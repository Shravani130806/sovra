/**
 * Contract edge: wb-rag ← wb-policy + wb-model-gateway
 *
 * Proves wb-rag's apply function resolves and its service interface is correct.
 * wb-rag has no default export; uses named apply.
 *
 * @module workbench/tests/contract/rag-from-policy.spec.ts
 */
import { describe, expect, it, beforeEach } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { asWbUserId, asWbSessionId } from '@mrpl/dsh-workbench-types'
import WbPolicyServiceClass from '@mrpl/dsh-workbench-policy'
import { apply as wbRagApply } from '@mrpl/dsh-workbench-rag'

const SESSION = asWbSessionId('rag-contract-s1')
const USER_ID = asWbUserId('rag-contract-user-1')

function stubIdentity() {
  return {
    current: () => ({
      id: USER_ID, displayName: 'R', department: 'QA', role: 'engineer',
      clearance: 'PUBLIC' as const, allowedAgentPresets: ['document-analyst'],
      allowedToolCategories: ['local'], networkPermissions: [],
    }),
  }
}

function stubGateway() {
  const m = new Map()
  return {
    registerManifest(manifest: import('@mrpl/dsh-workbench-types').WbToolManifest) { m.set(manifest.toolId, manifest) },
    getManifest(id: string) { return m.get(id) },
  }
}

describe('Contract: wb-rag ← wb-policy', () => {
  let ctx: Context
  beforeEach(() => { ctx = new Context() })

  it('wb-rag apply function is importable', () => {
    expect(typeof wbRagApply).toBe('function')
  })

  it('wb-rag mounts when wb-policy and wb-model-gateway are available', async () => {
    ctx.provide('wbIdentity', stubIdentity())
    ctx.provide('wbToolGateway', stubGateway())
    await ctx.plugin(WbPolicyServiceClass)
    ctx.provide('wbModelGateway', { resolve: () => ({ endpoint: '', apiKey: '', model: '' }) })
    await ctx.plugin({ apply: wbRagApply, inject: ['wbPolicy', 'wbModelGateway'] })
    expect(ctx.wbRag).toBeDefined()
    expect(typeof ctx.wbRag.retrieve).toBe('function')
  })
})
