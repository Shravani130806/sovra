import styles from './DocumentViewer.module.css'
import { useDocuments, useNavigation } from '../live/hooks.ts'
import { navigate } from '../live/navigation-store.ts'

export function DocumentViewer() {
  const { documentId, locator } = useNavigation()
  const { documents } = useDocuments()

  const doc = documentId ? documents.find((d) => d.id === documentId) : undefined
  const title = doc?.title ?? 'Engineering Safety Manual.pdf'
  const classification = doc?.classification ?? 'RESTRICTED'

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.titleGroup}>
          <button
            type="button"
            className={styles.controlBtn}
            onClick={() => navigate('documents')}
            aria-label="Back to documents"
          >
            ← Back
          </button>
          <h1 className={styles.title}>{title}</h1>
          <span className={styles.badge}>{classification}</span>
        </div>
        <div className={styles.controls}>
          <button type="button" className={styles.controlBtn}>-</button>
          <span style={{ fontSize: '0.85rem', padding: '0 0.5rem' }}>100%</span>
          <button type="button" className={styles.controlBtn}>+</button>
          <span style={{ margin: '0 0.5rem', color: 'var(--wb-border-strong)' }}>|</span>
          <button type="button" className={styles.controlBtn}>
            Page {locator?.page ?? 42} / {doc?.chunks ?? 128}
          </button>
        </div>
      </div>

      <div className={styles.contentArea}>
        <div className={styles.viewerPane}>
          <div className={styles.mockPdf}>
            <div className={styles.pdfHeader}>
              {locator?.section ? `Section ${locator.section}` : '4.2 Emergency Shutdown Procedures'}
            </div>
            <div className={styles.pdfText}>
              <p>In the event of a catastrophic pressure failure, operators must immediately initiate the emergency shutdown sequence.</p>
              <br />
              <p>
                1. Ensure all personnel are cleared from the immediate vicinity.<br />
                2.{' '}
                <span className={styles.highlight}>
                  Engage the primary shutoff valve (V-204) located on the main supply line.
                </span>
                <br />
                3. Depressurize the secondary containment vessel (T-301) to prevent secondary rupture.
              </p>
            </div>
          </div>
        </div>

        <div className={styles.citationPane}>
          <div className={styles.citationHeader}>Evidence &amp; Highlights</div>
          <div className={styles.citationList}>
            {locator ? (
              <div className={styles.citationCard}>
                <h4>Referenced Target</h4>
                <p>
                  {locator.page ? `Page ${locator.page}` : ''}
                  {locator.page && locator.section ? ' • ' : ''}
                  {locator.section ? `Section ${locator.section}` : ''}
                </p>
              </div>
            ) : null}
            <div className={styles.citationCard}>
              <h4>Citation 1</h4>
              <p>Referenced in Chat: &quot;What is the procedure for pressure failure?&quot;</p>
            </div>
            <div className={styles.citationCard}>
              <h4>Section 4.2</h4>
              <p>Matches entity: <strong>V-204</strong> (Valve)</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
