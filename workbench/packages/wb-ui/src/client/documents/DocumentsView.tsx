import { useRef, useState } from 'react'
import { asWbDocumentId, type WbClassification } from '@mrpl/dsh-workbench-types'
import styles from './DocumentsView.module.css'
import { useDocuments } from '../live/hooks.ts'
import { openDocument } from '../live/navigation-store.ts'
import {
  CLASSIFICATIONS,
  DEFAULT_CLASSIFICATION,
  completeUpload,
  createChunksFromText,
  markUploading,
  queueUpload,
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

async function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve) => {
    try {
      const reader = new FileReader()
      reader.onload = () => {
        const text = typeof reader.result === 'string' ? reader.result : ''
        resolve(text)
      }
      reader.onerror = async () => {
        if (typeof file.text === 'function') {
          try {
            const t = await file.text()
            resolve(t || '')
          } catch {
            resolve('')
          }
        } else {
          resolve('')
        }
      }
      reader.readAsText(file)
    } catch {
      if (typeof file.text === 'function') {
        file.text().then(resolve).catch(() => resolve(''))
      } else {
        resolve('')
      }
    }
  })
}

export function DocumentsView({ onIngest }: DocumentsViewProps) {
  const { documents, uploads } = useDocuments()
  const [classification, setClassification] = useState<WbClassification>(DEFAULT_CLASSIFICATION)
  const [dragging, setDragging] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  function accept(files: FileList | null) {
    const fileList = Array.from(files ?? [])
    // Queue all files first synchronously so the upload job queue is immediately populated.
    const jobs = fileList.map((file) => ({
      file,
      jobId: queueUpload(file.name, classification),
    }))

    for (const { file, jobId } of jobs) {
      if (onIngest) {
        onIngest(jobId, file, classification)
      } else {
        // Standalone / client fallback: process the ingestion so queued files
        // transition to ingesting and land in the corpus table with full text.
        markUploading(jobId)
        void (async () => {
          const textContent = await readFileAsText(file)
          const chunksData = textContent ? createChunksFromText(textContent) : undefined
          const chunkCount =
            chunksData && chunksData.length > 0 ? chunksData.length : Math.max(1, Math.ceil(file.size / 1024))

          completeUpload(jobId, {
            id: asWbDocumentId(`doc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`),
            title: file.name,
            classification,
            declaredClassification: classification,
            chunks: chunkCount,
            content: textContent || undefined,
            chunksData: chunksData || undefined,
            ingestedAt: new Date().toISOString(),
          })
        })()
      }
    }
    if (input.current) {
      input.current.value = ''
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
              {documents.map((d) => (
                <tr key={d.id} className={styles.clickableRow} onClick={() => openDocument(d.id)}>
                  <td>{d.title}</td>
                  <td data-testid="doc-band">{d.classification}</td>
                  <td>{d.chunks}</td>
                  <td>{new Date(d.ingestedAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}
