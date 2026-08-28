/**
 * Central policy gateway for the Sovereign AI Workbench.
 *
 * Evaluates every tool call against a configurable classification × capability
 * matrix and publishes all decisions (including ALLOW) as events for audit.
 *
 * @module @mrpl/dsh-workbench-policy
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { PreToolDecision } from '@deepseek-ai/dsh-tools'
import {
  asWbSessionId,
  type WbClassification,
  type WbDecisionKind,
  type WbPolicyRequest,
  type WbPolicyDecision,
  type WbPolicyDecisionEvent,
  type WbIdentityService,
  type WbToolGatewayService,
  type WbToolNetworkAccess,
  type WbCapability,
  type WbPolicyMatrix,
  type WbRoleOverrides,
  type WbPolicyOverrideChangedEvent,
  type WbUser,
} from '@mrpl/dsh-workbench-types'

// ---------------------------------------------------------------------------
// Plugin metadata
// ---------------------------------------------------------------------------

/** Preset name used when a principal declares none. */
const UNKNOWN_PRESET = 'unknown'

/**
 * Map a tool's declared network reach onto the policy destination axis.
 *
 * `wb-tool-gateway` is the single source of truth for what a tool can reach,
 * so the gate reads it instead of matching substrings in the tool's name.
 * @param access - the manifest's `networkAccess`, or undefined for an
 *   unmanifested tool.
 * @returns the destination to evaluate; an unmanifested tool is treated as
 *   external, the most restrictive column, though it is denied earlier for
 *   having no manifest at all.
 */
function destinationForNetworkAccess(
  access: WbToolNetworkAccess | undefined,
): WbPolicyRequest['destination'] {
  switch (access) {
    case 'none':
      return 'local'
    case 'internal':
      return 'internal'
    case 'external':
      return 'internet'
    default:
      return 'external_api'
  }
}

export const name = 'wb-policy'

export const inject = ['wbIdentity', 'wbToolGateway'] as const

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Capability keys matching the §5 matrix rows (snake_case). */
// The capability axis and the override table are frozen in §7.2 so that
// wb-admin-console can reference them without importing this package.
export type { WbCapability } from '@mrpl/dsh-workbench-types'
/** Every capability the matrix keys on; the validation set for admin edits. */
export const ALL_CAPABILITIES: readonly WbCapability[] = [
  'local_model_inference',
  'internal_rag',
  'local_code_sandbox',
  'internal_db_api',
  'web_search',
  'external_api',
  'external_upload',
]

/** Every decision kind an override may name. */
export const ALL_DECISION_KINDS: readonly WbDecisionKind[] = [
  'ALLOW',
  'DENY',
  'REQUIRE_APPROVAL',
  'ALLOW_WITH_REDACTION',
  'ALLOW_METADATA_ONLY',
]

export type PolicyMatrix = WbPolicyMatrix
export type RoleOverrides = WbRoleOverrides

export interface Config {
  /** Classification × capability matrix (§5 default when omitted). */
  matrix?: PolicyMatrix
  /** Per-role overrides applied on top of the matrix. */
  roleOverrides?: RoleOverrides
}

// Config is validated manually in the constructor since the matrix/roleOverrides
// are complex nested objects that don't fit schemastery's object schema well.
export const Config = z.any()

// ---------------------------------------------------------------------------
// Default §5 matrix
// ---------------------------------------------------------------------------

const DEFAULT_MATRIX: PolicyMatrix = {
  PUBLIC: {
    local_model_inference: 'ALLOW',
    internal_rag: 'ALLOW',
    local_code_sandbox: 'ALLOW',
    internal_db_api: 'ALLOW',
    web_search: 'ALLOW',
    external_api: 'ALLOW',
    external_upload: 'ALLOW',
  },
  INTERNAL: {
    local_model_inference: 'ALLOW',
    internal_rag: 'ALLOW',
    local_code_sandbox: 'ALLOW',
    internal_db_api: 'ALLOW',
    web_search: 'ALLOW',
    external_api: 'REQUIRE_APPROVAL',
    external_upload: 'DENY',
  },
  CONFIDENTIAL: {
    local_model_inference: 'ALLOW',
    internal_rag: 'ALLOW',
    local_code_sandbox: 'ALLOW',
    internal_db_api: 'ALLOW',
    web_search: 'REQUIRE_APPROVAL',
    external_api: 'DENY',
    external_upload: 'DENY',
  },
  RESTRICTED: {
    local_model_inference: 'ALLOW',
    internal_rag: 'ALLOW',
    local_code_sandbox: 'ALLOW',
    internal_db_api: 'REQUIRE_APPROVAL',
    web_search: 'DENY',
    external_api: 'DENY',
    external_upload: 'DENY',
  },
}

