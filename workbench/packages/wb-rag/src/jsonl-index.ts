/**
 * On-disk JSONL vector index for wb-rag.
 *
 * Reads chunks from a JSONL file (one JSON object per line) written by
 * wb-ingestion. No in-memory cache — reads fresh on each search call.
 * Prototype-quality: linear scan with cosine similarity. A production
 * deployment would replace this with an actual vector database.
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

/** Cosine similarity between two vectors of equal length. */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!
    normA += a[i]! * a[i]!
    normB += b[i]! * b[i]!
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  return denom === 0 ? 0 : dot / denom
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
