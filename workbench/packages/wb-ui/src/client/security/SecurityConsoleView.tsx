import styles from './SecurityConsoleView.module.css'
import { useModels, useSovereignActivity } from '../live/hooks.ts'
import { useSovereignPolicy } from '../policy/use-sovereign-policy.ts'

export function SecurityConsoleView() {
  const { decision, isLocal, reason } = useSovereignPolicy()
  const { strictLocalOnly } = useModels()
  const { activityLog } = useSovereignActivity()

  const policyDecisions = activityLog.filter(
    (a) => a.kind === 'policy_decision' || a.kind === 'policy_override',
  )

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1>Security Console</h1>
        <p>Real-time monitoring of sovereign AI boundaries</p>
      </div>

      <div className={styles.grid}>
        <div className={styles.card}>
          <h3>Network Status</h3>
          <div className={`${styles.metric} ${isLocal ? styles.metricSuccess : styles.metric}`}>
            {strictLocalOnly ? 'AIR-GAPPED' : isLocal ? 'ISOLATED' : 'EXTERNAL ACTIVE'}
          </div>
          <div className={styles.metricDesc}>
            {strictLocalOnly
              ? 'Strict on-premise execution enforced. External network egress prohibited.'
              : isLocal
                ? 'No outbound connections detected. All operations running locally.'
                : 'Session communicated with external endpoint.'}
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
            Last Verdict: <strong>{decision}</strong> ({reason})
          </div>
        </div>
      </div>

      <div className={styles.card}>
        <h3>Recent Policy Decisions</h3>
        <div className={styles.policyList}>
          {policyDecisions.length === 0 ? (
            <div style={{ padding: '1rem', color: 'var(--wb-text-secondary, #a1a1aa)', fontSize: '0.9rem' }}>
              No policy intercepts recorded yet in this session.
            </div>
          ) : (
            policyDecisions.map((act) => {
              const isBlocked = act.blocked || act.summary.toLowerCase().includes('deny') || act.summary.toLowerCase().includes('blocked')
              return (
                <div key={act.id} className={styles.policyItem}>
                  <div className={styles.policyHeader}>
                    <span className={`${styles.badge} ${isBlocked ? styles.badgeDeny : styles.badgeAllow}`}>
                      {isBlocked ? 'DENY' : 'ALLOW'}
                    </span>
                    <span className={styles.policyTitle}>{act.summary}</span>
                  </div>
                  <div className={styles.metricDesc}>
                    Timestamp: {new Date(act.at).toLocaleTimeString()} • Event: {act.kind}
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>

      <div className={styles.visualization}>
        <div className={styles.visIcon}>🛡️</div>
        <div className={styles.visTitle}>Your data remains inside the organization's security boundary.</div>
        <div className={styles.visDesc}>SOVRA Sovereign AI is running entirely on local infrastructure.</div>
      </div>
    </div>
  )
}
