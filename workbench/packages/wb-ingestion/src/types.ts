/**
 * Plugin-local types for wb-ingestion.
 *
 * Shared contract types (WbDocumentId, WbClassification, etc.) live in
 * wb-types and must not be redefined here. This file holds only types
 * specific to this plugin's implementation.
 *
 * @module
 */

import type { WbDocumentId, WbClassification } from '@mrpl/dsh-workbench-types'

// ---------------------------------------------------------------------------
// Config (validated by Schema in index.ts)
// ---------------------------------------------------------------------------

export interface IngestionConfig {
  /** Maximum file size in bytes. */
  maxFileSize: number
  /** Allowed MIME types; glob patterns like 'text/*' match any subtype. */
  allowedMimeTypes: string[]
  /** Path to the shared JSONL vector index (read by wb-rag). */
  indexPath: string
  /** Chunk size in characters for text splitting. */
  chunkSize: number
  /** Overlap between consecutive chunks in characters. */
  chunkOverlap: number
}

// ---------------------------------------------------------------------------
// IndexChunk — the on-disk JSONL row format
// ---------------------------------------------------------------------------

/**
 * A single chunk written to the JSONL vector index. Both wb-ingestion
 * (writer) and wb-rag (reader) must agree on this shape. The format is
 * defined by wb-ingestion (built first) and documented in its README.
 *
 * JSONL: one JSON object per line, newline-terminated.
 * Concurrency: each append uses fs.appendFileSync (O_APPEND, atomic under
 * PIPE_BUF on Linux) — same pattern as wb-audit/src/index.ts:139-144.
 */
export interface IndexChunk {
  text: string
  documentId: WbDocumentId
  title: string
  page?: number
  section?: string
  classification: WbClassification
  embedding: number[]
}
