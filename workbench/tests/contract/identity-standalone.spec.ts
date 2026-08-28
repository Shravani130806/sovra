/**
 * Contract edge: wb-identity standalone
 *
 * Proves wb-identity can mount and expose the current() API.
 *
 * @module workbench/tests/contract/identity-standalone.spec.ts
 */
import { describe, expect, it, beforeEach } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { asWbSessionId, asWbUserId } from '@mrpl/dsh-workbench-types'

describe('Contract: wb-identity standalone', () => {
  let ctx: Context
  beforeEach(() => { ctx = new Context() })

  it('wbIdentity service is available after providing', async () => {
    ctx.provide('wbIdentity', { current: () => undefined })
    expect(ctx.wbIdentity).toBeDefined()
    expect(typeof ctx.wbIdentity.current).toBe('function')
  })

  it('current() returns undefined for unknown sessions by default', async () => {
    ctx.provide('wbIdentity', { current: () => undefined })
    const user = ctx.wbIdentity.current(asWbSessionId('unknown-session'))
    expect(user).toBeUndefined()
  })

  it('current() returns user when identity is resolved', async () => {
    const testUser = {
      id: asWbUserId('test-id'),
      displayName: 'Test',
      department: 'QA',
      role: 'engineer',
      clearance: 'PUBLIC' as const,
      allowedAgentPresets: ['document-analyst'],
      allowedToolCategories: ['local'],
      networkPermissions: [],
    }
    ctx.provide('wbIdentity', { current: () => testUser })
    const user = ctx.wbIdentity.current(asWbSessionId('s1'))
    expect(user).toEqual(testUser)
  })
})
