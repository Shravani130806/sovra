/**
 * React binding for the live policy state.
 * @module @mrpl/dsh-workbench-ui/client/policy/use-sovereign-policy
 */

import { useSyncExternalStore } from 'react'
import { getPolicyState, subscribePolicyState, type PolicyState } from './policy-store.ts'

/**
 * Subscribe the calling component to the active session's policy state.
 *
 * Returns the full {@link PolicyState}, so `decision` keeps its
 * `WbDecisionKind` union type and every branch the security indicator renders
 * stays reachable.
 * @returns the current policy state, re-rendering the caller when it changes.
 */
export function useSovereignPolicy(): PolicyState {
  return useSyncExternalStore(subscribePolicyState, getPolicyState, getPolicyState)
}
