/**
 * wb-rag — Enterprise RAG plugin.
 *
 * Permission-aware retrieval: authorize chunks before reranking, never
 * letting the LLM see unauthorized text. Authorization happens before
 * context reaches the LLM (DESIGN.md §9 invariant 2).
 *
 * @module
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {
  WbRagService,
  WbRagResult,
  WbUser,
  WbSessionId,
  WbCitation,
  WbPolicyService,
  WbModelGatewayService,
  WbRagRetrievedEvent,
} from '@mrpl/dsh-workbench-types'

import { readIndex, search, type IndexChunk } from './jsonl-index.ts'

// ---------------------------------------------------------------------------
// Declaration merges — consumed services + events
// ---------------------------------------------------------------------------

declare module '@deepseek-ai/cordis' {
  interface Context {
    wbPolicy: WbPolicyService
    wbModelGateway: WbModelGatewayService
    wbRag: WbRagService
  }

  interface Events {
    /**
     * Emitted once per retrieve() call, listing authorized and filtered chunks.
     * @mode emit
     * @param payload - retrieval result including authorized and filtered chunks
     */
    'wb/rag/retrieved'(payload: WbRagRetrievedEvent): void
  }
}

// ---------------------------------------------------------------------------
// Plugin exports
// ---------------------------------------------------------------------------

export const name = 'wb-rag'
export const inject = ['wbPolicy', 'wbModelGateway']

export interface Config {
  /** Path to the on-disk JSONL vector index file. */
  indexPath: string
}

export const Config: z<Config> = z.object({
  indexPath: z.string(),
})

/** Sentinel for WbPolicyRequest.agentPreset — retrieve() has no preset parameter. */
const UNKNOWN_PRESET = 'unknown'



/** Build a WbCitation from an IndexChunk, omitting undefined optional fields. */
function makeCitation(chunk: IndexChunk): WbCitation {
  const citation: WbCitation = {
    documentId: chunk.documentId,
    title: chunk.title,
  }
  if (chunk.page !== undefined) citation.page = chunk.page
  if (chunk.section !== undefined) citation.section = chunk.section
  return citation
}

/**
 * Partition candidates by policy decision into authorized and filtered sets.
 * Uses Promise.all for parallel policy evaluation (ordering invariant: all
 * evaluations complete before reranking begins).
 */
async function authorizeCandidates(
  ctx: Context,
  candidates: IndexChunk[],
  user: WbUser,
  sessionId: WbSessionId,
): Promise<{ authorized: IndexChunk[]; filtered: WbRagResult['filtered'] }> {
  const evaluations = await Promise.all(
    candidates.map(async (candidate) => {
      const decision = await ctx.wbPolicy.evaluate({
        user: user.id,
        sessionId,
        agentPreset: user.allowedAgentPresets[0] ?? UNKNOWN_PRESET,
        action: 'read_data',
        resource: candidate.documentId,
        classification: candidate.classification,
        destination: 'local',
      })
      return { candidate, decision }
    }),
  )

    const authorized: IndexChunk[] = []
    const filtered: WbRagResult['filtered'] = []

    for (const { candidate, decision } of evaluations) {
      if (decision.decision === 'ALLOW') {
        authorized.push(candidate)
      } else {
        filtered.push({
          citation: makeCitation(candidate),
          reason: decision.reason || decision.decision,
        })
      }
    }

  return { authorized, filtered }
}

/**
 * Rerank authorized chunks. In this prototype, returns chunks in their
 * original order — the reranker adapter resolved through
 * ctx.wbModelGateway.resolve('rerank') would handle real reranking.
 * The actual call mechanism is an adapter detail of wb-model-gateway.
 */
async function rerankChunks(
  chunks: IndexChunk[],
): Promise<IndexChunk[]> {
  // Prototype: return chunks in index order. A real implementation would
  // call the reranker adapter resolved through wb-model-gateway.
  return chunks
}

export function apply(ctx: Context, config: Config) {
  ctx.provide('wbRag', undefined)

  ctx.effect(() => {
    ctx.wbRag = {
      async retrieve(query: string, user: WbUser, sessionId: WbSessionId): Promise<WbRagResult> {
        // 1. Embed query via wb-model-gateway
        ctx.wbModelGateway.resolve('embedding')

        // Prototype: deterministic embedding from query string.
        // A real implementation would call the embedding adapter resolved
        // through wb-model-gateway (see DESIGN.md §12 open question).
        const queryEmbedding = deterministicEmbed(query)

        // 2. Query the on-disk vector index
        const candidates = readIndex(config.indexPath)
        const topCandidates = search(candidates, queryEmbedding, 20)

        // 3. Authorize BEFORE reranking (DESIGN.md §9 invariant 2)
        const { authorized, filtered } = await authorizeCandidates(ctx, topCandidates, user, sessionId)

        // 4. Rerank the authorized set
        ctx.wbModelGateway.resolve('rerank')
        const reranked = await rerankChunks(authorized)

        // 5. Build result — citations strictly mirror chunks
        const chunks = reranked.map(c => ({
          text: c.text,
          citation: makeCitation(c),
          classification: c.classification,
        }))
        const citations = chunks.map(c => c.citation)

        const result: WbRagResult = { chunks, citations, filtered }

        // 6. Emit retrieval event for wb-audit
        ctx.emit('wb/rag/retrieved', {
          sessionId,
          result,
        })

        return result
      },
    }

    return () => {
      // Cleanup: the service reference is released when the fiber is disposed.
      // No external resources to close — the JSONL index is read fresh per call.
    }
  }, 'wb-rag')
}

/**
 * Prototype-only deterministic embedding. Maps a query string to a fixed
 * 8-dimensional vector. A real implementation calls the embedding adapter
 * through wb-model-gateway.
 */
function deterministicEmbed(text: string): number[] {
  const vec: number[] = [0, 0, 0, 0, 0, 0, 0, 0]
  for (let i = 0; i < text.length; i++) {
    const idx = i % 8
    vec[idx] = (vec[idx] ?? 0) + text.charCodeAt(i) / 1000
  }
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0))
  if (norm === 0) return vec
  return vec.map(v => v / norm)
}
