import { describe, expect, it, beforeEach } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import {
  asWbAuditEntryId,
  asWbSessionId,
  asWbUserId,
  type WbAuditEntry,
  type WbPolicyService,
} from '@mrpl/dsh-workbench-types'
import WbPolicyService_ from '@mrpl/dsh-workbench-policy'
import {
  countDashboard,
  decisionsByUser,
  securityFeed,
  UNATTRIBUTED,
} from '../src/client/dashboard-model.ts'
import {
  clearCapability,
  commitOverride,
  effectiveDecisions,
} from '../src/client/override-editor.ts'

let seq = 0
function entry(overrides: Partial<WbAuditEntry> = {}): WbAuditEntry {
  seq++
  return {
    id: asWbAuditEntryId(`e${seq}`),
    at: `2026-08-28T10:00:${String(seq).padStart(2, '0')}.000Z`,
    sessionId: asWbSessionId('s1'),
    userId: asWbUserId('u1'),
    kind: 'policy_decision',
    summary: 'decision',
    payload: { decision: 'ALLOW' },
    ...overrides,
  }
}

function decision(kind: string, over: Partial<WbAuditEntry> = {}): WbAuditEntry {
  return entry({ kind: 'policy_decision', payload: { decision: kind }, ...over })
}

describe('dashboard counters', () => {
  it('all five read zero for an empty log, rather than breaking', () => {
    expect(countDashboard([])).toEqual({
      users: 0,
      activeAgents: 0,
      documents: 0,
      policyDecisions: 0,
      blockedRequests: 0,
    })
  })

  it('counts distinct users and sessions, not entry volume', () => {
    const entries = [
      decision('ALLOW', { userId: asWbUserId('u1'), sessionId: asWbSessionId('s1') }),
      decision('ALLOW', { userId: asWbUserId('u1'), sessionId: asWbSessionId('s1') }),
      decision('ALLOW', { userId: asWbUserId('u2'), sessionId: asWbSessionId('s2') }),
    ]
    const counters = countDashboard(entries)
    expect(counters.users).toBe(2)
    expect(counters.activeAgents).toBe(2)
    expect(counters.policyDecisions).toBe(3)
  })

  it('excludes the unattributed placeholder from users and agents', () => {
    // wb-audit records ingestion under `unattributed` because §7.4 does not
    // attribute it; counting it would invent a user and an agent that
    // never existed.
    const entries = [
      entry({
        kind: 'ingestion_completed',
        userId: asWbUserId(UNATTRIBUTED),
        sessionId: asWbSessionId(UNATTRIBUTED),
        payload: { documentId: 'doc-1', classification: 'INTERNAL' },
      }),
    ]
    const counters = countDashboard(entries)
    expect(counters.users).toBe(0)
    expect(counters.activeAgents).toBe(0)
    expect(counters.documents).toBe(1)
  })

  it('counts distinct documents, so re-ingesting one does not inflate the figure', () => {
    const entries = [
      entry({ kind: 'ingestion_completed', payload: { documentId: 'doc-1' } }),
      entry({ kind: 'ingestion_completed', payload: { documentId: 'doc-1' } }),
      entry({ kind: 'ingestion_completed', payload: { documentId: 'doc-2' } }),
    ]
    expect(countDashboard(entries).documents).toBe(2)
  })

  it('counts only DENY as a blocked request', () => {
    const entries = [
      decision('ALLOW'),
      decision('DENY'),
      decision('DENY'),
      decision('REQUIRE_APPROVAL'),
      decision('ALLOW_WITH_REDACTION'),
    ]
    const counters = countDashboard(entries)
    expect(counters.policyDecisions).toBe(5)
    expect(counters.blockedRequests).toBe(2)
  })

  it('does not count tool results or session events as policy decisions', () => {
    // The figure names policy decisions; padding it with ordinary activity
    // would make the governance layer look busier than it is.
    const entries = [
      decision('ALLOW'),
      entry({ kind: 'tool_result', payload: {} }),
      entry({ kind: 'session_event', payload: {} }),
      entry({ kind: 'rag_retrieval', payload: {} }),
    ]
    expect(countDashboard(entries).policyDecisions).toBe(1)
  })
})

