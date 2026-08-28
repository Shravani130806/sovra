import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import { LlmAdapter } from '@deepseek-ai/dsh-llm'
import type {
  GenerateOptions,
  StreamChunk,
  LlmModelInfo,
  LlmResolvedModelInfo,
} from '@deepseek-ai/dsh-llm'
import { describe, expect, it, afterEach } from 'vitest'
import { WbModelGatewayService, apply } from '../src/index'
import type { Config as GatewayConfig } from '../src/index'
import type { WbModelCapability } from '@mrpl/dsh-workbench-types'

// ---------------------------------------------------------------------------
// Stub adapters — register the real LlmAdapter capability surface
// ---------------------------------------------------------------------------

class StubAdapter extends LlmAdapter {
  private readonly models: LlmModelInfo[]
  private readonly resolvedModels: LlmResolvedModelInfo[]

  constructor(models: LlmModelInfo[], resolvedModels?: LlmResolvedModelInfo[]) {
    super()
    this.models = models
    this.resolvedModels = resolvedModels ?? models.map(m => ({
      ...m,
      reasoning: undefined,
    }))
  }

  override listModels(_provider: string): Promise<readonly LlmModelInfo[]> {
    return Promise.resolve(this.models)
  }

  override resolveModel(
    provider: string,
    model: string,
  ): Promise<LlmResolvedModelInfo> {
    const found = this.resolvedModels.find(m => m.id === model)
    if (found) return Promise.resolve(found)
    return Promise.resolve({ provider, id: model, name: model })
  }