// ---------------------------------------------------------------------------
// Action + destination → capability mapping
// ---------------------------------------------------------------------------

/**
 * Resolve a WbPolicyRequest's action and destination to a matrix capability key.
 * Returns undefined for unsupported combinations (will be rejected).
 */
function resolveCapability(
  action: WbPolicyRequest['action'],
  destination: WbPolicyRequest['destination'],
): WbCapability | undefined {
  switch (action) {
    case 'model_request':
      // All model requests use local inference regardless of destination
      return 'local_model_inference'

    case 'read_data':
      // All data reads use internal RAG regardless of destination
      return 'internal_rag'

    case 'invoke_tool':
      switch (destination) {
        case 'local':
          return 'local_code_sandbox'
        case 'internal':
          return 'internal_db_api'
        case 'internet':
          return 'web_search'
        case 'external_api':
          return 'external_api'
        default:
          return undefined
      }

    case 'send_data':
      switch (destination) {
        case 'local':
          // Sending data locally uses internal RAG capability
          return 'internal_rag'
        case 'internal':
          // Sending data internally uses internal RAG capability
          return 'internal_rag'
        case 'internet':
          return 'external_upload'
        case 'external_api':
          return 'external_upload'
        default:
          return undefined
      }

    default:
      return undefined
  }
}

// ---------------------------------------------------------------------------
// Context augmentation
// ---------------------------------------------------------------------------

declare module '@deepseek-ai/cordis' {
  interface Context {
    wbPolicy: WbPolicyService
    /** Identity service provided by wb-identity plugin. */
    wbIdentity: WbIdentityService
    /** Tool gateway service provided by wb-tool-gateway plugin. */
    wbToolGateway: WbToolGatewayService
  }

  interface Events {
    /** A policy decision was made. */
    'wb/policy/decision'(event: WbPolicyDecisionEvent): void
    /** The per-role override table changed. */
    'wb/policy/override-changed'(event: WbPolicyOverrideChangedEvent): void
  }
}

// ---------------------------------------------------------------------------
// Service implementation
// ---------------------------------------------------------------------------

/**
 * Central policy gateway that evaluates every tool call against a configurable
 * classification × capability matrix.
 *
 * Provides `ctx.wbPolicy.evaluate(request)` for direct policy checks and
 * registers a `tools/pre-execute` listener to gate all tool calls automatically.
 */
export class WbPolicyService extends Service {
  static inject = ['wbIdentity', 'wbToolGateway'] as const

  private readonly matrix: PolicyMatrix
  private roleOverrides: RoleOverrides

  constructor(ctx: Context, config?: Config) {
    super(ctx, 'wbPolicy')

    // Validate and merge matrix config
    this.matrix = config?.matrix ?? DEFAULT_MATRIX
    this.roleOverrides = config?.roleOverrides ?? {}

    // Validate matrix structure
    this.validateMatrix(this.matrix)

    // Register tools/pre-execute listener
    ctx.effect(() => {
      const unsubscribe = ctx.on('tools/pre-execute', async (exec, next): Promise<PreToolDecision> => {
        // Build a WbPolicyRequest from the tool execution. No session or no
        // resolved principal is a denial, never a skipped check: invariant 1
        // requires every tool call to be reachable by the policy check, and
        // §6.1 requires identity to have resolved before anything is allowed.
        const request = this.buildRequestFromExecution(exec)
        if (!request) {
          return {
            kind: 'deny',
            reason: `IDENTITY_UNRESOLVED: no resolved principal for tool "${exec.name}"`,
          }
        }
        const decision = await this.evaluate(request)

        // Map WbDecisionKind to PreToolDecision
        switch (decision.decision) {
          case 'ALLOW':
            return next()

          case 'DENY':
            return { kind: 'deny', reason: decision.reason }

          case 'REQUIRE_APPROVAL':
            return { kind: 'ask', reason: decision.reason }

          case 'ALLOW_WITH_REDACTION':
          case 'ALLOW_METADATA_ONLY':
            // Deny rather than pass through. A pre-execution gate cannot redact
            // a result it has not seen, and running the call unmodified would
            // make a STRICTER matrix setting behave as the loosest one — the
            // one outcome that misleads whoever configured it. Callers able to
            // enforce these (wb-rag, the data layer) reach them through a
            // direct evaluate(), which is unaffected.
            return {
              kind: 'deny',
              reason:
                `${decision.reason} (${decision.decision} cannot be enforced on a tool call; ` +
                'the tool gate has no result to redact)',
            }

          default:
            return { kind: 'deny', reason: `unrecognised policy decision for tool "${exec.name}"` }
        }
      })

      return () => {
        unsubscribe()
      }
    }, 'wb-policy-listener')
  }

