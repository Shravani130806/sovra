/**
 * Plugin-local types for wb-identity.
 *
 * The {@link SessionPrincipalProvider} interface is the seam for "how a raw
 * principal string arrives on the session." The harness has no authenticated
 * identity concept (see DESIGN.md §12 gap); this interface lets the plugin
 * consume whatever principal the deployment's transport attaches, without
 * guessing at harness internals.
 *
 * This interface is NOT exposed via `ctx` — it is a constructor-level
 * dependency of the plugin, not a shared workbench service.
 *
 * @module
 */

import type { WbSessionId } from '@mrpl/dsh-workbench-types'

/**
 * Maps a session to the raw principal string the deployment's transport
 * attached (e.g., from a reverse-proxy header, SSO callback, or CLI flag).
 *
 * Implementations are internal to `wb-identity`; they are NOT shared via `ctx`
 * and other plugins must not depend on them.
 */
export interface SessionPrincipalProvider {
  /**
   * Return the raw principal string for the given session, or `undefined` if
   * no principal is available (e.g., anonymous access, transport not wired).
   */
  getPrincipal(sessionId: WbSessionId): string | undefined
}

/**
 * Default provider that always returns `undefined` — no principal is available.
 *
 * This is the safe production baseline: identity never resolves → `wb-policy`
 * denies everything. Deployments wire a real provider (reverse-proxy header
 * injection, SSO callback) to replace this.
 */
export class NullSessionPrincipalProvider implements SessionPrincipalProvider {
  getPrincipal(_sessionId: WbSessionId): string | undefined {
    return undefined
  }
}

/**
 * Configurable provider that checks:
 * 1. Runtime environment variables (`DSH_USER` or `SOVRA_USER`)
 * 2. Static default configured in cordis.yml / plugin config (`defaultPrincipal`)
 * 3. Fallback `undefined` if unconfigured.
 */
export class ConfigurableSessionPrincipalProvider implements SessionPrincipalProvider {
  private readonly defaultPrincipal?: string | undefined

  constructor(defaultPrincipal?: string | undefined) {
    this.defaultPrincipal = defaultPrincipal
  }

  getPrincipal(_sessionId: WbSessionId): string | undefined {
    if (typeof process !== 'undefined' && process.env) {
      const envUser = process.env.DSH_USER || process.env.SOVRA_USER
      if (envUser && envUser.trim() !== '') {
        return envUser.trim()
      }
    }
    return this.defaultPrincipal
  }
}
