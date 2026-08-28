import {
  WbAuditEntry,
  WbCitation,
} from '@mrpl/dsh-workbench-types'

// Mock state hooks to cleanly separate UI components from hardcoded strings.
// These hooks will later be replaced by the real dsh-sdk / workbench event-stream integrations.

// `useSovereignPolicy` is deliberately NOT mocked here. A hardcoded 'ALLOW'
// narrows `decision` to one literal, which makes the security indicator's DENY
// and REQUIRE_APPROVAL branches unreachable and welds the badge to green —
// the opposite of what DESIGN.md §6.10 asks the badge to prove. It reads live
// state instead; see ../policy/policy-store.ts.
export { useSovereignPolicy } from '../policy/use-sovereign-policy.ts'
export type { PolicyState } from '../policy/policy-store.ts'

export function useSovereignActivity() {
  const activityLog: Pick<WbAuditEntry, 'at' | 'summary'>[] = [
    { at: new Date().toISOString(), summary: 'Policy: Active (Local & Sovereign)' },
    { at: new Date().toISOString(), summary: 'Network: Isolated' },
    { at: new Date().toISOString(), summary: 'Reading document...' },
  ]
  
  return {
    activityLog,
    isLoading: false,
  }
}

export function useMockCitations(): WbCitation[] {
  return [
    { documentId: 'doc_1' as any, title: 'Pump Inspection Report', page: 12 },
    { documentId: 'doc_2' as any, title: 'Maintenance SOP', section: '4.2' },
    { documentId: 'doc_3' as any, title: 'Equipment Reliability Manual', page: 87 }
  ]
}

export interface MockArtifact {
  id: string
  filename: string
  type: 'report' | 'spreadsheet' | 'presentation' | 'approval_note'
  status: 'generating' | 'completed' | 'failed'
  isLocal: boolean
  sourceCount: number
}

export function useMockArtifacts(): MockArtifact[] {
  return [
    {
      id: 'art_1',
      filename: 'Inspection_Summary.docx',
      type: 'report',
      status: 'completed',
      isLocal: true,
      sourceCount: 3
    }
  ]
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