  /**
   * Evaluate a policy request against the classification × capability matrix.
   *
   * @param request - the policy request to evaluate
   * @returns the policy decision with reason
   */
  async evaluate(request: WbPolicyRequest): Promise<WbPolicyDecision> {
    // 1. Look up user identity
    const identityService = this.ctx.get('wbIdentity') as WbIdentityService | undefined
    if (!identityService) {
      const decision: WbPolicyDecision = {
        decision: 'DENY',
        reason: 'IDENTITY_UNRESOLVED: no identity service available',
      }
      this.emitDecision(request, decision)
      return decision
    }

    // Keyed by SESSION, per §7.3. Passing `request.user` here (behind a cast)
    // made every caller that supplies a real user id — wb-rag does — miss the
    // lookup and be denied, which silently emptied every retrieval.
    const user = identityService.current(request.sessionId)
    if (!user) {
      const decision: WbPolicyDecision = {
        decision: 'DENY',
        reason: `IDENTITY_UNRESOLVED: no principal resolved for session ${request.sessionId}`,
      }
      this.emitDecision(request, decision)
      return decision
    }

    if (user.id !== request.user) {
      // The request names a different principal than the session resolves to.
      // Evaluating the session's clearance against another user's request
      // would authorize the wrong person, so refuse instead of picking one.
      const decision: WbPolicyDecision = {
        decision: 'DENY',
        reason: `IDENTITY_MISMATCH: session ${request.sessionId} resolves to ${user.id}, not ${request.user}`,
      }
      this.emitDecision(request, decision)
      return decision
    }

    // 2. Check tool manifest (for invoke_tool actions)
    if (request.action === 'invoke_tool' && request.tool) {
      const toolGateway = this.ctx.get('wbToolGateway') as WbToolGatewayService | undefined
      if (toolGateway) {
        const manifest = toolGateway.getManifest(request.tool)
        if (!manifest) {
          const decision: WbPolicyDecision = {
            decision: 'DENY',
            reason: `NO_MANIFEST: tool "${request.tool}" has no registered manifest`,
          }
          this.emitDecision(request, decision)
          return decision
        }

        // Check if user's clearance meets the tool's data classification ceiling
        if (!this.clearanceMeetsCeiling(user, manifest.dataClassificationCeiling)) {
          const decision: WbPolicyDecision = {
            decision: 'DENY',
            reason: `CLEARANCE_INSUFFICIENT: user clearance ${user.clearance} below tool ceiling ${manifest.dataClassificationCeiling}`,
          }
          this.emitDecision(request, decision)
          return decision
        }
      }
    }

    // 3. Resolve capability from action + destination
    const capability = resolveCapability(request.action, request.destination)
    if (!capability) {
      const decision: WbPolicyDecision = {
        decision: 'DENY',
        reason: `UNSUPPORTED: action "${request.action}" + destination "${request.destination}" is not a valid combination`,
      }
      this.emitDecision(request, decision)
      return decision
    }

    // 4. Check role overrides first, then fall back to matrix
    let decisionKind: WbDecisionKind | undefined

    // Check role overrides
    const userRole = user.role
    if (userRole && this.roleOverrides[userRole]) {
      const roleDecision = this.roleOverrides[userRole][capability]
      if (roleDecision) {
        decisionKind = roleDecision
      }
    }

    // Fall back to matrix if no role override
    if (decisionKind === undefined) {
      decisionKind = this.matrix[request.classification]?.[capability]
    }

    // 5. Default to DENY if no decision found (fail-closed)
    if (decisionKind === undefined) {
      const decision: WbPolicyDecision = {
        decision: 'DENY',
        reason: `NO_RULE: no policy rule for ${request.classification} + ${capability}`,
      }
      this.emitDecision(request, decision)
      return decision
    }

    // 6. Generate decision with reason
    const decision: WbPolicyDecision = {
      decision: decisionKind,
      reason: this.generateReason(request, capability, decisionKind),
    }

    // 7. Publish decision event
    this.emitDecision(request, decision)

    return decision
  }

