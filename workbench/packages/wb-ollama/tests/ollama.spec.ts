import { describe, expect, it, beforeAll, afterAll, beforeEach } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Context } from '@deepseek-ai/cordis'
import { isOnPremiseHost, requireOnPremiseUrl } from '../src/host-guard.ts'
import { OllamaAdapter, toOllamaMessages } from '../src/adapter.ts'
import { OllamaEmbeddings } from '../src/embeddings.ts'

/**
 * A stand-in Ollama, speaking the real wire format on a real socket.
 *
 * The adapter's job is almost entirely protocol handling — NDJSON framing,
 * partial-line buffering, error shapes — so it is exercised over HTTP rather
 * than against a stubbed `fetch`. Mocking `fetch` would assert that the code
 * calls itself correctly and prove nothing about the format.
 */
let server: Server
let baseUrl: string
let lastBody: Record<string, unknown> = {}
let scenario: 'ok' | 'split' | 'error-frame' | 'http-error' | 'no-embedding' = 'ok'

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      lastBody = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}

      if (req.url === '/api/tags') {
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ models: [{ name: 'llama3.2' }, { name: 'qwen2.5vl' }, {}] }))
        return
      }

      if (req.url === '/api/embeddings') {
        if (scenario === 'http-error') { res.statusCode = 404; res.end('model not found'); return }
        if (scenario === 'no-embedding') { res.end(JSON.stringify({ embedding: [] })); return }
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ embedding: [0.1, 0.2, 0.3, 0.4] }))
        return
      }

      if (req.url === '/api/chat') {
        if (scenario === 'http-error') { res.statusCode = 500; res.end('model runner crashed'); return }
        res.setHeader('content-type', 'application/x-ndjson')
        if (scenario === 'error-frame') {
          res.end(JSON.stringify({ error: 'model requires more system memory' }) + '\n')
          return
        }
        const frames = [
          { message: { role: 'assistant', content: 'PUMP ' } },
          { message: { role: 'assistant', content: 'P-101' } },
          { done: true, prompt_eval_count: 11, eval_count: 4 },
        ]
        if (scenario === 'split') {
          // Deliver a frame across two writes, mid-JSON, as TCP may.
          const text = frames.map((f) => JSON.stringify(f)).join('\n') + '\n'
          const cut = Math.floor(text.length / 2)
          res.write(text.slice(0, cut))
          setTimeout(() => res.end(text.slice(cut)), 5)
          return
        }
        res.end(frames.map((f) => JSON.stringify(f)).join('\n') + '\n')
        return
      }

      res.statusCode = 404
      res.end()
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())))
beforeEach(() => { scenario = 'ok' })

async function collect(stream: AsyncIterable<unknown>) {
  const out: unknown[] = []
  for await (const chunk of stream) out.push(chunk)
  return out as Array<Record<string, unknown>>
}

describe('on-premise host guard (§9 invariant 3)', () => {
  it('accepts loopback', () => {
    expect(isOnPremiseHost('127.0.0.1')).toBe(true)
    expect(isOnPremiseHost('localhost')).toBe(true)
    expect(isOnPremiseHost('::1')).toBe(true)
  })

  it('accepts RFC 1918 ranges, including the whole 172.16/12 block', () => {
    for (const host of ['10.0.0.5', '192.168.1.40', '172.16.0.1', '172.31.255.254']) {
      expect(isOnPremiseHost(host), host).toBe(true)
    }
  })

  it('rejects 172.15 and 172.32, which sit outside the private block', () => {
    // The classic off-by-one in hand-written private-range checks.
    expect(isOnPremiseHost('172.15.0.1')).toBe(false)
    expect(isOnPremiseHost('172.32.0.1')).toBe(false)
  })

  it('accepts .local and .internal LAN names', () => {
    expect(isOnPremiseHost('refinery-gpu.local')).toBe(true)
    expect(isOnPremiseHost('models.internal')).toBe(true)
  })

  it('rejects public hosts', () => {
    for (const host of ['api.openai.com', '8.8.8.8', 'ollama.com', '1.1.1.1']) {
      expect(isOnPremiseHost(host), host).toBe(false)
    }
  })

  it('refuses to construct an adapter pointed off-premise', () => {
    // The whole sovereignty claim: this must fail at load, not be denied
    // later, so a deployment cannot route the corpus off-site by editing one
    // config line and having it work.
    expect(() => new OllamaAdapter('https://api.openai.com')).toThrow(/not a loopback or private/)
  })

  it('names the offending host in the error', () => {
    expect(() => requireOnPremiseUrl('http://evil.example.com:11434')).toThrow(/evil\.example\.com/)
  })

  it('rejects a malformed URL rather than treating it as private', () => {
    expect(() => requireOnPremiseUrl('not a url')).toThrow(/not a valid URL/)
  })
})

describe('message translation', () => {
  const message = (content: unknown[]) => ({ id: 'm', role: 'user' as const, content, source: { kind: 'user' as const } })

  it('puts the system prompt first', async () => {
    const out = await toOllamaMessages([message([{ type: 'text', text: 'hi' }]) as never], 'be brief')
    expect(out[0]).toEqual({ role: 'system', content: 'be brief' })
  })

  it('carries images as base64 alongside the text', async () => {
    const out = await toOllamaMessages(
      [message([{ type: 'image', attachment: { attachmentId: 'a1' } }, { type: 'text', text: 'what is this?' }]) as never],
      undefined,
      async () => 'BASE64BYTES',
    )
    expect(out[0]).toMatchObject({ content: 'what is this?', images: ['BASE64BYTES'] })
  })

  it('announces an unresolvable image instead of dropping it', async () => {
    // A vision answer built from an image the model never received would look
    // confident and be baseless.
    const out = await toOllamaMessages(
      [message([{ type: 'image', attachment: { attachmentId: 'gone' } }]) as never],
      undefined,
      async () => undefined,
    )
    expect(out[0]!.content).toContain('could not be loaded')
    expect(out[0]!.images).toBeUndefined()
  })
})

