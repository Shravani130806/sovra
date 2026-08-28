import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { SessionId, type Session, type SessionEvent } from '@deepseek-ai/dsh-session'
import {
  asWbAuditEntryId,
  asWbUserId,
  asWbSessionId,
  asWbDocumentId,
  type WbAuditEntry,
  type WbPolicyDecisionEvent,
  type WbRagRetrievedEvent,
  type WbIngestionCompletedEvent,
  type WbUser,
  type WbClassification,
} from '@mrpl/dsh-workbench-types'
import WbAuditService, { apply as wbAuditApply } from '../src/index.ts'

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'wb-audit-test-'))
}

function createMockSession(id: string = 'test-session'): Session {
  return {
    id: SessionId(id),
  } as unknown as Session
}

function createMockUser(userId: string = 'test-user'): WbUser {
  return {
    id: asWbUserId(userId),
    displayName: 'Test User',
    department: 'Engineering',
    role: 'engineer',
    clearance: 'INTERNAL' as WbClassification,
    allowedAgentPresets: ['document-analyst'],
    allowedToolCategories: ['local', 'enterprise'],
    networkPermissions: [],
  }
}

describe('wb-audit plugin', () => {
  let ctx: Context
  let auditRoot: string

  beforeEach(() => {
    auditRoot = tmpDir()
    ctx = new Context()
    // Provide mock identity service
    ctx.provide('wbIdentity', {
      current(_sessionId) {
        return createMockUser()
      },
    })
  })

  afterEach(() => {
    fs.rmSync(auditRoot, { recursive: true, force: true })
  })

  it('exposes wbAudit service', async () => {
    await ctx.plugin(WbAuditService, { root: auditRoot })
    expect(ctx.wbAudit).toBeDefined()
    expect(typeof ctx.wbAudit.record).toBe('function')
    expect(typeof ctx.wbAudit.query).toBe('function')
  })

  it('record() assigns unique id and at timestamp', async () => {
    await ctx.plugin(WbAuditService, { root: auditRoot })
    const entry = {
      sessionId: asWbSessionId('s1'),
      userId: asWbUserId('u1'),
      kind: 'session_event' as const,
      summary: 'test',
      payload: {},
    }
    ctx.wbAudit.record(entry)
    const results = ctx.wbAudit.query({})
    expect(results).toHaveLength(1)
    const recorded = results[0]
    expect(recorded.id).toBeDefined()
    expect(recorded.at).toBeDefined()
    expect(new Date(recorded.at).toISOString()).toBe(recorded.at)
  })

  it('entries persist across plugin restart (durability)', async () => {
    await ctx.plugin(WbAuditService, { root: auditRoot })
    ctx.wbAudit.record({
      sessionId: asWbSessionId('s1'),
      userId: asWbUserId('u1'),
      kind: 'session_event',
      summary: 'first',
      payload: {},
    })

    // Create fresh plugin instance
    const ctx2 = new Context()
    ctx2.provide('wbIdentity', {
      current() {
        return createMockUser()
      },
    })
    await ctx2.plugin(WbAuditService, { root: auditRoot })
    const results = ctx2.wbAudit.query({})
    expect(results).toHaveLength(1)
    expect(results[0].summary).toBe('first')
  })

  it('query() filters by sessionId', async () => {
    await ctx.plugin(WbAuditService, { root: auditRoot })
    ctx.wbAudit.record({
      sessionId: asWbSessionId('s1'),
      userId: asWbUserId('u1'),
      kind: 'session_event',
      summary: 's1 event',
      payload: {},
    })
    ctx.wbAudit.record({
      sessionId: asWbSessionId('s2'),
      userId: asWbUserId('u1'),
      kind: 'session_event',
      summary: 's2 event',
      payload: {},
    })
    const results = ctx.wbAudit.query({ sessionId: asWbSessionId('s1') })
    expect(results).toHaveLength(1)
    expect(results[0].summary).toBe('s1 event')
  })

  it('query() filters by kind', async () => {
    await ctx.plugin(WbAuditService, { root: auditRoot })
    ctx.wbAudit.record({
      sessionId: asWbSessionId('s1'),
      userId: asWbUserId('u1'),
      kind: 'session_event',
      summary: 'session',
      payload: {},
    })
    ctx.wbAudit.record({
      sessionId: asWbSessionId('s1'),
      userId: asWbUserId('u1'),
      kind: 'tool_result',
      summary: 'tool',
      payload: {},
    })
    const results = ctx.wbAudit.query({ kind: 'tool_result' })
    expect(results).toHaveLength(1)
    expect(results[0].summary).toBe('tool')
  })

  it('no delete/update method exists on the service', async () => {
    await ctx.plugin(WbAuditService, { root: auditRoot })
    expect((ctx.wbAudit as any).delete).toBeUndefined()
    expect((ctx.wbAudit as any).update).toBeUndefined()
  })

  it('daily rotation: entries on different dates land in different files', async () => {
    await ctx.plugin(WbAuditService, { root: auditRoot })
    // Mock Date to simulate two different dates
    const originalDate = Date
    const date1 = new Date('2026-01-15T12:00:00Z')
    const date2 = new Date('2026-01-16T12:00:00Z')
    let currentDate = date1
    vi.useFakeTimers()
    vi.setSystemTime(currentDate)

    ctx.wbAudit.record({
      sessionId: asWbSessionId('s1'),
      userId: asWbUserId('u1'),
      kind: 'session_event',
      summary: 'day1',
      payload: {},
    })

    currentDate = date2
    vi.setSystemTime(currentDate)

    ctx.wbAudit.record({
      sessionId: asWbSessionId('s1'),
      userId: asWbUserId('u1'),
      kind: 'session_event',
      summary: 'day2',
      payload: {},
    })

    vi.useRealTimers()

    const files = fs.readdirSync(auditRoot).filter(f => f.endsWith('.jsonl'))
    expect(files).toContain('audit-2026-01-15.jsonl')
    expect(files).toContain('audit-2026-01-16.jsonl')
    // Both entries queryable
    const all = ctx.wbAudit.query({})
    expect(all).toHaveLength(2)
  })

  it('malformed JSONL line is skipped and logged', async () => {
    // Write a malformed line directly
    const filePath = path.join(auditRoot, 'audit-2026-01-01.jsonl')
    fs.mkdirSync(auditRoot, { recursive: true })
    fs.writeFileSync(filePath, '{"valid":true}\n{invalid}\n', 'utf8')
    await ctx.plugin(WbAuditService, { root: auditRoot })
    const results = ctx.wbAudit.query({})
    expect(results).toHaveLength(1)
  })

  it('session/event with tool/result results in audit entry kind tool_result', async () => {
    await ctx.plugin(WbAuditService, { root: auditRoot })
    const session = createMockSession('s1')
    const toolResultEvent = {
      type: 'tool/result',
      seq: 1,
      time: Date.now(),
      data: {
        turn: 1,
        step: 1,
        message: { content: [{ type: 'text', text: 'result' }] },
      },
    } as unknown as SessionEvent
    ctx.emit('session/event', session, toolResultEvent)
    const results = ctx.wbAudit.query({ kind: 'tool_result' })
    expect(results).toHaveLength(1)
    expect(results[0].sessionId).toBe(asWbSessionId('s1'))
  })

  it('wb/rag/retrieved event results in audit entry kind rag_retrieval', async () => {
    await ctx.plugin(WbAuditService, { root: auditRoot })
    const ragEvent: WbRagRetrievedEvent = {
      sessionId: asWbSessionId('s2'),
      result: {
        chunks: [],
        citations: [],
        filtered: [],
      },
    }
    ctx.emit('wb/rag/retrieved', ragEvent)
    const results = ctx.wbAudit.query({ kind: 'rag_retrieval' })
    expect(results).toHaveLength(1)
    expect(results[0].sessionId).toBe(asWbSessionId('s2'))
  })

  it('wb/policy/decision event is skipped due to missing sessionId gap', async () => {
    await ctx.plugin(WbAuditService, { root: auditRoot })
    const policyEvent: WbPolicyDecisionEvent = {
      user: asWbUserId('u1'),
      agentPreset: 'test',
      action: 'invoke_tool',
      classification: 'INTERNAL',
      destination: 'local',
      decision: 'ALLOW',
      reason: 'test',
    }
    ctx.emit('wb/policy/decision', policyEvent)
    // Should not create an entry because of missing sessionId gap
    const results = ctx.wbAudit.query({ kind: 'policy_decision' })
    expect(results).toHaveLength(0)
  })

  it('wb/ingestion/completed event is skipped due to missing sessionId gap', async () => {
    await ctx.plugin(WbAuditService, { root: auditRoot })
    const ingestionEvent: WbIngestionCompletedEvent = {
      documentId: asWbDocumentId('doc1'),
      classification: 'PUBLIC',
    }
    ctx.emit('wb/ingestion/completed', ingestionEvent)
    const results = ctx.wbAudit.query({ kind: 'ingestion_completed' })
    expect(results).toHaveLength(0)
  })
})