/**
 * Contract edge: wb-policy ← wb-identity
 *
 * Proves wb-policy correctly consumes wb-identity.current() for
 * session-keyed user resolution. Tests the real Cordis injection chain.
 *
 * @module workbench/tests/contract/policy-from-identity.spec.ts
 */
import { describe, expect, it, beforeEach } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { asWbSessionId, asWbUserId, type WbUser } from '@mrpl/dsh-workbench-types'
import WbPolicyServiceClass from '@mrpl/dsh-workbench-policy'

const SESSION = asWbSessionId('contract-s1')
const USER_ID = asWbUserId('contract-user-1')

function makeUser(overrides: Partial<WbUser> = {}): WbUser {
  return {
    id: USER_ID,
    displayName: 'Contract Tester',
    department: 'QA',
    role: 'engineer',
    clearance: 'PUBLIC',
    allowedAgentPresets: ['document-analyst'],
    allowedToolCategories: ['local'],
    networkPermissions: [],
    ...overrides,
  }
}

function stubIdentity(user?: WbUser) {
  return { current: () => user ?? makeUser() }
}

function stubGateway() {
  const m = new Map<string, import('@mrpl/dsh-workbench-types').WbToolManifest>()
  return {
    registerManifest(manifest: import('@mrpl/dsh-workbench-types').WbToolManifest) { m.set(manifest.toolId, manifest) },
    getManifest(id: string) { return m.get(id) },
  }
}

describe('Contract: wb-policy ← wb-identity', () => {
  let ctx: Context
  beforeEach(() => { ctx = new Context() })

  it('identity.current() is called with the session id from the policy request', async () => {
    let receivedSession: string | undefined
    const tracking = {
      current(sid: import('@mrpl/dsh-workbench-types').WbSessionId) {
        receivedSession = sid
        return makeUser()
      },
    }
    ctx.provide('wbIdentity', tracking)
    ctx.provide('wbToolGateway', stubGateway())
    await ctx.plugin(WbPolicyServiceClass)

    await ctx.wbPolicy.evaluate({
      user: USER_ID,
      sessionId: SESSION,
      agentPreset: 'document-analyst',
      action: 'model_request',
      classification: 'PUBLIC',
      destination: 'local',
    })

    expect(receivedSession).toBe(SESSION)
  })

  it('DENY when identity.current() returns undefined', async () => {
    ctx.provide('wbIdentity', { current: () => undefined })
    ctx.provide('wbToolGateway', stubGateway())
    await ctx.plugin(WbPolicyServiceClass)

    const d = await ctx.wbPolicy.evaluate({
      user: USER_ID,
      sessionId: SESSION,
      agentPreset: 'document-analyst',
      action: 'model_request',
      classification: 'PUBLIC',
      destination: 'local',
    })
    expect(d.decision).toBe('DENY')
    expect(d.reason).toContain('IDENTITY_UNRESOLVED')
  })

  it('DENY when resolved user.id differs from request.user', async () => {
    ctx.provide('wbIdentity', { current: () => makeUser({ id: asWbUserId('other-user') }) })
    ctx.provide('wbToolGateway', stubGateway())
    await ctx.plugin(WbPolicyServiceClass)

    const d = await ctx.wbPolicy.evaluate({
      user: USER_ID,
      sessionId: SESSION,
      agentPreset: 'document-analyst',
      action: 'model_request',
      classification: 'PUBLIC',
      destination: 'local',
    })
    expect(d.decision).toBe('DENY')
    expect(d.reason).toContain('IDENTITY_MISMATCH')
  })

  it('ALLOW when identity resolves and matrix permits', async () => {
    ctx.provide('wbIdentity', stubIdentity())
    ctx.provide('wbToolGateway', stubGateway())
    await ctx.plugin(WbPolicyServiceClass)

    const d = await ctx.wbPolicy.evaluate({
      user: USER_ID,
      sessionId: SESSION,
      agentPreset: 'document-analyst',
      action: 'model_request',
      classification: 'PUBLIC',
      destination: 'local',
    })
    expect(d.decision).toBe('ALLOW')
  })
})
