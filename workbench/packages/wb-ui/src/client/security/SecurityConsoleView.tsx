import styles from './SecurityConsoleView.module.css'

export function SecurityConsoleView() {
  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1>Security Console</h1>
        <p>Real-time monitoring of sovereign AI boundaries</p>
      </div>

      <div className={styles.grid}>
        <div className={styles.card}>
          <h3>Network Status</h3>
          <div className={`${styles.metric} ${styles.metricSuccess}`}>ISOLATED</div>
          <div className={styles.metricDesc}>
            No outbound connections permitted. Local model inference enforced.
          </div>
        </div>

        <div className={styles.card}>
          <h3>Data Boundary</h3>
          <div className={styles.metric}>ORGANIZATION ONLY</div>
          <div className={styles.metricDesc}>
            Files and prompts remain strictly within the internal perimeter.
          </div>
        </div>

        <div className={styles.card}>
          <h3>Policy Engine</h3>
          <div className={`${styles.metric} ${styles.metricSuccess}`}>ACTIVE</div>
          <div className={styles.metricDesc}>
            Intercepting and evaluating all capability requests.
          </div>
        </div>
      </div>

      <div className={styles.card}>
        <h3>Recent Policy Decisions</h3>
        <div className={styles.policyList}>
          <div className={styles.policyItem}>
            <div className={styles.policyHeader}>
              <span className={`${styles.badge} ${styles.badgeAllow}`}>ALLOW</span>
              <span className={styles.policyTitle}>Local model inference</span>
            </div>
            <div className={styles.metricDesc}>Authorized standard LLM generation using local hardware.</div>
          </div>

          <div className={styles.policyItem}>
            <div className={styles.policyHeader}>
              <span className={`${styles.badge} ${styles.badgeDeny}`}>DENY</span>
              <span className={styles.policyTitle}>External request containing CONFIDENTIAL data</span>
            </div>
            <div className={styles.metricDesc}>Blocked outgoing Web Search tool call due to PII/Confidential patterns in prompt.</div>
          </div>

          <div className={styles.policyItem}>
            <div className={styles.policyHeader}>
              <span className={`${styles.badge} ${styles.badgeApproval}`}>REQUIRE APPROVAL</span>
              <span className={styles.policyTitle}>Internal ERP System Access</span>
            </div>
            <div className={styles.metricDesc}>User clearance is sufficient, but action requires explicit 2FA confirmation.</div>
          </div>
        </div>
      </div>

      <div className={styles.visualization}>
        <div className={styles.visIcon}>🛡️</div>
        <div className={styles.visTitle}>Your data remains inside the organization's security boundary.</div>
        <div className={styles.visDesc}>MRPL Sovereign AI is running entirely on local infrastructure.</div>
      </div>
    </div>
  )
}
