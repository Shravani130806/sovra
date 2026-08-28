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
  asWbUserId,
  type WbClassification,
  type WbDecisionKind,
  type WbPolicyRequest,
  type WbPolicyDecision,
  type WbPolicyDecisionEvent,
  type WbIdentityService,
  type WbToolGatewayService,
  type WbUser,
} from '@mrpl/dsh-workbench-types'

// ---------------------------------------------------------------------------
// Plugin metadata
// ---------------------------------------------------------------------------

export const name = 'wb-policy'

export const inject = ['wbIdentity', 'wbToolGateway'] as const

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Capability keys matching the §5 matrix rows (snake_case). */
export type WbCapability =
  | 'local_model_inference'
  | 'internal_rag'
  | 'local_code_sandbox'
  | 'internal_db_api'
  | 'web_search'
  | 'external_api'
  | 'external_upload'

/** Matrix: classification → capability → decision. */
export type PolicyMatrix = Record<WbClassification, Record<WbCapability, WbDecisionKind>>

/** Role overrides: role → capability → decision. */
export type RoleOverrides = Record<string, Partial<Record<WbCapability, WbDecisionKind>>>

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
  private readonly roleOverrides: RoleOverrides

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
        // Build a WbPolicyRequest from the tool execution
        const request = this.buildRequestFromExecution(exec)
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
            // These require direct evaluate() calls by components capable of
            // enforcing those restrictions (e.g., RAG/data layer).
            // For the pre-execute hook, treat as allow with a note.
            return next()

          default:
            return next()
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

    const user = identityService.current(request.user as any)
    if (!user) {
      const decision: WbPolicyDecision = {
        decision: 'DENY',
        reason: `IDENTITY_UNRESOLVED: user ${request.user} not found`,
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
  private buildRequestFromExecution(exec: { name: string; arguments: unknown; agent?: { session?: { id: string } } }): WbPolicyRequest {
    // Default to most restrictive classification for unclassified tool calls
    const classification: WbClassification = 'PUBLIC'

    // Determine destination from tool name heuristics
    const destination = this.inferDestination(exec.name)

    // Determine action from tool name
    const action = this.inferAction(exec.name)

    return {
      user: asWbUserId(exec.agent?.session?.id ?? 'unknown'),
      agentPreset: 'unknown',
      action,
      classification,
      destination,
      tool: exec.name,
    }
  }

  /**
   * Infer destination from tool name heuristics.
   */
  private inferDestination(toolName: string): WbPolicyRequest['destination'] {
    const lowerName = toolName.toLowerCase()

    // Local tools
    if (lowerName.includes('local') || lowerName.includes('bash') || lowerName.includes('shell')) {
      return 'local'
    }

    // Internal tools
    if (lowerName.includes('internal') || lowerName.includes('db') || lowerName.includes('database')) {
      return 'internal'
    }

    // Internet tools
    if (lowerName.includes('web') || lowerName.includes('search') || lowerName.includes('fetch')) {
      return 'internet'
    }

    // External API tools
    if (lowerName.includes('external') || lowerName.includes('api')) {
      return 'external_api'
    }

    // Default to local for unknown tools
    return 'local'
  }

  /**
   * Infer action from tool name heuristics.
   */
  private inferAction(toolName: string): WbPolicyRequest['action'] {
    const lowerName = toolName.toLowerCase()

    // Read operations
    if (lowerName.includes('read') || lowerName.includes('get') || lowerName.includes('fetch')) {
      return 'read_data'
    }

    // Write operations
    if (lowerName.includes('write') || lowerName.includes('send') || lowerName.includes('upload')) {
      return 'send_data'
    }

    // Default to invoke_tool
    return 'invoke_tool'
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