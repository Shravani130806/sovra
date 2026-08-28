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
  /**
   * The session the request belongs to.
   *
   * Carried on the request so it reaches `wb/policy/decision` through
   * `WbPolicyDecisionEvent`, which is what lets `wb-audit` write a decision
   * entry at all. It is also how a caller that holds only a session (the
   * `tools/pre-execute` gate) reaches the principal: resolve it through
   * `WbIdentityService.current(sessionId)` and put that user in `user`.
   */
  sessionId: WbSessionId
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

/**
 * The capability axis of the §5 matrix — what a request is trying to do,
 * independent of the data's classification.
 */
export type WbCapability =
  | 'local_model_inference'
  | 'internal_rag'
  | 'local_code_sandbox'
  | 'internal_db_api'
  | 'web_search'
  | 'external_api'
  | 'external_upload'

/** Classification x capability decision table (§5). */
export type WbPolicyMatrix = Record<WbClassification, Record<WbCapability, WbDecisionKind>>

/**
 * Per-role decisions layered over the matrix: role -> capability -> decision.
 *
 * A role names only the capabilities it changes; anything absent falls through
 * to the matrix.
 */
export type WbRoleOverrides = Record<string, Partial<Record<WbCapability, WbDecisionKind>>>

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
  kind:
    | 'policy_decision'
    | 'policy_override'
    | 'tool_result'
    | 'session_event'
    | 'rag_retrieval'
    | 'ingestion_completed'
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
  /**
   * The live matrix and per-role overrides, for an admin surface to render.
   * @returns a deep copy; mutating it does not change what is enforced.
   */
  governance(): { matrix: WbPolicyMatrix; roleOverrides: WbRoleOverrides }
  /**
   * Replace or clear one role's overrides.
   *
   * The only supported write path into policy state. §6.11 has
   * `wb-admin-console` edit the table `wb-policy` already reads rather than
   * keeping a second one, so the change lands here and takes effect on the
   * next `evaluate()`. Every change publishes `wb/policy/override-changed`:
   * a governance change is as observable as a decision (§9 invariant 4).
   * @param role - the role whose overrides to replace.
   * @param override - the new overrides, or undefined to clear the role.
   * @throws when the role is empty, or an entry names a capability or decision
   *   kind outside the frozen unions, so a bad edit fails at the call rather
   *   than silently never matching at evaluate() time.
   */
  setRoleOverride(
    role: string,
    override: Partial<Record<WbCapability, WbDecisionKind>> | undefined,
  ): void
}

export interface WbAuditService {
  record(entry: Omit<WbAuditEntry, 'id' | 'at'>): void
  query(filter: Partial<Pick<WbAuditEntry, 'sessionId' | 'userId' | 'kind'>>): WbAuditEntry[]
}

export interface WbModelGatewayService {
  resolve(capability: WbModelCapability): WbModelHandle
}

export interface WbRagService {
  /**
   * Retrieve chunks the user is cleared to see.
   *
   * `sessionId` is required because per-chunk authorization goes through
   * `WbPolicyService.evaluate`, which resolves the principal from the session
   * — a user id alone cannot be authenticated, and passing one made every
   * retrieval deny.
   * @param query - the natural-language query to embed and search.
   * @param user - the requesting principal.
   * @param sessionId - the session the retrieval belongs to.
   * @returns authorized chunks with citations, plus the chunks policy filtered.
   */
  retrieve(query: string, user: WbUser, sessionId: WbSessionId): Promise<WbRagResult>
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

/** Published by wb-policy whenever the per-role override table changes. */
export interface WbPolicyOverrideChangedEvent {
  role: string
  /** The overrides now in force for that role; absent when the role was cleared. */
  override?: Partial<Record<WbCapability, WbDecisionKind>>
  /** Who made the change, when the caller knows. */
  changedBy?: WbUserId
}

export interface WbRagRetrievedEvent {
  sessionId: WbSessionId
  result: WbRagResult
}

export interface WbIngestionCompletedEvent {
  documentId: WbDocumentId
  classification: WbClassification
}