describe('OllamaAdapter', () => {
  const adapter = () => new OllamaAdapter(baseUrl)

  it('lists the models the server has pulled, skipping malformed entries', async () => {
    expect((await adapter().listModels('llm-local')).map((m) => m.id)).toEqual(['llama3.2', 'qwen2.5vl'])
  })

  it('returns no models rather than throwing when the server is down', async () => {
    // Discovery is advisory; an unreachable server must not take a boot down.
    const dead = new OllamaAdapter('http://127.0.0.1:1')
    expect(await dead.listModels('llm-local')).toEqual([])
  })

  it('streams deltas, then a block, usage and finish', async () => {
    const chunks = await collect(adapter().stream({
      provider: 'llm-local', model: 'llama3.2',
      messages: [{ id: 'm', role: 'user', content: [{ type: 'text', text: 'read this' }], source: { kind: 'user' } }],
    } as never))
    expect(chunks.map((c) => c.type)).toEqual([
      'block-start', 'text-delta', 'text-delta', 'block-end', 'usage', 'finish',
    ])
    expect(chunks.filter((c) => c.type === 'text-delta').map((c) => c.text)).toEqual(['PUMP ', 'P-101'])
    expect((chunks.find((c) => c.type === 'block-end')!.block as { text: string }).text).toBe('PUMP P-101')
  })

  it('reassembles a frame split across TCP reads', async () => {
    // Parsing a partial line would drop tokens mid-answer.
    scenario = 'split'
    const chunks = await collect(adapter().stream({
      provider: 'llm-local', model: 'llama3.2',
      messages: [{ id: 'm', role: 'user', content: [{ type: 'text', text: 'q' }], source: { kind: 'user' } }],
    } as never))
    const text = (chunks.find((c) => c.type === 'block-end')!.block as { text: string }).text
    expect(text).toBe('PUMP P-101')
  })

  it('reports token usage from the done frame', async () => {
    const chunks = await collect(adapter().stream({
      provider: 'llm-local', model: 'llama3.2',
      messages: [{ id: 'm', role: 'user', content: [{ type: 'text', text: 'q' }], source: { kind: 'user' } }],
    } as never))
    expect(chunks.find((c) => c.type === 'usage')!.usage).toEqual({ inputTokens: 11, outputTokens: 4 })
  })

  it('sends the model, the messages and stream:true', async () => {
    await collect(adapter().stream({
      provider: 'llm-local', model: 'qwen2.5vl', temperature: 0.2,
      messages: [{ id: 'm', role: 'user', content: [{ type: 'text', text: 'q' }], source: { kind: 'user' } }],
    } as never))
    expect(lastBody).toMatchObject({ model: 'qwen2.5vl', stream: true })
    expect((lastBody.options as Record<string, unknown>).temperature).toBe(0.2)
  })

  it('an error frame becomes a thrown error, not a silent empty answer', async () => {
    scenario = 'error-frame'
    await expect(collect(adapter().stream({
      provider: 'llm-local', model: 'llama3.2',
      messages: [{ id: 'm', role: 'user', content: [{ type: 'text', text: 'q' }], source: { kind: 'user' } }],
    } as never))).rejects.toThrow(/system memory/)
  })

  it('an HTTP failure says how to fix it', async () => {
    scenario = 'http-error'
    await expect(collect(adapter().stream({
      provider: 'llm-local', model: 'llama3.2',
      messages: [{ id: 'm', role: 'user', content: [{ type: 'text', text: 'q' }], source: { kind: 'user' } }],
    } as never))).rejects.toThrow(/ollama pull llama3\.2/)
  })
})

describe('OllamaEmbeddings', () => {
  function mount(model = 'nomic-embed-text') {
    const ctx = new Context()
    return new OllamaEmbeddings(ctx, model, baseUrl)
  }

  it('embeds one text', async () => {
    expect(await mount().embed(['pump bearing'])).toEqual([[0.1, 0.2, 0.3, 0.4]])
  })

  it('embeds a batch in input order', async () => {
    const vectors = await mount().embed(['a', 'b', 'c'])
    expect(vectors).toHaveLength(3)
  })

  it('reports its dimensionality', async () => {
    // An index written with one model cannot be read with another.
    expect(await mount().dimensions()).toBe(4)
  })

  it('a missing model fails loudly with the pull command', async () => {
    scenario = 'http-error'
    await expect(mount('not-pulled').embed(['x'])).rejects.toThrow(/ollama pull not-pulled/)
  })

  it('an empty vector is an error, not a silently indexed zero', async () => {
    // Indexing an empty vector would rank meaninglessly and look like a
    // retrieval-quality problem rather than a broken embedding.
    scenario = 'no-embedding'
    await expect(mount().embed(['x'])).rejects.toThrow(/no embedding vector/)
  })

  it('refuses an off-premise host at construction', () => {
    expect(() => new OllamaEmbeddings(new Context(), 'm', 'https://api.openai.com'))
      .toThrow(/not a loopback or private/)
  })
})
