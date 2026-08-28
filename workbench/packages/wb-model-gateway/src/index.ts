/**
 * Capability-based model gateway for the Sovereign AI Workbench.
 *
 * Routes `WbModelCapability` requests to mounted harness LLM adapters
 * via a config-driven routing table validated at boot.
 *
 * @module @mrpl/dsh-workbench-model-gateway
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { LlmProviderInfo } from '@deepseek-ai/dsh-llm'
import {
  type WbModelCapability,
  type WbModelHandle,
  type WbModelGatewayService as WbModelGatewayContract,
} from '@mrpl/dsh-workbench-types'

// ---------------------------------------------------------------------------
// Plugin metadata
// ---------------------------------------------------------------------------

export const name = 'wb-model-gateway'

export const inject = ['llm'] as const

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface Config {
  /** Maps each WbModelCapability to the cordis.yml id of a mounted adapter. */
  routing: Record<WbModelCapability, string>
}

const ALL_CAPABILITIES: WbModelCapability[] = [
  'reasoning',
  'vision_reasoning',
  'embedding',
  'rerank',
  'ocr',
]

export const Config = z.object({
  routing: z.object({
    reasoning: z.string(),
    vision_reasoning: z.string(),
    embedding: z.string(),
    rerank: z.string(),
    ocr: z.string(),
  }),
})

// ---------------------------------------------------------------------------
// Context augmentation
// ---------------------------------------------------------------------------

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Model gateway service providing capability-based adapter routing. */
    wbModelGateway: WbModelGatewayContract
    /** Harness LLM runtime — injected to enumerate mounted adapters. */
    llm: import('@deepseek-ai/dsh-llm').LlmRuntime
  }
}

// ---------------------------------------------------------------------------
// Service implementation
// ---------------------------------------------------------------------------

/**
 * Resolves `WbModelCapability` requests to mounted harness LLM adapters.
 *
 * The routing table is config-driven and validated at boot: every entry
 * must name a genuinely mounted adapter. Adding a new model is a config
 * change, never a code change.
 */
export class WbModelGatewayService extends Service implements WbModelGatewayContract {
  static inject = ['llm'] as const

  private readonly routing: Record<WbModelCapability, string>
  private readonly mountedProviders: LlmProviderInfo[]

  constructor(ctx: Context, config: Config) {
    super(ctx, 'wbModelGateway')

    this.routing = config.routing
    this.mountedProviders = ctx.llm.listProviders()

    this.validateRouting()
  }

  /**
   * Validate every routing entry at boot. Throws on any misconfiguration.
   */
  private validateRouting(): void {
    const mountedIds = new Set(this.mountedProviders.map(p => p.id))

    for (const capability of ALL_CAPABILITIES) {
      const adapterId = this.routing[capability]
      if (adapterId === undefined) {
        throw new Error(
          `wb-model-gateway: missing routing entry for capability "${capability}"`,
        )
      }

      if (!mountedIds.has(adapterId)) {
        throw new Error(
          `wb-model-gateway: routing "${capability}" → "${adapterId}" failed: ` +
          `no mounted adapter with id "${adapterId}". ` +
          `Mounted adapters: [${[...mountedIds].join(', ')}]`,
        )
      }
    }
  }

  /**
   * Resolve a capability to a model handle.
   *
   * This is a pure lookup against validated config — it never calls a model.
   */
  resolve(capability: WbModelCapability): WbModelHandle {
    const adapterId = this.routing[capability]
    if (adapterId === undefined) {
      throw new Error(
        `wb-model-gateway: no routing entry for capability "${capability}"`,
      )
    }

    return { adapterId, capability }
  }
}

// ---------------------------------------------------------------------------
// Plugin entry point
// ---------------------------------------------------------------------------

export function apply(ctx: Context, config: Config): void {
  ctx.effect(() => {
    new WbModelGatewayService(ctx, config)
    return () => {}
  }, 'wb-model-gateway')
}

export default WbModelGatewayService
