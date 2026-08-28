/**
 * Composition harness for the workbench integration suites.
 *
 * Mounts the REAL `wb-*` plugins in the order `cordis/workbench.cordis.yml`
 * declares, over the harness's real `ToolRuntime`. The only stand-ins are the
 * ones a CI box cannot supply: `llm` adapters (no model server) and the
 * attachment store's byte handling. Everything else — identity, policy,
 * the tool gateway, audit, rag, vision, ingestion, artifacts — is the real
 * plugin, so a disagreement between two of them shows up here rather than
 * being absorbed by a fake.
 * @module workbench/tests/harness
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { CallId } from '@deepseek-ai/dsh-llm'
import {
  asWbSessionId,
  asWbUserId,
  type WbClassification,
  type WbSessionId,
  type WbUser,
} from '@mrpl/dsh-workbench-types'

import WbToolGateway from '@mrpl/dsh-workbench-tool-gateway'
import WbPolicy from '@mrpl/dsh-workbench-policy'
import WbAudit from '@mrpl/dsh-workbench-audit'
import WbModelGateway from '@mrpl/dsh-workbench-model-gateway'
import * as WbVision from '@mrpl/dsh-workbench-vision'
import * as WbRag from '@mrpl/dsh-workbench-rag'
import * as WbIngestion from '@mrpl/dsh-workbench-ingestion'

/** The routing table from `cordis/workbench.cordis.yml`, with stub adapter ids. */
export const STUB_ROUTING = {
  reasoning: 'llm-deepseek',
  vision_reasoning: 'llm-vision-local',
  embedding: 'embedding-local',
  rerank: 'reranker-local',
  ocr: 'llm-vision-local',
}

/** What a composed workbench under test exposes to a suite. */
export interface Composed {
  ctx: Context
  home: string
  /** Text the stubbed model returns next. */
  setModelReply(text: string): void
  /** Every provider/model pair the stub adapter was asked to answer. */
  modelCalls: Array<{ provider: string; model: string }>
  /** Chunk texts handed to the reranker, in call order. */
  rerankedTexts: string[]
  dispose(): void
}

export interface ComposeOptions {
  /** Users the identity provider will resolve, keyed by session id. */
  sessions?: Record<string, WbUser>
  /** Override the capability routing, to test misconfiguration. */
  routing?: Partial<typeof STUB_ROUTING>
  /** Mount adapters under these ids; defaults to every id STUB_ROUTING names. */
  mountedAdapters?: string[]
  /** Omit a plugin from the bundle, to prove a consumer refuses to run without it. */
  omit?: Array<'identity' | 'toolGateway' | 'policy' | 'audit' | 'modelGateway'>
  /** Replace the policy matrix, to test malformed config. */
  policyConfig?: unknown
}

/** A principal with full clearance and every tool category. */
export function testUser(overrides: Partial<WbUser> = {}): WbUser {
  return {
    id: asWbUserId('u-integration'),
    displayName: 'Integration User',
    department: 'Engineering',
    role: 'process-engineer',
    clearance: 'RESTRICTED' as WbClassification,
    allowedAgentPresets: ['document-analyst', 'engineering-vision'],
    allowedToolCategories: ['local', 'enterprise', 'external'],
    networkPermissions: ['web_search'],
    ...overrides,
  }
}

/** The default session every suite uses unless it says otherwise. */
export const SESSION: WbSessionId = asWbSessionId('s-integration')

/**
 * A fully-cleared operator's session.
 *
 * Loading the corpus is itself governed (`action: 'ingest_document'`), so a
 * suite testing a low-clearance principal still needs a cleared session to
 * seed with — which is also the realistic deployment: an operator loads the
 * corpus, and engineers query it under their own clearance.
 */
export const ADMIN_SESSION: WbSessionId = asWbSessionId('s-admin')

/**
 * Mount the composed workbench.
 * @param options - what to vary from the good configuration.
 * @returns the mounted context plus the instrumentation suites assert on.
 */
