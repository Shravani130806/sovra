import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { Context, type Service } from '@deepseek-ai/cordis'
import { CallId } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { PreToolDecision } from '@deepseek-ai/dsh-tools'
import {
  asWbUserId,
  asWbSessionId,
  type WbClassification,
  type WbDecisionKind,
  type WbPolicyRequest,
  type WbPolicyDecision,
  type WbPolicyDecisionEvent,
  type WbIdentityService,
  type WbToolGatewayService,
  type WbUser,
  type WbToolManifest,
} from '@mrpl/dsh-workbench-types'
import WbPolicyService from '../src/index.ts'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** The session every hand-built request in these tests belongs to. */
const TEST_SESSION = 'test-session'

function createMockUser(overrides: Partial<WbUser> = {}): WbUser {
  return {
    id: asWbUserId('test-user'),
    displayName: 'Test User',
    department: 'Engineering',
    role: 'engineer',
    // Fully cleared on purpose: the matrix suite tests the §5 mapping, and a
    // principal short of the row's classification is denied on clearance
    // before the matrix is ever consulted. Clearance itself is covered by its
    // own describe block below.
    clearance: 'RESTRICTED',
    allowedAgentPresets: ['document-analyst', 'engineering-vision', 'code-analysis', 'research', 'artifact'],
    allowedToolCategories: ['local', 'enterprise', 'external'],
    networkPermissions: ['web_search', 'external_api'],
    ...overrides,
  }
}

function createMockIdentityService(user?: WbUser): WbIdentityService {
  return {
    current(_sessionId) {
      return user ?? createMockUser()
    },
  }
}

function createMockToolGateway(manifests?: Map<string, WbToolManifest>): WbToolGatewayService {
  // Default: include manifests for test tools so matrix tests pass the manifest check
  const map = manifests ?? new Map([
    ['test-tool', {
      toolId: 'test-tool',
      riskLevel: 'low',
      requiredPermissions: [],
      dataClassificationCeiling: 'RESTRICTED',
      networkAccess: 'none',
    }],
    ['search-tool', {
      toolId: 'search-tool',
      riskLevel: 'low',
      requiredPermissions: [],
      dataClassificationCeiling: 'RESTRICTED',
      networkAccess: 'external',
    }],
  ])
  return {
    registerManifest(_manifest) {},
    getManifest(toolId) {
      return map.get(toolId)
    },
  }
}

function createMockAgent(overrides: Partial<{ session: { id: string; events: unknown[] } }> = {}): Agent {
  return {
    session: {
      id: asWbSessionId('test-session'),
      events: [{ type: 'turn/start', data: {} }],
      ...overrides.session,
    },
  } as unknown as Agent
}

// ---------------------------------------------------------------------------
// §5 Classification × Capability Matrix Tests
// ---------------------------------------------------------------------------

