import styles from './SecurityIndicator.module.css'
import { useSovereignPolicy } from '../mock/index.ts'

export function SecurityIndicator() {
  const { decision, isLocal, isProcessing } = useSovereignPolicy()

  if (isProcessing) {
    return (
      <div className={`${styles.indicator} ${styles.sovereign}`}>
        <div className={styles.dot}></div>
        <span className={styles.label}>Processing locally</span>
      </div>
    )
  }

  if (isLocal) {
    return (
      <div className={`${styles.indicator} ${styles.sovereign}`}>
        <div className={styles.dot}></div>
        <span className={styles.label}>Local / Sovereign</span>
      </div>
    )
  }

  if (decision === 'DENY') {
    return (
      <div className={`${styles.indicator} ${styles.blocked}`}>
        <div className={styles.dot}></div>
        <span className={styles.label}>External request blocked</span>
      </div>
    )
  }

  if (decision === 'REQUIRE_APPROVAL') {
    return (
      <div className={`${styles.indicator} ${styles.approval}`}>
        <div className={styles.dot}></div>
        <span className={styles.label}>Approval required</span>
      </div>
    )
  }

  return (
    <div className={`${styles.indicator} ${styles.external}`}>
      <div className={styles.dot}></div>
      <span className={styles.label}>External Access Allowed</span>
    </div>
  )
}
