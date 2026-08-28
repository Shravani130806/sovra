/**
 * Pure projections from the audit log to what the console displays.
 *
 * Kept separate from the React tree because this is where a defect would
 * misstate the security posture — an undercounted "Blocked Requests" reads as
 * a quiet system rather than a broken one. Everything here is a pure function
 * of the entries handed in, so it is testable without a DOM.
 * @module @mrpl/dsh-workbench-admin-console/client/dashboard-model
 */

import type { WbAuditEntry, WbDecisionKind } from '@mrpl/dsh-workbench-types'

/**
 * Placeholder id `wb-audit` records for events §7.4 does not attribute to a
 * session or user. Counting it as a real user or agent would inflate both.
 */
export const UNATTRIBUTED = 'unattributed'

/** The five headline counters from `Plugin_design_idea` §14. */
export interface DashboardCounters {
  users: number
  activeAgents: number
  documents: number
  policyDecisions: number
  blockedRequests: number
}

/** One row of the live security feed. */
export interface SecurityEvent {
  id: string
  at: string
  summary: string
  /** Absent for entries that are not a policy decision. */
  decision?: WbDecisionKind
  /** Whether this row denied something — the feed's primary visual split. */
  blocked: boolean
  userId: string
}

/** Read the decision off a `policy_decision` entry's payload. */
function decisionOf(entry: WbAuditEntry): WbDecisionKind | undefined {
  if (entry.kind !== 'policy_decision') return undefined
  const value = (entry.payload as { decision?: unknown }).decision
  return typeof value === 'string' ? (value as WbDecisionKind) : undefined
}

/**
 * Count the five dashboard figures.
 *
 * Users and agents are counted from distinct ids rather than entry volume, so
 * one busy session does not read as many agents. `UNATTRIBUTED` is excluded
 * from both: it is the placeholder for events the contract does not attribute,
 * not a person.
 * @param entries - the audit entries to summarize.
 * @returns the five counters.
 */
export function countDashboard(entries: readonly WbAuditEntry[]): DashboardCounters {
  const users = new Set<string>()
  const agents = new Set<string>()
  const documents = new Set<string>()
  let policyDecisions = 0
  let blockedRequests = 0

  for (const entry of entries) {
    if (entry.userId !== UNATTRIBUTED) users.add(entry.userId)
    if (entry.sessionId !== UNATTRIBUTED) agents.add(entry.sessionId)

    if (entry.kind === 'ingestion_completed') {
      const id = (entry.payload as { documentId?: unknown }).documentId
      if (typeof id === 'string') documents.add(id)
    }

    if (entry.kind === 'policy_decision') {
      policyDecisions++
      if (decisionOf(entry) === 'DENY') blockedRequests++
    }
  }

  return {
    users: users.size,
    activeAgents: agents.size,
    documents: documents.size,
    policyDecisions,
    blockedRequests,
  }
}

/**
 * Build the live security feed, newest first.
 *
 * Carries policy decisions and governance changes only — a tool result or a
 * session event is not a security event, and mixing them in would bury the
 * denials this panel exists to surface.
 * @param entries - the audit entries to project.
 * @param limit - maximum rows to return; omit for all of them.
 * @returns feed rows ordered newest first.
 */
export function securityFeed(entries: readonly WbAuditEntry[], limit?: number): SecurityEvent[] {
  const rows = entries
    .filter((e) => e.kind === 'policy_decision' || e.kind === 'policy_override')
    .map((entry): SecurityEvent => {
      const decision = decisionOf(entry)
      return {
        id: entry.id,
        at: entry.at,
        summary: entry.summary,
        ...(decision ? { decision } : {}),
        blocked: decision === 'DENY',
        userId: entry.userId,
      }
    })
    // Newest first. Timestamps are ISO 8601, so lexicographic order is
    // chronological; ties keep insertion order, which is append order in the log.
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))

  return limit === undefined ? rows : rows.slice(0, limit)
}

/**
 * Summarize how a user's requests have been decided.
 *
 * The console's user table answers "who is being blocked, and how often" —
 * a count of denials per principal, not a raw entry dump.
 * @param entries - the audit entries to summarize.
 * @returns one row per user seen, most-blocked first.
 */
export function decisionsByUser(
  entries: readonly WbAuditEntry[],
): Array<{ userId: string; total: number; blocked: number }> {
  const rows = new Map<string, { userId: string; total: number; blocked: number }>()

  for (const entry of entries) {
    if (entry.kind !== 'policy_decision') continue
    if (entry.userId === UNATTRIBUTED) continue
    const row = rows.get(entry.userId) ?? { userId: entry.userId, total: 0, blocked: 0 }
    row.total++
    if (decisionOf(entry) === 'DENY') row.blocked++
    rows.set(entry.userId, row)
  }

  return [...rows.values()].sort((a, b) => b.blocked - a.blocked || b.total - a.total)
}
