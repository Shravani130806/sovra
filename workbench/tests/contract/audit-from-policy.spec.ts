/**
 * Contract edge: wb-audit ← wb-policy
 *
 * Proves wb-audit mounts and exposes record/query for policy decisions.
 *
 * @module workbench/tests/contract/audit-from-policy.spec.ts
 */
import { describe, expect, it, beforeEach } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import WbAuditService from '@mrpl/dsh-workbench-audit'

describe('Contract: wb-audit ← wb-policy', () => {
  let ctx: Context
  beforeEach(() => { ctx = new Context() })

  it('audit service mounts and exposes query API', async () => {
    ctx.provide('wbIdentity', { current: () => undefined })
    await ctx.plugin(WbAuditService, { root: '/tmp/wb-audit-test' })
    expect(ctx.wbAudit).toBeDefined()
    expect(typeof ctx.wbAudit.record).toBe('function')
    expect(typeof ctx.wbAudit.query).toBe('function')
  })
})
