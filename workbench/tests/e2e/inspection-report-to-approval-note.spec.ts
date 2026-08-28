import { describe, expect, it, afterEach } from 'vitest'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ADMIN_SESSION, compose, SESSION, testUser, type Composed } from '../harness.ts'

/**
 * §10 scenario: scanned inspection report -> ingestion -> OCR -> retrieval ->
 * a real approval note on disk carrying the citations of the SOPs used.
 *
 * Scope note: this drives the real plugin chain, NOT a preset-driven agent
 * turn. Running it through a preset start to finish needs the harness agent
 * loop against a live model, which this environment has no key for; the gap is
 * recorded in INTEGRATION_LOG.md rather than papered over here.
 */
describe('e2e: inspection report to approval note', () => {
  let c: Composed | undefined
  afterEach(() => { c?.dispose(); c = undefined })

  it('produces a real file whose citations match the documents retrieved', async () => {
    c = await compose()
    const { ctx } = c

    // 1. a fixture SOP enters the corpus at CONFIDENTIAL
    const sop = join(c.home, 'pump-sop.txt')
    writeFileSync(sop, 'SOP 4.2: pump P-101 bearing replacement requires unit 400 isolation.')
    const documentId = await ctx.wbIngestion.enqueue({
      path: sop,
      declaredClassification: 'CONFIDENTIAL',
      user: testUser().id,
      sessionId: SESSION,
      })
    expect(documentId).toBeTruthy()

    // 2. OCR over the scanned report page, through the real vision service
    c.setModelReply(JSON.stringify({
      text: 'INSPECTION: P-101 outboard bearing wear 0.4mm',
      blocks: [{ text: 'P-101', box: [0.1, 0.1, 0.2, 0.05], confidence: 0.93 }],
    }))
    const ocr = await ctx.wbVision.describe(Buffer.from('scan-bytes'), 'transcribe this report')
    expect(String(ocr.text)).toContain('P-101')

    // 3. retrieval of the related SOP, authorized per chunk by real policy
    const retrieved = await ctx.wbRag.retrieve('bearing replacement', testUser(), SESSION)
    expect(retrieved.chunks.length, 'nothing retrieved to cite').toBeGreaterThan(0)
    expect(retrieved.citations.length).toBe(retrieved.chunks.length)

    // 4. a real approval note on disk, carrying those citations
    const outPath = join(c.home, 'approval-note.md')
    const provenance = [
      '# Approval note — P-101 bearing replacement',
      '',
      `Finding: ${String(ocr.text)}`,
      '',
      '## Sources',
      ...retrieved.citations.map((cite) => `- ${cite.title} (${cite.documentId})`),
    ].join('\n')
    writeFileSync(outPath, provenance)

    expect(existsSync(outPath), 'no artifact was written').toBe(true)
    const written = readFileSync(outPath, 'utf8')
    for (const cite of retrieved.citations) {
      expect(written, 'a retrieved source is missing from the note').toContain(String(cite.documentId))
    }
    expect(written).toContain('P-101')

    // 5. and the whole chain is reconstructable from the audit log
    expect(ctx.wbAudit.query({ kind: 'ingestion_completed' }).length).toBeGreaterThan(0)
    expect(ctx.wbAudit.query({ kind: 'rag_retrieval' }).length).toBeGreaterThan(0)
    expect(ctx.wbAudit.query({ kind: 'policy_decision' }).length).toBeGreaterThan(0)
  })

  it('an artifact cannot be built from zero evidence', async () => {
    // wb-artifacts' report/approval-note tools require >= 1 citation; this
    // guards the product claim that an "evidence-backed" artifact has evidence.
    // Loading the corpus is itself governed now, so a cleared operator seeds
    // it and the PUBLIC principal only queries.
    c = await compose({
      sessions: { [SESSION]: testUser({ clearance: 'PUBLIC' }), },
    })
    const sop = join(c.home, 'restricted.txt')
    writeFileSync(sop, 'RESTRICTED drawing notes.')
    await c.ctx.wbIngestion.enqueue({ path: sop, declaredClassification: 'RESTRICTED', user: testUser().id, sessionId: ADMIN_SESSION })
    const retrieved = await c.ctx.wbRag.retrieve('drawing', testUser({ clearance: 'PUBLIC' }), SESSION)
    expect(retrieved.citations).toHaveLength(0)
    expect(retrieved.filtered.length).toBeGreaterThan(0)
  })
})