describe('security feed', () => {
  it('carries policy decisions and overrides, and nothing else', () => {
    const entries = [
      decision('DENY'),
      entry({ kind: 'policy_override', payload: { role: 'r' } }),
      entry({ kind: 'tool_result', payload: {} }),
      entry({ kind: 'rag_retrieval', payload: {} }),
    ]
    expect(securityFeed(entries)).toHaveLength(2)
  })

  it('orders newest first', () => {
    const older = decision('ALLOW', { at: '2026-08-28T09:00:00.000Z', id: asWbAuditEntryId('old') })
    const newer = decision('DENY', { at: '2026-08-28T11:00:00.000Z', id: asWbAuditEntryId('new') })
    const feed = securityFeed([older, newer])
    expect(feed[0]!.id).toBe('new')
    expect(feed[1]!.id).toBe('old')
  })

  it('marks a DENY as blocked and everything else as not', () => {
    const feed = securityFeed([
      decision('DENY'),
      decision('ALLOW'),
      decision('REQUIRE_APPROVAL'),
    ])
    const byDecision = new Map(feed.map((f) => [f.decision, f.blocked]))
    expect(byDecision.get('DENY')).toBe(true)
    expect(byDecision.get('ALLOW')).toBe(false)
    expect(byDecision.get('REQUIRE_APPROVAL')).toBe(false)
  })

  it('an override row has no decision but still appears', () => {
    const feed = securityFeed([entry({ kind: 'policy_override', payload: { role: 'r' } })])
    expect(feed[0]!.decision).toBeUndefined()
    expect(feed[0]!.blocked).toBe(false)
  })

  it('honours a row limit', () => {
    const entries = Array.from({ length: 10 }, () => decision('ALLOW'))
    expect(securityFeed(entries, 3)).toHaveLength(3)
  })
})

describe('per-user decisions', () => {
  it('ranks the most-blocked principal first', () => {
    const entries = [
      decision('ALLOW', { userId: asWbUserId('quiet') }),
      decision('DENY', { userId: asWbUserId('blocked') }),
      decision('DENY', { userId: asWbUserId('blocked') }),
      decision('ALLOW', { userId: asWbUserId('blocked') }),
    ]
    const rows = decisionsByUser(entries)
    expect(rows[0]).toEqual({ userId: 'blocked', total: 3, blocked: 2 })
    expect(rows[1]).toEqual({ userId: 'quiet', total: 1, blocked: 0 })
  })
})

