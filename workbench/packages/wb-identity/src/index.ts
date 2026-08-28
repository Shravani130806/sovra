/**
 * wb-identity — Identity & RBAC plugin.
 *
 * Turns "who is logged in" into a structured {@link WbUser} object every other
 * workbench plugin can reason about, and makes session identity resolution an
 * event other plugins (especially `wb-policy`) can depend on having already
 * happened.
 *
 * @module
 */

import { Context, Service } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import type { Session } from '@deepseek-ai/dsh-session'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import {
  asWbSessionId,
  type WbIdentityService,
  type WbIdentityResolvedEvent,
  type WbUser,
  type WbSessionId,
} from '@mrpl/dsh-workbench-types'
import { join } from 'node:path'

import {
  type SessionPrincipalProvider,
  NullSessionPrincipalProvider,
} from './types.ts'
import {
  EnvSessionPrincipalProvider,
  FileSessionPrincipalProvider,
  HeaderSessionPrincipalProvider,
} from './principal-providers.ts'

export {
  EnvSessionPrincipalProvider,
  FileSessionPrincipalProvider,
  HeaderSessionPrincipalProvider,
} from './principal-providers.ts'
import {
  type WbUserDirectoryProvider,
  FileBackedUserDirectory,
} from './user-directory.ts'

// ---------------------------------------------------------------------------
// Declaration merges — provided service + emitted events
// ---------------------------------------------------------------------------

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Identity service: resolve session → WbUser. */
    wbIdentity: WbIdentityService
  }

  interface Events {
    /**
     * Identity resolved for a session, fired once before any tool call.
     * @mode emit
     * @param payload - the resolved session identity
     */
    'wb/identity/resolved'(payload: WbIdentityResolvedEvent): void
  }
}

// ---------------------------------------------------------------------------
// Plugin exports
// ---------------------------------------------------------------------------

export const name = 'wb-identity'
export const inject = [] as const

export interface Config {
  /** Which user-directory provider kind to use. Extensible for future kinds. */
  userDirectory: 'file'
  /** Path to the users.yaml file (supports $DSH_HOME expansion). */
  userDirectoryPath: string
  /**
   * Where an already-authenticated username arrives from.
   *
   * `wb-identity` shapes the principal the deployment authenticates; it does
   * not authenticate anyone (§6.1 non-goals). `null` resolves nobody, so
   * `wb-policy` denies everything — correct as a safe baseline, but it was
   * previously the only option and not selectable, which meant a real
   * deployment could not resolve identity at all without patching the plugin.
   */
  principalSource: 'null' | 'header' | 'env' | 'file'
  /** Header a reverse proxy stamps the username on, for `header`. */
  principalHeader: string
  /** Environment variable naming the single operator, for `env`. */
  principalEnvVar: string
  /** Path to a session-id to username JSON map, for `file`. */
  principalFilePath: string
}

export const Config: Schema<Config> = Schema.object({
  userDirectory: Schema.union(['file']).default('file'),
  userDirectoryPath: Schema.string().default('$DSH_HOME/workbench/users.yaml'),
  principalSource: Schema.union(['null', 'header', 'env', 'file']).default('null'),
  principalHeader: Schema.string().default('x-forwarded-user'),
  principalEnvVar: Schema.string().default('WB_PRINCIPAL'),
  principalFilePath: Schema.string().default('$DSH_HOME/workbench/sessions.json'),
})

// ---------------------------------------------------------------------------
// Service implementation (factored out of apply for testability)
// ---------------------------------------------------------------------------

/**
 * Core identity service: holds the resolved-session cache, subscribes to
 * session lifecycle events, and exposes `current()` as a pure cache read.
 *
 * Factored out of `apply()` so tests can instantiate directly with a stub
 * {@link SessionPrincipalProvider}.
 */
export class WbIdentityServiceImpl extends Service implements WbIdentityService {
  static inject = [] as const

  /**
   * Session → resolved user cache. `undefined` values mean "we tried to
   * resolve this session and could not" — distinct from "not yet resolved"
   * (entry absent from map).
   */
  private readonly resolved = new Map<WbSessionId, WbUser | undefined>()
  private readonly directory: WbUserDirectoryProvider
  private readonly principalProvider: SessionPrincipalProvider

