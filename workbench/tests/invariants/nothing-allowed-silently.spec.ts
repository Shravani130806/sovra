import { describe, expect, it, afterEach } from 'vitest'
import { compose, SESSION, testUser, type Composed } from '../harness.ts'
import type { WbClassification } from '@mrpl/dsh-workbench-types'

/** §9 invariant 4 — every decision is observable, ALLOW included. */
describe('invariant 4: nothing is allowed silently', () => {
  let c: Composed | undefined
  afterEach(() => { c?.dispose(); c = undefined })

  const BANDS: WbClassification[] = ['PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'RESTRICTED']

  it('one policy_decision entry per action, across every matrix row', async () => {
    c = await compose()
    for (const classification of BANDS) {
      await c.ctx.wbPolicy.evaluate({
        user: testUser().id,
        sessionId: SESSION,
        agentPreset: 'document-analyst',
        action: 'read_data',
        classification,
        destination: 'local',
      })
    }
    const entries = c.ctx.wbAudit.query({ kind: 'policy_decision' })
    expect(entries).toHaveLength(BANDS.length)
  })

  it('an ALLOW is recorded, not only the denials', async () => {
    c = await compose()
    const decision = await c.ctx.wbPolicy.evaluate({
      user: testUser().id,
      sessionId: SESSION,
      agentPreset: 'document-analyst',
      action: 'read_data',
      classification: 'PUBLIC',
      destination: 'local',
    })
    expect(decision.decision).toBe('ALLOW')
    const entries = c.ctx.wbAudit.query({ kind: 'policy_decision' })
    expect(entries).toHaveLength(1)
    expect(entries[0]!.summary).toContain('ALLOW')
  })

  it('a denial is recorded with its reason', async () => {
    c = await compose({
      sessions: { [SESSION]: testUser({ clearance: 'PUBLIC' as WbClassification }) },
    })
    await c.ctx.wbPolicy.evaluate({
      user: testUser().id,
      sessionId: SESSION,
      agentPreset: 'document-analyst',
      action: 'read_data',
      classification: 'RESTRICTED',
      destination: 'local',
    })
    const entries = c.ctx.wbAudit.query({ kind: 'policy_decision' })
    expect(entries[0]!.summary).toContain('CLEARANCE_INSUFFICIENT')
  })
})
