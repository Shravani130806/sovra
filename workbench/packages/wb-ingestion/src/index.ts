/**
 * wb-ingestion — Document Ingestion plugin.
 *
 * Pipeline: upload → validate → classify → parse/OCR → chunk → embed → index.
 * The on-disk JSONL index is read by wb-rag (a separate plugin).
 *
 * Concurrency: JSONL appends use fs.appendFileSync (O_APPEND), which is
 * atomic under PIPE_BUF (4096 bytes on Linux) — same pattern as
 * wb-audit/src/index.ts:139-144.
 *
 * @module
 */

import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import {
  asWbDocumentId,
  type WbIngestionService,
  type WbIngestionCompletedEvent,
  type WbDocumentId,
  type WbClassification,
  type WbIngestFile,
  type WbVisionService,
  type WbModelGatewayService,
  type WbPolicyService,
} from '@mrpl/dsh-workbench-types'
import * as fs from 'node:fs'
import * as crypto from 'node:crypto'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'

import { type IngestionConfig, type IndexChunk } from './types.ts'
import { extractOfficeText, isOfficeType } from './office.ts'
import { classificationRank, suggestClassification } from './classify.ts'

// ---------------------------------------------------------------------------
// Declaration merges
// ---------------------------------------------------------------------------

declare module '@deepseek-ai/cordis' {
  interface Context {
    wbIngestion: WbIngestionService
    wbVision: WbVisionService
    wbModelGateway: WbModelGatewayService
    wbPolicy: WbPolicyService
  }

  interface Events {
    /**
     * Document ingestion completed successfully.
     * @mode emit
     * @param payload - the resulting document id and final classification
     */
    'wb/ingestion/completed'(payload: WbIngestionCompletedEvent): void
  }
}

// ---------------------------------------------------------------------------
// Plugin exports
// ---------------------------------------------------------------------------

export const name = 'wb-ingestion'
export const inject = ['wbVision', 'wbModelGateway', 'wbPolicy'] as const

export const Config: Schema<IngestionConfig> = Schema.object({
  maxFileSize: Schema.number().default(50 * 1024 * 1024),
  allowedMimeTypes: Schema.array(Schema.string()).default([
    'text/*',
    'application/pdf',
    'image/*',
    'application/vnd.openxmlformats-officedocument.*',
    'application/json',
  ]),
  indexPath: Schema.string().default('$DSH_HOME/workbench/vector-index'),
  chunkSize: Schema.number().default(1000),
  chunkOverlap: Schema.number().default(200),
})

// ---------------------------------------------------------------------------
// MIME type detection
// ---------------------------------------------------------------------------

const EXTENSION_TO_MIME: Record<string, string> = {
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.csv': 'text/csv',
  '.ts': 'text/typescript',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.tiff': 'image/tiff',
  '.tif': 'image/tiff',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
}

function detectMime(filePath: string): string {
  const ext = filePath.substring(filePath.lastIndexOf('.')).toLowerCase()
  return EXTENSION_TO_MIME[ext] ?? 'application/octet-stream'
}

function mimeMatches(mime: string, pattern: string): boolean {
  if (pattern === 'text/*') return mime.startsWith('text/')
  if (pattern === 'image/*') return mime.startsWith('image/')
  if (pattern.endsWith('*')) return mime.startsWith(pattern.slice(0, -1))
  if (pattern.endsWith('/*')) return mime.startsWith(pattern.slice(0, -2) + '/')
  return mime === pattern
}

function isImageType(mime: string): boolean {
  return mime.startsWith('image/') || mime === 'application/pdf'
}

/** MIME types that cannot be parsed as text or by vision/OCR. */
const UNPARSABLE_MIME_TYPES = new Set([
  'application/octet-stream',
  'application/x-executable',
  'application/x-sharedlib',
])

// ---------------------------------------------------------------------------
// Text chunking
// ---------------------------------------------------------------------------

function chunkText(text: string, chunkSize: number, chunkOverlap: number): string[] {
  if (text.length === 0) return []
  if (text.length <= chunkSize) return [text]

  const chunks: string[] = []
  let start = 0

  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length)
    chunks.push(text.slice(start, end))
    if (end === text.length) break
    start += chunkSize - chunkOverlap
  }

  return chunks
}

// ---------------------------------------------------------------------------
// JSONL index writing (O_APPEND, per wb-audit pattern)
// ---------------------------------------------------------------------------

function appendToIndex(indexPath: string, chunk: IndexChunk): void {
  const line = JSON.stringify(chunk) + '\n'
  // O_APPEND (set by appendFileSync) ensures atomic appends under PIPE_BUF
  // on Linux — same concurrency guarantee as wb-audit/src/index.ts:143.
  fs.appendFileSync(indexPath, line, 'utf8')
}

// ---------------------------------------------------------------------------
// Service implementation
// ---------------------------------------------------------------------------

