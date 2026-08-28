import { describe, expect, it, afterEach } from 'vitest'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { asWbDocumentId } from '@mrpl/dsh-workbench-types'
import { compose, SESSION, testUser, type Composed } from '../harness.ts'

/**
 * Edge: wb-audit receiving events from the REAL emitters, not fixtures it
 * emitted itself.
 */
describe('real emitters -> wb-audit', () => {
  let c: Composed | undefined
  afterEach(() => { c?.dispose(); c = undefined })

  it('records a policy decision produced by a real evaluate() call', async () => {
    c = await compose()
    await c.ctx.wbPolicy.evaluate({
      user: testUser().id,
      sessionId: SESSION,
      agentPreset: 'document-analyst',
      action: 'invoke_tool',
      classification: 'INTERNAL',
      destination: 'local',
      tool: 'read',
    })
    const entries = c.ctx.wbAudit.query({ kind: 'policy_decision' })
    expect(entries.length).toBeGreaterThan(0)
    expect(entries[0]!.sessionId).toBe(SESSION)
  })

  it('records a retrieval produced by a real wb-rag call', async () => {
    c = await compose()
    writeFileSync(join(c.home, 'vector-index.jsonl'), JSON.stringify({
      text: 'sop step 4', documentId: asWbDocumentId('doc-sop'), title: 'SOP',
      page: 4, classification: 'INTERNAL', embedding: [0.1, 0.1, 0.1, 0.1],
    }) + '\n')
    await c.ctx.wbRag.retrieve('sop', testUser(), SESSION)
    expect(c.ctx.wbAudit.query({ kind: 'rag_retrieval' }).length).toBeGreaterThan(0)
  })

  it('records an ingestion completed by real wb-ingestion', async () => {
    c = await compose()
    const file = join(c.home, 'note.txt')
    writeFileSync(file, 'pump P-101 inspection notes')
    await c.ctx.wbIngestion.enqueue({ path: file, declaredClassification: 'CONFIDENTIAL' })
    const entries = c.ctx.wbAudit.query({ kind: 'ingestion_completed' })
    expect(entries.length).toBeGreaterThan(0)
    expect(entries[0]!.summary).toContain('CONFIDENTIAL')
  })
})
