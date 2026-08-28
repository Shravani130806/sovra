/**
 * On-disk JSONL vector index for wb-rag.
 *
 * Reads chunks from a JSONL file (one JSON object per line) written by
 * wb-ingestion. Supports hybrid semantic + lexical relevance search.
 *
 * @module
 */

import { readFileSync } from 'node:fs'
import type { WbDocumentId, WbClassification } from '@mrpl/dsh-workbench-types'

/** A single indexed chunk with its embedding vector. */
export interface IndexChunk {
  text: string
  documentId: WbDocumentId
  title: string
  page?: number
  section?: string
  classification: WbClassification
  embedding: number[]
}

/**
 * Read and parse the JSONL index file. Returns [] when the file does not
 * exist (fresh deployment before any ingestion).
 */
export function readIndex(indexPath: string): IndexChunk[] {
  let content: string
  try {
    content = readFileSync(indexPath, 'utf-8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }

  return content
    .split('\n')
    .filter(line => line.trim() !== '')
    .map(line => JSON.parse(line) as IndexChunk)
}

/** Cosine similarity between two vectors, handling variable length by zero-padding. */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0) return 0
  const maxLen = Math.max(a.length, b.length)
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < maxLen; i++) {
    const valA = a[i] ?? 0
    const valB = b[i] ?? 0
    dot += valA * valB
    normA += valA * valA
    normB += valB * valB
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  return denom === 0 ? 0 : dot / denom
}

/** Tokenize a string into lowercased search terms. */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9_-]+/)
    .filter(t => t.length > 1)
}

/** Calculate lexical overlap score between query and chunk. */
export function lexicalScore(query: string, chunkText: string, chunkTitle: string): number {
  const queryTokens = tokenize(query)
  if (queryTokens.length === 0) return 0

  const chunkTokens = new Set([...tokenize(chunkText), ...tokenize(chunkTitle)])
  let matchCount = 0
  for (const token of queryTokens) {
    if (chunkTokens.has(token)) {
      matchCount++
    }
  }

  return matchCount / queryTokens.length
}

/** Return the top-K chunks most similar to the query embedding. */
export function search(
  chunks: IndexChunk[],
  queryEmbedding: number[],
  topK: number,
): IndexChunk[] {
  return chunks
    .map(chunk => ({
      chunk,
      score: cosineSimilarity(queryEmbedding, chunk.embedding),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map(entry => entry.chunk)
}