describe('override write path', () => {
  let ctx: Context
  let policy: WbPolicyService

  beforeEach(async () => {
    ctx = new Context()
    ctx.provide('wbIdentity', { current: () => undefined })
    ctx.provide('wbToolGateway', { registerManifest() {}, getManifest: () => undefined })
    await ctx.plugin(WbPolicyService_)
    policy = ctx.wbPolicy
  })

  it('writes into wb-policy itself, so evaluate() sees the change', () => {
    // §6.11: the console must not keep a second policy table.
    const result = commitOverride(policy, {
      role: 'process-engineer',
      capability: 'web_search',
      decision: 'DENY',
    })
    expect(result.ok).toBe(true)
    expect(policy.governance().roleOverrides['process-engineer']).toEqual({ web_search: 'DENY' })
  })

  it('keeps a role’s other overrides when one capability is edited', () => {
    commitOverride(policy, { role: 'r', capability: 'web_search', decision: 'DENY' })
    commitOverride(policy, { role: 'r', capability: 'external_api', decision: 'REQUIRE_APPROVAL' })
    expect(policy.governance().roleOverrides['r']).toEqual({
      web_search: 'DENY',
      external_api: 'REQUIRE_APPROVAL',
    })
  })

  it('rejects an empty role with a message, not a silent no-op', () => {
    const result = commitOverride(policy, { role: '   ', capability: 'web_search', decision: 'DENY' })
    expect(result.ok).toBe(false)
    expect(result.ok ? '' : result.error).toMatch(/empty/i)
  })

  it('rejects an unknown capability rather than storing an override that can never match', () => {
    const result = commitOverride(policy, {
      role: 'r',
      capability: 'not_a_capability' as never,
      decision: 'DENY',
    })
    expect(result.ok).toBe(false)
    expect(policy.governance().roleOverrides['r']).toBeUndefined()
  })

  it('rejects an unknown decision kind', () => {
    const result = commitOverride(policy, {
      role: 'r',
      capability: 'web_search',
      decision: 'MAYBE' as never,
    })
    expect(result.ok).toBe(false)
  })

  it('a refused write leaves the standing table untouched', () => {
    commitOverride(policy, { role: 'r', capability: 'web_search', decision: 'DENY' })
    commitOverride(policy, { role: 'r', capability: 'bogus' as never, decision: 'ALLOW' })
    expect(policy.governance().roleOverrides['r']).toEqual({ web_search: 'DENY' })
  })

  it('clearing the last capability removes the role entirely', () => {
    commitOverride(policy, { role: 'r', capability: 'web_search', decision: 'DENY' })
    clearCapability(policy, 'r', 'web_search')
    expect(policy.governance().roleOverrides['r']).toBeUndefined()
  })

  it('clearing one capability leaves the rest in force', () => {
    commitOverride(policy, { role: 'r', capability: 'web_search', decision: 'DENY' })
    commitOverride(policy, { role: 'r', capability: 'external_api', decision: 'DENY' })
    clearCapability(policy, 'r', 'web_search')
    expect(policy.governance().roleOverrides['r']).toEqual({ external_api: 'DENY' })
  })

  it('governance() hands back a copy, so rendering cannot mutate live policy', () => {
    commitOverride(policy, { role: 'r', capability: 'web_search', decision: 'DENY' })
    const snapshot = policy.governance()
    snapshot.roleOverrides['r']!.web_search = 'ALLOW'
    expect(policy.governance().roleOverrides['r']).toEqual({ web_search: 'DENY' })
  })

  it('publishes wb/policy/override-changed, so a governance edit is auditable', () => {
    // §9 invariant 4 covers governance changes too, not only decisions.
    const seen: Array<{ role: string }> = []
    ctx.on('wb/policy/override-changed', (event) => {
      seen.push(event)
    })
    commitOverride(policy, { role: 'r', capability: 'web_search', decision: 'DENY' })
    expect(seen).toHaveLength(1)
    expect(seen[0]!.role).toBe('r')
  })
})

describe('effective decisions', () => {
  let ctx: Context
  let policy: WbPolicyService

  beforeEach(async () => {
    ctx = new Context()
    ctx.provide('wbIdentity', { current: () => undefined })
    ctx.provide('wbToolGateway', { registerManifest() {}, getManifest: () => undefined })
    await ctx.plugin(WbPolicyService_)
    policy = ctx.wbPolicy
  })

  it('reports the matrix value when no override applies', () => {
    const rows = effectiveDecisions(policy, 'nobody', 'RESTRICTED')
    const webSearch = rows.find((r) => r.capability === 'web_search')!
    expect(webSearch.overridden).toBe(false)
    expect(webSearch.decision).toBe('DENY')
  })

  it('reports the override, marked as such, when one applies', () => {
    commitOverride(policy, { role: 'r', capability: 'web_search', decision: 'ALLOW' })
    const webSearch = effectiveDecisions(policy, 'r', 'RESTRICTED').find(
      (row) => row.capability === 'web_search',
    )!
    expect(webSearch.decision).toBe('ALLOW')
    expect(webSearch.overridden).toBe(true)
  })

  it('covers every capability in the matrix row', () => {
    expect(effectiveDecisions(policy, 'r', 'PUBLIC')).toHaveLength(7)
  })
})
