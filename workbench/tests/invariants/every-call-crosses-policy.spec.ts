import { describe, expect, it, afterEach } from 'vitest'
import { callTool, compose, type Composed } from '../harness.ts'

/** §9 invariant 1 — every tool call is reachable by the central policy check. */
describe('invariant 1: every call crosses policy', () => {
  let c: Composed | undefined
  afterEach(() => { c?.dispose(); c = undefined })

  it('a workbench tool call produces a policy_decision entry', async () => {
    c = await compose()
    c.setModelReply(JSON.stringify({ text: 'PUMP P-101', blocks: [] }))
    await callTool(c.ctx, 'wb_ocr_extract', { image: 'aGVsbG8=', mediaType: 'image/png' })
    const decisions = c.ctx.wbAudit.query({ kind: 'policy_decision' })
    expect(decisions.some((d) => JSON.stringify(d.payload).includes('wb_ocr_extract'))).toBe(true)
  })

  it('a harness-native tool call produces one too — the gate is not scoped to wb_*', async () => {
    c = await compose()
    const { ctx } = c
    // A stand-in for a harness-native tool, registered under a real
    // harness-native NAME so it resolves against wb-tool-gateway's static
    // table exactly as dsh-tool-fs would.
    ctx.tools.register({
      name: 'read',
      description: 'read a file',
      parameters: { path: { type: 'string', required: true } },
      output: { schema: { type: 'string' }, render: () => [{ type: 'text', text: 'ok' }] },
      execute: async () => 'contents',
    } as Parameters<typeof ctx.tools.register>[0])

    await callTool(ctx, 'read', { path: '/tmp/x' })
    const decisions = ctx.wbAudit.query({ kind: 'policy_decision' })
    expect(
      decisions.some((d) => JSON.stringify(d.payload).includes('"tool":"read"')),
      'a harness-native call was not gated',
    ).toBe(true)
  })
})