export async function compose(options: ComposeOptions = {}): Promise<Composed> {
  const home = mkdtempSync(join(tmpdir(), 'wb-integration-'))
  const ctx = new Context()
  const modelCalls: Array<{ provider: string; model: string }> = []
  const rerankedTexts: string[] = []
  let modelReply = JSON.stringify({ text: 'stub', blocks: [] })

  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime, { mode: 'native' })

  // --- the two stand-ins a CI box cannot avoid -------------------------------
  const adapters = options.mountedAdapters ?? [...new Set(Object.values(STUB_ROUTING))]
  ctx.provide('llm', {
    listProviders: () => adapters.map((id) => ({ id, name: id })),
    listModels: async () => [{ id: 'stub-model', name: 'stub-model' }],
    async *stream(opts: { provider: string; model: string }) {
      modelCalls.push({ provider: opts.provider, model: opts.model })
      yield { type: 'text-delta', index: 0, text: modelReply }
      yield { type: 'finish', reason: 'stop' }
    },
  })
  ctx.provide('attachments', {
    imageLimits: {
      mediaTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
      maxImageBytes: 5_000_000,
      maxMessageImageBytes: 5_000_000,
      maxImageDimension: 8000,
      maxImagePixels: 40_000_000,
    },
    async saveImage(input: { data: Uint8Array; mediaType: string; name?: string }) {
      if (input.data.length === 0) throw new Error('empty image bytes')
      return {
        attachmentId: 'att-integration',
        mediaType: input.mediaType,
        bytes: input.data.length,
        width: 1,
        height: 1,
        name: input.name,
      }
    },
  })

  // --- real plugins, in workbench.cordis.yml order --------------------------
  if (!options.omit?.includes('identity')) {
    // The admin session is always present so any suite can seed the corpus;
    // an explicit `sessions` map still governs who SESSION resolves to.
    const sessions = { [ADMIN_SESSION]: testUser(), ...(options.sessions ?? { [SESSION]: testUser() }) }
    ctx.provide('wbIdentity', {
      current: (sessionId: WbSessionId) => sessions[sessionId],
    })
  }

  if (!options.omit?.includes('toolGateway')) await ctx.plugin(WbToolGateway, {})
  if (!options.omit?.includes('policy')) {
    await ctx.plugin(WbPolicy, options.policyConfig ?? undefined)
  }
  if (!options.omit?.includes('audit')) {
    await ctx.plugin(WbAudit, { root: join(home, 'audit') })
  }
  if (!options.omit?.includes('modelGateway')) {
    await ctx.plugin(WbModelGateway, { routing: { ...STUB_ROUTING, ...options.routing } })
  }
  await ctx.plugin(WbVision, {})
  await ctx.plugin(WbRag, { indexPath: join(home, 'vector-index.jsonl') })
  await ctx.plugin(WbIngestion, { indexPath: join(home, 'vector-index.jsonl'), root: home })

  return {
    ctx,
    home,
    modelCalls,
    rerankedTexts,
    setModelReply(text: string) {
      modelReply = text
    },
    dispose() {
      rmSync(home, { recursive: true, force: true })
    },
  }
}

let callCounter = 0

/**
 * Run one tool call through the real registry, so it crosses the real
 * `tools/pre-execute` gate exactly as a model-issued call would.
 * @param ctx - the composed context.
 * @param name - the registered tool name.
 * @param args - the tool arguments.
 * @param sessionId - the session to attribute the call to.
 * @returns the settled tool result.
 */
export function callTool(
  ctx: Context,
  name: string,
  args: Record<string, unknown>,
  sessionId: WbSessionId = SESSION,
) {
  return ctx.tools.execute({
    callId: CallId(`integration-${++callCounter}`),
    name,
    arguments: args,
    agent: { session: { id: sessionId } },
    signal: new AbortController().signal,
  } as Parameters<Context['tools']['execute']>[0])
}
