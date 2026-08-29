import { describe, expect, it, beforeEach, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { CallId } from '@deepseek-ai/dsh-llm'
import type { WbModelCapability, WbModelHandle, WbToolManifest } from '@mrpl/dsh-workbench-types'
import * as WbVision from '../src/index.ts'

/** A 1x1 PNG — the smallest input the attachment service will accept. */
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

interface Harness {
  ctx: Context
  resolved: WbModelCapability[]
  manifests: WbToolManifest[]
  /** Text the faked model streams back, per call. */
  setModelReply(text: string): void
  modelCalls: Array<{ provider: string; model: string }>
}

/**
 * Mount wb-vision over the real tools/Context machinery, faking only the
 * model boundary (the expensive, non-deterministic part) plus the two
 * workbench siblings' service interfaces.
 */
async function harness(options: { modelReply?: string; hangForever?: boolean } = {}): Promise<Harness> {
  const ctx = new Context()
  // Real tools registry: the tool-call entry path under test must be the real
  // one. Only the model boundary and the two workbench siblings are faked.
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime, { mode: 'native' })
  const resolved: WbModelCapability[] = []
  const manifests: WbToolManifest[] = []
  const modelCalls: Array<{ provider: string; model: string }> = []
  let reply = options.modelReply ?? JSON.stringify({ text: 'PUMP P-101', blocks: [] })

  ctx.provide('wbModelGateway', {
    resolve(capability: WbModelCapability): WbModelHandle {
      resolved.push(capability)
      return { adapterId: 'llm-vision-local', capability }
    },
  })

  ctx.provide('wbToolGateway', {
    registerManifest(manifest: WbToolManifest) {
      manifests.push(manifest)
    },
    getManifest(toolId: string) {
      return manifests.find((m) => m.toolId === toolId)
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
        attachmentId: 'att-1',
        mediaType: input.mediaType,
        bytes: input.data.length,
        width: 1,
        height: 1,
        name: input.name,
      }
    },
  })

  ctx.provide('llm', {
    listModels: async () => [{ id: 'qwen-vl', name: 'qwen-vl' }],
    listProviders: () => [{ id: 'llm-vision-local', name: 'local vision' }],
    async *stream(opts: { provider: string; model: string }) {
      modelCalls.push({ provider: opts.provider, model: opts.model })
      if (options.hangForever) {
        await new Promise(() => {})
      }
      yield { type: 'text-delta', index: 0, text: reply }
      yield { type: 'finish', reason: 'stop' }
    },
  })

  await ctx.plugin(WbVision, {})
  return {
    ctx,
    resolved,
    manifests,
    modelCalls,
    setModelReply(text: string) {
      reply = text
    },
  }
}

/** Invoke a tool through the real registry, not by calling the module function. */
let callCounter = 0
async function callTool(ctx: Context, name: string, args: Record<string, unknown>, signal?: AbortSignal) {
  const controller = new AbortController()
  return ctx.tools.execute({
    callId: CallId(`wb-vision-call-${++callCounter}`),
    name,
    arguments: args,
    signal: signal ?? controller.signal,
  })
}

