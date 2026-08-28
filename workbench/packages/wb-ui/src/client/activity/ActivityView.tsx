import styles from './ActivityView.module.css'
import { useSovereignActivity } from '../live/hooks.ts'

export function ActivityView() {
  const { activityLog } = useSovereignActivity()

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1>Activity Log</h1>
        <p>Comprehensive audit trail of Sovereign AI operations</p>
      </div>

      <div className={styles.tableContainer}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Timestamp</th>
              <th>Event</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {activityLog.map((log, i) => (
              <tr key={i}>
                <td>{new Date(log.at).toLocaleString()}</td>
                <td>{log.summary}</td>
                <td>
                  <span className={`${styles.status} ${styles.statusSuccess}`}>
                    SUCCESS
                  </span>
                </td>
              </tr>
            ))}
            <tr>
              <td>{new Date().toLocaleString()}</td>
              <td>External API request blocked by policy engine</td>
              <td>
                <span className={`${styles.status} ${styles.statusError}`}>
                  BLOCKED
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}
