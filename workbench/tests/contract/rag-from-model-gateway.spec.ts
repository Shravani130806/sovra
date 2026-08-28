/**
 * Contract edge: wb-rag ← wb-model-gateway
 *
 * Proves wb-rag's apply function resolves when wb-model-gateway is available.
 *
 * @module workbench/tests/contract/rag-from-model-gateway.spec.ts
 */
import { describe, expect, it, beforeEach } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { apply as wbRagApply } from '@mrpl/dsh-workbench-rag'

describe('Contract: wb-rag ← wb-model-gateway', () => {
  let ctx: Context
  beforeEach(() => { ctx = new Context() })

  it('wb-rag apply function is importable', () => {
    expect(typeof wbRagApply).toBe('function')
  })

  it('wb-rag mounts when wb-model-gateway is available', async () => {
    ctx.provide('wbModelGateway', { resolve: () => ({ endpoint: '', apiKey: '', model: '' }) })
    await ctx.plugin({ apply: wbRagApply, inject: ['wbModelGateway'] })
    expect(ctx.wbRag).toBeDefined()
  })
})
