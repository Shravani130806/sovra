/**
 * Contract: bundle composition
 *
 * Proves all workbench plugins can mount together in a single Cordis context
 * and that the composed service graph is consistent.
 *
 * @module workbench/tests/contract/bundle-composition.spec.ts
 */
import { describe, expect, it, beforeEach } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { asWbUserId, asWbSessionId, type WbUser } from '@mrpl/dsh-workbench-types'
import WbPolicyServiceClass from '@mrpl/dsh-workbench-policy'
import WbToolGatewayServiceClass from '@mrpl/dsh-workbench-tool-gateway'
import WbAuditServiceClass from '@mrpl/dsh-workbench-audit'
import { apply as wbModelGatewayApply } from '@mrpl/dsh-workbench-model-gateway'
import { apply as wbRagApply } from '@mrpl/dsh-workbench-rag'
import { apply as wbIngestionApply } from '@mrpl/dsh-workbench-ingestion'

const USER_ID = asWbUserId('bundle-user')
const SESSION = asWbSessionId('bundle-session')

function makeUser(): WbUser {
  return {
    id: USER_ID, displayName: 'Bundle', department: 'QA', role: 'engineer',
    clearance: 'PUBLIC', allowedAgentPresets: ['document-analyst'],
    allowedToolCategories: ['local', 'enterprise'], networkPermissions: ['web_search'],
  }
}

describe('Contract: bundle composition', () => {
  let ctx: Context
  beforeEach(() => { ctx = new Context() })

  it('all service plugins mount in dependency order', async () => {
    // 1. Identity (no deps)
    ctx.provide('wbIdentity', { current: () => makeUser() })

    // 2. Tool gateway (no deps)
    await ctx.plugin(WbToolGatewayServiceClass)
    expect(ctx.wbToolGateway).toBeDefined()

    // 3. Model gateway (needs llm from harness + config)
    const ADAPTER_ID = 'stub-adapter'
    ctx.provide('llm', { listProviders: () => [{ id: ADAPTER_ID }] })
    await ctx.plugin({
      name: 'wb-model-gateway',
      inject: ['llm'],
      apply(inner: Context) {
        wbModelGatewayApply(inner, {
          routing: {
            reasoning: ADAPTER_ID, vision_reasoning: ADAPTER_ID, embedding: ADAPTER_ID,
            rerank: ADAPTER_ID, ocr: ADAPTER_ID, generation: ADAPTER_ID,
          },
        })
      },
    })
    expect(ctx.wbModelGateway).toBeDefined()

    // 4. Policy (needs identity + tool gateway)
    await ctx.plugin(WbPolicyServiceClass)
    expect(ctx.wbPolicy).toBeDefined()

    // 5. Audit (needs identity + config)
    await ctx.plugin(WbAuditServiceClass, { root: '/tmp/wb-audit-bundle-test' })
    expect(ctx.wbAudit).toBeDefined()

    // 6. RAG (needs policy + model gateway)
    await ctx.plugin({ apply: wbRagApply, inject: ['wbPolicy', 'wbModelGateway'] })
    expect(ctx.wbRag).toBeDefined()

    // 7. Ingestion (needs vision + policy + model gateway)
    ctx.provide('wbVision', {
      ocr: async () => ({ text: '', confidence: 0, language: 'en' }),
      describe: async () => ({ description: '', objects: [], tags: [] }),
    })
    await ctx.plugin({
      name: 'wb-ingestion',
      apply(inner: Context) {
        wbIngestionApply(inner, { indexPath: '/tmp/wb-ingestion-bundle-test', maxFileSize: 1024, allowedMimeTypes: ['text/*'] })
      },
    })
    expect(ctx.wbIngestion).toBeDefined()
  })

  it('policy evaluates correctly with full service graph', async () => {
    ctx.provide('wbIdentity', { current: () => makeUser() })
    await ctx.plugin(WbToolGatewayServiceClass)
    await ctx.plugin(WbPolicyServiceClass)

    const d = await ctx.wbPolicy.evaluate({
      user: USER_ID, sessionId: SESSION, agentPreset: 'document-analyst',
      action: 'model_request', classification: 'PUBLIC', destination: 'local',
    })
    expect(d.decision).toBe('ALLOW')
  })

  it('policy denies tool without manifest in full graph', async () => {
    ctx.provide('wbIdentity', { current: () => makeUser() })
    await ctx.plugin(WbToolGatewayServiceClass)
    await ctx.plugin(WbPolicyServiceClass)

    const d = await ctx.wbPolicy.evaluate({
      user: USER_ID, sessionId: SESSION, agentPreset: 'document-analyst',
      action: 'invoke_tool', classification: 'PUBLIC', destination: 'local',
      tool: 'unregistered_tool',
    })
    expect(d.decision).toBe('DENY')
    expect(d.reason).toContain('NO_MANIFEST')
  })

  it('governance matrix is accessible and deep-copyable in full graph', async () => {
    ctx.provide('wbIdentity', { current: () => makeUser() })
    await ctx.plugin(WbToolGatewayServiceClass)
    await ctx.plugin(WbPolicyServiceClass)

    const gov = ctx.wbPolicy.governance()
    expect(gov.matrix).toBeDefined()
    expect(gov.matrix.PUBLIC.local_model_inference).toBe('ALLOW')

    // Mutating copy does not affect enforcement
    gov.matrix.PUBLIC.local_model_inference = 'DENY'
    const d = await ctx.wbPolicy.evaluate({
      user: USER_ID, sessionId: SESSION, agentPreset: 'document-analyst',
      action: 'model_request', classification: 'PUBLIC', destination: 'local',
    })
    expect(d.decision).toBe('ALLOW')
  })
})
