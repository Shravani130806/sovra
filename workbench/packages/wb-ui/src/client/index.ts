import type { Context } from '@deepseek-ai/cordis'
import './styles/variables.css'
import { SidebarRoot } from './sidebar/SidebarRoot.tsx'
import { ConversationRoot } from './conversation/ConversationRoot.tsx'
import { DetailsRoot } from './details/DetailsRoot.tsx'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'

export const inject = ['slots']

export function apply(ctx: Context): void {
  // Replace the default sidebar with our Sovereign Sidebar
  ctx.slots.register({
    name: 'sidebar'
  }, SidebarRoot)

  // Replace the default conversation area with our Sovereign Workspace/Chat
  ctx.slots.register({
    name: 'conversation'
  }, ConversationRoot)

  // Replace the details panel with our Sovereign Security/Activity panel
  ctx.slots.register({
    name: 'details'
  }, DetailsRoot)
}
