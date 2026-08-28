import { describe, expect, it } from 'vitest'
import { compose } from '../harness.ts'

/** §9 invariant 5 — misconfiguration fails loud at load. */
describe('invariant 5: misconfiguration fails loud', () => {
  it('a routing entry pointing at an unmounted adapter refuses to boot', async () => {
    await expect(compose({ routing: { embedding: 'embedding-missing' } }))
      .rejects.toThrow(/embedding-missing/)
  })

  it('the error names the adapters that ARE mounted', async () => {
    await expect(compose({ routing: { rerank: 'nope' } })).rejects.toThrow(/Mounted adapters/)
  })

  it('a malformed policy matrix refuses to boot', async () => {
    await expect(compose({ policyConfig: { matrix: { PUBLIC: { web_search: 'NOT_A_DECISION' } } } }))
      .rejects.toThrow()
  })
})