  constructor(
    ctx: Context,
    directory: WbUserDirectoryProvider,
    principalProvider: SessionPrincipalProvider,
  ) {
    super(ctx, 'wbIdentity')
    this.directory = directory
    this.principalProvider = principalProvider

    // Eager resolution on session creation, cache cleanup on disposal
    ctx.effect(() => {
      const unsubCreated = ctx.on('session/created', (session: Session) => {
        this.resolveSession(session)
      })

      const unsubDisposed = ctx.on('session/disposed', (session: Session) => {
        const wbSessionId = asWbSessionId(session.id)
        this.resolved.delete(wbSessionId)
      })

      return () => {
        unsubCreated()
        unsubDisposed()
      }
    }, 'wb-identity')
  }

  /** Pure synchronous cache read — no side effects, no resolution trigger. */
  current(sessionId: WbSessionId): WbUser | undefined {
    return this.resolved.get(sessionId)
  }

  /**
   * Resolve identity for a newly created session. Eager: fires once per
   * session on `session/created`, before any tool call is dispatched.
   * Caches `undefined` for unresolvable cases so we never re-invoke the
   * provider.
   */
  private resolveSession(session: Session): void {
    const wbSessionId = asWbSessionId(session.id)

    // Already resolved (idempotent guard)
    if (this.resolved.has(wbSessionId)) return

    const principal = this.principalProvider.getPrincipal(wbSessionId)
    if (principal === undefined) {
      // Cache the miss — deterministic, no re-invocation
      this.resolved.set(wbSessionId, undefined)
      return
    }

    const user = this.directory.lookup(principal)
    // Cache even if lookup failed — directory miss is final for this session
    this.resolved.set(wbSessionId, user)

    if (user) {
      this.ctx.emit('wb/identity/resolved', {
        sessionId: wbSessionId,
        user,
      })
    }
  }
}

// ---------------------------------------------------------------------------
// apply() — Cordis entrypoint
// ---------------------------------------------------------------------------

/**
 * Build the configured principal provider.
 *
 * Misconfiguration fails at load (§9 invariant 5) rather than resolving nobody
 * at request time, because a silently-empty identity is indistinguishable from
 * a correctly-denied one in the audit log.
 * @param config - the validated plugin configuration.
 * @returns the provider for the selected source.
 * @throws when a source is selected without the setting it requires.
 */
export function createPrincipalProvider(config: Config): SessionPrincipalProvider {
  switch (config.principalSource) {
    case 'header':
      if (!config.principalHeader.trim()) {
        throw new Error('wb-identity: principalSource "header" requires principalHeader')
      }
      return new HeaderSessionPrincipalProvider(config.principalHeader)
    case 'env':
      if (!config.principalEnvVar.trim()) {
        throw new Error('wb-identity: principalSource "env" requires principalEnvVar')
      }
      return new EnvSessionPrincipalProvider(config.principalEnvVar)
    case 'file':
      if (!config.principalFilePath.trim()) {
        throw new Error('wb-identity: principalSource "file" requires principalFilePath')
      }
      return new FileSessionPrincipalProvider(
        config.principalFilePath.replace('$DSH_HOME', resolveDshHome()),
      )
    case 'null':
      return new NullSessionPrincipalProvider()
    default: {
      const never: never = config.principalSource
      throw new Error(`wb-identity: unknown principalSource ${String(never)}`)
    }
  }
}

export function apply(ctx: Context, config: Config): void {
  const dshHome = resolveDshHome()
  const dirPath = config.userDirectoryPath.replace('$DSH_HOME', dshHome)
  const fullPath = join(dirPath)

  let directory: WbUserDirectoryProvider
  try {
    directory = new FileBackedUserDirectory(fullPath)
  } catch (error) {
    throw new Error(
      `wb-identity: failed to load user directory from ${fullPath}: ${String(error)}`,
    )
  }

  new WbIdentityServiceImpl(ctx, directory, createPrincipalProvider(config))
}
