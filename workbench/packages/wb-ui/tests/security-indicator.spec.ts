import { describe, expect, it, beforeEach } from 'vitest'
import type { WbDecisionKind, WbPolicyDecisionEvent } from '@mrpl/dsh-workbench-types'
import { asWbUserId } from '@mrpl/dsh-workbench-types'
import { badgeFor } from '../src/client/components/SecurityIndicator.tsx'
import {
  getPolicyState,
  markPolicyProcessing,
  publishPolicyDecision,
  resetPolicyState,
  subscribePolicyState,
} from '../src/client/policy/policy-store.ts'

const ALL_DECISIONS: WbDecisionKind[] = [
  'ALLOW',
  'DENY',
  'REQUIRE_APPROVAL',
  'ALLOW_WITH_REDACTION',
  'ALLOW_METADATA_ONLY',
]

function decisionEvent(overrides: Partial<WbPolicyDecisionEvent> = {}): WbPolicyDecisionEvent {
  return {
    user: asWbUserId('u1'),
    agentPreset: 'document-analyst',
    action: 'invoke_tool',
    classification: 'INTERNAL',
    destination: 'local',
    decision: 'ALLOW',
    reason: 'within clearance',
    ...overrides,
  } as WbPolicyDecisionEvent
}

describe('policy store', () => {
  beforeEach(() => {
    resetPolicyState()
  })

  it('starts sovereign, because a session that made no request sent nothing off-premise', () => {
    expect(getPolicyState()).toMatchObject({ isLocal: true, isProcessing: false, decision: 'ALLOW' })
  })

  it('records every decision kind the frozen union defines', () => {
    for (const decision of ALL_DECISIONS) {
      resetPolicyState()
      publishPolicyDecision(decisionEvent({ decision }))
      expect(getPolicyState().decision, decision).toBe(decision)
    }
  })

  it('publishes ALLOW too, not only denials', () => {
    // Invariant 4: a positive decision is as observable as a negative one.
    publishPolicyDecision(decisionEvent({ decision: 'ALLOW', reason: 'clearance met' }))
    expect(getPolicyState().reason).toBe('clearance met')
  })

  it('clears the processing flag once a decision settles', () => {
    markPolicyProcessing()
    expect(getPolicyState().isProcessing).toBe(true)
    publishPolicyDecision(decisionEvent())
    expect(getPolicyState().isProcessing).toBe(false)
  })

  it('a pending request does not overwrite the previous verdict', () => {
    publishPolicyDecision(decisionEvent({ decision: 'DENY', reason: 'blocked' }))
    markPolicyProcessing()
    expect(getPolicyState().decision).toBe('DENY')
  })

  describe('isLocal is one-way within a session', () => {
    it('stays true while every decision is local', () => {
      publishPolicyDecision(decisionEvent({ destination: 'local' }))
      publishPolicyDecision(decisionEvent({ destination: 'internal' }))
      expect(getPolicyState().isLocal).toBe(true)
    })

    it('goes false once an allowed request reaches the internet', () => {
      publishPolicyDecision(decisionEvent({ destination: 'internet', decision: 'ALLOW' }))
      expect(getPolicyState().isLocal).toBe(false)
    })

    it('goes false for an allowed external API call', () => {
      publishPolicyDecision(decisionEvent({ destination: 'external_api', decision: 'ALLOW' }))
      expect(getPolicyState().isLocal).toBe(false)
    })

    it('stays true when an off-premise request was DENIED — nothing left', () => {
      publishPolicyDecision(decisionEvent({ destination: 'internet', decision: 'DENY' }))
      expect(getPolicyState().isLocal).toBe(true)
    })

    it('never returns to true after a later local allow', () => {
      // The whole point: one egress must not be laundered back to green.
      publishPolicyDecision(decisionEvent({ destination: 'internet', decision: 'ALLOW' }))
      publishPolicyDecision(decisionEvent({ destination: 'local', decision: 'ALLOW' }))
      expect(getPolicyState().isLocal).toBe(false)
    })
  })

  describe('subscriptions', () => {
    it('notifies subscribers on each decision', () => {
      let calls = 0
      const unsubscribe = subscribePolicyState(() => {
        calls++
      })
      publishPolicyDecision(decisionEvent())
      publishPolicyDecision(decisionEvent({ decision: 'DENY' }))
      expect(calls).toBe(2)
      unsubscribe()
    })

    it('stops notifying after unsubscribe', () => {
      let calls = 0
      const unsubscribe = subscribePolicyState(() => {
        calls++
      })
      unsubscribe()
      publishPolicyDecision(decisionEvent())
      expect(calls).toBe(0)
    })

    it('resetPolicyState clears one session before the next', () => {
      publishPolicyDecision(decisionEvent({ destination: 'internet', decision: 'DENY' }))
      resetPolicyState()
      expect(getPolicyState()).toMatchObject({ decision: 'ALLOW', isLocal: true })
    })
  })
})

describe('security indicator badge', () => {
  it('maps every decision kind — none falls through to a generic allow', () => {
    for (const decision of ALL_DECISIONS) {
      expect(() => badgeFor(decision), decision).not.toThrow()
    }
  })

  it('DENY is the blocked badge, which is the DESIGN.md §6.10 requirement', () => {
    expect(badgeFor('DENY')).toEqual({ tone: 'blocked', label: 'External request blocked' })
  })

  it('a redacted or metadata-only allow is NOT shown as unrestricted external access', () => {
    // The bug this guards: both used to fall through to "External Access
    // Allowed", presenting a withheld-content decision as an open one.
    expect(badgeFor('ALLOW_WITH_REDACTION').tone).toBe('partial')
    expect(badgeFor('ALLOW_METADATA_ONLY').tone).toBe('partial')
    expect(badgeFor('ALLOW_WITH_REDACTION').label).not.toBe('External Access Allowed')
    expect(badgeFor('ALLOW_METADATA_ONLY').label).not.toBe('External Access Allowed')
  })

  it('every decision kind gets a distinct label', () => {
    const labels = ALL_DECISIONS.map((d) => badgeFor(d).label)
    expect(new Set(labels).size).toBe(labels.length)
  })
})
