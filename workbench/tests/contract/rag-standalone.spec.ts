/**
 * Contract edge: wb-rag standalone
 *
 * Proves wb-rag's apply function resolves and service interface is correct.
 *
 * @module workbench/tests/contract/rag-standalone.spec.ts
 */
import { describe, expect, it, beforeEach } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { apply as wbRagApply } from '@mrpl/dsh-workbench-rag'

describe('Contract: wb-rag standalone', () => {
  let ctx: Context
  beforeEach(() => { ctx = new Context() })

  it('wb-rag apply function is importable and has correct signature', () => {
    expect(typeof wbRagApply).toBe('function')
  })

  it('wb-rag mounts when wbModelGateway is provided', async () => {
    ctx.provide('wbModelGateway', { resolve: () => ({ endpoint: '', apiKey: '', model: '' }) })
    await ctx.plugin({ apply: wbRagApply, inject: ['wbModelGateway'] })
    expect(ctx.wbRag).toBeDefined()
    expect(typeof ctx.wbRag.retrieve).toBe('function')
  })
})
