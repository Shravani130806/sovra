import { describe, expect, it, afterEach } from 'vitest'
import { callTool, compose, STUB_ROUTING, type Composed } from './harness.ts'

describe('Stage 2 — the composed bundle boots', () => {
  let composed: Composed | undefined
  afterEach(() => {
    composed?.dispose()
    composed = undefined
  })

  it('mounts every wb-* plugin with the routing table from workbench.cordis.yml', async () => {
    composed = await compose()
    const { ctx } = composed
    for (const key of [
      'wbIdentity', 'wbPolicy', 'wbAudit', 'wbModelGateway',
      'wbToolGateway', 'wbVision', 'wbRag', 'wbIngestion',
    ] as const) {
      expect(ctx.get(key), `${key} did not mount`).toBeDefined()
    }
  })

  it('every inject resolves against a really-mounted sibling', async () => {
    composed = await compose()
    // wb-vision injects five services and registers its tools only on apply();
    // its tools existing proves the whole inject list resolved for real.
    const names = composed.ctx.tools.schemas().map((s: { name: string }) => s.name)
    expect(names).toContain('wb_ocr_extract')
    expect(names).toContain('wb_vision_analyze')
  })

  describe('misconfiguration fails loud (§9 invariant 5)', () => {
    it('routing pointing at an unmounted adapter refuses to boot', async () => {
      await expect(
        compose({ routing: { vision_reasoning: 'llm-not-mounted' } }),
      ).rejects.toThrow(/llm-not-mounted/)
    })

    it('names the mounted adapters in the error, so the fix is obvious', async () => {
      await expect(compose({ routing: { ocr: 'nope' } })).rejects.toThrow(/Mounted adapters/)
    })

    it('a malformed policy matrix refuses to boot', async () => {
      await expect(
        compose({ policyConfig: { matrix: { PUBLIC: { web_search: 'PROBABLY' } } } }),
      ).rejects.toThrow()
    })

    it('the good configuration still boots cleanly after each negative case', async () => {
      composed = await compose()
      expect(composed.ctx.get('wbPolicy')).toBeDefined()
      expect(Object.values(STUB_ROUTING).length).toBeGreaterThan(0)
    })
  })
})

describe('Stage 2 — an incomplete governance stack must not boot quietly', () => {
  it('wb-policy still mounts and still gates when wb-identity is absent', async () => {
    // The failure this guards: Cordis inject is required-only, so listing
    // wbIdentity left wb-policy unapplied when identity was missing — the
    // bundle booted with wb-vision's tools registered, no tools/pre-execute
    // listener, and no error. Every tool call ran ungoverned.
    const composed = await compose({ omit: ['identity'] })
    try {
      expect(composed.ctx.get('wbPolicy'), 'the gate must exist even so').toBeDefined()
      const result = await callTool(composed.ctx, 'wb_ocr_extract', {
        image: 'aGk=',
        mediaType: 'image/png',
      })
      expect(result.isError, 'an ungoverned call must not succeed').toBe(true)
    } finally {
      composed.dispose()
    }
  })

  it('a call is denied, not skipped, when the manifest directory is absent', async () => {
    const composed = await compose({ omit: ['toolGateway'] })
    try {
      const result = await callTool(composed.ctx, 'wb_ocr_extract', {
        image: 'aGk=',
        mediaType: 'image/png',
      })
      expect(result.isError).toBe(true)
    } finally {
      composed.dispose()
    }
  })
})
