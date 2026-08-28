/**
 * Concrete {@link SessionPrincipalProvider} implementations.
 *
 * `wb-identity` shapes whatever principal the deployment already
 * authenticates; it does not authenticate anyone itself (§6.1 non-goals). What
 * differs between deployments is only *where* the already-authenticated
 * username arrives from, which is what these providers select between.
 *
 * Every one of them fails closed: an absent or unreadable principal returns
 * `undefined`, identity never resolves, and `wb-policy` denies. None of them
 * can invent a user.
 * @module @mrpl/dsh-workbench-identity/principal-providers
 */

import { readFileSync } from 'node:fs'
import type { WbSessionId } from '@mrpl/dsh-workbench-types'
import type { SessionPrincipalProvider } from './types.ts'

/**
 * Resolve the principal from a header a reverse proxy or SSO layer sets.
 *
 * The standard on-premise deployment: an authenticating proxy in front of the
 * workbench (nginx `auth_request`, oauth2-proxy, Kerberos SSO) stamps the
 * authenticated username on each request, and the workbench trusts only that
 * header. It is therefore **only** as trustworthy as the proxy — a deployment
 * that exposes the workbench port directly must not use this provider, since
 * a caller could set the header themselves.
 */
export class HeaderSessionPrincipalProvider implements SessionPrincipalProvider {
  private readonly bySession = new Map<WbSessionId, string>()

  constructor(private readonly headerName: string) {}

  /**
   * Record the principal a proxy asserted for one session.
   *
   * Called by the transport layer when a session is established. Sessions are
   * long-lived while a request's headers are not, so the value is bound once
   * at session start rather than re-read per call.
   * @param sessionId - the session being opened.
   * @param headers - the request headers the proxy stamped.
   */
  bind(sessionId: WbSessionId, headers: Record<string, string | undefined>): void {
    // Header names are case-insensitive per RFC 9110; transports normalize
    // inconsistently, so match without regard to case rather than trusting one
    // spelling and silently resolving nobody.
    const wanted = this.headerName.toLowerCase()
    for (const [name, value] of Object.entries(headers)) {
      if (name.toLowerCase() === wanted && value && value.trim() !== '') {
        this.bySession.set(sessionId, value.trim())
        return
      }
    }
  }

  /** Forget a session's principal when it ends. */
  release(sessionId: WbSessionId): void {
    this.bySession.delete(sessionId)
  }

  getPrincipal(sessionId: WbSessionId): string | undefined {
    return this.bySession.get(sessionId)
  }
}

/**
 * Resolve every session to one principal named by an environment variable.
 *
 * For single-operator deployments and demo machines, where the workbench runs
 * as one known engineer and there is no proxy to ask. It is deliberately not
 * the default: it gives every session the same identity, so the audit trail
 * cannot distinguish who did what.
 */
export class EnvSessionPrincipalProvider implements SessionPrincipalProvider {
  private readonly principal: string | undefined

  constructor(variableName: string, env: NodeJS.ProcessEnv = process.env) {
    const value = env[variableName]
    this.principal = value && value.trim() !== '' ? value.trim() : undefined
  }

  getPrincipal(_sessionId: WbSessionId): string | undefined {
    return this.principal
  }
}

/**
 * Resolve principals from a file mapping session id to username.
 *
 * For automation and integration environments that establish sessions out of
 * band. Re-read on every lookup so an operator can correct a mapping without
 * restarting; a missing or malformed file resolves nobody rather than throwing,
 * because an identity provider that crashes takes the whole gate down with it.
 */
export class FileSessionPrincipalProvider implements SessionPrincipalProvider {
  constructor(private readonly path: string) {}

  getPrincipal(sessionId: WbSessionId): string | undefined {
    let raw: string
    try {
      raw = readFileSync(this.path, 'utf8')
    } catch {
      // Unreadable mapping file: no principal, so policy denies. Deliberately
      // not a throw — see the class note.
      return undefined
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      // Malformed mapping file: same reasoning as above.
      return undefined
    }
    if (typeof parsed !== 'object' || parsed === null) return undefined
    const value = (parsed as Record<string, unknown>)[sessionId]
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
  }
}