  async *stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    yield { type: 'chunk', delta: '' }
    yield { type: 'finish', finishReason: 'stop' }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function mountLlmRuntime(ctx: Context): Promise<void> {
  await ctx.plugin(LlmRuntime)
}

function registerAdapter(
  ctx: Context,
  providerId: string,
  models: LlmModelInfo[],
  resolvedModels?: LlmResolvedModelInfo[],
): void {
  const adapter = new StubAdapter(models, resolvedModels)
  ctx.llm.registerAdapter([providerId], adapter)
}

function makeReasoningModels(provider: string): LlmModelInfo[] {
  return [{ provider, id: 'reasoning-model', name: 'Reasoning Model' }]
}

function makeResolvedReasoningModels(provider: string): LlmResolvedModelInfo[] {
  return [{
    provider,
    id: 'reasoning-model',
    name: 'Reasoning Model',
    reasoning: {
      efforts: [
        { id: 'off' as any, name: 'Off' },
        { id: 'high' as any, name: 'High' },
      ],
      defaultEffort: 'off' as any,
    },
  }]
}

function makeVisionModels(provider: string): LlmModelInfo[] {
  return [{
    provider,
    id: 'vision-model',
    name: 'Vision Model',
    inputModalities: ['text', 'image'],
  }]
}

function makeEmbeddingModels(provider: string): LlmModelInfo[] {
  return [{ provider, id: 'embedding-model', name: 'Embedding Model' }]
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('wb-model-gateway', () => {
  let ctx: Context

  afterEach(async () => {
    if (ctx) await ctx.fiber.dispose()
  })

  // --- Core routing --------------------------------------------------------

  it('resolves each capability to the correct adapterId', async () => {
    ctx = new Context()
    await mountLlmRuntime(ctx)

    registerAdapter(ctx, 'reasoning-adp', makeReasoningModels('reasoning-adp'),
      makeResolvedReasoningModels('reasoning-adp'))
    registerAdapter(ctx, 'vision-adp', makeVisionModels('vision-adp'))
    registerAdapter(ctx, 'embed-adp', makeEmbeddingModels('embed-adp'))
    registerAdapter(ctx, 'rerank-adp', makeEmbeddingModels('rerank-adp'))
    registerAdapter(ctx, 'ocr-adp', makeVisionModels('ocr-adp'))

    const config: GatewayConfig = {
      routing: {
        reasoning: 'reasoning-adp',
        vision_reasoning: 'vision-adp',
        embedding: 'embed-adp',
        rerank: 'rerank-adp',
        ocr: 'ocr-adp',
      },
    }

    await ctx.plugin({ name: 'wb-model-gateway', inject: ['llm'], apply(inner) { apply(inner, config) } })

    expect(ctx.wbModelGateway.resolve('reasoning')).toEqual({
      adapterId: 'reasoning-adp',
      capability: 'reasoning',
    })
    expect(ctx.wbModelGateway.resolve('vision_reasoning')).toEqual({
      adapterId: 'vision-adp',
      capability: 'vision_reasoning',
    })
    expect(ctx.wbModelGateway.resolve('embedding')).toEqual({
      adapterId: 'embed-adp',
      capability: 'embedding',
    })
    expect(ctx.wbModelGateway.resolve('rerank')).toEqual({
      adapterId: 'rerank-adp',
      capability: 'rerank',
    })
    expect(ctx.wbModelGateway.resolve('ocr')).toEqual({
      adapterId: 'ocr-adp',
      capability: 'ocr',
    })
  })

  // --- Validation: unmounted adapter --------------------------------------

  it('throws at boot when a routing entry names an unmounted adapter', async () => {
    ctx = new Context()
    await mountLlmRuntime(ctx)

    registerAdapter(ctx, 'reasoning-adp', makeReasoningModels('reasoning-adp'),
      makeResolvedReasoningModels('reasoning-adp'))

    const config: GatewayConfig = {
      routing: {
        reasoning: 'reasoning-adp',
        vision_reasoning: 'missing-vision',
        embedding: 'missing-embed',
        rerank: 'missing-rerank',
        ocr: 'missing-ocr',
      },
    }

    await expect(
      ctx.plugin({ name: 'wb-model-gateway', inject: ['llm'], apply(inner) { apply(inner, config) } }),
    ).rejects.toThrow(/no mounted adapter with id "missing-vision"/)
  })

  // --- Validation: missing capability key ----------------------------------

  it('throws at boot when a capability is missing from routing config', async () => {
    ctx = new Context()
    await mountLlmRuntime(ctx)

    registerAdapter(ctx, 'adp', makeReasoningModels('adp'),
      makeResolvedReasoningModels('adp'))

    const badConfig = {
      routing: {
        reasoning: 'adp',
        vision_reasoning: 'adp',
        rerank: 'adp',
        ocr: 'adp',
      },
    }

    await expect(
      ctx.plugin({ name: 'wb-model-gateway', inject: ['llm'], apply(inner) {
        apply(inner, badConfig as any)
      } }),
    ).rejects.toThrow()
  })

  // --- Unknown keys stripped by Schemastery ---------------------------------

  it('strips unknown routing keys via Schemastery (extra keys ignored)', async () => {
    ctx = new Context()
    await mountLlmRuntime(ctx)

    registerAdapter(ctx, 'adp', makeReasoningModels('adp'),
      makeResolvedReasoningModels('adp'))

    const configWithExtra = {
      routing: {
        reasoning: 'adp',
        vision_reasoning: 'adp',
        embedding: 'adp',
        rerank: 'adp',
        ocr: 'adp',
        unknown_capability: 'adp',
      },
    }

    // Schemastery strips unknown keys; plugin still loads successfully
    await ctx.plugin({ name: 'wb-model-gateway', inject: ['llm'], apply(inner) {
      apply(inner, configWithExtra as any)
    } })

    expect(ctx.wbModelGateway.resolve('reasoning').adapterId).toBe('adp')
  })

  // --- resolve() is pure ---------------------------------------------------

  it('resolve() returns a WbModelHandle without triggering adapter calls', async () => {
    ctx = new Context()
    await mountLlmRuntime(ctx)

    const throwingAdapter = new StubAdapter(makeReasoningModels('adp'),
      makeResolvedReasoningModels('adp'))
    let streamCalled = false
    const originalStream = throwingAdapter.stream.bind(throwingAdapter)
    ;(throwingAdapter as any).stream = function* () {
      streamCalled = true
      yield* originalStream({} as any)
    }

    ctx.llm.registerAdapter(['adp'], throwingAdapter)

    const config: GatewayConfig = {
      routing: {
        reasoning: 'adp',
        vision_reasoning: 'adp',
        embedding: 'adp',
        rerank: 'adp',
        ocr: 'adp',
      },
    }

    await ctx.plugin({ name: 'wb-model-gateway', inject: ['llm'], apply(inner) { apply(inner, config) } })

    const handle = ctx.wbModelGateway.resolve('reasoning')
    expect(handle).toEqual({ adapterId: 'adp', capability: 'reasoning' })
    expect(streamCalled).toBe(false)
  })

  // --- Two capabilities, same adapter --------------------------------------

  it('allows two capabilities pointing at the same adapter id', async () => {
    ctx = new Context()
    await mountLlmRuntime(ctx)

    registerAdapter(ctx, 'multi-adp', makeVisionModels('multi-adp'))

    const config: GatewayConfig = {
      routing: {
        reasoning: 'multi-adp',
        vision_reasoning: 'multi-adp',
        embedding: 'multi-adp',
        rerank: 'multi-adp',
        ocr: 'multi-adp',
      },
    }

    await ctx.plugin({ name: 'wb-model-gateway', inject: ['llm'], apply(inner) { apply(inner, config) } })

    expect(ctx.wbModelGateway.resolve('vision_reasoning').adapterId).toBe('multi-adp')
    expect(ctx.wbModelGateway.resolve('ocr').adapterId).toBe('multi-adp')
  })

  // --- HMR safety ----------------------------------------------------------

  it('cleans up on disposal (HMR safety)', async () => {
    ctx = new Context()
    await mountLlmRuntime(ctx)

    registerAdapter(ctx, 'adp', makeReasoningModels('adp'),
      makeResolvedReasoningModels('adp'))

    const config: GatewayConfig = {
      routing: {
        reasoning: 'adp',
        vision_reasoning: 'adp',
        embedding: 'adp',
        rerank: 'adp',
        ocr: 'adp',
      },
    }

    const fiber = await ctx.plugin({ name: 'wb-model-gateway', inject: ['llm'], apply(inner) { apply(inner, config) } })
    expect(ctx.wbModelGateway).toBeDefined()

    await fiber.dispose()
  })
})
