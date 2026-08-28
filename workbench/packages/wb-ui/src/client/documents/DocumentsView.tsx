import { useRef, useState } from 'react'
import type { WbClassification } from '@mrpl/dsh-workbench-types'
import styles from './DocumentsView.module.css'
import { useDocuments } from '../live/hooks.ts'
import { openDocument } from '../live/navigation-store.ts'
import {
  CLASSIFICATIONS, DEFAULT_CLASSIFICATION, queueUpload,
} from '../live/documents-store.ts'

/** What the ingest pipeline can read; anything else is refused before upload. */
const ACCEPTED = '.pdf,.png,.jpg,.jpeg,.webp,.gif,.docx,.xlsx,.pptx,.txt,.md'

export interface DocumentsViewProps {
  /**
   * Hand a queued file to the ingest pipeline.
   *
   * Supplied by the container that owns the transport; the panel decides when
   * a file should be ingested, never how, so it cannot become a second path
   * into the corpus.
   */
  onIngest?: (jobId: string, file: File, classification: WbClassification) => void
}

export function DocumentsView({ onIngest }: DocumentsViewProps) {
  const { documents, uploads } = useDocuments()
  const [classification, setClassification] = useState<WbClassification>(DEFAULT_CLASSIFICATION)
  const [dragging, setDragging] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  function accept(files: FileList | null) {
    for (const file of Array.from(files ?? [])) {
      // Queue first, notify second. `onIngest?.(queueUpload(...))` would
      // short-circuit the whole call — including the argument — whenever no
      // handler is attached, so the file would silently never be queued.
      // The band is chosen BEFORE the file is read, so nothing is ever
      // ingested at a classification the uploader did not pick.
      const jobId = queueUpload(file.name, classification)
      onIngest?.(jobId, file, classification)
    }
  }

  return (
    <div className={styles.container}>
      <div className={styles.uploadBar}>
        <label className={styles.pickerLabel} htmlFor="wb-classification">
          Classification
        </label>
        <select
          id="wb-classification"
          className={styles.picker}
          value={classification}
          onChange={(e) => setClassification(e.target.value as WbClassification)}
        >
          {CLASSIFICATIONS.map((band) => (
            <option key={band} value={band}>{band}</option>
          ))}
        </select>

        <button type="button" className={styles.uploadButton} onClick={() => input.current?.click()}>
          Upload documents
        </button>
        <input
          ref={input}
          type="file"
          multiple
          accept={ACCEPTED}
          aria-label="Choose files"
          className={styles.hiddenInput}
          onChange={(e) => accept(e.target.files)}
        />
      </div>

      <div
        className={`${styles.dropzone} ${dragging ? styles.dropzoneActive : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); accept(e.dataTransfer.files) }}
      >
        Drop files here — they will be ingested as <strong>{classification}</strong>
      </div>

      {uploads.length > 0 ? (
        <section>
          <h3 className={styles.heading}>Uploads</h3>
          <ul className={styles.uploadList}>
            {uploads.map((job) => (
              <li key={job.id} className={styles.uploadRow}>
                <span className={styles.uploadName}>{job.filename}</span>
                <span className={styles.uploadStatus}>{job.status}</span>
                {job.raisedTo ? (
                  // A raise must be visible; an operator who declared INTERNAL
                  // needs to know the document is stored higher.
                  <span className={styles.raised}>raised to {job.raisedTo}</span>
                ) : null}
                {job.error ? <span className={styles.uploadError}>{job.error}</span> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section>
        <h3 className={styles.heading}>Corpus</h3>
        {documents.length === 0 ? (
          <p className={styles.empty}>No documents ingested yet.</p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr><th>Title</th><th>Classification</th><th>Chunks</th><th>Ingested</th></tr>
            </thead>
            <tbody>
              {documents.map((doc) => (
                <tr key={doc.id} onClick={() => openDocument(doc.id)} className={styles.row}>
                  <td>{doc.title}</td>
                  <td><span className={styles.band} data-testid="doc-band">{doc.classification}</span></td>
                  <td>{doc.chunks}</td>
                  <td>{new Date(doc.ingestedAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}
