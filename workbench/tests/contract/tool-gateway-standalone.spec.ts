/**
 * Contract edge: wb-tool-gateway standalone
 *
 * Proves wb-tool-gateway can mount independently and serve manifests.
 *
 * @module workbench/tests/contract/tool-gateway-standalone.spec.ts
 */
import { describe, expect, it, beforeEach } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { asWbUserId, type WbToolManifest } from '@mrpl/dsh-workbench-types'
import WbToolGatewayServiceClass from '@mrpl/dsh-workbench-tool-gateway'

describe('Contract: wb-tool-gateway standalone', () => {
  let ctx: Context
  beforeEach(() => { ctx = new Context() })

  it('mounts without any inject dependencies', async () => {
    await ctx.plugin(WbToolGatewayServiceClass)
    expect(ctx.wbToolGateway).toBeDefined()
  })

  it('registerManifest + getManifest round-trip', async () => {
    await ctx.plugin(WbToolGatewayServiceClass)

    const manifest: WbToolManifest = {
      toolId: 'test_round_trip',
      riskLevel: 'local',
      requiredPermissions: [],
      dataClassificationCeiling: 'PUBLIC',
      networkAccess: 'none',
    }
    ctx.wbToolGateway.registerManifest(manifest)
    expect(ctx.wbToolGateway.getManifest('test_round_trip')).toEqual(manifest)
  })

  it('getManifest returns undefined for unknown tool', async () => {
    await ctx.plugin(WbToolGatewayServiceClass)
    expect(ctx.wbToolGateway.getManifest('nonexistent')).toBeUndefined()
  })

  it('static default manifests are registered on mount', async () => {
    const manifests: WbToolManifest[] = []
    const originalRegister = WbToolGatewayServiceClass.prototype.registerManifest
    // Intercept via the service instance after mount
    await ctx.plugin(WbToolGatewayServiceClass)

    // Check that the service has static manifests registered
    // (read, list, grep, glob, etc. from DESIGN.md §7.7)
    const readManifest = ctx.wbToolGateway.getManifest('read')
    expect(readManifest).toBeDefined()
    expect(readManifest!.riskLevel).toBe('local')
  })
})
