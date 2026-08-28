/**
 * `wb-admin-console` — the admin and policy console client plugin.
 *
 * A leaf: it provides no `ctx` service and nothing depends on it. It reads
 * `ctx.wbAudit.query()` and writes only through `ctx.wbPolicy.setRoleOverride()`,
 * which is `wb-policy`'s own table — §6.11 forbids a second policy path, so
 * there is no local copy of policy state anywhere in this package.
 * @module @mrpl/dsh-workbench-admin-console/client
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { AdminConsoleContainer } from './AdminConsoleContainer.tsx'

export const inject = ['slots']

export function apply(ctx: Context): void {
  ctx.slots.register({ name: 'details' }, () => AdminConsoleContainer({ ctx }))
}

export { AdminConsoleView } from './AdminConsoleView.tsx'
export * from './dashboard-model.ts'
export * from './override-editor.ts'
