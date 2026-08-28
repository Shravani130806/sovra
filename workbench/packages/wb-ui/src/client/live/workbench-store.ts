/**
 * Live workbench state behind the non-chat panels.
 *
 * `wb-ui` is a client plugin: it cannot hold `ctx.wbAudit` or `ctx.wbRag`
 * directly, because those live host-side. So each panel reads a store here,
 * and the host bridge (`../../host/bridge.ts`) publishes into it from the real
 * services — the same shape as `policy-store.ts`, which is already the
 * security indicator's seam.
 *
 * What changed: these panels previously read `useMock*` hooks returning
 * hardcoded pump-inspection fixtures, so the sources, artifacts and activity
 * a viewer saw were invented and identical in every session.
 * @module @mrpl/dsh-workbench-ui/client/live/workbench-store
 */

import type { WbAuditEntry, WbCitation, WbDecisionKind } from '@mrpl/dsh-workbench-types'

/** One row of the activity timeline. */
export interface ActivityEntry {
  at: string
  summary: string
  kind: WbAuditEntry['kind']
}

/** One artifact the session has produced. */
export interface ArtifactEntry {
  id: string
  filename: string
  kind: 'report' | 'approval_note' | 'spreadsheet' | 'presentation'
  /** Whether it was produced entirely on-premise. */
  isLocal: boolean
  sourceCount: number
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
  const activity: ActivityEntry[] = [
    { at: entry.at, summary: entry.summary, kind: entry.kind },
    ...state.activity,
  ].slice(0, ACTIVITY_WINDOW)

  let artifacts = state.artifacts
  if (entry.kind === 'tool_result') {
    const payload = entry.payload as { name?: unknown; value?: unknown }
    const kind = typeof payload.name === 'string' ? ARTIFACT_KINDS[payload.name] : undefined
    if (kind) {
      const value = (payload.value ?? {}) as { path?: unknown; citations?: unknown }
      const path = typeof value.path === 'string' ? value.path : 'artifact'
      artifacts = [
        {
          id: entry.id,
          filename: path.split('/').pop() ?? path,
          kind,
          // Artifacts are generated on-premise; the flag exists so a future
          // remote generator cannot appear indistinguishable from a local one.
          isLocal: true,
          sourceCount: Array.isArray(value.citations) ? value.citations.length : 0,
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
export function publishChatDecision(decision: WbDecisionKind, reason: string): void {
  commit({
    ...state,
    chat: {
      isPolicyBlocked: decision === 'DENY',
      isApprovalRequired: decision === 'REQUIRE_APPROVAL',
      blockReason: decision === 'ALLOW' ? '' : reason,
    },
  })
}

/**
 * Reset every panel.
 *
 * For session switches and tests: one session's sources, artifacts and
 * activity must never appear under another.
 */
export function resetWorkbenchState(): void {
  commit(INITIAL_STATE)
}
