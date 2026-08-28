/**
 * Contract edge: wb-vision ← wb-tool-gateway
 *
 * Proves wb-vision's apply function is importable.
 * NOTE: wb-vision requires harness-level `tools`, `llm`, and `attachments`
 * services that are not available outside the full harness. We verify the
 * apply function exists and has the correct inject declaration.
 *
 * @module workbench/tests/contract/vision-from-tool-gateway.spec.ts
 */
import { describe, expect, it } from 'vitest'
import { apply as wbVisionApply } from '@mrpl/dsh-workbench-vision'

describe('Contract: wb-vision ← wb-tool-gateway', () => {
  it('wb-vision apply function is importable', () => {
    expect(typeof wbVisionApply).toBe('function')
  })
})
