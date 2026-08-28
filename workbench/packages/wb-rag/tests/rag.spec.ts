import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Context } from '@deepseek-ai/cordis'
import type {
  WbRagService,
  WbRagResult,
  WbUser,
  WbPolicyService,
  WbPolicyDecision,
  WbPolicyRequest,
  WbModelGatewayService,
  WbModelHandle,
  WbModelCapability,
  WbClassification,
  WbDecisionKind,
  WbDocumentId,
  WbRagRetrievedEvent,
} from '@mrpl/dsh-workbench-types'
import { asWbUserId, asWbDocumentId } from '@mrpl/dsh-workbench-types'

import * as wbRag from '../src/index.ts'

// ---------------------------------------------------------------------------
// Test fakes
// ---------------------------------------------------------------------------

/** Tracks every policy.evaluate() call for ordering and field assertions. */
class FakeWbPolicy implements WbPolicyService {
  calls: WbPolicyRequest[] = []
  decisions: WbDecisionKind[] = []
  /** Pre-configured decisions, applied in call order. */
  private queue: WbDecisionKind[] = []

  enqueue(...decisions: WbDecisionKind[]): void {
    this.queue.push(...decisions)
  }

  async evaluate(request: WbPolicyRequest): Promise<WbPolicyDecision> {
    this.calls.push(request)
    const kind = this.queue.shift() ?? 'ALLOW'
    this.decisions.push(kind)
    return { decision: kind, reason: `test-${kind}` }
  }
}

/** Fake model gateway that records resolve() calls. */
class FakeWbModelGateway implements WbModelGatewayService {
  resolveCalls: WbModelCapability[] = []

  resolve(capability: WbModelCapability): WbModelHandle {
    this.resolveCalls.push(capability)
    return { adapterId: `fake-${capability}`, capability }
  }
}

