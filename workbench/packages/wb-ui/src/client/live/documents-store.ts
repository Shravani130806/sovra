/**
 * The corpus: what has been ingested, and what is being uploaded now.
 *
 * The upload queue lives here rather than in the view so a viewer can navigate
 * away from the Documents panel without losing sight of an ingest in flight.
 * @module @mrpl/dsh-workbench-ui/client/live/documents-store
 */

import type { WbClassification, WbDocumentId } from '@mrpl/dsh-workbench-types'

/** Bands ordered least to most sensitive; the non-downgrade check reads this. */
export const CLASSIFICATIONS: readonly WbClassification[] = [
  'PUBLIC',
  'INTERNAL',
  'CONFIDENTIAL',
  'RESTRICTED',
]

/** The band a new upload is offered at unless the user changes it. */
export const DEFAULT_CLASSIFICATION: WbClassification = 'INTERNAL'

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
}

/** One upload in progress or recently settled. */
export interface UploadJob {
  id: string
  filename: string
  declaredClassification: WbClassification
  status: 'queued' | 'ingesting' | 'done' | 'failed'
  /** Assigned once ingestion succeeds. */
  documentId?: WbDocumentId
  /** Set when the band was raised above what the uploader declared. */
  raisedTo?: WbClassification
  error?: string
}

export interface DocumentsState {
  documents: CorpusDocument[]
  uploads: UploadJob[]
}

export const INITIAL_DOCUMENTS: DocumentsState = { documents: [], uploads: [] }

let state: DocumentsState = INITIAL_DOCUMENTS
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

/** Record a failed ingestion with the reason the pipeline gave. */
export function failUpload(id: string, error: string): void {
  commit({ ...state, uploads: patchUpload(id, { status: 'failed', error }) })
}

/** Replace the corpus listing, for a full refresh. */
export function setDocuments(documents: readonly CorpusDocument[]): void {
  commit({ ...state, documents: [...documents] })
}

export function resetDocuments(): void {
  uploadCounter = 0
  commit(INITIAL_DOCUMENTS)
}
