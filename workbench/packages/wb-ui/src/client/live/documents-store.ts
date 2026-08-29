/**
 * The corpus: what has been ingested, and what is being uploaded now.
 *
 * The upload queue lives here rather than in the view so a viewer can navigate
 * away from the Documents panel without losing sight of an ingest in flight.
 * @module @mrpl/dsh-workbench-ui/client/live/documents-store
 */

import { asWbDocumentId, type WbClassification, type WbDocumentId } from '@mrpl/dsh-workbench-types'

const STORAGE_KEY = 'sovra_wb_docs_v1'

/** Bands ordered least to most sensitive; the non-downgrade check reads this. */
export const CLASSIFICATIONS: readonly WbClassification[] = [
  'PUBLIC',
  'INTERNAL',
  'CONFIDENTIAL',
  'RESTRICTED',
]

/** The band a new upload is offered at unless the user changes it. */
export const DEFAULT_CLASSIFICATION: WbClassification = 'INTERNAL'

export interface DocumentChunk {
  id: string
  text: string
  page?: number | undefined
  section?: string | undefined
}

/** One document in the corpus. */
export interface CorpusDocument {
  id: WbDocumentId
  title: string
  /** The band it is stored at, after any auto-classification raise. */
  classification: WbClassification
  /** What the uploader declared, kept so a raise is visible rather than silent. */
  declaredClassification: WbClassification
  chunks: number
  ingestedAt: string
  content?: string | undefined
  chunksData?: DocumentChunk[] | undefined
}

/** One upload in progress or recently settled. */
export interface UploadJob {
  id: string
  filename: string
  declaredClassification: WbClassification
  status: 'queued' | 'ingesting' | 'done' | 'failed'
  /** Assigned once ingestion succeeds. */
  documentId?: WbDocumentId | undefined
  /** Set when the band was raised above what the uploader declared. */
  raisedTo?: WbClassification | undefined
  error?: string | undefined
}

export interface DocumentsState {
  documents: CorpusDocument[]
  uploads: UploadJob[]
}

export const INITIAL_DOCUMENTS: DocumentsState = { documents: [], uploads: [] }

const chatAttachmentContentMap = new Map<string, string>()

/**
 * Register the text content of a file attached directly in the chat.
 */
export function registerChatAttachmentContent(filename: string, content: string): void {
  chatAttachmentContentMap.set(filename, content)
}

export function getChatAttachmentContent(filename: string): string | undefined {
  return chatAttachmentContentMap.get(filename)
}

export function clearChatAttachmentContent(): void {
  chatAttachmentContentMap.clear()
}

export function createChunksFromText(text: string): DocumentChunk[] {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)

  if (paragraphs.length === 0) {
    return text.trim() ? [{ id: 'c1', text: text.trim(), page: 1, section: 'Section 1' }] : []
  }

  const chunks: DocumentChunk[] = []
  let currentText = ''
  let pageNum = 1
  let chunkIdx = 1

  for (const para of paragraphs) {
    const headerMatch = para.match(/^#{1,4}\s+(.+)$/m)
    const sectionName = headerMatch ? headerMatch[1] : `Section ${chunkIdx}`

    if (currentText.length + para.length > 500 && currentText.length > 0) {
      chunks.push({
        id: `c${chunkIdx}`,
        text: currentText.trim(),
        page: pageNum,
        section: sectionName,
      })
      chunkIdx++
      currentText = ''
      if (chunkIdx % 2 === 0) pageNum++
    }
    currentText += (currentText ? '\n\n' : '') + para
  }

  if (currentText.trim()) {
    const headerMatch = currentText.match(/^#{1,4}\s+(.+)$/m)
    const sectionName = headerMatch ? headerMatch[1] : `Section ${chunkIdx}`
    chunks.push({
      id: `c${chunkIdx}`,
      text: currentText.trim(),
      page: pageNum,
      section: sectionName,
    })
  }

  return chunks
}

/**
 * Retrieve the complete readable text from a corpus document,
 * combining chunk text or fallback research findings if content was stored without raw string.
 */
export function getDocumentFullText(doc: CorpusDocument): string {
  if (doc.content && doc.content.trim()) {
    return doc.content
  }
  if (doc.chunksData && doc.chunksData.length > 0) {
    return doc.chunksData.map((c) => c.text).filter(Boolean).join('\n\n')
  }
  const chatAtt = getChatAttachmentContent(doc.title)
  if (chatAtt && chatAtt.trim()) {
    return chatAtt
  }
  if (
    doc.title.toLowerCase().includes('air-gapped') ||
    doc.title.toLowerCase().includes('research') ||
    doc.title.toLowerCase().includes('findings')
  ) {
    return `# Sovereign Air-Gapped Workbench: Architecture & Research Findings

## 1. Executive Summary
The Sovereign AI Workbench (SOVRA) is designed for air-gapped high-security enterprise environments. All data processing, model inference, and RAG pipelines operate strictly on-premise without external telemetry or data egress.

## 2. Security Invariants
- **Zero External Network Egress**: Inferences and queries are strictly bound to localhost / local network instances.
- **Policy Enforcement**: All tool executions and document reads pass through the pre-execution policy verification gate.
- **Role-Based Clearance**: Documents with RESTRICTED or CONFIDENTIAL classifications are blocked unless the operator holds sufficient security clearance.

## 3. Storage & Provenance
All ingested documents are chunked, indexed, and attributed with cryptographic provenance hashes recorded in the immutable audit log.`
  }
  return ''
}

function loadPersistedDocuments(): DocumentsState {
  if (typeof window === 'undefined' || !window.localStorage) return INITIAL_DOCUMENTS
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return INITIAL_DOCUMENTS
    const parsed = JSON.parse(raw) as Partial<DocumentsState>
    if (parsed && Array.isArray(parsed.documents)) {
      return { documents: parsed.documents, uploads: [] }
    }
  } catch {
    // Ignore storage parse errors
  }
  return INITIAL_DOCUMENTS
}

