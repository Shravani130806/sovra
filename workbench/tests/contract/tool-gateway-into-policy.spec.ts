import { describe, expect, it, afterEach } from 'vitest'
import { callTool, compose, SESSION, type Composed } from '../harness.ts'

/**
 * Edge: wb-policy consulting the REAL wb-tool-gateway.getManifest(), where its
 * own suite used a fake whose manifests it authored itself.
 */
describe('wb-tool-gateway -> wb-policy', () => {
  let c: Composed | undefined
  afterEach(() => { c?.dispose(); c = undefined })

  it('policy reads the real static table, keyed on registered tool names', async () => {
    c = await compose()
    expect(c.ctx.wbToolGateway.getManifest('read')).toBeDefined()
    // The failure this guards: a table keyed on package names would deny the
    // whole harness toolset while looking individually correct.
    expect(c.ctx.wbToolGateway.getManifest('dsh-tool-fs')).toBeUndefined()
  })

  it('a tool with no manifest is denied, not passed through', async () => {
    c = await compose()
    const { ctx } = c
    ctx.tools.register({
      name: 'unmanifested_probe',
      description: 'probe',
      parameters: {},
      output: { schema: { type: 'string' }, render: () => [{ type: 'text', text: 'ok' }] },
      execute: async () => 'ok',
    } as Parameters<typeof ctx.tools.register>[0])
    const result = await callTool(ctx, 'unmanifested_probe', {})
    expect(result.isError).toBe(true)
  })

  it("the manifest's networkAccess, not the tool name, drives the destination", async () => {
    c = await compose()
    const decision = await c.ctx.wbPolicy.evaluate({
      user: (await Promise.resolve(c.ctx.wbIdentity.current(SESSION)))!.id,
      sessionId: SESSION,
      agentPreset: 'document-analyst',
      action: 'invoke_tool',
      classification: 'CONFIDENTIAL',
      destination: 'internet',
      tool: 'bash',
    })
    // bash's real manifest declares external reach; a name heuristic read it
    // as 'local' and the two silently disagreed.
    expect(c.ctx.wbToolGateway.getManifest('bash')!.networkAccess).toBe('external')
    expect(decision.decision).toBeDefined()
  })
})
