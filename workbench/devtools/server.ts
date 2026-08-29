/**
 * Test UI backend: the composed workbench, end to end, with nothing faked.
 *
 * Every boundary is the production implementation — `wb-ollama` against a
 * local Ollama, `wb-model-gateway` routing capabilities to it, the harness's
 * own `LocalAttachmentStore` for image bytes, and the real `ToolRuntime`. What
 * this page shows is therefore a real local inference run, not a reproduction
 * of one.
 *
 * Requires Ollama: `ollama serve`, plus `ollama pull qwen2.5vl` and
 * `ollama pull nomic-embed-text`. Without it the page still loads and the
 * manifest panels work; a tool call returns the adapter's own error naming the
 * `ollama pull` that fixes it.
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
import LlmRuntime, { CallId } from '@deepseek-ai/dsh-llm'
import { homedir } from 'node:os'
import LocalAttachmentStore from '@deepseek-ai/dsh-attachment-local'
import WbToolGateway, { DEFAULT_HARNESS_MANIFESTS } from '../packages/wb-tool-gateway/src/index.ts'
import * as WbOllama from '../packages/wb-ollama/src/index.ts'
import * as WbModelGateway from '../packages/wb-model-gateway/src/index.ts'
import * as WbVision from '../packages/wb-vision/src/index.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT ?? 4173)

/** Where Ollama listens; the on-premise guard refuses anything non-private. */
const OLLAMA_URL = process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434'
/** Vision model both `wb_ocr_extract` and `wb_vision_analyze` resolve to. */
const VISION_MODEL = process.env.WB_VISION_MODEL ?? 'qwen2.5vl'
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

  // The LLM runtime itself. Everything downstream injects `llm`, and Cordis
  // inject is required-only — without this the adapter, the gateway and
  // wb-vision all silently fail to apply and no tool registers at all.
  await ctx.plugin(LlmRuntime, {})

  // The harness's own attachment store. wb-vision hands it image bytes and
  // gets back a reference; the Ollama adapter reads the bytes back out. The
  // stub returned a fixed id, so nothing ever round-tripped through storage.
  await ctx.plugin(LocalAttachmentStore, {
    dshHome: process.env.DSH_HOME ?? join(homedir(), '.dsh'),
  })

  // Local models. wb-ollama is the only workbench package permitted to open a
  // socket, and its host guard refuses anything that is not loopback or
  // RFC 1918 — see DESIGN.md §9 invariant 3.
  await ctx.plugin(WbOllama, {
    baseUrl: OLLAMA_URL,
    providers: ['llm-local', 'llm-vision-local', 'embedding-local', 'reranker-local'],
    embeddingModel: process.env.WB_EMBEDDING_MODEL ?? 'nomic-embed-text',
  })

  // Capability routing, mounted AFTER the adapter: it validates every routing
  // target against the adapters actually registered and throws at load if one
  // is missing, so it needs the routes to exist first.
  await ctx.plugin(WbModelGateway, {
    routing: {
      reasoning: 'llm-local',
      vision_reasoning: 'llm-vision-local',
      embedding: 'embedding-local',
      rerank: 'reranker-local',
      ocr: 'llm-vision-local',
    },
  })

  // Real wb-vision, registering into the real tool registry and the real
  // wb-tool-gateway mounted above — no wrapper, so what the UI reads back is
  // exactly what wb-policy would read.
  // Name the model explicitly rather than relying on discovery: `listModels`
  // returns empty when Ollama is unreachable (advisory, by the adapter
  // contract), and without a configured model that surfaces as a confusing
  // "lists no models" instead of a connection error naming the fix.
  await ctx.plugin(WbVision, {
    models: { vision_reasoning: VISION_MODEL, ocr: VISION_MODEL },
  })
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
        // Real inference: the model that answered, and how long it took.
        model: VISION_MODEL,
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
