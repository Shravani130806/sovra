import { describe, expect, it, afterEach, beforeAll, afterAll } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { OllamaEmbeddings } from '@mrpl/dsh-workbench-ollama'
import { ADMIN_SESSION, compose, SESSION, testUser, type Composed } from '../harness.ts'

/**
 * Edge: wb-ingestion and wb-rag over the REAL embedding seam.
 *
 * The seam is what makes retrieval semantic; before it existed both sides fell
 * back to a hash of the text. A local Ollama is stood in for by a server
 * speaking its wire format — the point under test is that writer and reader
 * embed through the same provider, not the quality of any one model.
 */
let server: Server
let baseUrl: string
/** Vectors keyed by the text asked for, so retrieval order is predictable. */
const VECTORS: Record<string, number[]> = {
  'pump bearing failure': [1, 0, 0, 0],
  'bearing wear on pump P-101 outboard side': [0.99, 0.1, 0, 0],
  'canteen menu for Tuesday': [0, 0, 1, 0],
}

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      const { prompt } = JSON.parse(Buffer.concat(chunks).toString() || '{}') as { prompt?: string }
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ embedding: VECTORS[prompt ?? ''] ?? [0, 0, 0, 1] }))
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => new Promise<void>((r) => server.close(() => r())))

describe('wb-ollama embeddings -> wb-ingestion -> wb-rag', () => {
  let c: Composed | undefined
  afterEach(() => { c?.dispose(); c = undefined })

  async function composeWithEmbeddings() {
    const composed = await compose()
    new OllamaEmbeddings(composed.ctx, 'nomic-embed-text', baseUrl)
    return composed
  }

  it('the seam is reachable as ctx.wbEmbeddings', async () => {
    c = await composeWithEmbeddings()
    expect(c.ctx.get('wbEmbeddings')).toBeDefined()
    expect(await c.ctx.wbEmbeddings!.dimensions()).toBe(4)
  })

  it('ingestion embeds through the provider, and retrieval finds the match', async () => {
    c = await composeWithEmbeddings()
    const relevant = join(c.home, 'inspection.txt')
    const irrelevant = join(c.home, 'canteen.txt')
    writeFileSync(relevant, 'bearing wear on pump P-101 outboard side')
    writeFileSync(irrelevant, 'canteen menu for Tuesday')

    for (const path of [relevant, irrelevant]) {
      await c.ctx.wbIngestion.enqueue({
        path, declaredClassification: 'INTERNAL',
        user: testUser().id, sessionId: ADMIN_SESSION,
      })
    }

    const result = await c.ctx.wbRag.retrieve('pump bearing failure', testUser(), SESSION)
    expect(result.chunks.length).toBeGreaterThan(0)
    // The nearest vector wins: the inspection note, not the canteen menu.
    expect(result.chunks[0]!.text).toContain('bearing wear')
  })

  it('writer and reader agree — a document embedded on ingest is retrievable', async () => {
    // The failure this guards: if only one side used the provider, every
    // vector comparison would cross provenance and rank meaninglessly while
    // still returning plausible-looking numbers.
    c = await composeWithEmbeddings()
    const path = join(c.home, 'sop.txt')
    writeFileSync(path, 'bearing wear on pump P-101 outboard side')
    await c.ctx.wbIngestion.enqueue({
      path, declaredClassification: 'INTERNAL',
      user: testUser().id, sessionId: ADMIN_SESSION,
    })
    const result = await c.ctx.wbRag.retrieve('pump bearing failure', testUser(), SESSION)
    expect(result.chunks).toHaveLength(1)
  })

  it('without the seam both sides still work, together, on the lexical fallback', async () => {
    // A deployment with no embedding model must not break — it just is not
    // semantic, which the README states rather than leaving to discovery.
    c = await compose()
    expect(c.ctx.get('wbEmbeddings')).toBeUndefined()
    const path = join(c.home, 'note.txt')
    writeFileSync(path, 'pump bearing inspection notes')
    await c.ctx.wbIngestion.enqueue({
      path, declaredClassification: 'INTERNAL',
      user: testUser().id, sessionId: ADMIN_SESSION,
    })
    const result = await c.ctx.wbRag.retrieve('pump bearing', testUser(), SESSION)
    expect(result.chunks.length).toBeGreaterThan(0)
  })
})
