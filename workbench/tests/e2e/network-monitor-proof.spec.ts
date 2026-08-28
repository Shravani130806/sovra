import { describe, expect, it, afterEach, beforeEach, vi } from 'vitest'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { compose, SESSION, testUser, type Composed } from '../harness.ts'

/**
 * §10 demo artifact: a human-readable sovereignty summary built from the real
 * audit log, proving zero external calls fired for confidential-data actions
 * across a realistic session.
 */
describe('e2e: network monitor proof', () => {
  let c: Composed | undefined
  let egress: string[]

  beforeEach(() => {
    egress = []
    vi.stubGlobal('fetch', (input: unknown) => {
      egress.push(String(input))
      return Promise.reject(new Error('blocked'))
    })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    c?.dispose()
    c = undefined
  })

  it('produces a judge-readable summary showing zero egress for confidential work', async () => {
    c = await compose()
    const file = join(c.home, 'unit-400-sop.txt')
    writeFileSync(file, 'Unit 400 emergency shutdown procedure, revision C, pump P-101 isolation.')

    await c.ctx.wbIngestion.enqueue({ path: file, declaredClassification: 'CONFIDENTIAL', user: testUser().id, sessionId: SESSION })
    await c.ctx.wbRag.retrieve('shutdown procedure', testUser(), SESSION)
    c.setModelReply(JSON.stringify({ text: 'P-101', blocks: [] }))
    await c.ctx.wbVision.describe(Buffer.from('drawing-bytes'), 'identify the isolation valve')
    await c.ctx.wbPolicy.evaluate({
      user: testUser().id, sessionId: SESSION, agentPreset: 'research',
      action: 'send_data', classification: 'CONFIDENTIAL', destination: 'internet',
    })

    const decisions = c.ctx.wbAudit.query({ kind: 'policy_decision' })
    const denials = decisions.filter((d) => d.summary.startsWith('DENY'))

    const summary = [
      'SOVEREIGNTY REPORT',
      `  outbound network calls observed: ${egress.length}`,
      `  policy decisions recorded:       ${decisions.length}`,
      `  external requests blocked:       ${denials.length}`,
      `  documents ingested:              ${c.ctx.wbAudit.query({ kind: 'ingestion_completed' }).length}`,
      `  retrievals authorized:           ${c.ctx.wbAudit.query({ kind: 'rag_retrieval' }).length}`,
    ].join('\n')

    expect(egress, 'confidential work reached the network').toHaveLength(0)
    expect(decisions.length, 'no decisions were recorded to show a judge').toBeGreaterThan(0)
    expect(denials.length, 'the confidential-to-internet attempt was not blocked').toBeGreaterThan(0)
    expect(summary).toContain('outbound network calls observed: 0')
  })
})
