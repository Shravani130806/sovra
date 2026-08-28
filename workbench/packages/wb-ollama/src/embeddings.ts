/**
 * `WbEmbeddingsService` over Ollama's embeddings endpoint.
 *
 * This is the seam the harness does not have: `ctx.llm` is chat-only, so
 * `wb-model-gateway.resolve('embedding')` could return an adapter id but
 * nothing could ever embed with it.
 * @module @mrpl/dsh-workbench-ollama/embeddings
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { attributionHeaders } from '@deepseek-ai/dsh-llm'
import type { WbEmbeddingsService as WbEmbeddingsContract } from '@mrpl/dsh-workbench-types'
import { requireOnPremiseUrl } from './host-guard.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    wbEmbeddings: OllamaEmbeddings
  }
}

/** Embedding provider backed by a local Ollama server. */
export class OllamaEmbeddings extends Service implements WbEmbeddingsContract {
  static inject = [] as const

  private readonly base: URL
  /** Cached after the first call; the model's width does not change at runtime. */
  private width: number | undefined

  constructor(
    ctx: Context,
    private readonly model: string,
    baseUrl: string,
  ) {
    super(ctx, 'wbEmbeddings')
    this.base = requireOnPremiseUrl(baseUrl)
  }

  /**
   * Embed texts in order.
   * @param texts - the texts to embed.
   * @param signal - caller cancellation.
   * @returns one vector per input.
   * @throws when the host is unreachable or the model is not pulled — an
   *   empty or zero vector would index silently and rank meaninglessly.
   */
  async embed(texts: readonly string[], signal?: AbortSignal): Promise<number[][]> {
    const out: number[][] = []
    for (const text of texts) {
      const response = await fetch(new URL('/api/embeddings', this.base).toString(), {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...attributionHeaders() },
        body: JSON.stringify({ model: this.model, prompt: text }),
        ...(signal ? { signal } : {}),
      })
      if (!response.ok) {
        const detail = await response.text().catch(() => '')
        throw new Error(
          `wb-ollama: embedding with "${this.model}" failed (${response.status})` +
            `${detail ? `: ${detail.slice(0, 200)}` : ''}. ` +
            `Is it pulled? Try: ollama pull ${this.model}`,
        )
      }
      const body = (await response.json()) as { embedding?: unknown }
      if (!Array.isArray(body.embedding) || body.embedding.length === 0) {
        throw new Error(`wb-ollama: "${this.model}" returned no embedding vector`)
      }
      out.push(body.embedding as number[])
    }
    return out
  }

  /**
   * The width of this model's vectors.
   * @returns the dimensionality, embedding a probe once to learn it.
   */
  async dimensions(): Promise<number> {
    if (this.width === undefined) {
      const [probe] = await this.embed([''])
      this.width = probe?.length ?? 0
    }
    return this.width
  }
}
