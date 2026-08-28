// Standalone mock of @mrpl/dsh-workbench-types for the dev server.
// This avoids needing the workspace dependency to resolve.

export type Branded<T, B extends string> = T & { readonly __brand: B }

export type WbUserId = Branded<string, 'WbUserId'>
export type WbDocumentId = Branded<string, 'WbDocumentId'>
export type WbSessionId = Branded<string, 'WbSessionId'>
export type WbAuditEntryId = Branded<string, 'WbAuditEntryId'>

export const asWbUserId = (v: string): WbUserId => v as WbUserId
export const asWbDocumentId = (v: string): WbDocumentId => v as WbDocumentId
export const asWbSessionId = (v: string): WbSessionId => v as WbSessionId
export const asWbAuditEntryId = (v: string): WbAuditEntryId => v as WbAuditEntryId

export type WbClassification = 'PUBLIC' | 'INTERNAL' | 'CONFIDENTIAL' | 'RESTRICTED'

export type WbDecisionKind =
  | 'ALLOW'
  | 'DENY'
  | 'REQUIRE_APPROVAL'
  | 'ALLOW_WITH_REDACTION'
  | 'ALLOW_METADATA_ONLY'

export interface WbPolicyDecision {
  decision: WbDecisionKind
  reason: string
  redactions?: string[]
}

export interface WbCitation {
  documentId: WbDocumentId
  title: string
  page?: number
  section?: string
}

export interface WbAuditEntry {
  id: WbAuditEntryId
  at: string
  sessionId: WbSessionId
  userId: WbUserId
  kind: 'policy_decision' | 'tool_result' | 'session_event' | 'rag_retrieval' | 'ingestion_completed'
  summary: string
  payload: Record<string, unknown>
}
