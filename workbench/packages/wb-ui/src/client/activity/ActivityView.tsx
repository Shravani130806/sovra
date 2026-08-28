import { useState } from 'react'
import styles from './ActivityView.module.css'
import { useSovereignActivity } from '../live/hooks.ts'
import type { ActivityEntry } from '../live/workbench-store.ts'

/** Filters offered above the timeline. */
const KINDS: Array<{ value: 'all' | ActivityEntry['kind']; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'policy_decision', label: 'Policy' },
  { value: 'tool_result', label: 'Tools' },
  { value: 'rag_retrieval', label: 'Retrieval' },
  { value: 'ingestion_completed', label: 'Ingestion' },
  { value: 'policy_override', label: 'Overrides' },
]

/** Glyph per event kind, so the timeline is scannable without reading it. */
const ICONS: Readonly<Record<string, string>> = {
  policy_decision: '⚖',
  policy_override: '✎',
  tool_result: '⚙',
  rag_retrieval: '❍',
  ingestion_completed: '⤓',
  session_event: '·',
}

export function ActivityView() {
  const { activityLog } = useSovereignActivity()
  const [kind, setKind] = useState<'all' | ActivityEntry['kind']>('all')

  const rows = kind === 'all' ? activityLog : activityLog.filter((row) => row.kind === kind)

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1>Activity Log</h1>
        <p>Audit trail of Sovereign AI operations</p>
      </div>

      <div className={styles.filters}>
        {KINDS.map((option) => (
          <button
            key={option.value}
            type="button"
            className={`${styles.filter} ${kind === option.value ? styles.filterActive : ''}`}
            onClick={() => setKind(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className={styles.tableContainer}>
        {rows.length === 0 ? (
          // Say the log is empty rather than rendering an empty table, and
          // never invent a row: an earlier version appended a fixed "BLOCKED"
          // entry on every render, showing a refusal that never happened.
          <p className={styles.empty}>No activity recorded yet.</p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr><th /><th>Timestamp</th><th>Event</th><th>Status</th></tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className={row.blocked ? styles.rowBlocked : ''}>
                  <td className={styles.icon} aria-hidden="true">{ICONS[row.kind] ?? '·'}</td>
                  <td>{new Date(row.at).toLocaleString()}</td>
                  <td>{row.summary}</td>
                  <td>
                    <span className={`${styles.status} ${row.blocked ? styles.statusError : styles.statusSuccess}`}>
                      {row.blocked ? 'BLOCKED' : 'OK'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
