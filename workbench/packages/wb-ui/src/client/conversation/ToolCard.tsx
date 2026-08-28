import { useState } from 'react'
import styles from './ToolCard.module.css'
import type { ToolNode } from '../live/chat-store.ts'

/** Badge tone per policy verdict; a denial must not read like an allow. */
const DECISION_TONE: Readonly<Record<string, string>> = {
  ALLOW: 'allow',
  DENY: 'deny',
  REQUIRE_APPROVAL: 'approval',
  ALLOW_WITH_REDACTION: 'partial',
  ALLOW_METADATA_ONLY: 'partial',
}

/** One-line argument preview; the full value is behind the disclosure. */
function preview(args: Record<string, unknown>): string {
  const parts = Object.entries(args).map(([key, value]) => {
    const text = typeof value === 'string' ? value : JSON.stringify(value)
    // Base64 image payloads and long file bodies would swamp the card.
    return `${key}: ${text.length > 60 ? `${text.slice(0, 60)}…` : text}`
  })
  return parts.join(', ')
}

export interface ToolCardProps {
  node: ToolNode
}

export function ToolCard({ node }: ToolCardProps) {
  const [open, setOpen] = useState(false)
  const tone = node.decision ? DECISION_TONE[node.decision] ?? 'partial' : undefined

  return (
    <div className={`${styles.card} ${node.status === 'denied' ? styles.cardDenied : ''}`}>
      <button
        className={styles.header}
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={styles.chevron} aria-hidden="true">{open ? '▾' : '▸'}</span>
        <span className={styles.name}>{node.name}</span>
        {node.decision ? (
          <span className={`${styles.badge} ${styles[tone!] ?? ''}`}>{node.decision}</span>
        ) : null}
        <span className={styles.status}>{node.status}</span>
      </button>

      <div className={styles.argPreview}>{preview(node.args)}</div>

      {node.decisionReason ? (
        // Surfaced on the card, not only in the audit log: a denial the
        // operator cannot see is not visible governance.
        <div className={styles.reason}>{node.decisionReason}</div>
      ) : null}

      {open && node.result !== undefined ? (
        <pre className={styles.result}>{node.result}</pre>
      ) : null}
    </div>
  )
}