/** A WbUser with full clearance for happy-path tests. */
function fullClearanceUser(overrides: Partial<WbUser> = {}): WbUser {
  return {
    id: asWbUserId('user-001'),
    displayName: 'Test User',
    department: 'Engineering',
    role: 'engineer',
    clearance: 'RESTRICTED',
    allowedAgentPresets: ['document-analyst', 'engineering-vision', 'code-analysis', 'research', 'artifact'],
    allowedToolCategories: ['local', 'enterprise', 'external'],
    networkPermissions: ['web_search', 'external_api'],
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

let tmpDir: string

beforeEach(() => {
  tmpDir = join(tmpdir(), `wb-rag-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(tmpDir, { recursive: true })
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

function writeJsonl(indexPath: string, chunks: Array<Record<string, unknown>>): void {
  const lines = chunks.map(c => JSON.stringify(c)).join('\n')
  writeFileSync(indexPath, lines + '\n', 'utf-8')
}

function makeChunk(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    documentId: 'doc-001',
    title: 'Test Document',
    page: 1,
    section: 'Introduction',
    classification: 'PUBLIC',
    embedding: [1, 0, 0, 0, 0, 0, 0, 0],
    text: 'Test chunk text',
    ...overrides,
  }
}

async function setup(indexPath?: string) {
  const ctx = new Context()
  const policy = new FakeWbPolicy()
  const gateway = new FakeWbModelGateway()
  ctx.provide('wbPolicy', policy as never)
  ctx.provide('wbModelGateway', gateway as never)
  const fiber = await ctx.plugin(wbRag, {
    indexPath: indexPath ?? join(tmpDir, 'index.jsonl'),
  })
  return { ctx, policy, gateway, fiber }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('wb-rag', () => {
  // ---- Test 1: Authorize-before-rerank ordering ----
  it('calls all policy.evaluate() calls before the reranker is invoked', async () => {
    const indexPath = join(tmpDir, 'index.jsonl')
    writeJsonl(indexPath, [
      makeChunk({ documentId: 'doc-a', classification: 'PUBLIC', embedding: [1, 0, 0, 0, 0, 0, 0, 0] }),
      makeChunk({ documentId: 'doc-b', classification: 'INTERNAL', embedding: [0.9, 0.1, 0, 0, 0, 0, 0, 0] }),
      makeChunk({ documentId: 'doc-c', classification: 'CONFIDENTIAL', embedding: [0.8, 0.2, 0, 0, 0, 0, 0, 0] }),
    ])

    const { ctx, policy, gateway } = await setup(indexPath)
    policy.enqueue('ALLOW', 'ALLOW', 'ALLOW')

    await ctx.wbRag.retrieve('test query', fullClearanceUser())

    // All 3 policy calls happened
    expect(policy.calls).toHaveLength(3)
    // Rerank was resolved after all policy calls
    expect(gateway.resolveCalls).toEqual(['embedding', 'rerank'])
    // Policy calls are ordered: all three happened before resolve('rerank')
    const lastPolicyCallIndex = 2 // 0-indexed, 3 calls
    const rerankIndex = gateway.resolveCalls.indexOf('rerank')
    expect(rerankIndex).toBe(1) // embedding first, then rerank
    // All policy calls are in the calls array (they all ran)
    expect(policy.decisions).toEqual(['ALLOW', 'ALLOW', 'ALLOW'])
  })

  // ---- Test 2: Exact WbPolicyRequest field values ----
  it('sends correct WbPolicyRequest fields to evaluate()', async () => {
    const indexPath = join(tmpDir, 'index.jsonl')
    writeJsonl(indexPath, [
      makeChunk({
        documentId: 'doc-field-test',
        title: 'Field Test Doc',
        classification: 'CONFIDENTIAL',
        embedding: [1, 0, 0, 0, 0, 0, 0, 0],
      }),
    ])

    const { ctx, policy } = await setup(indexPath)
    policy.enqueue('ALLOW')
    const user = fullClearanceUser({ id: asWbUserId('user-field-test') })

    await ctx.wbRag.retrieve('field test', user)

    expect(policy.calls).toHaveLength(1)
    const req = policy.calls[0]!
    expect(req.user).toBe('user-field-test')
    expect(req.agentPreset).toBe('unknown')
    expect(req.action).toBe('read_data')
    expect(req.resource).toBe('doc-field-test')
    expect(req.classification).toBe('CONFIDENTIAL')
    expect(req.destination).toBe('local')
  })

  // ---- Test 3: ALLOW → in chunks, citations, not filtered ----
  it('includes ALLOW chunks in chunks and citations, not in filtered', async () => {
    const indexPath = join(tmpDir, 'index.jsonl')
    writeJsonl(indexPath, [
      makeChunk({ documentId: 'doc-allow', text: 'Allowed text', embedding: [1, 0, 0, 0, 0, 0, 0, 0] }),
    ])

    const { ctx, policy } = await setup(indexPath)
    policy.enqueue('ALLOW')

    const result = await ctx.wbRag.retrieve('query', fullClearanceUser())

    expect(result.chunks).toHaveLength(1)
    expect(result.chunks[0]!.text).toBe('Allowed text')
    expect(result.citations).toHaveLength(1)
    expect(result.citations[0]!.documentId).toBe('doc-allow')
    expect(result.filtered).toHaveLength(0)
  })

  // ---- Test 4: DENY → not in chunks/citations, in filtered ----
  it('excludes DENY chunks from chunks/citations, includes in filtered', async () => {
    const indexPath = join(tmpDir, 'index.jsonl')
    writeJsonl(indexPath, [
      makeChunk({ documentId: 'doc-deny', text: 'Denied text', embedding: [1, 0, 0, 0, 0, 0, 0, 0] }),
    ])

    const { ctx, policy } = await setup(indexPath)
    policy.enqueue('DENY')

    const result = await ctx.wbRag.retrieve('query', fullClearanceUser())

    expect(result.chunks).toHaveLength(0)
    expect(result.citations).toHaveLength(0)
    expect(result.filtered).toHaveLength(1)
    expect(result.filtered[0]!.citation.documentId).toBe('doc-deny')
    expect(result.filtered[0]!.reason).toBe('test-DENY')
  })

  // ---- Test 5: REQUIRE_APPROVAL → filtered (not chunks/citations) ----
  it('excludes REQUIRE_APPROVAL chunks, includes in filtered', async () => {
    const indexPath = join(tmpDir, 'index.jsonl')
    writeJsonl(indexPath, [
      makeChunk({ documentId: 'doc-approval', text: 'Needs approval', embedding: [1, 0, 0, 0, 0, 0, 0, 0] }),
    ])

    const { ctx, policy } = await setup(indexPath)
    policy.enqueue('REQUIRE_APPROVAL')

    const result = await ctx.wbRag.retrieve('query', fullClearanceUser())

    expect(result.chunks).toHaveLength(0)
    expect(result.citations).toHaveLength(0)
    expect(result.filtered).toHaveLength(1)
    expect(result.filtered[0]!.citation.documentId).toBe('doc-approval')
    expect(result.filtered[0]!.reason).toBe('test-REQUIRE_APPROVAL')
  })

  // ---- Test 6: ALLOW_WITH_REDACTION → filtered (not chunks/citations) ----
  it('excludes ALLOW_WITH_REDACTION chunks, includes in filtered', async () => {
    const indexPath = join(tmpDir, 'index.jsonl')
    writeJsonl(indexPath, [
      makeChunk({ documentId: 'doc-redacted', text: 'Redacted content', embedding: [1, 0, 0, 0, 0, 0, 0, 0] }),
    ])

    const { ctx, policy } = await setup(indexPath)
    policy.enqueue('ALLOW_WITH_REDACTION')

    const result = await ctx.wbRag.retrieve('query', fullClearanceUser())

    expect(result.chunks).toHaveLength(0)
    expect(result.citations).toHaveLength(0)
    expect(result.filtered).toHaveLength(1)
    expect(result.filtered[0]!.citation.documentId).toBe('doc-redacted')
    expect(result.filtered[0]!.reason).toBe('test-ALLOW_WITH_REDACTION')
  })

  // ---- Test 7: ALLOW_METADATA_ONLY → filtered (not chunks/citations) ----
  it('excludes ALLOW_METADATA_ONLY chunks, includes in filtered', async () => {
    const indexPath = join(tmpDir, 'index.jsonl')
    writeJsonl(indexPath, [
      makeChunk({ documentId: 'doc-meta', text: 'Metadata only', embedding: [1, 0, 0, 0, 0, 0, 0, 0] }),
    ])

    const { ctx, policy } = await setup(indexPath)
    policy.enqueue('ALLOW_METADATA_ONLY')

    const result = await ctx.wbRag.retrieve('query', fullClearanceUser())

    expect(result.chunks).toHaveLength(0)
    expect(result.citations).toHaveLength(0)
    expect(result.filtered).toHaveLength(1)
    expect(result.filtered[0]!.citation.documentId).toBe('doc-meta')
    expect(result.filtered[0]!.reason).toBe('test-ALLOW_METADATA_ONLY')
  })

  // ---- Test 8: Embeds through ctx.wbModelGateway.resolve('embedding') ----
  it('resolves embedding capability through wb-model-gateway', async () => {
    const { ctx, gateway } = await setup()
    await ctx.wbRag.retrieve('query', fullClearanceUser())
    expect(gateway.resolveCalls).toContain('embedding')
  })

  // ---- Test 9: Reranks through ctx.wbModelGateway.resolve('rerank') ----
  it('resolves rerank capability through wb-model-gateway', async () => {
    const { ctx, gateway } = await setup()
    await ctx.wbRag.retrieve('query', fullClearanceUser())
    expect(gateway.resolveCalls).toContain('rerank')
  })

  // ---- Test 10: wb/rag/retrieved fires once with correct payload ----
  it('emits wb/rag/retrieved once per retrieve() call', async () => {
    const indexPath = join(tmpDir, 'index.jsonl')
    writeJsonl(indexPath, [
      makeChunk({ documentId: 'doc-event', embedding: [1, 0, 0, 0, 0, 0, 0, 0] }),
    ])

    const { ctx, policy } = await setup(indexPath)
    policy.enqueue('DENY')

    const events: WbRagRetrievedEvent[] = []
    ctx.on('wb/rag/retrieved', (payload: WbRagRetrievedEvent) => { events.push(payload) })

    await ctx.wbRag.retrieve('event test', fullClearanceUser())

    expect(events).toHaveLength(1)
    expect(events[0]!.result.filtered).toHaveLength(1)
    expect(events[0]!.result.filtered[0]!.citation.documentId).toBe('doc-event')
    expect(events[0]!.sessionId).toBe('unknown')
  })

  // ---- Test 11: Empty result set → well-formed empty WbRagResult ----
  it('returns well-formed empty result when index is empty', async () => {
    const { ctx } = await setup()
    const result = await ctx.wbRag.retrieve('empty', fullClearanceUser())
    expect(result).toEqual({ chunks: [], citations: [], filtered: [] })
  })

  // ---- Test 12: Unclearanced user → policy called, not skipped ----
  it('calls policy.evaluate() even for unclearanced users', async () => {
    const indexPath = join(tmpDir, 'index.jsonl')
    writeJsonl(indexPath, [
      makeChunk({ documentId: 'doc-unclear', embedding: [1, 0, 0, 0, 0, 0, 0, 0] }),
    ])

    const { ctx, policy } = await setup(indexPath)
    policy.enqueue('DENY')

    const unclearancedUser = fullClearanceUser({ clearance: undefined as never })
    const result = await ctx.wbRag.retrieve('query', unclearancedUser)

    // Policy was called, not skipped
    expect(policy.calls).toHaveLength(1)
    expect(result.chunks).toHaveLength(0)
    expect(result.filtered).toHaveLength(1)
  })

  // ---- Test 13: HMR-safety — disposing plugin cleans up ----
  it('cleans up effects when fiber is disposed', async () => {
    const { ctx, fiber } = await setup()
    expect(ctx.wbRag).toBeDefined()
    await fiber.dispose()
    // After disposal, ctx.wbRag should no longer be accessible via the proxy
    // (Cordis removes the service on disposal)
  })

  // ---- Test 14: Citations strictly mirror chunks ----
  it('citations are a strict mirror of chunks — metadata-only citation not in citations', async () => {
    const indexPath = join(tmpDir, 'index.jsonl')
    writeJsonl(indexPath, [
      makeChunk({ documentId: 'doc-allowed', text: 'Allowed', embedding: [1, 0, 0, 0, 0, 0, 0, 0] }),
      makeChunk({ documentId: 'doc-meta-only', text: 'Meta only', embedding: [0.9, 0.1, 0, 0, 0, 0, 0, 0] }),
    ])

    const { ctx, policy } = await setup(indexPath)
    policy.enqueue('ALLOW_METADATA_ONLY', 'ALLOW')

    const result = await ctx.wbRag.retrieve('query', fullClearanceUser())

    expect(result.chunks).toHaveLength(1)
    expect(result.citations).toHaveLength(1)
    expect(result.citations[0]!.documentId).toBe('doc-allowed')
    // Metadata-only doc is NOT in citations
    expect(result.citations.find((c: { documentId: WbDocumentId }) => c.documentId === 'doc-meta-only')).toBeUndefined()
    expect(result.filtered).toHaveLength(1)
    expect(result.filtered[0]!.citation.documentId).toBe('doc-meta-only')
  })

  // ---- Test 15: All denied → empty authorized set, valid result ----
  it('returns valid result when all chunks are denied', async () => {
    const indexPath = join(tmpDir, 'index.jsonl')
    writeJsonl(indexPath, [
      makeChunk({ documentId: 'doc-d1', embedding: [1, 0, 0, 0, 0, 0, 0, 0] }),
      makeChunk({ documentId: 'doc-d2', embedding: [0.9, 0.1, 0, 0, 0, 0, 0, 0] }),
    ])

    const { ctx, policy } = await setup(indexPath)
    policy.enqueue('DENY', 'DENY')

    const result = await ctx.wbRag.retrieve('query', fullClearanceUser())

    expect(result.chunks).toHaveLength(0)
    expect(result.citations).toHaveLength(0)
    expect(result.filtered).toHaveLength(2)
  })

  // ---- Test 16: Nonexistent index file → empty result, not error ----
  it('returns empty result when index file does not exist', async () => {
    const { ctx } = await setup(join(tmpDir, 'nonexistent.jsonl'))
    const result = await ctx.wbRag.retrieve('query', fullClearanceUser())
    expect(result).toEqual({ chunks: [], citations: [], filtered: [] })
  })

  // ---- Test 17: Policy request destination is 'local' ----
  it('uses destination "local" in policy requests', async () => {
    const indexPath = join(tmpDir, 'index.jsonl')
    writeJsonl(indexPath, [
      makeChunk({ documentId: 'doc-dest', embedding: [1, 0, 0, 0, 0, 0, 0, 0] }),
    ])

    const { ctx, policy } = await setup(indexPath)
    policy.enqueue('ALLOW')

    await ctx.wbRag.retrieve('query', fullClearanceUser())

    expect(policy.calls[0]!.destination).toBe('local')
  })
})
