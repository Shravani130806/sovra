/**
 * Contract edge: wb-model-gateway standalone
 *
 * Proves wb-model-gateway can mount with config and expose resolve API.
 * NOTE: wb-model-gateway injects `llm` from the harness and validates routing
 * against mounted adapters. We provide a stub llm with a matching adapter.
 *
 * @module workbench/tests/contract/model-gateway-standalone.spec.ts
 */
import { describe, expect, it, beforeEach } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { apply as wbModelGatewayApply } from '@mrpl/dsh-workbench-model-gateway'

const ADAPTER_ID = 'stub-adapter'
const ROUTING = {
  reasoning: ADAPTER_ID, vision_reasoning: ADAPTER_ID, embedding: ADAPTER_ID,
  rerank: ADAPTER_ID, ocr: ADAPTER_ID, generation: ADAPTER_ID,
}

describe('Contract: wb-model-gateway standalone', () => {
  let ctx: Context
  beforeEach(() => { ctx = new Context() })

  it('apply function is importable and has correct signature', () => {
    expect(typeof wbModelGatewayApply).toBe('function')
  })

  it('exposes resolve method when mounted with llm stub', async () => {
    ctx.provide('llm', { listProviders: () => [{ id: ADAPTER_ID }] })
    await ctx.plugin({
      name: 'wb-model-gateway',
      inject: ['llm'],
      apply(inner: Context) { wbModelGatewayApply(inner, { routing: ROUTING }) },
    })
    expect(ctx.wbModelGateway).toBeDefined()
    expect(typeof ctx.wbModelGateway.resolve).toBe('function')
  })
})
