import styles from './EngineeringVisionView.module.css'

export function EngineeringVisionView() {
  return (
    <div className={styles.container}>
      <div className={styles.viewerPane}>
        <div className={styles.viewerHeader}>
          <h1 className={styles.title}>Plant_Unit_3_PID.dwg</h1>
        </div>
        
        <div className={styles.drawingArea}>
          <div className={styles.mockDrawing}>
            {/* SVG mockup of a P&ID drawing */}
            <svg width="100%" height="100%" viewBox="0 0 800 600" xmlns="http://www.w3.org/2000/svg">
              <rect width="800" height="600" fill="#ffffff" />
              
              {/* Grid lines */}
              <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
                <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#f0f0f0" strokeWidth="1"/>
              </pattern>
              <rect width="800" height="600" fill="url(#grid)" />
              
              {/* Pipe */}
              <line x1="200" y1="300" x2="600" y2="300" stroke="#000" strokeWidth="3" />
              
              {/* Pump P-101 */}
              <circle cx="200" cy="300" r="40" fill="none" stroke="#000" strokeWidth="3" />
              <text x="180" y="305" fontFamily="sans-serif" fontSize="14">P-101</text>
              
              {/* Valve V-204 */}
              <polygon points="380,280 380,320 420,280 420,320" fill="none" stroke="#000" strokeWidth="3" />
              <text x="385" y="270" fontFamily="sans-serif" fontSize="14">V-204</text>
              
              {/* Tank T-301 */}
              <rect x="550" y="200" width="100" height="200" rx="20" fill="none" stroke="#000" strokeWidth="3" />
              <text x="575" y="305" fontFamily="sans-serif" fontSize="14">T-301</text>
            </svg>

            {/* Bounding boxes overlay */}
            <div className={styles.boundingBox} style={{ top: '40%', left: '20%', width: '100px', height: '100px' }}>
              <div className={styles.boxLabel}>P-101</div>
            </div>
            <div className={styles.boundingBox} style={{ top: '43%', left: '46%', width: '60px', height: '60px', borderColor: 'var(--wb-color-blocked)' }}>
              <div className={styles.boxLabel} style={{ backgroundColor: 'var(--wb-color-blocked)' }}>V-204</div>
            </div>
            <div className={styles.boundingBox} style={{ top: '30%', left: '68%', width: '120px', height: '240px' }}>
              <div className={styles.boxLabel}>T-301</div>
            </div>
          </div>
        </div>
      </div>

      <div className={styles.findingsPane}>
        <div className={styles.findingsHeader}>
          <h3>AI Inspection Findings</h3>
          <p>Identified 3 equipment items</p>
        </div>

        <div className={styles.findingsList}>
          <div className={styles.findingCard}>
            <div className={styles.findingHeader}>
              <h4>P-101 (Pump)</h4>
              <span className={styles.confidenceBadge}>High 98%</span>
            </div>
            <div className={styles.findingBody}>
              <p>Main centrifugal pump. Found connected to main supply line leading to V-204.</p>
            </div>
          </div>

          <div className={styles.findingCard} style={{ borderColor: 'var(--wb-color-blocked)' }}>
            <div className={styles.findingHeader}>
              <h4>V-204 (Valve)</h4>
              <span className={`${styles.confidenceBadge} ${styles.confidenceMedium}`}>Med 74%</span>
            </div>
            <div className={styles.findingBody}>
              <p>Primary shutoff valve. Detected state appears anomalous (possibly partially open).</p>
            </div>
          </div>

          <div className={styles.findingCard}>
            <div className={styles.findingHeader}>
              <h4>T-301 (Tank)</h4>
              <span className={styles.confidenceBadge}>High 95%</span>
            </div>
            <div className={styles.findingBody}>
              <p>Secondary containment vessel. Verified standard capacity markers.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
