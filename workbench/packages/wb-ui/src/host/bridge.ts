/**
 * Host-side bridge feeding the client's live panels.
 *
 * `wb-ui`'s panels render from `client/live/workbench-store.ts`, which cannot
 * reach `ctx` — it runs in the browser. This module runs host-side and is the
 * single place the real services are read: `wb-audit` for activity and
 * artifacts, `wb/rag/retrieved` for sources, `wb/policy/decision` for the
 * composer's posture and the security badge.
 *
 * It reads only. `wb-ui` is a leaf (§6.10) and must not become a second path
 * that could act on the workbench's behalf.
 * @module @mrpl/dsh-workbench-ui/host/bridge
 */

import type { Context } from '@deepseek-ai/cordis'
import type {
  WbAuditEntry,
  WbCitation,
  WbDecisionKind,
  WbPolicyDecisionEvent,
  WbRagRetrievedEvent,
} from '@mrpl/dsh-workbench-types'

declare module '@deepseek-ai/cordis' {
  interface Events {
    /** A policy decision was made. */
    'wb/policy/decision'(event: WbPolicyDecisionEvent): void
    /** RAG retrieval completed. */
    'wb/rag/retrieved'(event: WbRagRetrievedEvent): void
  }
}

/** The client-side sinks this bridge writes into. */
export interface WorkbenchSinks {
  publishAuditEntry(entry: WbAuditEntry): void
  publishRetrievalCitations(citations: readonly WbCitation[]): void
  publishChatDecision(decision: WbDecisionKind, reason: string): void
  publishPolicyDecision(event: WbPolicyDecisionEvent): void
}

/** How many past entries the activity panel is seeded with on connect. */
const BACKFILL = 50

/**
 * Connect the live services to the client's panels.
 *
 * Backfills from a bounded `query` so a viewer opening the UI mid-session sees
 * what already happened, then follows `subscribe`. The audit seam offers both
 * as of §7.3, which is what let this replace the previous fixture hooks.
 * @param ctx - the host context.
 * @param sinks - the client-side publish functions.
 * @returns a disposer that detaches every subscription.
 */
export function connectWorkbenchBridge(ctx: Context, sinks: WorkbenchSinks): () => void {
  const disposers: Array<() => void> = []

  const audit = ctx.get('wbAudit')
  if (audit) {
    // Oldest first, so replaying them leaves the panel in newest-first order.
    for (const entry of audit.query({ limit: BACKFILL }).slice().reverse()) {
      sinks.publishAuditEntry(entry)
    }
    disposers.push(audit.subscribe((entry: WbAuditEntry) => sinks.publishAuditEntry(entry)))
  }

  disposers.push(
    ctx.on('wb/rag/retrieved', (event) => {
      sinks.publishRetrievalCitations(event.result.citations)
    }),
  )

  disposers.push(
    ctx.on('wb/policy/decision', (event) => {
      sinks.publishPolicyDecision(event)
      sinks.publishChatDecision(event.decision, event.reason)
    }),
  )

  return () => {
    for (const dispose of disposers) dispose()
  }
}
