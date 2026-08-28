import { useMockCitations } from '../mock/index.ts'
import styles from './SourcesView.module.css'

export function SourcesView() {
  const citations = useMockCitations()

  if (citations.length === 0) return null

  return (
    <div className={styles.container}>
      <h3 className={styles.title}>Sources</h3>
      <div className={styles.list}>
        {citations.map((cite, i) => (
          <div key={i} className={styles.item}>
            <div className={styles.index}>{i + 1}</div>
            <div className={styles.details}>
              <div className={styles.docTitle}>{cite.title}</div>
              <div className={styles.locator}>
                {cite.page ? `Page ${cite.page}` : cite.section ? `Section ${cite.section}` : 'Full document'}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
