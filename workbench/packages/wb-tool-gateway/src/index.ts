/**
 * `wb-tool-gateway` — the tool manifest directory.
 *
 * Answers "what kind of thing is this tool" so `wb-policy` evaluates
 * structured metadata instead of guessing from a tool's name string, and so
 * adding a thirteenth tool never means editing `wb-policy`.
 *
 * This is a **Directory, not an executor**: it makes no ALLOW/DENY decision,
 * hooks no `tools/pre-execute`, and never invents a manifest. `getManifest`
 * for an unknown tool returns `undefined`; turning that into `DENY`
 * (`reason: "NO_MANIFEST"`) is `wb-policy`'s job and it already does it.
 * @module @mrpl/dsh-workbench-tool-gateway
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { WbToolManifest, WbToolGatewayService as WbToolGatewayContract } from '@mrpl/dsh-workbench-types'
import { DEFAULT_HARNESS_MANIFESTS } from './manifests.ts'

export { DEFAULT_HARNESS_MANIFESTS } from './manifests.ts'

export const name = 'wb-tool-gateway'

export const inject = [] as const

/** Deployment configuration for the manifest directory. */
export interface Config {
  /**
   * Seed the directory with {@link DEFAULT_HARNESS_MANIFESTS}.
   *
   * A deployment that governs a non-default toolset, or that wants every
   * harness tool denied until explicitly manifested, sets this false.
   */
  includeHarnessDefaults: boolean
  /**
   * Admin-authored manifests, applied over the defaults by `toolId`.
   *
   * This is the only way to govern a tool whose registered name is chosen at
   * registration time from config — the `subagent` and `workflow` families —
   * since no static default can name them ahead of time.
   */
  staticManifests: WbToolManifest[]
}

const manifestSchema: z<WbToolManifest> = z.object({
  toolId: z.string().required(),
  riskLevel: z.union([z.const('local'), z.const('enterprise'), z.const('external')]).required(),
  requiredPermissions: z.array(z.string()).default([]),
  dataClassificationCeiling: z
    .union([z.const('PUBLIC'), z.const('INTERNAL'), z.const('CONFIDENTIAL'), z.const('RESTRICTED')])
    .required(),
  networkAccess: z.union([z.const('none'), z.const('internal'), z.const('external')]).required(),
})

export const Config: z<Config> = z.object({
  includeHarnessDefaults: z.boolean().default(true),
  staticManifests: z.array(manifestSchema).default([]),
})

declare module '@deepseek-ai/cordis' {
  interface Context {
    wbToolGateway: WbToolGatewayService
  }
}

/** Field-by-field manifest comparison, so an idempotent re-registration is recognised. */
function sameManifest(a: WbToolManifest, b: WbToolManifest): boolean {
  return (
    a.toolId === b.toolId &&
    a.riskLevel === b.riskLevel &&
    a.dataClassificationCeiling === b.dataClassificationCeiling &&
    a.networkAccess === b.networkAccess &&
    a.requiredPermissions.length === b.requiredPermissions.length &&
    a.requiredPermissions.every((p, i) => p === b.requiredPermissions[i])
  )
}

/**
 * Tool manifest directory backing `ctx.wbToolGateway`.
 *
 * Holds two tiers under one lookup: `static` entries seeded from config at
 * construction, and `dynamic` entries contributed by plugins at `apply()`
 * time. Both answer `getManifest`; only dynamic entries are fiber-scoped and
 * disappear when their contributing plugin unmounts.
 */
export class WbToolGatewayService extends Service<Config> implements WbToolGatewayContract {
  static inject = [] as const
  /** Cordis reads the schema off the plugin runtime, so it must live on the class. */
  static Config = Config

  /** Config-sourced manifests. Not fiber-scoped: they outlive any plugin unmount. */
  private readonly staticManifests = new Map<string, WbToolManifest>()
  /** Plugin-contributed manifests, removed when the contributing fiber disposes. */
  private readonly dynamicManifests = new Map<string, WbToolManifest>()

  constructor(ctx: Context, config: Config) {
    super(ctx, 'wbToolGateway')

    if (config.includeHarnessDefaults) {
      for (const [toolId, manifest] of Object.entries(DEFAULT_HARNESS_MANIFESTS)) {
        this.staticManifests.set(toolId, manifest)
      }
    }
    for (const manifest of config.staticManifests) {
      this.staticManifests.set(manifest.toolId, manifest)
    }
  }

  /**
   * Record a tool's manifest for the lifetime of the calling plugin.
   *
   * Conflicting re-registration throws rather than overwriting: last-write-wins
   * would let a later-mounted plugin silently raise another tool's
   * classification ceiling, which is the downgrade DESIGN.md §9 invariant 6
   * forbids. An identical re-registration is a no-op so a double mount, or a
   * remount after HMR, is not an error.
   * @param manifest - the tool's declared metadata; `toolId` must equal the
   *   name the tool was registered under with `ctx.tools.register`.
   * @throws if `toolId` is empty, or if a different manifest already stands
   *   for that `toolId`.
   */
  registerManifest(manifest: WbToolManifest): void {
    if (!manifest.toolId) {
      throw new Error('wb-tool-gateway: registerManifest requires a non-empty toolId')
    }

    const existing = this.getManifest(manifest.toolId)
    if (existing) {
      if (sameManifest(existing, manifest)) return
      throw new Error(
        `wb-tool-gateway: conflicting manifest for tool "${manifest.toolId}". ` +
          'A manifest already stands for this tool and re-registering with different ' +
          'content would silently change its governance. Reconcile the two registrations, ' +
          'or override the tool through Config.staticManifests.',
      )
    }

    // `this.ctx` is the accessing context, so the entry is scoped to the
    // plugin that registered it and disappears when that plugin unmounts.
    this.ctx.effect(() => {
      this.dynamicManifests.set(manifest.toolId, manifest)
      return () => {
        this.dynamicManifests.delete(manifest.toolId)
      }
    }, `wbToolGateway.registerManifest(${manifest.toolId})`)
  }

  /**
   * Look up a tool's manifest by its registered name.
   * @param toolId - the tool name as registered with `ctx.tools.register`.
   * @returns the manifest, or `undefined` when the tool is unknown to this
   *   directory. `undefined` is a real answer, not a failure: `wb-policy`
   *   turns it into `DENY`.
   */
  getManifest(toolId: string): WbToolManifest | undefined {
    return this.staticManifests.get(toolId) ?? this.dynamicManifests.get(toolId)
  }
}

export default WbToolGatewayService
