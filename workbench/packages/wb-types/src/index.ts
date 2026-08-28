/**
 * Frozen shared contract for the Sovereign AI Workbench.
 *
 * This file is authoritative. It is copied verbatim from
 * `workbench/DESIGN.md` §7. Do not edit it as part of building any other
 * workbench plugin — if the contract needs to change, propose the change in
 * `DESIGN.md` §12 first. See `workbench/AGENTS.md` §6.
 *
 * No Cordis plugin export lives here (no `name`/`inject`/`apply`). Every
 * other `wb-*` package depends on this one as a real runtime `dependency`
 * (not `devDependency`), because the branded-id constructors below are
 * called at runtime, not just used as types.
 */

// ---------------------------------------------------------------------------
// 7.1 Branded ids
// ---------------------------------------------------------------------------

export type Branded<T, B extends string> = T & { readonly __brand: B }

export type WbUserId = Branded<string, 'WbUserId'>
export type WbDocumentId = Branded<string, 'WbDocumentId'>
export type WbSessionId = Branded<string, 'WbSessionId'>
export type WbAuditEntryId = Branded<string, 'WbAuditEntryId'>

export const asWbUserId = (v: string): WbUserId => v as WbUserId
export const asWbDocumentId = (v: string): WbDocumentId => v as WbDocumentId
export const asWbSessionId = (v: string): WbSessionId => v as WbSessionId
export const asWbAuditEntryId = (v: string): WbAuditEntryId => v as WbAuditEntryId

// ---------------------------------------------------------------------------
// 7.2 Shared enums and value types
// ---------------------------------------------------------------------------

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
  /** Present only for ALLOW_WITH_REDACTION. */
  redactions?: string[]
}

export interface WbPolicyRequest {
  user: WbUserId
  agentPreset: string
  action: 'send_data' | 'read_data' | 'invoke_tool' | 'model_request'
  resource?: WbDocumentId | string
  classification: WbClassification
  destination: 'local' | 'internal' | 'internet' | 'external_api'
  tool?: string
}

export type WbModelCapability =
  | 'reasoning'
  | 'vision_reasoning'
  | 'embedding'
  | 'rerank'
  | 'ocr'

export interface WbModelHandle {
  /** The mounted cordis.yml `id` this capability resolved to. */
  adapterId: string
  capability: WbModelCapability
}

export interface WbUser {
  id: WbUserId
  displayName: string
  department: string
  role: string
  clearance: WbClassification
  allowedAgentPresets: string[]
  allowedToolCategories: Array<'local' | 'enterprise' | 'external'>
  networkPermissions: Array<'web_search' | 'external_api'>
}

export interface WbCitation {
  documentId: WbDocumentId
  title: string
  page?: number
  section?: string
}

export interface WbRagResult {
  chunks: Array<{ text: string; citation: WbCitation; classification: WbClassification }>
  citations: WbCitation[]
  /** Chunks that matched but were filtered by policy — for transparency in the UI/audit. */
  filtered: Array<{ citation: WbCitation; reason: string }>
}

export type WbToolRiskLevel = 'local' | 'enterprise' | 'external'
export type WbToolNetworkAccess = 'none' | 'internal' | 'external'

export interface WbToolManifest {
  toolId: string // must equal the tool's registered name, e.g. 'wb_vision_analyze'
  riskLevel: WbToolRiskLevel
  requiredPermissions: string[]
  dataClassificationCeiling: WbClassification
  networkAccess: WbToolNetworkAccess
}

export interface WbAuditEntry {
  id: WbAuditEntryId
  at: string // ISO 8601
  sessionId: WbSessionId
  userId: WbUserId
  kind: 'policy_decision' | 'tool_result' | 'session_event' | 'rag_retrieval' | 'ingestion_completed'
  summary: string
  payload: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// 7.3 Service Definition interfaces (implemented by their owning plugin;
// re-exported here so every consumer types against the same shape)
// ---------------------------------------------------------------------------

export interface WbIdentityService {
  current(sessionId: WbSessionId): WbUser | undefined
}

export interface WbPolicyService {
  evaluate(request: WbPolicyRequest): Promise<WbPolicyDecision>
}

export interface WbAuditService {
  record(entry: Omit<WbAuditEntry, 'id' | 'at'>): void
  query(filter: Partial<Pick<WbAuditEntry, 'sessionId' | 'userId' | 'kind'>>): WbAuditEntry[]
}

export interface WbModelGatewayService {
  resolve(capability: WbModelCapability): WbModelHandle
}

export interface WbRagService {
  retrieve(query: string, user: WbUser): Promise<WbRagResult>
}

export interface WbVisionService {
  describe(image: Buffer | string, prompt: string): Promise<Record<string, unknown>>
}

export interface WbToolGatewayService {
  registerManifest(manifest: WbToolManifest): void
  getManifest(toolId: string): WbToolManifest | undefined
}

export interface WbIngestionService {
  enqueue(file: { path: string; declaredClassification: WbClassification }): Promise<WbDocumentId>
}

// ---------------------------------------------------------------------------
// 7.4 Event payloads (paired with the ctx keys/event names table in DESIGN.md §7.4)
// ---------------------------------------------------------------------------

export interface WbIdentityResolvedEvent {
  sessionId: WbSessionId
  user: WbUser
}

export type WbPolicyDecisionEvent = WbPolicyRequest & WbPolicyDecision

export interface WbRagRetrievedEvent {
  sessionId: WbSessionId
  result: WbRagResult
}

export interface WbIngestionCompletedEvent {
  documentId: WbDocumentId
  classification: WbClassification
}
