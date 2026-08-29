/**
 * `wb-ollama` — local models served on-premise.
 *
 * Registers an `LlmAdapter` for every configured route so `ctx.llm` (and
 * therefore `wb-model-gateway`) can reach them, and provides `ctx.wbEmbeddings`
 * for the retrieval path the LLM seam cannot serve.
 *
 * This is the only workbench package permitted to open a socket, and only to
 * its configured model host — see `host-guard.ts` and DESIGN.md §9 invariant 3.
 * @module @mrpl/dsh-workbench-ollama
 */

import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { OllamaAdapter, type ImageResolver } from './adapter.ts'
import { OllamaEmbeddings } from './embeddings.ts'
import { requireOnPremiseUrl } from './host-guard.ts'

export { OllamaAdapter, type ImageResolver } from './adapter.ts'
export { OllamaEmbeddings } from './embeddings.ts'
export { isOnPremiseHost, requireOnPremiseUrl } from './host-guard.ts'

export const name = 'wb-ollama'

export const inject = ['llm'] as const

export interface Config {
  /** Where Ollama listens. Must be loopback or a private address. */
  baseUrl: string
  /**
   * Provider routes this adapter answers for.
   *
   * These are the ids `wb-model-gateway`'s routing table points at, so a
   * deployment names them to match its `cordis.yml` — one Ollama server can
   * back several capabilities.
   */
  providers: string[]
  /** Model used for `ctx.wbEmbeddings`; must be an embedding model. */
  embeddingModel: string
}

export const Config: z<Config> = z.object({
  baseUrl: z.string().default('http://127.0.0.1:11434'),
  providers: z.array(z.string()).default(['llm-local', 'llm-vision-local']),
  embeddingModel: z.string().default('nomic-embed-text'),
})

/**
 * Mount the local model provider.
 * @param ctx - the plugin context.
 * @param config - validated configuration.
 * @throws at load when `baseUrl` is not an on-premise address, so a
 *   misconfigured deployment does not start (§9 invariants 3 and 5).
 */
export function apply(ctx: Context, config: Config): void {
  // Validate before anything registers: a bad host must stop the boot, not
  // surface at the first inference when a demo is already running.
  requireOnPremiseUrl(config.baseUrl)

  const resolveImage: ImageResolver = async (attachmentId) => {
    const attachments = ctx.get('attachments')
    if (!attachments) return undefined
    try {
      const stored = await attachments.readImage({ attachmentId } as never)
      return Buffer.from(stored.data).toString('base64')
    } catch {
      // A missing or unreadable attachment is announced to the model by the
      // adapter rather than failing the whole turn.
      return undefined
    }
  }

  ctx.effect(() => {
    const handle = ctx.llm.registerAdapter(
      config.providers,
      new OllamaAdapter(config.baseUrl, resolveImage),
    )
    return () => handle()
  }, 'wb-ollama.adapter')

  new OllamaEmbeddings(ctx, config.embeddingModel, config.baseUrl)
}

export default apply
