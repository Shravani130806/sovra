import { useEffect, useState } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { WbAuditEntry } from '@mrpl/dsh-workbench-types'
import { AdminConsoleView } from './AdminConsoleView.tsx'

/**
 * How many entries the console holds.
 *
 * The counters summarize this window, not the whole log — a deployed audit
 * trail grows without bound and a console that reads all of it to render five
 * numbers stops working exactly when it matters most. The window is stated in
 * the UI so a viewer is never shown a partial count as if it were total.
 */
const WINDOW = 500

export interface AdminConsoleContainerProps {
  ctx: Context
}

/**
 * Bind the console to the live services.
 *
 * Reads a bounded window once, then follows `wbAudit.subscribe` for new
 * entries. It previously polled `query({})` on a 4s timer, re-reading the
 * entire JSONL log each tick, because the audit seam offered neither a
 * subscription nor a bounded read; §7.3 now provides both.
 */
export function AdminConsoleContainer({ ctx }: AdminConsoleContainerProps) {
  const [entries, setEntries] = useState<readonly WbAuditEntry[]>([])

  useEffect(() => {
    // A missing audit service is an empty console, not a crashed panel: the
    // console is read-only over audit and must degrade rather than take the
    // surrounding UI down with it.
    const audit = ctx.get('wbAudit')
    if (!audit) {
      setEntries([])
      return
    }

    setEntries(audit.query({ limit: WINDOW }))
    return audit.subscribe((entry: WbAuditEntry) => {
      // Newest first, matching query()'s order, and trimmed so a long-running
      // console cannot grow its state without bound.
      setEntries((current) => [entry, ...current].slice(0, WINDOW))
    })
  }, [ctx])

  const policy = ctx.get('wbPolicy')
  if (!policy) return null
  return AdminConsoleView({ entries, policy, window: WINDOW })
}
