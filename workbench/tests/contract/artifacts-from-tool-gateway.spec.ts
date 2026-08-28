/**
 * Contract edge: wb-artifacts ← wb-tool-gateway
 *
 * Proves wb-artifacts registers its tools via wbToolGateway.registerManifest().
 * wb-artifacts also injects harness `tools` for tool registration.
 *
 * @module workbench/tests/contract/artifacts-from-tool-gateway.spec.ts
 */
import { describe, expect, it, beforeEach } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { apply as wbArtifactsApply } from '@mrpl/dsh-workbench-artifacts'

describe('Contract: wb-artifacts ← wb-tool-gateway', () => {
  let ctx: Context
  beforeEach(() => { ctx = new Context() })

  it('wb-artifacts apply function is importable', () => {
    expect(typeof wbArtifactsApply).toBe('function')
  })

  it('wb-artifacts registers tool manifests on mount', async () => {
    const manifests: import('@mrpl/dsh-workbench-types').WbToolManifest[] = []
    ctx.provide('wbToolGateway', {
      registerManifest(m: import('@mrpl/dsh-workbench-types').WbToolManifest) { manifests.push(m) },
      getManifest() { return undefined },
    })
    // wb-artifacts injects `tools` from the harness for tool registration
    ctx.provide('tools', { register() {} })

    await ctx.plugin({
      name: 'wb-artifacts',
      apply(inner: Context) { wbArtifactsApply(inner, { outputDir: '/tmp/wb-artifacts-test' }) },
    })

    const ids = manifests.map((m) => m.toolId)
    expect(ids).toContain('wb_generate_report')
    expect(ids).toContain('wb_generate_approval_note')
    expect(ids).toContain('wb_generate_spreadsheet')
    expect(ids).toContain('wb_generate_presentation')
  })

  it('registered manifests have dataClassificationCeiling PUBLIC (known deviation)', async () => {
    const manifests: import('@mrpl/dsh-workbench-types').WbToolManifest[] = []
    ctx.provide('wbToolGateway', {
      registerManifest(m: import('@mrpl/dsh-workbench-types').WbToolManifest) { manifests.push(m) },
      getManifest() { return undefined },
    })
    ctx.provide('tools', { register() {} })

    await ctx.plugin({
      name: 'wb-artifacts',
      apply(inner: Context) { wbArtifactsApply(inner, { outputDir: '/tmp/wb-artifacts-test' }) },
    })

    // Known deviation: all artifact tools have PUBLIC ceiling
    for (const m of manifests) {
      expect(m.dataClassificationCeiling).toBe('PUBLIC')
    }
  })
})
