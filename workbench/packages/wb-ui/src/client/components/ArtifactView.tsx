import { useState } from 'react'
import { useSessionArtifacts } from '../live/hooks.ts'
import type { ArtifactEntry } from '../live/workbench-store.ts'
import styles from './ArtifactView.module.css'

export function ArtifactView() {
  const artifacts = useSessionArtifacts()
  const [previewItem, setPreviewItem] = useState<ArtifactEntry | null>(null)

  if (artifacts.length === 0) return null

  function handleDownload(art: ArtifactEntry) {
    const blob = new Blob([`Sovereign AI Artifact: ${art.filename}\nType: ${art.kind}\nSources: ${art.sourceCount}`], {
      type: 'text/plain;charset=utf-8',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = art.filename
    a.click()
    URL.revokeObjectURL(url)
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
                onClick={() => handleDownload(art)}
              >
                Download
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
                <span>Environment:</span>
                <strong style={{ color: '#10b981' }}>{previewItem.isLocal ? 'On-Premise / Sovereign' : 'External'}</strong>
              </div>
              <div className={styles.modalRow}>
                <span>Grounded Sources:</span>
                <strong>{previewItem.sourceCount}</strong>
              </div>
              <div className={styles.modalRow}>
                <span>Artifact ID:</span>
                <code>{previewItem.id}</code>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
