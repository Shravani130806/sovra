/**
 * Contract edge: wb-ingestion ← wb-model-gateway
 *
 * Proves wb-ingestion's apply function resolves when wb-model-gateway is provided.
 *
 * @module workbench/tests/contract/ingestion-from-model-gateway.spec.ts
 */
import { describe, expect, it, beforeEach } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { apply as wbIngestionApply } from '@mrpl/dsh-workbench-ingestion'

describe('Contract: wb-ingestion ← wb-model-gateway', () => {
  let ctx: Context
  beforeEach(() => { ctx = new Context() })

  it('wb-ingestion apply function is importable', () => {
    expect(typeof wbIngestionApply).toBe('function')
  })

  it('wb-ingestion mounts when wb-model-gateway is provided', async () => {
    ctx.provide('wbVision', {
      ocr: async () => ({ text: '', confidence: 0, language: 'en' }),
      describe: async () => ({ description: '', objects: [], tags: [] }),
    })
    ctx.provide('wbModelGateway', { resolve: () => ({ endpoint: '', apiKey: '', model: '' }) })
    ctx.provide('wbPolicy', { evaluate: async () => ({ decision: 'ALLOW' as const, reason: '' }) })

    await ctx.plugin({
      name: 'wb-ingestion',
      apply(inner: Context) { wbIngestionApply(inner, { indexPath: '/tmp/wb-ingestion-test', maxFileSize: 1024, allowedMimeTypes: ['text/*'] }) },
    })
    expect(ctx.wbIngestion).toBeDefined()
  })
})
