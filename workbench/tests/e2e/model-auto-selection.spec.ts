import { describe, expect, it, afterEach } from 'vitest'
import { compose, type Composed } from '../harness.ts'

/**
 * §10 scenario: "automatically pick the right model for a given task".
 *
 * Asserts two DIFFERENT mounted adapter ids answered two different capability
 * needs in one session, which is the mechanism behind the PS requirement.
 */
describe('e2e: model auto-selection', () => {
  let c: Composed | undefined
  afterEach(() => { c?.dispose(); c = undefined })

  it('vision and reasoning resolve to different mounted adapters', async () => {
    c = await compose()
    const vision = c.ctx.wbModelGateway.resolve('vision_reasoning')
    const reasoning = c.ctx.wbModelGateway.resolve('reasoning')
    expect(vision.adapterId).toBe('llm-vision-local')
    expect(reasoning.adapterId).toBe('llm-deepseek')
    expect(vision.adapterId).not.toBe(reasoning.adapterId)
  })

  it('a real vision tool call is answered by the vision adapter, not the reasoning one', async () => {
    c = await compose()
    c.setModelReply(JSON.stringify({ answered: true, findings: [], reason: '' }))
    await c.ctx.wbVision.describe(Buffer.from('png-bytes'), 'what is connected to P-101?')
    expect(c.modelCalls.map((m) => m.provider)).toContain('llm-vision-local')
    expect(c.modelCalls.map((m) => m.provider)).not.toContain('llm-deepseek')
  })

  it('adding a model is config, not code — routing alone redirects a capability', async () => {
    c = await compose({
      mountedAdapters: ['llm-deepseek', 'llm-vision-local', 'embedding-local', 'reranker-local', 'llm-newcomer'],
      routing: { ocr: 'llm-newcomer' },
    })
    expect(c.ctx.wbModelGateway.resolve('ocr').adapterId).toBe('llm-newcomer')
  })
})
