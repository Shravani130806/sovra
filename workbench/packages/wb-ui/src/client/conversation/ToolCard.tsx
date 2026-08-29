/**
 * Compact rendered card for one tool invocation within a turn.
 *
 * Expands to show the invocation's raw argument map and result payload, and
 * renders the policy decision that governed it.
 *
 * What changed: the tool log was previously a separate side drawer; rendering
 * inline keeps each tool call next to the turn that launched it.
 * @module @mrpl/dsh-workbench-ui/client/conversation/ToolCard
 */

import { useState } from 'react'
import type { ToolNode } from '../live/chat-store.ts'
import styles from './ToolCard.module.css'

interface ToolCardProps {
  node: ToolNode
}

/** Summarise args into a single line so the card stays compact. */
function preview(args: Record<string, unknown>): string {
  const parts = Object.entries(args).map(([k, v]) => {
    const rendered = typeof v === 'string' ? v : JSON.stringify(v)
    const truncated = rendered.length > 32 ? `${rendered.slice(0, 32)}…` : rendered
    return `${k}: ${truncated}`
  })
  return parts.join(' ')
}

export function ToolCard({ node }: ToolCardProps) {
  const [open, setOpen] = useState(false)

  return (
    <div
      className={`${styles.card} ${node.status === 'denied' ? styles.cardDenied : ''}`}
      data-status={node.status}
    >
      <button
        type="button"
        className={styles.header}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className={styles.name}>{node.name}</span>
        {node.decision ? (
          <span
            className={`${styles.decision} ${node.decision === 'ALLOW' ? styles.decisionAllow : styles.decisionDeny}`}
          >
            {node.decision}
          </span>
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
        <pre className={styles.result}>
          {typeof node.result === 'string' ? node.result : JSON.stringify(node.result, null, 2)}
        </pre>
      ) : null}
    </div>
  )
}
