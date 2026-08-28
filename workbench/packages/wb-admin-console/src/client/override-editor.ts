/**
 * The console's write path into policy state.
 *
 * §6.11 permits exactly one: edits go to `wb-policy`'s own override table, the
 * same one `evaluate()` reads. There is deliberately no local copy that could
 * drift from what is enforced, and no second decision path.
 * @module @mrpl/dsh-workbench-admin-console/client/override-editor
 */

import type {
  WbCapability,
  WbClassification,
  WbDecisionKind,
  WbPolicyService,
  WbRoleOverrides,
} from '@mrpl/dsh-workbench-types'

/** One pending, uncommitted edit in the console's table. */
export interface DraftOverride {
  role: string
  capability: WbCapability
  decision: WbDecisionKind
}

/** What happened when a draft was committed. */
export type CommitResult =
  | { ok: true; role: string; overrides: WbRoleOverrides }
  | { ok: false; role: string; error: string }

/**
 * Apply one draft to the live override table.
 *
 * Reads the current overrides back from `wb-policy` before writing rather than
 * from anything the console cached, so two admins editing at once cannot have
 * one silently discard the other's untouched capabilities.
 *
 * Rejection is returned, never thrown: an invalid role or capability must
 * surface in the UI as a clear message, and a policy write that fails must not
 * look like one that succeeded.
 * @param policy - the live policy service.
 * @param draft - the edit to apply.
 * @returns the committed overrides, or the reason the write was refused.
 */
export function commitOverride(policy: WbPolicyService, draft: DraftOverride): CommitResult {
  const role = draft.role.trim()
  if (!role) return { ok: false, role: draft.role, error: 'Role name cannot be empty.' }

  try {
    const current = policy.governance().roleOverrides[role] ?? {}
    policy.setRoleOverride(role, { ...current, [draft.capability]: draft.decision })
    return { ok: true, role, overrides: policy.governance().roleOverrides }
  } catch (error) {
    return { ok: false, role, error: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Drop one capability from a role, leaving the rest in force.
 *
 * Clears the whole role when that was its last override, so a role with no
 * overrides does not linger as an empty row implying it has some.
 * @param policy - the live policy service.
 * @param role - the role to edit.
 * @param capability - the capability to stop overriding.
 * @returns the resulting overrides, or the reason the write was refused.
 */
export function clearCapability(
  policy: WbPolicyService,
  role: string,
  capability: WbCapability,
): CommitResult {
  try {
    const current = policy.governance().roleOverrides[role]
    if (!current || !(capability in current)) {
      return { ok: true, role, overrides: policy.governance().roleOverrides }
    }
    const { [capability]: _dropped, ...rest } = current
    policy.setRoleOverride(role, Object.keys(rest).length > 0 ? rest : undefined)
    return { ok: true, role, overrides: policy.governance().roleOverrides }
  } catch (error) {
    return { ok: false, role, error: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * What a role's requests actually resolve to, matrix and overrides combined.
 *
 * The console shows the effective value rather than the two layers separately,
 * because an admin asking "what can this role do" is asking about the outcome.
 * @param policy - the live policy service.
 * @param role - the role to resolve.
 * @param classification - the data band to resolve against.
 * @returns each capability's decision, and whether an override supplied it.
 */
export function effectiveDecisions(
  policy: WbPolicyService,
  role: string,
  classification: WbClassification,
): Array<{ capability: WbCapability; decision: WbDecisionKind; overridden: boolean }> {
  const { matrix, roleOverrides } = policy.governance()
  const row = matrix[classification] ?? {}
  const override = roleOverrides[role] ?? {}

  return (Object.keys(row) as WbCapability[]).map((capability) => {
    const overridden = capability in override
    return {
      capability,
      decision: overridden ? override[capability]! : row[capability],
      overridden,
    }
  })
}
