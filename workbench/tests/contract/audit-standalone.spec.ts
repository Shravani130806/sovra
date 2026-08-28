/**
 * Contract edge: wb-audit standalone
 *
 * Proves wb-audit can mount with required deps and expose record/query API.
 *
 * @module workbench/tests/contract/audit-standalone.spec.ts
 */
import { describe, expect, it, beforeEach } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import WbAuditService from '@mrpl/dsh-workbench-audit'

describe('Contract: wb-audit standalone', () => {
  let ctx: Context
  beforeEach(() => { ctx = new Context() })

  it('mounts when wbIdentity and config are provided', async () => {
    ctx.provide('wbIdentity', { current: () => undefined })
    await ctx.plugin(WbAuditService, { root: '/tmp/wb-audit-test' })
    expect(ctx.wbAudit).toBeDefined()
  })

  it('exposes record and query methods', async () => {
    ctx.provide('wbIdentity', { current: () => undefined })
    await ctx.plugin(WbAuditService, { root: '/tmp/wb-audit-test' })
    expect(typeof ctx.wbAudit.record).toBe('function')
    expect(typeof ctx.wbAudit.query).toBe('function')
  })

  it('record adds an entry and query returns it', async () => {
    ctx.provide('wbIdentity', { current: () => undefined })
    await ctx.plugin(WbAuditService, { root: '/tmp/wb-audit-test' })

    ctx.wbAudit.record({
      sessionId: 'test-session' as any,
      userId: 'test-user' as any,
      kind: 'session_event',
      summary: 'test entry',
    })

    const results = ctx.wbAudit.query({ kind: 'session_event' })
    expect(results.length).toBeGreaterThanOrEqual(1)
  })
})