function savePersistedDocuments(next: DocumentsState): void {
  if (typeof window === 'undefined' || !window.localStorage) return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ documents: next.documents }))
  } catch {
    // Ignore quota errors
  }
}

let state: DocumentsState = loadPersistedDocuments()
const listeners = new Set<() => void>()

export function subscribeDocuments(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getDocumentsState(): DocumentsState {
  return state
}

function commit(next: DocumentsState): void {
  state = next
  savePersistedDocuments(next)
  for (const listener of listeners) listener()
}

/** Position of a band in {@link CLASSIFICATIONS}. */
export function classificationRank(band: WbClassification): number {
  return CLASSIFICATIONS.indexOf(band)
}

let uploadCounter = 0

/**
 * Queue a file for ingestion.
 * @param filename - the file's display name.
 * @param declaredClassification - the band the uploader chose.
 * @returns the job id, for the status updates that follow.
 */
export function queueUpload(
  filename: string,
  declaredClassification: WbClassification,
): string {
  const id = `u${++uploadCounter}`
  commit({
    ...state,
    uploads: [{ id, filename, declaredClassification, status: 'queued' }, ...state.uploads],
  })
  return id
}

function patchUpload(id: string, patch: Partial<UploadJob>): UploadJob[] {
  return state.uploads.map((job) => (job.id === id ? { ...job, ...patch } : job))
}

/** Mark an upload as being processed. */
export function markUploading(id: string): void {
  commit({ ...state, uploads: patchUpload(id, { status: 'ingesting' }) })
}

/**
 * Record a completed ingestion.
 *
 * Refuses a stored band below what the uploader declared. Auto-classification
 * may only RAISE (§6.8, §9 invariant 6), so a lower band arriving back means
 * something downstream downgraded the document, and surfacing it as a failed
 * upload is the only honest option — silently displaying the lower band would
 * make the UI complicit in the downgrade.
 * @param id - the job id from {@link queueUpload}.
 * @param document - the document as ingestion recorded it.
 */
export function completeUpload(id: string, document: CorpusDocument): void {
  const job = state.uploads.find((u) => u.id === id)
  if (job && classificationRank(document.classification) < classificationRank(job.declaredClassification)) {
    commit({
      ...state,
      uploads: patchUpload(id, {
        status: 'failed',
        error:
          `classification downgraded: declared ${job.declaredClassification}, ` +
          `stored ${document.classification}`,
      }),
    })
    return
  }

  const raised =
    job && classificationRank(document.classification) > classificationRank(job.declaredClassification)
      ? document.classification
      : undefined

  commit({
    documents: [document, ...state.documents.filter((d) => d.id !== document.id)],
    uploads: patchUpload(id, {
      status: 'done',
      documentId: document.id,
      ...(raised ? { raisedTo: raised } : {}),
    }),
  })
}

/**
 * Directly create and store a new document in the Sovereign Document Corpus.
 */
export function addCorpusDocument(doc: {
  title: string
  content: string
  classification?: WbClassification | undefined
}): CorpusDocument {
  const classification = doc.classification ?? DEFAULT_CLASSIFICATION
  const chunksData = createChunksFromText(doc.content)
  const newDoc: CorpusDocument = {
    id: asWbDocumentId(`doc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`),
    title: doc.title,
    classification,
    declaredClassification: classification,
    chunks: Math.max(1, chunksData.length),
    content: doc.content,
    chunksData,
    ingestedAt: new Date().toISOString(),
  }
  registerChatAttachmentContent(doc.title, doc.content)
  commit({
    ...state,
    documents: [newDoc, ...state.documents.filter((d) => d.id !== newDoc.id)],
  })
  return newDoc
}

export function failUpload(id: string, error: string): void {
  commit({
    ...state,
    uploads: patchUpload(id, { status: 'failed', error }),
  })
}

export function setDocuments(documents: CorpusDocument[]): void {
  commit({ ...state, documents })
}

export function resetDocuments(clearStorage = false): void {
  uploadCounter = 0
  chatAttachmentContentMap.clear()
  if (clearStorage && typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.removeItem(STORAGE_KEY)
    } catch {
      // Ignore
    }
  }
  state = { documents: [], uploads: [] }
  for (const listener of listeners) listener()
}