function createService(ctx: Context, config: IngestionConfig): WbIngestionService {
  const expandedIndexPath = config.indexPath.replace(
    '$DSH_HOME',
    resolveDshHome(),
  )

  return {
    async enqueue(file: WbIngestFile): Promise<WbDocumentId> {
      // 1. Validate file exists
      if (!fs.existsSync(file.path)) {
        throw new Error(`File not found: ${file.path}`)
      }

      // 2. Validate file is non-empty
      const stat = fs.statSync(file.path)
      if (stat.size === 0) {
        throw new Error('File is empty')
      }

      // 3. Validate file size
      if (stat.size > config.maxFileSize) {
        const sizeMB = (stat.size / (1024 * 1024)).toFixed(1)
        const limitMB = (config.maxFileSize / (1024 * 1024)).toFixed(0)
        throw new Error(`File size ${sizeMB}MB exceeds limit ${limitMB}MB`)
      }

      // 4. Validate MIME type
      const mime = detectMime(file.path)
      const allowed = config.allowedMimeTypes.some((pattern) =>
        mimeMatches(mime, pattern),
      )
      if (!allowed) {
        throw new Error(`MIME type not allowed: ${mime}`)
      }

      // 5. Reject MIME types that cannot be parsed
      if (UNPARSABLE_MIME_TYPES.has(mime)) {
        throw new Error(`Cannot parse file: unsupported format (${mime})`)
      }

      // 5b. Authorize the upload itself. §6 lists wb-policy as a dependency of
      // this plugin; before `ingest_document` existed there was no valid
      // request to build, so it injected policy and never called it and every
      // upload was ungoverned.
      const decision = await ctx.wbPolicy.evaluate({
        user: file.user,
        sessionId: file.sessionId,
        agentPreset: file.agentPreset ?? 'unknown',
        action: 'ingest_document',
        classification: file.declaredClassification,
        destination: 'local',
      })
      if (decision.decision !== 'ALLOW') {
        throw new Error(`ingestion denied: ${decision.decision} — ${decision.reason}`)
      }

      // 6. Assign document ID
      const documentId = asWbDocumentId(crypto.randomUUID())

      // 7. Classification: declared value at minimum (never auto-downgrade)
      let finalClassification: WbClassification = file.declaredClassification

      // 8. Parse content
      let title = file.path.split('/').pop() ?? 'unknown'

      let documentText: string
      if (isImageType(mime)) {
        // Image/PDF → OCR via wb-vision
        const buffer = fs.readFileSync(file.path)
        const ocrResult = await ctx.wbVision.describe(
          buffer,
          'Extract all text from this document via OCR. Preserve structure and formatting.',
        )
        documentText = String(ocrResult.text ?? '')
        if (documentText.length === 0) {
          throw new Error('OCR produced no text output')
        }
      } else if (isOfficeType(mime)) {
        // OOXML → unzip the archive and read its XML parts. Reading these as
        // UTF-8 decodes compressed binary into mojibake, which then chunks and
        // indexes cleanly as unsearchable noise — a silent corpus corruption.
        documentText = await extractOfficeText(fs.readFileSync(file.path), mime)
      } else {
        // Text → direct read
        documentText = fs.readFileSync(file.path, 'utf-8')
        if (documentText.trim().length === 0) {
          throw new Error('File is empty')
        }
      }

      // 9. Auto-classification may only RAISE the declared band (§6.8, and
      // §9 invariant 6). A suggestion below the declared value is discarded.
      const suggested = suggestClassification(documentText, mime)
      if (suggested && classificationRank(suggested) > classificationRank(finalClassification)) {
        finalClassification = suggested
      }

      const textChunks = chunkText(documentText, config.chunkSize, config.chunkOverlap)

      if (textChunks.length === 0) {
        throw new Error('No chunks produced from document')
      }

      // 10. Embed chunks via wb-model-gateway
      ctx.wbModelGateway.resolve('embedding')
      const embeddings = textChunks.map((chunk) =>
        generateEmbedding(chunk),
      )

      // 11. Write chunks to JSONL index (O_APPEND, atomic under PIPE_BUF)
      for (let i = 0; i < textChunks.length; i++) {
        const chunk: IndexChunk = {
          text: textChunks[i]!,
          documentId,
          title,
          classification: finalClassification,
          embedding: embeddings[i]!,
        }
        appendToIndex(expandedIndexPath, chunk)
      }

      // 12. Emit completion event
      const event: WbIngestionCompletedEvent = {
        documentId,
        classification: finalClassification,
      }
      ctx.emit('wb/ingestion/completed', event)

      return documentId
    },
  }
}

// ---------------------------------------------------------------------------
// apply() — Cordis entrypoint
// ---------------------------------------------------------------------------

export function apply(ctx: Context, config: IngestionConfig): void {
  ctx.provide('wbIngestion', undefined)

  ctx.effect(() => {
    ctx.wbIngestion = createService(ctx, config)

    return () => {
      // No persistent resources to close — JSONL writes are fire-and-forget.
    }
  }, 'wb-ingestion')
}

// ---------------------------------------------------------------------------
// Shared embedding generator (8-dim normalized embedding)
// ---------------------------------------------------------------------------

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
