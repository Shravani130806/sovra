/**
 * Test UI backend: mounts the REAL `wb-tool-gateway` and `wb-vision` plugins
 * over a real Cordis `Context` and the harness's real `ToolRuntime`, then
 * exposes their output over HTTP.
 *
 * Only the model boundary and the two not-yet-relevant siblings are faked, the
 * same way the package tests fake them — so what this page shows is the
 * plugins' genuine output, not a reproduction of it. The canned model reply is
 * supplied per request by the UI, which is what makes it useful for checking
 * how each tool handles a good, an unanswerable, and a malformed answer.
 *
 * Run: `pnpm dev:workbench-ui` (or `node --import tsx workbench/devtools/server.ts`).
 * @module workbench/devtools/server
 */

import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { CallId } from '@deepseek-ai/dsh-llm'
import type { WbModelCapability } from '@mrpl/dsh-workbench-types'
import WbToolGateway, { DEFAULT_HARNESS_MANIFESTS } from '../packages/wb-tool-gateway/src/index.ts'
import * as WbVision from '../packages/wb-vision/src/index.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT ?? 4173)

/** What the faked vision model returns for the next call. */
let cannedModelReply = ''
/** Capabilities `wb-vision` asked `wb-model-gateway` to resolve, most recent last. */
let resolvedCapabilities: WbModelCapability[] = []
/** The frozen tool names `wb-vision` publishes manifests for (DESIGN.md §7.5). */
const VISION_TOOL_IDS = ['wb_ocr_extract', 'wb_vision_analyze']

/**
 * Build one context with both real plugins mounted.
 * @returns the mounted context.
 */
async function mount(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime, { mode: 'native' })

  // Real wb-tool-gateway.
  await ctx.plugin(WbToolGateway, {})

  // Faked model boundary — no API key, fully deterministic.
  ctx.provide('wbModelGateway', {
    resolve(capability: WbModelCapability) {
      resolvedCapabilities.push(capability)
      return { adapterId: 'llm-vision-local', capability }
    },
  })
  ctx.provide('attachments', {
    async saveImage(input: { data: Uint8Array; mediaType: string; name?: string }) {
      if (input.data.length === 0) throw new Error('empty image bytes')
      return {
        attachmentId: 'att-devtools',
        mediaType: input.mediaType,
        bytes: input.data.length,
        width: 1,
        height: 1,
        name: input.name,
      }
    },
  })
  ctx.provide('llm', {
    listModels: async () => [{ id: 'qwen-vl-local', name: 'Qwen-VL (local)' }],
    listProviders: () => [{ id: 'llm-vision-local', name: 'local vision' }],
    async *stream() {
      yield { type: 'text-delta', index: 0, text: cannedModelReply }
      yield { type: 'finish', reason: 'stop' }
    },
  })

  // Real wb-vision, registering into the real tool registry and the real
  // wb-tool-gateway mounted above — no wrapper, so what the UI reads back is
  // exactly what wb-policy would read.
  await ctx.plugin(WbVision, {})
  return ctx
}

const ctx = await mount()
let callCounter = 0

/**
 * Read and JSON-parse a request body.
 * @param req - the incoming request.
 * @returns the parsed body.
 */
async function readJson(req: import('node:http').IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as Record<string, unknown>
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`)
  const send = (code: number, body: unknown): void => {
    res.writeHead(code, { 'content-type': 'application/json' })
    res.end(JSON.stringify(body, null, 2))
  }

  try {
    if (url.pathname === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(await readFile(join(HERE, 'index.html'), 'utf8'))
      return
    }

    // Everything wb-tool-gateway knows, straight from the live service.
    if (url.pathname === '/api/manifests') {
      const ids = [...Object.keys(DEFAULT_HARNESS_MANIFESTS), ...VISION_TOOL_IDS]
      send(200, {
        registeredTools: ctx.tools.schemas().map((s: { name: string }) => s.name).sort(),
        manifests: ids.map((id) => ctx.wbToolGateway.getManifest(id)).filter(Boolean),
      })
      return
    }

    // The lookup wb-policy performs on every tool call.
    if (url.pathname === '/api/manifest') {
      const toolId = url.searchParams.get('toolId') ?? ''
      const manifest = ctx.wbToolGateway.getManifest(toolId)
      send(200, {
        toolId,
        manifest: manifest ?? null,
        policyWouldSay: manifest
          ? 'evaluated against this manifest'
          : 'DENY — reason: NO_MANIFEST (wb-policy default-denies an unmanifested tool)',
      })
      return
    }

    // Run a real tool call through the real registry.
    if (url.pathname === '/api/tool' && req.method === 'POST') {
      const body = await readJson(req)
      cannedModelReply = String(body.modelReply ?? '')
      resolvedCapabilities = []
      const args = body.arguments as Record<string, unknown>
      const started = Date.now()
      const result = await ctx.tools.execute({
        callId: CallId(`devtools-${++callCounter}`),
        name: String(body.name),
        arguments: args,
        signal: new AbortController().signal,
      })
      send(200, {
        isError: result.isError,
        value: result.isError ? null : result.value,
        content: result.content,
        // ToolFailure is a structured object; pass it through rather than
        // stringifying it into "[object Object]".
        error: result.isError ? result.error : null,
        resolvedCapabilities,
        ms: Date.now() - started,
      })
      return
    }

    send(404, { error: 'not found' })
  } catch (error) {
    send(500, { error: error instanceof Error ? error.message : String(error) })
  }
})

server.listen(PORT, () => {
  process.stdout.write(`workbench test UI on http://localhost:${PORT}\n`)
})
