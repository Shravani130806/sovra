// What remains here is genuinely still fixture data: chat message history and
// navigation, which need the harness session stream (dsh-sdk) rather than a
// workbench service. Everything sourced from a workbench service — the
// security badge, activity, sources and artifacts — now reads live state from
// ../live/, fed by ../../host/bridge.ts.

// `useSovereignPolicy` is deliberately NOT mocked here. A hardcoded 'ALLOW'
// narrows `decision` to one literal, which makes the security indicator's DENY
// and REQUIRE_APPROVAL branches unreachable and welds the badge to green —
// the opposite of what DESIGN.md §6.10 asks the badge to prove. It reads live
// state instead; see ../policy/policy-store.ts.
export { useSovereignPolicy } from '../policy/use-sovereign-policy.ts'
export { useSessionArtifacts, useSourceCitations, useSovereignActivity } from '../live/hooks.ts'
export type { PolicyState } from '../policy/policy-store.ts'



export interface MockArtifact {
  id: string
  filename: string
  type: 'report' | 'spreadsheet' | 'presentation' | 'approval_note'
  status: 'generating' | 'completed' | 'failed'
  isLocal: boolean
  sourceCount: number
}


export function useMockChatState() {
  return {
    isResponseLoading: false,
    hasError: false,
    errorMessage: '',
    isPolicyBlocked: false,
    isApprovalRequired: false,
  }
}

export * from './navigation.ts'
