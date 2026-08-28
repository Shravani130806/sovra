import { describe, expect, it, afterEach } from 'vitest'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { asWbDocumentId, type WbClassification } from '@mrpl/dsh-workbench-types'
import { compose, SESSION, testUser, type Composed } from '../harness.ts'

function seedIndex(home: string, rows: Array<{ text: string; classification: WbClassification }>) {
  const lines = rows.map((r, i) => JSON.stringify({
    text: r.text,
    documentId: asWbDocumentId(`doc-${i}`),
    title: `Doc ${i}`,
    page: 1,
    classification: r.classification,
    embedding: Array.from({ length: 8 }, () => 0.1),
  }))
  writeFileSync(join(home, 'vector-index.jsonl'), lines.join('\n') + '\n')
}

/**
 * Edge: wb-rag's per-chunk authorization against the REAL policy engine.
 * wb-rag's own suite used an instant fake that answered from a queue.
 */
describe('wb-policy -> wb-rag', () => {
  let c: Composed | undefined
  afterEach(() => { c?.dispose(); c = undefined })

  it('a cleared user receives chunks — the real engine does not deny everything', async () => {
    // The failure this guards: wb-policy resolved identity by USER id while
    // wb-rag passed one, so every chunk came back IDENTITY_UNRESOLVED and
    // retrieval silently returned nothing in the composed system.
    c = await compose()
    seedIndex(c.home, [{ text: 'pump P-101 spec', classification: 'INTERNAL' }])
    const result = await c.ctx.wbRag.retrieve('pump', testUser(), SESSION)
    expect(result.chunks.length, 'real policy denied every chunk').toBeGreaterThan(0)
    expect(result.filtered).toHaveLength(0)
  })

  it('a low-clearance user is filtered by the real matrix, with a reason', async () => {
    c = await compose({
      sessions: { [SESSION]: testUser({ clearance: 'PUBLIC' as WbClassification }) },
    })
    seedIndex(c.home, [{ text: 'restricted drawing', classification: 'RESTRICTED' }])
    const result = await c.ctx.wbRag.retrieve('drawing', testUser({ clearance: 'PUBLIC' as WbClassification }), SESSION)
    expect(result.chunks).toHaveLength(0)
    expect(result.filtered).toHaveLength(1)
    expect(result.filtered[0]!.reason).toBeTruthy()
  })

  it('a denied chunk never appears in citations', async () => {
    c = await compose({
      sessions: { [SESSION]: testUser({ clearance: 'PUBLIC' as WbClassification }) },
    })
    seedIndex(c.home, [{ text: 'secret', classification: 'RESTRICTED' }])
    const result = await c.ctx.wbRag.retrieve('secret', testUser({ clearance: 'PUBLIC' as WbClassification }), SESSION)
    expect(result.citations).toHaveLength(0)
  })
})
