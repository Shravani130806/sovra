/**
 * Live host-bound state for the SOVRA Workbench UI.
 *
 * Keeps activity, citations and artifacts in memory, fed by host events,
 * and notifies React views when anything changes.
 *
 * @module @mrpl/dsh-workbench-ui/client/live/workbench-store
 */

import type { WbAuditEntry, WbCitation } from '@mrpl/dsh-workbench-types'

/** One activity row shown in the activity panel. */
export interface ActivityEntry {
  id: string
  at: string
  summary: string
  kind: WbAuditEntry['kind']
  /** True when policy refused the operation; highlighted in the panel. */
  blocked: boolean
}

/** One artifact the session has produced. */
export interface ArtifactEntry {
  id: string
  filename: string
  kind: 'report' | 'approval_note' | 'spreadsheet' | 'presentation'
  /** Whether it was produced entirely on-premise. */
  isLocal: boolean
  sourceCount: number
  content?: string | undefined
  citations?: readonly WbCitation[] | undefined
  classification?: string | undefined
}

/** What the composer needs to know about the session's policy posture. */
export interface ChatState {
  isPolicyBlocked: boolean
  isApprovalRequired: boolean
  /** The reason behind the most recent non-ALLOW decision, for the banner. */
  blockReason: string
}

interface WorkbenchState {
  activity: ActivityEntry[]
  citations: WbCitation[]
  artifacts: ArtifactEntry[]
  chat: ChatState
}

/** How many activity rows are retained; the panel shows a live tail, not an archive. */
const ACTIVITY_WINDOW = 100

export const INITIAL_STATE: WorkbenchState = {
  activity: [],
  citations: [],
  artifacts: [],
  chat: { isPolicyBlocked: false, isApprovalRequired: false, blockReason: '' },
}

let state: WorkbenchState = INITIAL_STATE
const listeners = new Set<() => void>()

/**
 * Subscribe to workbench-state changes.
 * @param listener - called after each change.
 * @returns the unsubscribe function.
 */
export function subscribeWorkbench(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Read the current state; identity is stable until it actually changes. */
export function getWorkbenchState(): WorkbenchState {
  return state
}

function commit(next: WorkbenchState): void {
  state = next
  for (const listener of listeners) listener()
}

/** Map an artifact tool name onto the kind the panel labels it with. */
const ARTIFACT_KINDS: Readonly<Record<string, ArtifactEntry['kind']>> = {
  wb_generate_report: 'report',
  wb_generate_approval_note: 'approval_note',
  wb_generate_spreadsheet: 'spreadsheet',
  wb_generate_presentation: 'presentation',
  create_document: 'report',
  create_doc: 'report',
  write: 'report',
}

/**
 * Apply one audit entry to the panels it affects.
 *
 * The host bridge calls this for every entry `wb-audit` records, so activity
 * and artifacts derive from the same append-only log the audit console reads
 * — there is no second source that could disagree with it.
 * @param entry - the recorded audit entry.
 */
export function publishAuditEntry(entry: WbAuditEntry): void {
  const payload = (entry.payload ?? {}) as { decision?: unknown; name?: unknown; value?: unknown }
  const decision = payload.decision
  const activity: ActivityEntry[] = [
    {
      id: entry.id,
      at: entry.at,
      summary: entry.summary,
      kind: entry.kind,
      blocked: entry.kind === 'policy_decision' && decision === 'DENY',
    },
    ...state.activity,
  ].slice(0, ACTIVITY_WINDOW)

  let artifacts = state.artifacts
  if (entry.kind === 'tool_result') {
    const kind = typeof payload.name === 'string' ? ARTIFACT_KINDS[payload.name] : undefined
    if (kind) {
      const value = (payload.value ?? {}) as {
        path?: unknown
        citations?: unknown
        content?: unknown
        classification?: unknown
      }
      const path = typeof value.path === 'string' ? value.path : 'artifact.docx'
      const content = typeof value.content === 'string' ? value.content : undefined
      const classification = typeof value.classification === 'string' ? value.classification : undefined
      const citations = Array.isArray(value.citations) ? (value.citations as WbCitation[]) : []

      artifacts = [
        {
          id: entry.id,
          filename: path.split('/').pop() ?? path,
          kind,
          // Artifacts are generated on-premise; the flag exists so a future
          // remote generator cannot appear indistinguishable from a local one.
          isLocal: true,
          sourceCount: citations.length,
          content,
          citations,
          classification,
        },
        ...state.artifacts,
      ]
    }
  }

  commit({ ...state, activity, artifacts })
}

/**
 * Replace the sources panel with the citations of the latest retrieval.
 *
 * Replaces rather than accumulates: the panel answers "what is the current
 * answer grounded in", and carrying a previous query's sources forward would
 * attribute evidence to an answer that never used it.
 * @param citations - citations from the retrieval that just completed.
 */
export function publishRetrievalCitations(citations: readonly WbCitation[]): void {
  commit({ ...state, citations: [...citations] })
}

/**
 * Apply a policy decision to the composer's posture.
 * @param decision - the decision kind.
 * @param reason - the decision's reason, shown in the banner.
 */
export function publishChatDecision(decision: string, reason: string): void {
  const isPolicyBlocked = decision === 'DENY'
  const isApprovalRequired = decision === 'REQUIRE_APPROVAL'
  commit({
    ...state,
    chat: {
      isPolicyBlocked,
      isApprovalRequired,
      blockReason: decision === 'ALLOW' ? '' : reason,
    },
  })
}

/**
 * Reset all panels to empty state (for tests and session teardown).
 */
export function resetWorkbench(): void {
  state = INITIAL_STATE
  for (const listener of listeners) listener()
}

export const resetWorkbenchState = resetWorkbench
