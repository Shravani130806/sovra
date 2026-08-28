import styles from './SecurityIndicator.module.css'
import { useSovereignPolicy } from '../mock/index.ts'
import type { WbDecisionKind } from '@mrpl/dsh-workbench-types'

/** How one decision kind presents in the badge. */
interface BadgeView {
  /** CSS-module class selecting the badge colour. */
  tone: 'sovereign' | 'blocked' | 'approval' | 'partial' | 'external'
  label: string
}

/**
 * Map a policy decision to its badge.
 *
 * Exhaustive over `WbDecisionKind` on purpose: an unhandled kind previously
 * fell through to "External Access Allowed", so a redaction or a
 * metadata-only allow — both real restrictions — displayed as unrestricted
 * external access. Adding a decision kind to the frozen union now fails the
 * build here instead of silently mislabelling itself.
 * @param decision - the last decision for the active session.
 * @returns the tone and label to render.
 */
export function badgeFor(decision: WbDecisionKind): BadgeView {
  switch (decision) {
    case 'ALLOW':
      return { tone: 'external', label: 'External Access Allowed' }
    case 'DENY':
      return { tone: 'blocked', label: 'External request blocked' }
    case 'REQUIRE_APPROVAL':
      return { tone: 'approval', label: 'Approval required' }
    case 'ALLOW_WITH_REDACTION':
      return { tone: 'partial', label: 'Allowed with redaction' }
    case 'ALLOW_METADATA_ONLY':
      return { tone: 'partial', label: 'Metadata only' }
    default: {
      const never: never = decision
      throw new Error(`unhandled policy decision: ${String(never)}`)
    }
  }
}

export function SecurityIndicator() {
  const { decision, isLocal, isProcessing, reason } = useSovereignPolicy()

  if (isProcessing) {
    return (
      <div className={`${styles.indicator} ${styles.sovereign}`} title={reason}>
        <div className={styles.dot}></div>
        <span className={styles.label}>Processing locally</span>
      </div>
    )
  }

  // A denial outranks the sovereign badge: the session stayed on-premise
  // *because* policy stopped something, and that is the state worth showing.
  if (isLocal && decision !== 'DENY') {
    return (
      <div className={`${styles.indicator} ${styles.sovereign}`} title={reason}>
        <div className={styles.dot}></div>
        <span className={styles.label}>Local / Sovereign</span>
      </div>
    )
  }

  const { tone, label } = badgeFor(decision)
  return (
    <div className={`${styles.indicator} ${styles[tone]}`} title={reason}>
      <div className={styles.dot}></div>
      <span className={styles.label}>{label}</span>
    </div>
  )
}
