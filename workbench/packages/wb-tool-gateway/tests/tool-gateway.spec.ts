import { describe, expect, it, beforeEach } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { WbToolManifest } from '@mrpl/dsh-workbench-types'
import WbToolGatewayService, { DEFAULT_HARNESS_MANIFESTS } from '../src/index.ts'

function manifest(overrides: Partial<WbToolManifest> = {}): WbToolManifest {
  return {
    toolId: 'wb_test_tool',
    riskLevel: 'local',
    requiredPermissions: [],
    dataClassificationCeiling: 'INTERNAL',
    networkAccess: 'none',
    ...overrides,
  }
}

describe('wb-tool-gateway plugin', () => {
  let ctx: Context

  beforeEach(() => {
    ctx = new Context()
  })

  it('exposes wbToolGateway service', async () => {
    await ctx.plugin(WbToolGatewayService, {})
    expect(ctx.wbToolGateway).toBeDefined()
    expect(typeof ctx.wbToolGateway.registerManifest).toBe('function')
    expect(typeof ctx.wbToolGateway.getManifest).toBe('function')
  })

  describe('register / read round-trip', () => {
    it('registerManifest then getManifest returns the same manifest', async () => {
      await ctx.plugin(WbToolGatewayService, {})
      const m = manifest({ toolId: 'wb_vision_analyze' })
      ctx.wbToolGateway.registerManifest(m)
      expect(ctx.wbToolGateway.getManifest('wb_vision_analyze')).toEqual(m)
    })

    it('stores a manifest whose toolId matches no live harness tool, as given', async () => {
      // Deliberately no cross-validation against the live tools registry:
      // wb-tool-gateway is a directory, and a manifest registered ahead of its
      // tool (or for a tool in another bundle) must round-trip unchanged.
      await ctx.plugin(WbToolGatewayService, {})
      const m = manifest({ toolId: 'not_a_real_harness_tool' })
      ctx.wbToolGateway.registerManifest(m)
      expect(ctx.wbToolGateway.getManifest('not_a_real_harness_tool')).toEqual(m)
    })
  })

  describe('unknown tools', () => {
    it('getManifest for a never-registered tool returns undefined, not a default', async () => {
      await ctx.plugin(WbToolGatewayService, {})
      expect(ctx.wbToolGateway.getManifest('never_registered')).toBeUndefined()
    })

    it('does not invent a manifest for a tool that merely looks like a workbench tool', async () => {
      await ctx.plugin(WbToolGatewayService, {})
      expect(ctx.wbToolGateway.getManifest('wb_not_built_yet')).toBeUndefined()
    })
  })

  describe('static harness-native table', () => {
    it('is keyed on registered tool names, never package names', async () => {
      await ctx.plugin(WbToolGatewayService, {})
      // The failure this guards: keying on `dsh-tool-fs`/`tool-fs` instead of
      // `read`/`write`. wb-policy denies any unmanifested tool, so a
      // package-keyed table denies every harness tool call.
      expect(ctx.wbToolGateway.getManifest('read')).toBeDefined()
      expect(ctx.wbToolGateway.getManifest('dsh-tool-fs')).toBeUndefined()
      expect(ctx.wbToolGateway.getManifest('tool-fs')).toBeUndefined()
      expect(ctx.wbToolGateway.getManifest('dsh-tool-web')).toBeUndefined()
      expect(ctx.wbToolGateway.getManifest('dsh-tool-bash')).toBeUndefined()
    })

    it('every default manifest declares its own toolId as its key', async () => {
      await ctx.plugin(WbToolGatewayService, {})
      for (const [toolId, m] of Object.entries(DEFAULT_HARNESS_MANIFESTS)) {
        expect(m.toolId, `${toolId} manifest carries a mismatched toolId`).toBe(toolId)
      }
    })

    // One assertion per harness-native tool, so a reviewer can check the
    // reasoning per tool rather than trusting a blanket "looks sane".

    it('read: local file read, no network, may see the most sensitive local data', async () => {
      await ctx.plugin(WbToolGatewayService, {})
      const m = ctx.wbToolGateway.getManifest('read')!
      expect(m.riskLevel).toBe('local')
      expect(m.networkAccess).toBe('none')
      expect(m.dataClassificationCeiling).toBe('RESTRICTED')
    })

    it('write / edit / str_replace_editor: local mutation, no network', async () => {
      await ctx.plugin(WbToolGatewayService, {})
      for (const id of ['write', 'edit', 'str_replace_editor']) {
        const m = ctx.wbToolGateway.getManifest(id)!
        expect(m, `${id} missing`).toBeDefined()
        expect(m.riskLevel, id).toBe('local')
        expect(m.networkAccess, `${id} must not claim network access`).toBe('none')
      }
    })

    it('read_image: local, but image bytes are a distinct exfiltration surface from text', async () => {
      await ctx.plugin(WbToolGatewayService, {})
      const m = ctx.wbToolGateway.getManifest('read_image')!
      expect(m.riskLevel).toBe('local')
      expect(m.networkAccess).toBe('none')
    })

    it('glob / grep: local discovery, no network', async () => {
      await ctx.plugin(WbToolGatewayService, {})
      for (const id of ['glob', 'grep']) {
        const m = ctx.wbToolGateway.getManifest(id)!
        expect(m, `${id} missing`).toBeDefined()
        expect(m.riskLevel, id).toBe('local')
        expect(m.networkAccess, id).toBe('none')
      }
    })

    it('bash / pwsh: shell can reach the network, so it is not a local-risk tool', async () => {
      await ctx.plugin(WbToolGatewayService, {})
      for (const id of ['bash', 'pwsh']) {
        const m = ctx.wbToolGateway.getManifest(id)!
        expect(m, `${id} missing`).toBeDefined()
        expect(m.riskLevel, `${id} must not be classed 'local'`).toBe('enterprise')
        expect(m.networkAccess, `${id} can curl; declaring 'none' would be a lie`).toBe('external')
      }
    })

    it('web_search / web_fetch: external egress, capped at PUBLIC so nothing sensitive leaves', async () => {
      await ctx.plugin(WbToolGatewayService, {})
      for (const id of ['web_search', 'web_fetch']) {
        const m = ctx.wbToolGateway.getManifest(id)!
        expect(m, `${id} missing`).toBeDefined()
        expect(m.riskLevel, `${id} must not be classed 'local'`).toBe('external')
        expect(m.networkAccess, id).toBe('external')
        expect(m.dataClassificationCeiling, `${id} must never carry above-PUBLIC data off-premise`).toBe('PUBLIC')
      }
    })

    it('todo_write / skill / job_* / *_goal: local bookkeeping, no network', async () => {
      await ctx.plugin(WbToolGatewayService, {})
      for (const id of [
        'todo_write',
        'skill',
        'job_list',
        'job_output',
        'job_kill',
        'create_goal',
        'get_goal',
        'update_goal',
      ]) {
        const m = ctx.wbToolGateway.getManifest(id)!
        expect(m, `${id} missing`).toBeDefined()
        expect(m.riskLevel, id).toBe('local')
        expect(m.networkAccess, id).toBe('none')
      }
    })

    it('one bash manifest governs both tool-bash and tool-bash-persistent', async () => {
      // Both packages register the same tool name; the table is keyed by name,
      // so this is one entry, not a duplicate registration.
      await ctx.plugin(WbToolGatewayService, {})
      expect(ctx.wbToolGateway.getManifest('bash')).toBeDefined()
      expect(
        Object.keys(DEFAULT_HARNESS_MANIFESTS).filter((k) => k === 'bash'),
      ).toHaveLength(1)
    })

    it('config can add a manifest for a dynamically-named tool the defaults cannot cover', async () => {
      // subagent/workflow tools take their names from config at registration
      // time, so no static default can name them; an admin supplies them here.
      await ctx.plugin(WbToolGatewayService, {
        staticManifests: [manifest({ toolId: 'my_subagent', riskLevel: 'enterprise' })],
      })
      expect(ctx.wbToolGateway.getManifest('my_subagent')?.riskLevel).toBe('enterprise')
    })

    it('config entry overrides a default for the same toolId', async () => {
      await ctx.plugin(WbToolGatewayService, {
        staticManifests: [manifest({ toolId: 'bash', dataClassificationCeiling: 'PUBLIC' })],
      })
      expect(ctx.wbToolGateway.getManifest('bash')?.dataClassificationCeiling).toBe('PUBLIC')
    })

    it('defaults can be switched off wholesale for a locked-down deployment', async () => {
      await ctx.plugin(WbToolGatewayService, { includeHarnessDefaults: false })
      expect(ctx.wbToolGateway.getManifest('read')).toBeUndefined()
      expect(ctx.wbToolGateway.getManifest('bash')).toBeUndefined()
    })
  })

  describe('duplicate registration', () => {
    it('re-registering an identical manifest is a no-op, not an error', async () => {
      await ctx.plugin(WbToolGatewayService, {})
      const m = manifest({ toolId: 'wb_ocr_extract' })
      ctx.wbToolGateway.registerManifest(m)
      expect(() => ctx.wbToolGateway.registerManifest({ ...m })).not.toThrow()
      expect(ctx.wbToolGateway.getManifest('wb_ocr_extract')).toEqual(m)
    })

    it('re-registering the same toolId with different content throws', async () => {
      await ctx.plugin(WbToolGatewayService, {})
      ctx.wbToolGateway.registerManifest(manifest({ toolId: 'wb_ocr_extract' }))
      expect(() =>
        ctx.wbToolGateway.registerManifest(
          manifest({ toolId: 'wb_ocr_extract', dataClassificationCeiling: 'RESTRICTED' }),
        ),
      ).toThrow(/wb_ocr_extract/)
    })

    it('the losing registration does not weaken the stored manifest', async () => {
      // Last-write-wins would let a later-mounted plugin silently raise another
      // tool's ceiling. Invariant 6: classification is never silently changed.
      await ctx.plugin(WbToolGatewayService, {})
      const original = manifest({ toolId: 'wb_generate_report', dataClassificationCeiling: 'INTERNAL' })
      ctx.wbToolGateway.registerManifest(original)
      try {
        ctx.wbToolGateway.registerManifest(
          manifest({ toolId: 'wb_generate_report', dataClassificationCeiling: 'RESTRICTED' }),
        )
      } catch {
        // asserted in the test above; here we only care about the stored state
      }
      expect(ctx.wbToolGateway.getManifest('wb_generate_report')).toEqual(original)
    })

    it('registering over a static-table entry with different content throws', async () => {
      await ctx.plugin(WbToolGatewayService, {})
      expect(() =>
        ctx.wbToolGateway.registerManifest(
          manifest({ toolId: 'bash', riskLevel: 'local', networkAccess: 'none' }),
        ),
      ).toThrow(/bash/)
      // and the admin-configured truth survives the attempt
      expect(ctx.wbToolGateway.getManifest('bash')?.networkAccess).toBe('external')
    })
  })

  describe('disposal', () => {
    it('manifests registered by a fiber are gone after that fiber disposes', async () => {
      await ctx.plugin(WbToolGatewayService, {})
      const fork = await ctx.plugin({
        inject: ['wbToolGateway'],
        apply(child: Context) {
          child.wbToolGateway.registerManifest(manifest({ toolId: 'wb_vision_analyze' }))
        },
      })
      expect(ctx.wbToolGateway.getManifest('wb_vision_analyze')).toBeDefined()
      await fork.dispose()
      expect(ctx.wbToolGateway.getManifest('wb_vision_analyze')).toBeUndefined()
    })

    it('static-table entries survive a consumer fiber disposing', async () => {
      // They come from config, not from a fiber, so nothing about a plugin
      // unmounting should ungovern the harness-native tools.
      await ctx.plugin(WbToolGatewayService, {})
      const fork = await ctx.plugin({
        inject: ['wbToolGateway'],
        apply(child: Context) {
          child.wbToolGateway.registerManifest(manifest({ toolId: 'wb_ocr_extract' }))
        },
      })
      await fork.dispose()
      expect(ctx.wbToolGateway.getManifest('read')).toBeDefined()
      expect(ctx.wbToolGateway.getManifest('bash')).toBeDefined()
    })

    it('a toolId freed by disposal can be registered again with different content', async () => {
      await ctx.plugin(WbToolGatewayService, {})
      const first = await ctx.plugin({
        inject: ['wbToolGateway'],
        apply(child: Context) {
          child.wbToolGateway.registerManifest(
            manifest({ toolId: 'wb_vision_analyze', dataClassificationCeiling: 'INTERNAL' }),
          )
        },
      })
      await first.dispose()
      expect(() =>
        ctx.wbToolGateway.registerManifest(
          manifest({ toolId: 'wb_vision_analyze', dataClassificationCeiling: 'RESTRICTED' }),
        ),
      ).not.toThrow()
      expect(ctx.wbToolGateway.getManifest('wb_vision_analyze')?.dataClassificationCeiling).toBe(
        'RESTRICTED',
      )
    })
  })

  describe('validation', () => {
    it('rejects a manifest with an empty toolId at load rather than storing an unreachable entry', async () => {
      await ctx.plugin(WbToolGatewayService, {})
      expect(() => ctx.wbToolGateway.registerManifest(manifest({ toolId: '' }))).toThrow()
    })
  })
})
