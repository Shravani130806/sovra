import { useEffect, useState } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { WbAuditEntry } from '@mrpl/dsh-workbench-types'
import { AdminConsoleView } from './AdminConsoleView.tsx'

/** How often the console re-reads the audit log, in milliseconds. */
const REFRESH_MS = 4000

export interface AdminConsoleContainerProps {
  ctx: Context
}

/**
 * Bind the console to the live services.
 *
 * Polls `wb-audit` rather than subscribing: `WbAuditService` (§7.3) exposes
 * `record` and `query` only, with no change notification, and inventing a
 * second event stream here would be exactly the parallel path §6.11 forbids.
 * A push subscription belongs on the audit seam if it is wanted.
 */
export function AdminConsoleContainer({ ctx }: AdminConsoleContainerProps) {
  const [entries, setEntries] = useState<readonly WbAuditEntry[]>([])

  useEffect(() => {
    let cancelled = false
    const read = () => {
      if (cancelled) return
      // A missing audit service is an empty console, not a crashed panel: the
      // console is read-only over audit and must degrade rather than take the
      // surrounding UI down with it.
      const audit = ctx.get('wbAudit')
      setEntries(audit ? audit.query({}) : [])
    }
    read()
    const timer = setInterval(read, REFRESH_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [ctx])

  const policy = ctx.get('wbPolicy')
  if (!policy) return null
  return AdminConsoleView({ entries, policy })
}
