import styles from './DocumentViewer.module.css'

export function DocumentViewer() {
  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.titleGroup}>
          <h1 className={styles.title}>Engineering Safety Manual.pdf</h1>
          <span className={styles.badge}>RESTRICTED</span>
        </div>
        <div className={styles.controls}>
          <button className={styles.controlBtn}>-</button>
          <span style={{ fontSize: '0.85rem', padding: '0 0.5rem' }}>100%</span>
          <button className={styles.controlBtn}>+</button>
          <span style={{ margin: '0 0.5rem', color: 'var(--wb-border-strong)' }}>|</span>
          <button className={styles.controlBtn}>Page 42 / 128</button>
        </div>
      </div>

      <div className={styles.contentArea}>
        <div className={styles.viewerPane}>
          <div className={styles.mockPdf}>
            <div className={styles.pdfHeader}>4.2 Emergency Shutdown Procedures</div>
            <div className={styles.pdfText}>
              <p>In the event of a catastrophic pressure failure, operators must immediately initiate the emergency shutdown sequence.</p>
              <br/>
              <p>
                1. Ensure all personnel are cleared from the immediate vicinity.<br/>
                2. <span className={styles.highlight}>Engage the primary shutoff valve (V-204) located on the main supply line.</span><br/>
                3. Depressurize the secondary containment vessel (T-301) to prevent secondary rupture.
              </p>
            </div>
          </div>
        </div>

        <div className={styles.citationPane}>
          <div className={styles.citationHeader}>Evidence & Highlights</div>
          <div className={styles.citationList}>
            <div className={styles.citationCard}>
              <h4>Citation 1</h4>
              <p>Referenced in Chat: "What is the procedure for pressure failure?"</p>
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