  /**
   * Build a WbPolicyRequest from a tool execution.
   */
  /**
   * The live governance state, for an admin surface to render.
   *
   * Returns a deep copy: the console renders and edits a detached value and
   * commits through {@link setRoleOverride}, so there is no path where mutating
   * a rendered object quietly changes what `evaluate()` enforces.
   * @returns the matrix and per-role overrides currently in force.
   */
  governance(): { matrix: WbPolicyMatrix; roleOverrides: WbRoleOverrides } {
    return {
      matrix: structuredClone(this.matrix),
      roleOverrides: structuredClone(this.roleOverrides),
    }
  }

  /**
   * Replace or clear one role's overrides.
   * @param role - the role whose overrides to replace.
   * @param override - the new overrides, or undefined to clear the role.
   * @throws when the role is empty, or an entry names a capability or decision
   *   kind outside the frozen unions — a bad edit fails here rather than
   *   silently never matching at evaluate() time.
   */
  setRoleOverride(
    role: string,
    override: Partial<Record<WbCapability, WbDecisionKind>> | undefined,
  ): void {
    if (!role.trim()) throw new Error('wb-policy: setRoleOverride requires a non-empty role')

    if (override) {
      for (const [capability, decision] of Object.entries(override)) {
        if (!ALL_CAPABILITIES.includes(capability as WbCapability)) {
          throw new Error(`wb-policy: unknown capability "${capability}" for role "${role}"`)
        }
        if (!ALL_DECISION_KINDS.includes(decision as WbDecisionKind)) {
          throw new Error(`wb-policy: unknown decision "${String(decision)}" for role "${role}"`)
        }
      }
      this.roleOverrides = { ...this.roleOverrides, [role]: { ...override } }
    } else {
      const { [role]: _removed, ...rest } = this.roleOverrides
      this.roleOverrides = rest
    }

    // Governed <=> logged: an admin changing the table is a governance change,
    // and invariant 4 makes it as observable as a decision.
    const event: WbPolicyOverrideChangedEvent = override
      ? { role, override: { ...override } }
      : { role }
    this.ctx.emit('wb/policy/override-changed', event)
  }

  /**
   * Build a {@link WbPolicyRequest} from one tool execution.
   *
   * Resolves the session's principal through `ctx.wbIdentity` rather than
   * putting the session id in `user`: `user` is a {@link WbUserId} by §7.2, and
   * crossing the two made every caller that passes a real user id (`wb-rag`)
   * miss the identity lookup and be denied.
   *
   * `classification` and `destination` come from the tool's manifest, not from
   * its name. §6.7 exists so this gate reads structured metadata instead of
   * guessing, and a name heuristic disagrees with the manifest in practice —
   * `bash` reads as "local" by name while its manifest declares external
   * network reach.
   * @param exec - the pending tool call.
   * @returns the request to evaluate; `undefined` when no session is attached,
   *   which the caller must treat as a denial rather than a skipped check.
   */
  private buildRequestFromExecution(
    exec: { name: string; arguments: unknown; agent?: { session?: { id: string } } },
  ): WbPolicyRequest | undefined {
    const rawSessionId = exec.agent?.session?.id
    if (!rawSessionId) return undefined
    const sessionId = asWbSessionId(rawSessionId)

    const identity = this.ctx.get('wbIdentity') as WbIdentityService | undefined
    const user = identity?.current(sessionId)
    if (!user) return undefined

    const manifest = (this.ctx.get('wbToolGateway') as WbToolGatewayService | undefined)?.getManifest(
      exec.name,
    )

    return {
      user: user.id,
      sessionId,
      agentPreset: user.allowedAgentPresets[0] ?? UNKNOWN_PRESET,
      action: 'invoke_tool',
      // The highest band this tool may touch. Without a resolved document
      // argument this is the conservative reading of what the call could
      // reach; the previous constant 'PUBLIC' was the most PERMISSIVE band in
      // §5, which pinned the matrix to its loosest row on every decision.
      classification: manifest?.dataClassificationCeiling ?? 'RESTRICTED',
      destination: destinationForNetworkAccess(manifest?.networkAccess),
      tool: exec.name,
    }
  }


