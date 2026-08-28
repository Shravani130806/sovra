import { describe, expect, it, afterEach } from 'vitest'
import { compose, type Composed } from '../harness.ts'

/**
 * Edge: wb-vision registering manifests into the REAL wb-tool-gateway, and
 * them landing where wb-policy actually looks.
 */
describe('wb-vision -> wb-tool-gateway -> wb-policy', () => {
  let c: Composed | undefined
  afterEach(() => { c?.dispose(); c = undefined })

  it('both vision manifests are readable from the real directory', async () => {
    c = await compose()
    for (const id of ['wb_ocr_extract', 'wb_vision_analyze']) {
      const manifest = c.ctx.wbToolGateway.getManifest(id)
      expect(manifest, `${id} manifest missing`).toBeDefined()
      expect(manifest!.toolId).toBe(id)
    }
  })

  it('each manifest toolId equals the name the tool actually registered under', async () => {
    c = await compose()
    const registered = c.ctx.tools.schemas().map((s: { name: string }) => s.name)
    for (const id of ['wb_ocr_extract', 'wb_vision_analyze']) {
      // A mismatch denies the tool at every call with NO_MANIFEST while both
      // registrations individually look fine.
      expect(registered).toContain(id)
      expect(c.ctx.wbToolGateway.getManifest(id)!.toolId).toBe(id)
    }
  })
})
