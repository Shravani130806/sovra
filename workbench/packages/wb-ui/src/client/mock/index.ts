import {
  WbDecisionKind,
  WbAuditEntry,
  WbCitation,
} from '@mrpl/dsh-workbench-types'

// Mock state hooks to cleanly separate UI components from hardcoded strings.
// These hooks will later be replaced by the real dsh-sdk / workbench event-stream integrations.

export function useSovereignPolicy() {
  const decision: WbDecisionKind = 'ALLOW'
  
  return {
    decision,
    isLocal: true,
    isProcessing: false,
    reason: 'Local computation only',
  }
}

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
