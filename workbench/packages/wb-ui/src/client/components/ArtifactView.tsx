import { useSessionArtifacts } from '../live/hooks.ts'
import styles from './ArtifactView.module.css'

export function ArtifactView() {
  const artifacts = useSessionArtifacts()

  if (artifacts.length === 0) return null

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
              <button className={styles.actionBtn}>Preview</button>
              <button className={styles.actionBtn}>Download</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
