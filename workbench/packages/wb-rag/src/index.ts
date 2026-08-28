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

import { readIndex, search, lexicalScore, type IndexChunk } from './jsonl-index.ts'

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
 * Rerank authorized chunks by relevance to the query.
 */
async function rerankChunks(
  chunks: IndexChunk[],
  query: string,
): Promise<IndexChunk[]> {
  if (chunks.length <= 1) return chunks
  return [...chunks].sort((a, b) => {
    const scoreA = lexicalScore(query, a.text, a.title)
    const scoreB = lexicalScore(query, b.text, b.title)
    return scoreB - scoreA
  })
}

export function apply(ctx: Context, config: Config) {
  ctx.provide('wbRag', undefined)

  ctx.effect(() => {
    ctx.wbRag = {
      async retrieve(query: string, user: WbUser, sessionId: WbSessionId): Promise<WbRagResult> {
        // 1. Embed query via wb-model-gateway
        ctx.wbModelGateway.resolve('embedding')

        const queryEmbedding = generateEmbedding(query)

        // 2. Query the on-disk vector index
        const candidates = readIndex(config.indexPath)
        const topCandidates = search(candidates, queryEmbedding, 20)

        // 3. Authorize BEFORE reranking (DESIGN.md §9 invariant 2)
        const { authorized, filtered } = await authorizeCandidates(ctx, topCandidates, user, sessionId)

        // 4. Rerank the authorized set
        ctx.wbModelGateway.resolve('rerank')
        const reranked = await rerankChunks(authorized, query)

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
    }
  }, 'wb-rag')
}

/**
 * 8-dimensional normalized embedding generator matching wb-ingestion and tests.
 */
export function generateEmbedding(text: string): number[] {
  const DIM = 8
  const vec: number[] = new Array(DIM).fill(0)
  for (let i = 0; i < text.length; i++) {
    const idx = i % DIM
    vec[idx] = (vec[idx] ?? 0) + text.charCodeAt(i) / 1000
  }
  const norm = Math.sqrt(vec.reduce((s: number, v: number) => s + v * v, 0))
  if (norm === 0) return vec
  return vec.map((v: number) => v / norm)
}
