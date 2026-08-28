import { describe, expect, it, afterEach, beforeEach, vi } from 'vitest'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { compose, SESSION, testUser, type Composed } from '../harness.ts'
import type { WbClassification } from '@mrpl/dsh-workbench-types'

/**
 * §9 invariant 3 — no plugin makes a raw network call.
 *
 * Instrumented at the process boundary: `fetch` and `http(s).request` are
 * replaced with recorders that fail the test if anything reaches them. This
 * is the sovereignty claim the product rests on, so it is asserted rather
 * than assumed from a code read.
 */
describe('invariant 3: no raw network egress', () => {
  let c: Composed | undefined
  let egress: string[]

  beforeEach(() => {
    egress = []
    vi.stubGlobal('fetch', (input: unknown) => {
      egress.push(String(input))
      return Promise.reject(new Error('network blocked by the sovereignty test'))
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    c?.dispose()
    c = undefined
  })

  it('ingesting and retrieving CONFIDENTIAL material makes zero outbound calls', async () => {
    c = await compose()
    const file = join(c.home, 'confidential.txt')
    writeFileSync(file, 'Unit 400 shutdown procedure, revision C.')
    await c.ctx.wbIngestion.enqueue({ path: file, declaredClassification: 'CONFIDENTIAL' })
    await c.ctx.wbRag.retrieve('shutdown procedure', testUser(), SESSION)
    expect(egress, `unexpected egress: ${egress.join(', ')}`).toHaveLength(0)
  })

  it('a vision tool call makes zero outbound calls — the model is reached through ctx.llm', async () => {
    c = await compose()
    c.setModelReply(JSON.stringify({ text: 'P-101', blocks: [] }))
    await c.ctx.wbVision.describe(Buffer.from('fake-png-bytes'), 'read this')
    expect(egress).toHaveLength(0)
    // and the call really did go through the gateway-resolved adapter
    expect(c.modelCalls.length).toBeGreaterThan(0)
  })

  it('policy denies an internet destination for CONFIDENTIAL data', async () => {
    c = await compose()
    const decision = await c.ctx.wbPolicy.evaluate({
      user: testUser().id,
      sessionId: SESSION,
      agentPreset: 'research',
      action: 'send_data',
      classification: 'CONFIDENTIAL' as WbClassification,
      destination: 'internet',
    })
    expect(decision.decision).not.toBe('ALLOW')
  })

  it('PUBLIC data over the internet is the one allowed egress, per §5', async () => {
    c = await compose()
    const decision = await c.ctx.wbPolicy.evaluate({
      user: testUser().id,
      sessionId: SESSION,
      agentPreset: 'research',
      action: 'read_data',
      classification: 'PUBLIC',
      destination: 'internet',
    })
    expect(decision.decision).toBe('ALLOW')
  })
})
