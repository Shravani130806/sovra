import { useState } from 'react'
import { useSessionArtifacts } from '../live/hooks.ts'
import type { ArtifactEntry } from '../live/workbench-store.ts'
import { getDocumentsState, getDocumentFullText } from '../live/documents-store.ts'
import { createDocxBlob } from '../artifacts/docx-exporter.ts'
import { createXlsxBlob } from '../artifacts/xlsx-exporter.ts'
import styles from './ArtifactView.module.css'

export function ArtifactView() {
  const artifacts = useSessionArtifacts()
  const [previewItem, setPreviewItem] = useState<ArtifactEntry | null>(null)
  const [downloadingId, setDownloadingId] = useState<string | null>(null)

  if (artifacts.length === 0) return null

  function getArtifactContent(art: ArtifactEntry): string {
    if (art.content && art.content.trim()) return art.content
    const docs = getDocumentsState().documents
    const matched = docs.find(
      (d) => d.title === art.filename || d.title.toLowerCase().includes(art.filename.toLowerCase()),
    )
    if (matched) return getDocumentFullText(matched)
    return `Sovereign AI Document: ${art.filename}\nType: ${art.kind}\nSources: ${art.sourceCount}`
  }

  async function handleDownload(art: ArtifactEntry) {
    try {
      setDownloadingId(art.id)
      const content = getArtifactContent(art)
      const isXlsx =
        art.filename.toLowerCase().endsWith('.xlsx') ||
        art.filename.toLowerCase().endsWith('.xls') ||
        art.kind === 'spreadsheet'
      const isDocx =
        !isXlsx &&
        (art.filename.toLowerCase().endsWith('.docx') ||
          art.kind === 'report' ||
          art.kind === 'approval_note')

      let blob: Blob
      let downloadName = art.filename

      if (isXlsx) {
        if (!downloadName.toLowerCase().endsWith('.xlsx')) {
          downloadName = `${downloadName.replace(/\.[^.]+$/, '')}.xlsx`
        }
        blob = await createXlsxBlob(
          downloadName,
          content,
          art.citations ?? [],
          {
            generatedAt: new Date().toISOString(),
            toolsUsed: ['Sovereign AI Workbench', 'wb_generate_spreadsheet'],
            classification: art.classification,
          },
        )
      } else if (isDocx) {
        if (!downloadName.toLowerCase().endsWith('.docx')) {
          downloadName = `${downloadName.replace(/\.[^.]+$/, '')}.docx`
        }
        blob = await createDocxBlob(
          downloadName,
          content,
          art.citations ?? [],
          {
            generatedAt: new Date().toISOString(),
            toolsUsed: ['Sovereign AI Workbench', art.kind],
            classification: art.classification,
          },
        )
      } else if (downloadName.endsWith('.json')) {
        blob = new Blob([content], { type: 'application/json;charset=utf-8' })
      } else if (downloadName.endsWith('.csv')) {
        blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
      } else {
        blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
      }

      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = downloadName
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setDownloadingId(null)
    }
  }

  return (
    <div className={styles.container}>
      <h3 className={styles.title}>Generated Artifacts</h3>
      <div className={styles.grid}>
        {artifacts.map((art) => (
          <div key={art.id} className={styles.card}>
            <div className={styles.header}>
              <span className={styles.typeBadge}>{art.kind.replace('_', ' ')}</span>
              {art.isLocal && <span className={styles.localBadge}>Local</span>}
            </div>
            <div className={styles.filename}>{art.filename}</div>
            <div className={styles.meta}>
              <span className={styles.sources}>{art.sourceCount} sources</span>
            </div>
            <div className={styles.actions}>
              <button
                type="button"
                className={styles.actionBtn}
                onClick={() => setPreviewItem(art)}
              >
                Preview
              </button>
              <button
                type="button"
                className={styles.actionBtn}
                onClick={() => void handleDownload(art)}
                disabled={downloadingId === art.id}
              >
                {downloadingId === art.id ? 'Exporting...' : 'Download'}
              </button>
            </div>
          </div>
        ))}
      </div>

      {previewItem ? (
        <div className={styles.modalOverlay} onClick={() => setPreviewItem(null)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <div className={styles.modalHeader}>
              <h4 className={styles.modalTitle}>{previewItem.filename}</h4>
              <button
                type="button"
                className={styles.closeBtn}
                onClick={() => setPreviewItem(null)}
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <div className={styles.modalBody}>
              <div className={styles.modalRow}>
                <span>Kind:</span>
                <strong>{previewItem.kind.replace('_', ' ')}</strong>
              </div>
              <div className={styles.modalRow}>
                <span>Format:</span>
                <strong>
                  {previewItem.filename.toLowerCase().endsWith('.docx')
                    ? 'Microsoft Word Document (.docx)'
                    : previewItem.filename.toLowerCase().endsWith('.xlsx') ||
                      previewItem.kind === 'spreadsheet'
                    ? 'Microsoft Excel Spreadsheet (.xlsx)'
                    : 'Document'}
                </strong>
              </div>
              <div className={styles.modalRow}>
                <span>Environment:</span>
                <strong style={{ color: '#10b981' }}>
                  {previewItem.isLocal ? 'On-Premise / Sovereign' : 'External'}
                </strong>
              </div>
              <div className={styles.modalRow}>
                <span>Grounded Sources:</span>
                <strong>{previewItem.sourceCount}</strong>
              </div>
              <div style={{ marginTop: '12px', borderTop: '1px solid var(--sovra-border, #e2e8f0)', paddingTop: '10px' }}>
                <span style={{ fontSize: '12px', color: '#64748b', display: 'block', marginBottom: '6px' }}>
                  Document Content Preview:
                </span>
                <pre
                  style={{
                    background: '#f8fafc',
                    color: '#0f172a',
                    padding: '10px',
                    borderRadius: '6px',
                    fontSize: '12px',
                    whiteSpace: 'pre-wrap',
                    maxHeight: '180px',
                    overflowY: 'auto',
                  }}
                >
                  {getArtifactContent(previewItem)}
                </pre>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
