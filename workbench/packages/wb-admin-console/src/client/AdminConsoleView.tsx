import { useMemo, useState } from 'react'
import type {
  WbAuditEntry,
  WbCapability,
  WbClassification,
  WbDecisionKind,
  WbPolicyService,
} from '@mrpl/dsh-workbench-types'
import styles from './AdminConsoleView.module.css'
import { countDashboard, securityFeed, UNATTRIBUTED } from './dashboard-model.ts'
import { clearCapability, commitOverride, effectiveDecisions } from './override-editor.ts'

const CAPABILITIES: WbCapability[] = [
  'local_model_inference',
  'internal_rag',
  'local_code_sandbox',
  'internal_db_api',
  'web_search',
  'external_api',
  'external_upload',
]

const DECISIONS: WbDecisionKind[] = [
  'ALLOW',
  'DENY',
  'REQUIRE_APPROVAL',
  'ALLOW_WITH_REDACTION',
  'ALLOW_METADATA_ONLY',
]

const CLASSIFICATIONS: WbClassification[] = ['PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'RESTRICTED']

/** Clock time only; the feed is a live panel, not an archive. */
function timeOf(iso: string): string {
  const at = new Date(iso)
  return Number.isNaN(at.getTime()) ? '--:--:--' : at.toLocaleTimeString()
}

export interface AdminConsoleViewProps {
  /** Audit entries to summarize; supplied by the container that reads wb-audit. */
  entries: readonly WbAuditEntry[]
  /** The live policy service — the only write path into policy state. */
  policy: WbPolicyService
  /** How many entries the container holds, so counters can say what they cover. */
  window?: number
}

export function AdminConsoleView({ entries, policy, window }: AdminConsoleViewProps) {
  const [role, setRole] = useState('')
  const [capability, setCapability] = useState<WbCapability>('web_search')
  const [decision, setDecision] = useState<WbDecisionKind>('DENY')
  const [classification, setClassification] = useState<WbClassification>('CONFIDENTIAL')
  const [error, setError] = useState<string | null>(null)
  // Bumped after each successful write so the effective-decision table re-reads
  // wb-policy rather than rendering a stale copy of what we just sent.
  const [revision, setRevision] = useState(0)

  const counters = useMemo(() => countDashboard(entries), [entries])
  const feed = useMemo(() => securityFeed(entries, 50), [entries])
  const rows = useMemo(
    () => (role.trim() ? effectiveDecisions(policy, role.trim(), classification) : []),
    // `revision` is the dependency that makes a committed write visible here.
    [policy, role, classification, revision],
  )

  function apply() {
    const result = commitOverride(policy, { role, capability, decision })
    setError(result.ok ? null : result.error)
    if (result.ok) setRevision((n) => n + 1)
  }

  function remove(target: WbCapability) {
    const result = clearCapability(policy, role.trim(), target)
    setError(result.ok ? null : result.error)
    if (result.ok) setRevision((n) => n + 1)
  }

  return (
    <div className={styles.console}>
      <section>
        <h2 className={styles.heading}>
          Overview
          {window !== undefined && entries.length >= window ? (
            // Say so rather than presenting a windowed count as a total.
            <span className={styles.qualifier}> · last {window} events</span>
          ) : null}
        </h2>
        <div className={styles.counters}>
          <div className={styles.counter}>
            <span className={styles.counterValue}>{counters.users}</span>
            <span className={styles.counterLabel}>Users</span>
          </div>
          <div className={styles.counter}>
            <span className={styles.counterValue}>{counters.activeAgents}</span>
            <span className={styles.counterLabel}>Active agents</span>
          </div>
          <div className={styles.counter}>
            <span className={styles.counterValue}>{counters.documents}</span>
            <span className={styles.counterLabel}>Documents</span>
          </div>
          <div className={styles.counter}>
            <span className={styles.counterValue}>{counters.policyDecisions}</span>
            <span className={styles.counterLabel}>Policy decisions</span>
          </div>
          <div className={`${styles.counter} ${counters.blockedRequests > 0 ? styles.counterAlert : ''}`}>
            <span className={styles.counterValue}>{counters.blockedRequests}</span>
            <span className={styles.counterLabel}>Blocked requests</span>
          </div>
        </div>
      </section>

      <section>
        <h2 className={styles.heading}>Security events</h2>
        <div className={styles.feed}>
          {feed.length === 0 ? (
            <div className={styles.empty}>No policy activity recorded yet.</div>
          ) : (
            feed.map((event) => (
              <div
                key={event.id}
                className={`${styles.feedRow} ${event.blocked ? styles.feedBlocked : ''}`}
              >
                <span className={styles.feedTime}>{timeOf(event.at)}</span>
                <span className={styles.feedSummary}>
                  {event.decision ? (
                    <span className={`${styles.badge} ${event.blocked ? styles.badgeDeny : ''}`}>
                      {event.decision}
                    </span>
                  ) : (
                    <span className={styles.badge}>OVERRIDE</span>
                  )}
                  {event.summary}
                </span>
                <span className={styles.feedUser}>
                  {event.userId === UNATTRIBUTED ? '—' : event.userId}
                </span>
              </div>
            ))
          )}
        </div>
      </section>

      <section>
        <h2 className={styles.heading}>Policy overrides</h2>
        <div className={styles.editor}>
          <input
            aria-label="Role"
            placeholder="Role, e.g. process-engineer"
            value={role}
            onChange={(e) => setRole(e.target.value)}
          />
          <select
            aria-label="Capability"
            value={capability}
            onChange={(e) => setCapability(e.target.value as WbCapability)}
          >
            {CAPABILITIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <select
            aria-label="Decision"
            value={decision}
            onChange={(e) => setDecision(e.target.value as WbDecisionKind)}
          >
            {DECISIONS.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
          <button type="button" onClick={apply}>Apply override</button>
          <select
            aria-label="Classification"
            value={classification}
            onChange={(e) => setClassification(e.target.value as WbClassification)}
          >
            {CLASSIFICATIONS.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>

        {error ? <p className={styles.error} role="alert">{error}</p> : null}

        {role.trim() ? (
          <table className={styles.overrideTable}>
            <thead>
              <tr>
                <th>Capability</th>
                <th>Effective at {classification}</th>
                <th>Source</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.capability}>
                  <td>{row.capability}</td>
                  <td className={row.overridden ? styles.overridden : ''}>{row.decision}</td>
                  <td>{row.overridden ? 'Role override' : 'Matrix'}</td>
                  <td>
                    {row.overridden ? (
                      <button type="button" onClick={() => remove(row.capability)}>Clear</button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className={styles.empty}>Enter a role to see what it resolves to.</div>
        )}
      </section>
    </div>
  )
}