  /**
   * Check if user's clearance meets the tool's data classification ceiling.
   */
  private clearanceMeetsCeiling(user: WbUser, ceiling: WbClassification): boolean {
    const clearanceOrder: WbClassification[] = ['PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'RESTRICTED']
    const userLevel = clearanceOrder.indexOf(user.clearance)
    const ceilingLevel = clearanceOrder.indexOf(ceiling)
    return userLevel <= ceilingLevel
  }

  /**
   * Validate matrix structure.
   */
  private validateMatrix(matrix: PolicyMatrix): void {
    const requiredClassifications: WbClassification[] = ['PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'RESTRICTED']
    const requiredCapabilities: WbCapability[] = [
      'local_model_inference',
      'internal_rag',
      'local_code_sandbox',
      'internal_db_api',
      'web_search',
      'external_api',
      'external_upload',
    ]

    for (const classification of requiredClassifications) {
      if (!matrix[classification]) {
        throw new Error(`Missing classification "${classification}" in policy matrix`)
      }

      for (const capability of requiredCapabilities) {
        if (!matrix[classification][capability]) {
          throw new Error(`Missing capability "${capability}" for classification "${classification}" in policy matrix`)
        }

        const decision = matrix[classification][capability]
        if (!['ALLOW', 'DENY', 'REQUIRE_APPROVAL', 'ALLOW_WITH_REDACTION', 'ALLOW_METADATA_ONLY'].includes(decision)) {
          throw new Error(`Invalid decision "${decision}" for ${classification}/${capability} in policy matrix`)
        }
      }
    }
  }

  /**
   * Generate a human-readable reason for the decision.
   */
  private generateReason(
    request: WbPolicyRequest,
    capability: WbCapability,
    decisionKind: WbDecisionKind,
  ): string {
    const capabilityNames: Record<WbCapability, string> = {
      local_model_inference: 'local model inference',
      internal_rag: 'internal RAG/documents',
      local_code_sandbox: 'local code sandbox',
      internal_db_api: 'internal DB/API',
      web_search: 'web search',
      external_api: 'external API',
      external_upload: 'external upload/egress',
    }

    const capabilityName = capabilityNames[capability] ?? capability

    switch (decisionKind) {
      case 'ALLOW':
        return `ALLOWED: ${request.action} to ${request.destination} (${capabilityName}) permitted for ${request.classification} data`
      case 'DENY':
        return `DENIED: ${request.action} to ${request.destination} (${capabilityName}) not permitted for ${request.classification} data`
      case 'REQUIRE_APPROVAL':
        return `APPROVAL_REQUIRED: ${request.action} to ${request.destination} (${capabilityName}) requires approval for ${request.classification} data`
      case 'ALLOW_WITH_REDACTION':
        return `ALLOWED_WITH_REDACTION: ${request.action} to ${request.destination} (${capabilityName}) permitted with redaction for ${request.classification} data`
      case 'ALLOW_METADATA_ONLY':
        return `ALLOWED_METADATA_ONLY: ${request.action} to ${request.destination} (${capabilityName}) permitted with metadata only for ${request.classification} data`
      default:
        return `UNKNOWN: ${request.action} to ${request.destination} (${capabilityName}) decision ${decisionKind} for ${request.classification} data`
    }
  }

  /**
   * Emit a policy decision event for audit.
   */
  private emitDecision(request: WbPolicyRequest, decision: WbPolicyDecision): void {
    const event: WbPolicyDecisionEvent = {
      ...request,
      ...decision,
    }
    this.ctx.emit('wb/policy/decision', event)
  }
}

export default WbPolicyService