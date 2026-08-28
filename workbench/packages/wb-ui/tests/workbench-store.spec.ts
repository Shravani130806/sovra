import { describe, expect, it, beforeEach } from 'vitest'
import {
  asWbAuditEntryId, asWbDocumentId, asWbSessionId, asWbUserId,
  type WbAuditEntry,
} from '@mrpl/dsh-workbench-types'
import {
  getWorkbenchState, publishAuditEntry, publishChatDecision,
  publishRetrievalCitations, resetWorkbenchState, subscribeWorkbench,
} from '../src/client/live/workbench-store.ts'

let seq = 0
function entry(overrides: Partial<WbAuditEntry> = {}): WbAuditEntry {
  seq++
  return {
    id: asWbAuditEntryId(`e${seq}`),
    at: `2026-08-28T10:00:${String(seq).padStart(2, '0')}.000Z`,
    sessionId: asWbSessionId('s1'),
    userId: asWbUserId('u1'),
    kind: 'policy_decision',
    summary: 'ALLOW read',
    payload: {},
    ...overrides,
  }
}

describe('live workbench panels', () => {
  beforeEach(() => resetWorkbenchState())

  it('starts empty — an empty panel is a real answer, not a pending one', () => {
    const s = getWorkbenchState()
    expect(s.activity).toEqual([])
    expect(s.citations).toEqual([])
    expect(s.artifacts).toEqual([])
  })

  describe('activity', () => {
    it('records each audit entry, newest first', () => {
      publishAuditEntry(entry({ summary: 'first' }))
      publishAuditEntry(entry({ summary: 'second' }))
      expect(getWorkbenchState().activity.map((a) => a.summary)).toEqual(['second', 'first'])
    })

    it('is bounded, so a long session cannot grow state without limit', () => {
      for (let i = 0; i < 150; i++) publishAuditEntry(entry())
      expect(getWorkbenchState().activity).toHaveLength(100)
    })
  })

  describe('artifacts', () => {
    it('appears when an artifact tool result is recorded', () => {
      publishAuditEntry(entry({
        kind: 'tool_result',
        payload: { name: 'wb_generate_report', value: { path: '/out/note.docx', citations: [1, 2] } },
      }))
      const [artifact] = getWorkbenchState().artifacts
      expect(artifact).toMatchObject({ filename: 'note.docx', kind: 'report', sourceCount: 2 })
    })

    it('ignores tool results that are not artifact generations', () => {
      publishAuditEntry(entry({ kind: 'tool_result', payload: { name: 'read', value: {} } }))
      expect(getWorkbenchState().artifacts).toHaveLength(0)
    })

    it('maps each of the four generator tools to its own kind', () => {
      for (const [tool, kind] of [
        ['wb_generate_report', 'report'],
        ['wb_generate_approval_note', 'approval_note'],
        ['wb_generate_spreadsheet', 'spreadsheet'],
        ['wb_generate_presentation', 'presentation'],
      ]) {
        resetWorkbenchState()
        publishAuditEntry(entry({ kind: 'tool_result', payload: { name: tool, value: { path: 'x' } } }))
        expect(getWorkbenchState().artifacts[0]!.kind).toBe(kind)
      }
    })

    it('a malformed payload does not crash the panel', () => {
      expect(() => publishAuditEntry(entry({
        kind: 'tool_result', payload: { name: 'wb_generate_report' },
      }))).not.toThrow()
      expect(getWorkbenchState().artifacts[0]!.sourceCount).toBe(0)
    })
  })

  describe('sources', () => {
    it('shows the citations of the latest retrieval', () => {
      publishRetrievalCitations([{ documentId: asWbDocumentId('d1'), title: 'SOP 4.2' }])
      expect(getWorkbenchState().citations).toHaveLength(1)
    })

    it('replaces rather than accumulates across retrievals', () => {
      // Carrying a previous query's sources forward would attribute evidence
      // to an answer that never used it.
      publishRetrievalCitations([{ documentId: asWbDocumentId('d1'), title: 'A' }])
      publishRetrievalCitations([{ documentId: asWbDocumentId('d2'), title: 'B' }])
      expect(getWorkbenchState().citations.map((c) => c.title)).toEqual(['B'])
    })

    it('a retrieval that returned nothing clears the panel', () => {
      publishRetrievalCitations([{ documentId: asWbDocumentId('d1'), title: 'A' }])
      publishRetrievalCitations([])
      expect(getWorkbenchState().citations).toEqual([])
    })
  })

  describe('chat posture', () => {
    it('a DENY blocks the composer and carries the reason', () => {
      publishChatDecision('DENY', 'CLEARANCE_INSUFFICIENT')
      expect(getWorkbenchState().chat).toMatchObject({
        isPolicyBlocked: true, isApprovalRequired: false, blockReason: 'CLEARANCE_INSUFFICIENT',
      })
    })

    it('REQUIRE_APPROVAL asks rather than blocks', () => {
      publishChatDecision('REQUIRE_APPROVAL', 'needs sign-off')
      expect(getWorkbenchState().chat).toMatchObject({
        isPolicyBlocked: false, isApprovalRequired: true,
      })
    })

    it('a later ALLOW clears a previous block', () => {
      publishChatDecision('DENY', 'no')
      publishChatDecision('ALLOW', 'within clearance')
      expect(getWorkbenchState().chat).toMatchObject({
        isPolicyBlocked: false, isApprovalRequired: false, blockReason: '',
      })
    })
  })

  describe('subscriptions', () => {
    it('notifies on each publish', () => {
      let calls = 0
      const off = subscribeWorkbench(() => calls++)
      publishAuditEntry(entry())
      publishRetrievalCitations([])
      expect(calls).toBe(2)
      off()
    })

    it('stops after unsubscribe', () => {
      let calls = 0
      subscribeWorkbench(() => calls++)()
      publishAuditEntry(entry())
      expect(calls).toBe(0)
    })

    it('reset clears one session before the next', () => {
      publishAuditEntry(entry())
      publishRetrievalCitations([{ documentId: asWbDocumentId('d1'), title: 'A' }])
      resetWorkbenchState()
      expect(getWorkbenchState().activity).toEqual([])
      expect(getWorkbenchState().citations).toEqual([])
    })
  })
})