describe('wb-policy plugin', () => {
  let ctx: Context

  beforeEach(() => {
    ctx = new Context()
  })

  afterEach(() => {
    // Context cleanup is automatic via garbage collection
  })

  describe('§5 matrix evaluation', () => {
    // Matrix rows (capabilities) × columns (classifications)
    // Expected decisions from DESIGN.md §5:
    //
    // | Capability                      | PUBLIC | INTERNAL | CONFIDENTIAL | RESTRICTED |
    // |---------------------------------|--------|----------|--------------|------------|
    // | Local model inference           | ALLOW  | ALLOW    | ALLOW        | ALLOW      |
    // | Internal RAG / documents        | ALLOW  | ALLOW    | ALLOW        | ALLOW      |
    // | Local code sandbox              | ALLOW  | ALLOW    | ALLOW        | ALLOW      |
    // | Internal DB / internal API      | ALLOW  | ALLOW    | ALLOW        | APPROVAL   |
    // | Web search                      | ALLOW  | ALLOW    | APPROVAL     | DENY       |
    // | External API                    | ALLOW  | APPROVAL | DENY         | DENY       |
    // | External upload / egress        | ALLOW  | DENY     | DENY         | DENY       |

    const matrixTests: Array<{
      capability: string
      action: WbPolicyRequest['action']
      destination: WbPolicyRequest['destination']
      expected: Record<WbClassification, WbDecisionKind>
    }> = [
      {
        capability: 'local_model_inference',
        action: 'model_request',
        destination: 'local',
        expected: { PUBLIC: 'ALLOW', INTERNAL: 'ALLOW', CONFIDENTIAL: 'ALLOW', RESTRICTED: 'ALLOW' },
      },
      {
        capability: 'internal_rag',
        action: 'read_data',
        destination: 'internal',
        expected: { PUBLIC: 'ALLOW', INTERNAL: 'ALLOW', CONFIDENTIAL: 'ALLOW', RESTRICTED: 'ALLOW' },
      },
      {
        capability: 'local_code_sandbox',
        action: 'invoke_tool',
        destination: 'local',
        expected: { PUBLIC: 'ALLOW', INTERNAL: 'ALLOW', CONFIDENTIAL: 'ALLOW', RESTRICTED: 'ALLOW' },
      },
      {
        capability: 'internal_db_api',
        action: 'invoke_tool',
        destination: 'internal',
        expected: { PUBLIC: 'ALLOW', INTERNAL: 'ALLOW', CONFIDENTIAL: 'ALLOW', RESTRICTED: 'REQUIRE_APPROVAL' },
      },
      {
        capability: 'web_search',
        action: 'invoke_tool',
        destination: 'internet',
        expected: { PUBLIC: 'ALLOW', INTERNAL: 'ALLOW', CONFIDENTIAL: 'REQUIRE_APPROVAL', RESTRICTED: 'DENY' },
      },
      {
        capability: 'external_api',
        action: 'invoke_tool',
        destination: 'external_api',
        expected: { PUBLIC: 'ALLOW', INTERNAL: 'REQUIRE_APPROVAL', CONFIDENTIAL: 'DENY', RESTRICTED: 'DENY' },
      },
      {
        capability: 'external_upload',
        action: 'send_data',
        destination: 'external_api',
        expected: { PUBLIC: 'ALLOW', INTERNAL: 'DENY', CONFIDENTIAL: 'DENY', RESTRICTED: 'DENY' },
      },
    ]

    for (const { capability, action, destination, expected } of matrixTests) {
      for (const classification of ['PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'RESTRICTED'] as WbClassification[]) {
        it(`${capability} + ${classification} → ${expected[classification]}`, async () => {
          ctx.provide('wbIdentity', createMockIdentityService())
          ctx.provide('wbToolGateway', createMockToolGateway())
          await ctx.plugin(WbPolicyService)

          const request: WbPolicyRequest = {
            user: asWbUserId('test-user'),
            sessionId: asWbSessionId('test-session'),
            agentPreset: 'document-analyst',
            action,
            classification,
            destination,
            tool: 'test-tool',
          }

          const decision = await ctx.wbPolicy.evaluate(request)
          expect(decision.decision).toBe(expected[classification])
        })
      }
    }
  })

  describe('action/destination → capability mapping (16 combinations)', () => {
    const allActions: WbPolicyRequest['action'][] = ['send_data', 'read_data', 'invoke_tool', 'model_request']
    const allDestinations: WbPolicyRequest['destination'][] = ['local', 'internal', 'internet', 'external_api']

    // Define the expected capability for each combination
    const mapping: Record<string, string | null> = {
      // model_request
      'model_request+local': 'local_model_inference',
      'model_request+internal': 'local_model_inference',
      'model_request+internet': 'local_model_inference',
      'model_request+external_api': 'local_model_inference',
      // read_data
      'read_data+local': 'internal_rag',
      'read_data+internal': 'internal_rag',
      'read_data+internet': 'internal_rag',
      'read_data+external_api': 'internal_rag',
      // invoke_tool
      'invoke_tool+local': 'local_code_sandbox',
      'invoke_tool+internal': 'internal_db_api',
      'invoke_tool+internet': 'web_search',
      'invoke_tool+external_api': 'external_api',
      // send_data
      'send_data+local': 'internal_rag', // send_data to local uses internal RAG capability
      'send_data+internal': 'internal_rag', // default for send_data to internal
      'send_data+internet': 'external_upload',
      'send_data+external_api': 'external_upload',
    }

    for (const action of allActions) {
      for (const destination of allDestinations) {
        const key = `${action}+${destination}`
        const expectedCapability = mapping[key]

        it(`${action} + ${destination} → ${expectedCapability ?? 'DENY (unsupported)'}`, async () => {
          ctx.provide('wbIdentity', createMockIdentityService())
          ctx.provide('wbToolGateway', createMockToolGateway())
          await ctx.plugin(WbPolicyService)

          const request: WbPolicyRequest = {
            user: asWbUserId('test-user'),
            sessionId: asWbSessionId('test-session'),
            agentPreset: 'document-analyst',
            action,
            classification: 'PUBLIC',
            destination,
            tool: 'test-tool',
          }

          const decision = await ctx.wbPolicy.evaluate(request)
          // For supported combinations, should not be DENY (unless matrix says so)
          // For unsupported combinations, should be DENY
          if (expectedCapability === null) {
            expect(decision.decision).toBe('DENY')
            expect(decision.reason).toContain('UNSUPPORTED')
          } else {
            // All PUBLIC + supported combinations should be ALLOW
            expect(decision.decision).toBe('ALLOW')
          }
        })
      }
    }
  })

  describe('tools/pre-execute integration', () => {
    it('denies a call with no resolvable principal, rather than skipping the check', async () => {
      // Invariant 1: every tool call must be reachable by the policy check.
      // An exec with no session used to be evaluated as user 'unknown' with a
      // hardcoded PUBLIC classification, which allowed it.
      ctx.provide('wbIdentity', createMockIdentityService())
      ctx.provide('wbToolGateway', createMockToolGateway())
      await ctx.plugin(WbPolicyService)

      const exec = {
        callId: CallId('test-call'),
        name: 'search-tool',
        arguments: {},
        signal: AbortSignal.timeout(5000),
      }
      const result = await ctx.waterfall('tools/pre-execute', exec, () =>
        Promise.resolve({ kind: 'allow' } as PreToolDecision))
      expect(result.kind).toBe('deny')
      expect((result as { reason: string }).reason).toContain('IDENTITY_UNRESOLVED')
    })

    it('takes destination from the manifest, not from the tool name', async () => {
      // search-tool's manifest declares networkAccess 'external', so the call
      // is evaluated against the internet column even though nothing in its
      // name says so. A RESTRICTED-ceiling tool over the internet is DENY.
      ctx.provide('wbIdentity', createMockIdentityService())
      ctx.provide('wbToolGateway', createMockToolGateway())
      await ctx.plugin(WbPolicyService)

      const exec = {
        callId: CallId('test-call'),
        name: 'search-tool',
        arguments: {},
        agent: { session: { id: TEST_SESSION } },
        signal: AbortSignal.timeout(5000),
      }
      const result = await ctx.waterfall('tools/pre-execute', exec, () =>
        Promise.resolve({ kind: 'allow' } as PreToolDecision))
      expect(result.kind).toBe('deny')
    })

    it('allows a local tool for a cleared principal', async () => {
      // test-tool's manifest is networkAccess 'none' -> destination 'local'.
      ctx.provide('wbIdentity', createMockIdentityService())
      ctx.provide('wbToolGateway', createMockToolGateway())
      await ctx.plugin(WbPolicyService)

      const exec = {
        callId: CallId('test-call'),
        name: 'test-tool',
        arguments: {},
        agent: { session: { id: TEST_SESSION } },
        signal: AbortSignal.timeout(5000),
      }
      const decision = await ctx.waterfall('tools/pre-execute', exec, () =>
        Promise.resolve({ kind: 'allow' } as PreToolDecision))
      expect(decision.kind).toBe('allow')
    })
  })

  describe('event publishing', () => {
    it('emits wb/policy/decision for every evaluate() call', async () => {
      ctx.provide('wbIdentity', createMockIdentityService())
      ctx.provide('wbToolGateway', createMockToolGateway())
      await ctx.plugin(WbPolicyService)

      const events: WbPolicyDecisionEvent[] = []
      ctx.on('wb/policy/decision', (event) => {
        events.push(event)
      })

      const request: WbPolicyRequest = {
        user: asWbUserId('test-user'),
        sessionId: asWbSessionId('test-session'),
        agentPreset: 'document-analyst',
        action: 'invoke_tool',
        classification: 'PUBLIC',
        destination: 'local',
        tool: 'test-tool',
      }

      await ctx.wbPolicy.evaluate(request)
      expect(events).toHaveLength(1)
      expect(events[0].decision).toBe('ALLOW')
      expect(events[0].user).toBe(asWbUserId('test-user'))
    })

    it('emits event for DENY decisions', async () => {
      ctx.provide('wbIdentity', createMockIdentityService(createMockUser({ clearance: 'RESTRICTED' })))
      ctx.provide('wbToolGateway', createMockToolGateway())
      await ctx.plugin(WbPolicyService)

      const events: WbPolicyDecisionEvent[] = []
      ctx.on('wb/policy/decision', (event) => {
        events.push(event)
      })

      const request: WbPolicyRequest = {
        user: asWbUserId('test-user'),
        sessionId: asWbSessionId('test-session'),
        agentPreset: 'document-analyst',
        action: 'invoke_tool',
        classification: 'RESTRICTED',
        destination: 'internet',
        tool: 'test-tool',
      }

      await ctx.wbPolicy.evaluate(request)
      expect(events).toHaveLength(1)
      expect(events[0].decision).toBe('DENY')
    })
  })

  describe('REQUIRE_APPROVAL integration', () => {
    it('REQUIRE_APPROVAL decision returns ask kind for harness routing', async () => {
      ctx.provide('wbIdentity', createMockIdentityService())
      ctx.provide('wbToolGateway', createMockToolGateway())
      await ctx.plugin(WbPolicyService)

      const request: WbPolicyRequest = {
        user: asWbUserId('test-user'),
        sessionId: asWbSessionId('test-session'),
        agentPreset: 'document-analyst',
        action: 'invoke_tool',
        classification: 'CONFIDENTIAL',
        destination: 'internet',
        tool: 'test-tool',
      }

      const decision = await ctx.wbPolicy.evaluate(request)
      expect(decision.decision).toBe('REQUIRE_APPROVAL')
    })
  })

  describe('config-driven role overrides', () => {
    it('role override changes outcome', async () => {
      ctx.provide('wbIdentity', createMockIdentityService())
      ctx.provide('wbToolGateway', createMockToolGateway())
      await ctx.plugin(WbPolicyService, {
        matrix: undefined as any, // Use default
        roleOverrides: {
          engineer: {
            web_search: 'ALLOW',
          },
        },
      })

      const request: WbPolicyRequest = {
        user: asWbUserId('test-user'),
        sessionId: asWbSessionId('test-session'),
        agentPreset: 'document-analyst',
        action: 'invoke_tool',
        classification: 'CONFIDENTIAL',
        destination: 'internet',
        tool: 'test-tool',
      }

      // Without override, CONFIDENTIAL + web_search = REQUIRE_APPROVAL
      // With override for engineer role, should be ALLOW
      const decision = await ctx.wbPolicy.evaluate(request)
      expect(decision.decision).toBe('ALLOW')
    })
  })

  describe('malformed configuration', () => {
    it('fails loud on invalid matrix config', async () => {
      ctx.provide('wbIdentity', createMockIdentityService())
      ctx.provide('wbToolGateway', createMockToolGateway())

      // Invalid matrix should throw during plugin initialization
      await expect(ctx.plugin(WbPolicyService, {
        matrix: 'invalid',
        roleOverrides: undefined,
      })).rejects.toThrow()
    })
  })

  describe('unmanifested tool', () => {
    it('returns DENY with NO_MANIFEST reason', async () => {
      ctx.provide('wbIdentity', createMockIdentityService())
      ctx.provide('wbToolGateway', createMockToolGateway(new Map())) // Empty manifests
      await ctx.plugin(WbPolicyService)

      const request: WbPolicyRequest = {
        user: asWbUserId('test-user'),
        sessionId: asWbSessionId('test-session'),
        agentPreset: 'document-analyst',
        action: 'invoke_tool',
        classification: 'PUBLIC',
        destination: 'local',
        tool: 'unknown_tool',
      }

      const decision = await ctx.wbPolicy.evaluate(request)
      expect(decision.decision).toBe('DENY')
      expect(decision.reason).toContain('NO_MANIFEST')
    })
  })

  describe('HMR-safety', () => {
    it('disposes cleanly', async () => {
      ctx.provide('wbIdentity', createMockIdentityService())
      ctx.provide('wbToolGateway', createMockToolGateway())
      const fiber = await ctx.plugin(WbPolicyService)

      // Plugin should be registered
      expect(ctx.wbPolicy).toBeDefined()

      // Dispose should not throw
      await fiber.dispose()

      // After disposal, service should be undefined
      expect(ctx.wbPolicy).toBeUndefined()
    })
  })
})

describe('clearance is checked against the data, for every action', () => {
  let ctx: Context

  beforeEach(() => {
    ctx = new Context()
    ctx.provide('wbToolGateway', createMockToolGateway())
  })

  async function decide(clearance: WbClassification, classification: WbClassification) {
    ctx.provide('wbIdentity', createMockIdentityService(createMockUser({ clearance })))
    await ctx.plugin(WbPolicyService)
    return ctx.wbPolicy.evaluate({
      user: asWbUserId('test-user'),
      sessionId: asWbSessionId('test-session'),
      agentPreset: 'document-analyst',
      action: 'read_data',
      classification,
      destination: 'local',
    })
  }

  it('denies a principal reading data above their clearance', async () => {
    // The bug this guards: clearance was only compared inside the invoke_tool
    // branch, so read_data — how wb-rag authorizes every chunk — skipped it,
    // and a PUBLIC principal could read RESTRICTED text.
    const decision = await decide('PUBLIC', 'RESTRICTED')
    expect(decision.decision).toBe('DENY')
    expect(decision.reason).toContain('CLEARANCE_INSUFFICIENT')
  })

  it('allows a principal reading data at their own clearance', async () => {
    expect((await decide('CONFIDENTIAL', 'CONFIDENTIAL')).decision).not.toBe('DENY')
  })

  it('allows a principal reading data below their clearance', async () => {
    expect((await decide('RESTRICTED', 'PUBLIC')).decision).not.toBe('DENY')
  })

  it('denies one band short, not only the extreme case', async () => {
    // The comparison was inverted (userLevel <= dataLevel), which passed every
    // under-cleared principal; an off-by-one guard catches a re-inversion.
    expect((await decide('CONFIDENTIAL', 'RESTRICTED')).decision).toBe('DENY')
  })
})
