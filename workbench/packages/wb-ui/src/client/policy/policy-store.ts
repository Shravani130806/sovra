/**
 * Live policy state behind the security indicator.
 *
 * DESIGN.md §6.10 requires a persistent "Local / Sovereign" badge that flips
 * to "External request blocked by policy" the moment a `DENY` fires for the
 * active session. That requires state that can actually change: a hook
 * returning a hardcoded `'ALLOW'` narrows to a single literal, which makes the
 * `DENY` and `REQUIRE_APPROVAL` branches unreachable and the badge permanently
 * green — asserting sovereignty the runtime has not verified.
 *
 * This store holds the last decision seen for the active session and lets the
 * transport publish into it. It deliberately does NOT open its own connection:
 * `wb-ui` is a leaf that consumes the harness SDK's event stream, and wiring
 * that stream to {@link publishPolicyDecision} is the one integration point.
 * @module @mrpl/dsh-workbench-ui/client/policy/policy-store
 */

import type { WbDecisionKind, WbPolicyDecisionEvent } from '@mrpl/dsh-workbench-types'

/** What the security indicator renders from. */
export interface PolicyState {
  /** The most recent decision for the active session. */
  decision: WbDecisionKind
  /** Whether every decision so far kept work on-premise. */
  isLocal: boolean
  /** A request is in flight and no decision has settled yet. */
  isProcessing: boolean
  /** The reason carried by the last decision, for the badge tooltip. */
  reason: string
}

/**
 * The state before any decision arrives.
 *
 * `isLocal` starts true because a session that has made no request has sent
 * nothing off-premise. It becomes false only when a decision says otherwise —
 * it is never assumed back to true.
 */
export const INITIAL_POLICY_STATE: PolicyState = {
  decision: 'ALLOW',
  isLocal: true,
  isProcessing: false,
  reason: 'Local computation only',
}

let state: PolicyState = INITIAL_POLICY_STATE
const listeners = new Set<() => void>()

/** Destinations that leave the premises; anything else is on-premise work. */
const OFF_PREMISE: ReadonlySet<string> = new Set(['internet', 'external_api'])

/**
 * Subscribe to policy-state changes.
 * @param listener - called after each change; read the value with {@link getPolicyState}.
 * @returns the unsubscribe function.
 */
export function subscribePolicyState(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * Read the current policy state.
 * @returns the current value; identity is stable until it actually changes.
 */
export function getPolicyState(): PolicyState {
  return state
}

/** Publish the new state and wake every subscriber. */
function commit(next: PolicyState): void {
  state = next
  for (const listener of listeners) listener()
}

/**
 * Record that a request is in flight, before any decision has settled.
 *
 * Leaves `decision` and `isLocal` untouched: a pending request is not evidence
 * that the previous verdict was wrong.
 */
export function markPolicyProcessing(): void {
  commit({ ...state, isProcessing: true })
}

/**
 * Apply one `wb/policy/decision` event to the indicator.
 *
 * The transport calls this for every decision, ALLOW included — DESIGN.md §9
 * invariant 4 makes a positive decision just as observable as a negative one.
 *
 * `isLocal` is one-way within a session: once a request has been evaluated for
 * an off-premise destination, the session is no longer purely sovereign and a
 * later local ALLOW must not silently restore the green badge.
 * @param event - the decision as published by `wb-policy`.
 */
export function publishPolicyDecision(event: WbPolicyDecisionEvent): void {
  const wentOffPremise = OFF_PREMISE.has(event.destination) && event.decision !== 'DENY'
  commit({
    decision: event.decision,
    isLocal: state.isLocal && !wentOffPremise,
    isProcessing: false,
    reason: event.reason,
  })
}

/**
 * Reset to {@link INITIAL_POLICY_STATE}.
 *
 * For session switches and for tests; the badge must not carry one session's
 * verdict into another.
 */
export function resetPolicyState(): void {
  commit(INITIAL_POLICY_STATE)
}
