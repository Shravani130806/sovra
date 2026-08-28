import { describe, expect, it, afterEach } from 'vitest'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { compose, SESSION, testUser, type Composed } from '../harness.ts'

/** §9 invariant 6 — classification is never silently downgraded. */
describe('invariant 6: classification survives ingestion -> index -> retrieval', () => {
  let c: Composed | undefined
  afterEach(() => { c?.dispose(); c = undefined })

  it('a CONFIDENTIAL document is still CONFIDENTIAL on every retrieved chunk', async () => {
    c = await compose()
    const file = join(c.home, 'inspection.txt')
    writeFileSync(file, 'Pump P-101 inspection: bearing wear noted on the outboard side.')

    await c.ctx.wbIngestion.enqueue({ path: file, declaredClassification: 'CONFIDENTIAL', user: testUser().id, sessionId: SESSION })
    const result = await c.ctx.wbRag.retrieve('pump bearing', testUser(), SESSION)

    expect(result.chunks.length, 'nothing was retrieved to check').toBeGreaterThan(0)
    for (const chunk of result.chunks) {
      expect(chunk.classification).toBe('CONFIDENTIAL')
    }
  })

  it('the ingestion audit entry records the band it entered under', async () => {
    c = await compose()
    const file = join(c.home, 'restricted.txt')
    writeFileSync(file, 'P&ID revision notes for unit 400.')
    await c.ctx.wbIngestion.enqueue({ path: file, declaredClassification: 'RESTRICTED', user: testUser().id, sessionId: SESSION })
    const entries = c.ctx.wbAudit.query({ kind: 'ingestion_completed' })
    expect(entries[0]!.summary).toContain('RESTRICTED')
  })
})
