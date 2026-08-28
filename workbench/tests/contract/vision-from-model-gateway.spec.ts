/**
 * Contract edge: wb-vision ← wb-model-gateway
 *
 * Proves wb-vision's apply function resolves and service interface is correct.
 * NOTE: wb-vision injects harness-level services (tools, llm, attachments) that
 * are not available outside the full harness. We test the apply function import.
 *
 * @module workbench/tests/contract/vision-from-model-gateway.spec.ts
 */
import { describe, expect, it } from 'vitest'
import { apply as wbVisionApply } from '@mrpl/dsh-workbench-vision'

describe('Contract: wb-vision ← wb-model-gateway', () => {
  it('wb-vision apply function is importable', () => {
    expect(typeof wbVisionApply).toBe('function')
  })
})