describe('wb-vision plugin', () => {
  let h: Harness

  beforeEach(async () => {
    h = await harness()
  })

  describe('service surface', () => {
    it('exposes wbVision with describe()', () => {
      expect(h.ctx.wbVision).toBeDefined()
      expect(typeof h.ctx.wbVision.describe).toBe('function')
    })

    it('registers both frozen tool names, and no others', () => {
      const names = h.ctx.tools.schemas().map((s: { name: string }) => s.name).sort()
      expect(names).toEqual(['wb_ocr_extract', 'wb_vision_analyze'])
    })
  })

  describe('wb_ocr_extract', () => {
    it('returns structured text and layout through the real tool registry', async () => {
      h.setModelReply(
        JSON.stringify({ text: 'PUMP P-101', blocks: [{ text: 'PUMP P-101', box: [0, 0, 1, 1], confidence: 0.9 }] }),
      )
      const result = await callTool(h.ctx, 'wb_ocr_extract', { image: PNG_1X1.toString('base64'), mediaType: 'image/png' })
      expect(result.isError).toBeFalsy()
      expect(result.value).toMatchObject({ text: 'PUMP P-101' })
      expect(Array.isArray((result.value as { blocks: unknown[] }).blocks)).toBe(true)
    })

    it('resolves the ocr capability, not vision_reasoning', async () => {
      await callTool(h.ctx, 'wb_ocr_extract', { image: PNG_1X1.toString('base64'), mediaType: 'image/png' })
      expect(h.resolved).toContain('ocr')
      expect(h.resolved).not.toContain('vision_reasoning')
    })

    it('returns a structured value, never a bare string', async () => {
      const result = await callTool(h.ctx, 'wb_ocr_extract', { image: PNG_1X1.toString('base64'), mediaType: 'image/png' })
      expect(typeof result.value).toBe('object')
    })
  })

  describe('wb_vision_analyze', () => {
    it('answers a question about an image with structured findings', async () => {
      h.setModelReply(
        JSON.stringify({
          findings: [{ summary: 'P-101 feeds V-200', box: [0, 0, 1, 1], confidence: 0.8 }],
          answered: true,
        }),
      )
      const result = await callTool(h.ctx, 'wb_vision_analyze', {
        image: PNG_1X1.toString('base64'),
        mediaType: 'image/png',
        question: 'what equipment is connected to pump P-101?',
      })
      expect(result.isError).toBeFalsy()
      expect((result.value as { findings: unknown[] }).findings).toHaveLength(1)
    })

    it('resolves the vision_reasoning capability, not ocr', async () => {
      await callTool(h.ctx, 'wb_vision_analyze', {
        image: PNG_1X1.toString('base64'),
        mediaType: 'image/png',
        question: 'anything?',
      })
      expect(h.resolved).toContain('vision_reasoning')
      expect(h.resolved).not.toContain('ocr')
    })

    it('an unanswerable question is a structured no-finding result, not a thrown error', async () => {
      h.setModelReply(JSON.stringify({ findings: [], answered: false, reason: 'not visible in image' }))
      const result = await callTool(h.ctx, 'wb_vision_analyze', {
        image: PNG_1X1.toString('base64'),
        mediaType: 'image/png',
        question: 'what colour is the pump?',
      })
      expect(result.isError).toBeFalsy()
      expect(result.value).toMatchObject({ answered: false, findings: [] })
    })
  })

  describe('manifest registration', () => {
    it('registers exactly one manifest per tool at apply() time', () => {
      expect(h.manifests.map((m) => m.toolId).sort()).toEqual(['wb_ocr_extract', 'wb_vision_analyze'])
    })

    it('each manifest toolId equals the name the tool registered under', () => {
      const registered = h.ctx.tools.schemas().map((s: { name: string }) => s.name)
      for (const m of h.manifests) {
        // A mismatch means wb-policy denies the tool at every call with
        // NO_MANIFEST while both registrations individually look fine.
        expect(registered, `${m.toolId} has no matching registered tool`).toContain(m.toolId)
      }
    })

    it('both manifests declare local risk and no network access', () => {
      for (const m of h.manifests) {
        expect(m.riskLevel, m.toolId).toBe('local')
        expect(m.networkAccess, `${m.toolId} runs against a local adapter`).toBe('none')
      }
    })
  })

  describe('describe() as a plain service method', () => {
    it('works standalone, without going through the tool-call path', async () => {
      h.setModelReply(JSON.stringify({ text: 'scanned heading' }))
      const out = await h.ctx.wbVision.describe(PNG_1X1, 'transcribe this')
      expect(out).toMatchObject({ text: 'scanned heading' })
    })

    it('resolves through the same faked model boundary the tools use', async () => {
      await h.ctx.wbVision.describe(PNG_1X1, 'transcribe this')
      expect(h.modelCalls).toHaveLength(1)
      expect(h.modelCalls[0]!.provider).toBe('llm-vision-local')
    })

    it('accepts a filesystem path as well as a Buffer', async () => {
      const { writeFileSync, mkdtempSync } = await import('node:fs')
      const { join } = await import('node:path')
      const { tmpdir } = await import('node:os')
      const p = join(mkdtempSync(join(tmpdir(), 'wb-vision-')), 'x.png')
      writeFileSync(p, PNG_1X1)
      const out = await h.ctx.wbVision.describe(p, 'transcribe this')
      expect(out).toBeDefined()
    })
  })

  describe('cancellation', () => {
    it('a call whose signal fires mid-flight rejects rather than resolving stale', async () => {
      const hanging = await harness({ hangForever: true })
      const controller = new AbortController()
      const pending = callTool(hanging.ctx, 'wb_ocr_extract', {
        image: PNG_1X1.toString('base64'),
        mediaType: 'image/png',
      }, controller.signal)
      controller.abort()
      const result = await pending
      expect(result.isError).toBe(true)
    })
  })

  describe('malformed input', () => {
    it('empty image bytes are a structured tool error, not an unhandled throw', async () => {
      const result = await callTool(h.ctx, 'wb_ocr_extract', { image: '', mediaType: 'image/png' })
      expect(result.isError).toBe(true)
    })

    it('unreadable base64 is a structured tool error', async () => {
      const result = await callTool(h.ctx, 'wb_ocr_extract', {
        image: 'not-valid-base64!!!',
        mediaType: 'image/png',
      })
      expect(result.isError).toBe(true)
    })

    it('a model reply that is not the declared JSON is a tool error, not a silent empty result', async () => {
      h.setModelReply('I think it says PUMP P-101, roughly.')
      const result = await callTool(h.ctx, 'wb_ocr_extract', {
        image: PNG_1X1.toString('base64'),
        mediaType: 'image/png',
      })
      expect(result.isError).toBe(true)
    })

    it('describe() rejects on a path that does not exist', async () => {
      await expect(h.ctx.wbVision.describe('/nonexistent/file.png', 'x')).rejects.toThrow()
    })
  })

  describe('no tool-local policy gate', () => {
    it('does not consult wbPolicy itself — the central tools/pre-execute hook owns that', async () => {
      const evaluate = vi.fn()
      h.ctx.provide('wbPolicy', { evaluate })
      await callTool(h.ctx, 'wb_ocr_extract', { image: PNG_1X1.toString('base64'), mediaType: 'image/png' })
      expect(evaluate).not.toHaveBeenCalled()
    })
  })

  describe('disposal', () => {
    it('unregisters both tools when the plugin fiber disposes', async () => {
      const ctx = new Context()
      await ctx.plugin(SystemPrompt)
      await ctx.plugin(ToolRuntime, { mode: 'native' })
      ctx.provide('wbModelGateway', { resolve: (c: WbModelCapability) => ({ adapterId: 'a', capability: c }) })
      ctx.provide('wbToolGateway', { registerManifest() {}, getManifest: () => undefined })
      ctx.provide('attachments', { async saveImage() { return {} } })
      ctx.provide('llm', { listModels: async () => [{ id: 'm' }], async *stream() {} })

      const fork = await ctx.plugin(WbVision, {})
      expect(ctx.tools.schemas().map((s: { name: string }) => s.name).sort()).toEqual([
        'wb_ocr_extract',
        'wb_vision_analyze',
      ])
      await fork.dispose()
      expect(ctx.tools.schemas()).toHaveLength(0)
    })
  })
})

describe('diagnostics', () => {
  it('no model output is reported as an unreachable model, not as bad JSON', async () => {
    // These are different failures. Calling an empty stream "did not return
    // the requested JSON" sends an operator to inspect the prompt when the
    // real cause is almost always a model server that is not running.
    const h = await harness()
    h.setModelReply('')
    const result = await callTool(h.ctx, 'wb_ocr_extract', {
      image: PNG_1X1.toString('base64'),
      mediaType: 'image/png',
    })
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result.error)).toMatch(/produced no output/)
    expect(JSON.stringify(result.error)).toMatch(/ollama/)
  })

  it('bad-but-present output still reports as bad JSON', async () => {
    const h = await harness()
    h.setModelReply('I think it says PUMP P-101.')
    const result = await callTool(h.ctx, 'wb_ocr_extract', {
      image: PNG_1X1.toString('base64'),
      mediaType: 'image/png',
    })
    expect(JSON.stringify(result.error)).toMatch(/did not return the requested JSON/)
  })
})
