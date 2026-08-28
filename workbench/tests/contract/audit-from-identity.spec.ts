/**
 * Contract edge: wb-audit ← wb-identity
 *
 * Proves wb-audit mounts when identity service is provided.
 *
 * @module workbench/tests/contract/audit-from-identity.spec.ts
 */
import { describe, expect, it, beforeEach } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import WbAuditService from '@mrpl/dsh-workbench-audit'

describe('Contract: wb-audit ← wb-identity', () => {
  let ctx: Context
  beforeEach(() => { ctx = new Context() })

  it('audit service mounts when identity service is provided', async () => {
    ctx.provide('wbIdentity', { current: () => undefined })
    await ctx.plugin(WbAuditService, { root: '/tmp/wb-audit-test' })
    expect(ctx.wbAudit).toBeDefined()
    expect(typeof ctx.wbAudit.record).toBe('function')
  })

  it('audit service exposes query method', async () => {
    ctx.provide('wbIdentity', { current: () => undefined })
    await ctx.plugin(WbAuditService, { root: '/tmp/wb-audit-test' })
    expect(typeof ctx.wbAudit.query).toBe('function')
  })
})
