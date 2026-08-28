import { describe, expect, it, beforeEach } from 'vitest'
import { asWbAuditEntryId, asWbSessionId, asWbUserId, type WbAuditEntry } from '@mrpl/dsh-workbench-types'
import { act, render, screen, fireEvent } from './render.tsx'
import { ActivityView } from '../src/client/activity/ActivityView.tsx'
import { publishAuditEntry, resetWorkbenchState } from '../src/client/live/workbench-store.ts'

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
    payload: { decision: 'ALLOW' },
    ...overrides,
  }
}

describe('ActivityView', () => {
  beforeEach(() => resetWorkbenchState())

  it('says the log is empty rather than showing a bare table', () => {
    render(<ActivityView />)
    expect(screen.getByText('No activity recorded yet.')).toBeDefined()
  })

  it('never invents a row', () => {
    // An earlier version appended a fixed "BLOCKED" entry on every render,
    // showing a refusal that never happened — the UI asserting a policy event
    // the audit log had no record of.
    render(<ActivityView />)
    expect(screen.queryByText('BLOCKED')).toBeNull()
  })

  it('renders recorded entries newest first', () => {
    act(() => {
      publishAuditEntry(entry({ summary: 'first event' }))
      publishAuditEntry(entry({ summary: 'second event' }))
    })
    const { container } = render(<ActivityView />)
    const rows = [...container.querySelectorAll('tbody tr')]
    expect(rows[0]!.textContent).toContain('second event')
    expect(rows[1]!.textContent).toContain('first event')
  })

  it('marks a DENY as blocked', () => {
    act(() => publishAuditEntry(entry({ summary: 'DENY web_search', payload: { decision: 'DENY' } })))
    render(<ActivityView />)
    expect(screen.getByText('BLOCKED')).toBeDefined()
  })

  it('does not mark an ALLOW as blocked', () => {
    act(() => publishAuditEntry(entry({ payload: { decision: 'ALLOW' } })))
    render(<ActivityView />)
    expect(screen.getByText('OK')).toBeDefined()
    expect(screen.queryByText('BLOCKED')).toBeNull()
  })

  it('does not mark a non-policy event as blocked', () => {
    act(() => publishAuditEntry(entry({ kind: 'tool_result', summary: 'read', payload: {} })))
    render(<ActivityView />)
    expect(screen.getByText('OK')).toBeDefined()
  })

  it('highlights the blocked row itself, not only its badge', () => {
    act(() => publishAuditEntry(entry({ payload: { decision: 'DENY' } })))
    const { container } = render(<ActivityView />)
    expect(container.querySelector('tbody tr')!.className).toMatch(/rowBlocked/)
  })

  describe('filtering', () => {
    function seed() {
      act(() => {
        publishAuditEntry(entry({ kind: 'policy_decision', summary: 'a decision' }))
        publishAuditEntry(entry({ kind: 'tool_result', summary: 'a tool ran', payload: {} }))
        publishAuditEntry(entry({ kind: 'rag_retrieval', summary: 'a retrieval', payload: {} }))
      })
    }

    it('shows every kind by default', () => {
      seed()
      const { container } = render(<ActivityView />)
      expect(container.querySelectorAll('tbody tr')).toHaveLength(3)
    })

    it('narrows to one kind', () => {
      seed()
      const { container } = render(<ActivityView />)
      fireEvent.click(screen.getByText('Tools'))
      const rows = [...container.querySelectorAll('tbody tr')]
      expect(rows).toHaveLength(1)
      expect(rows[0]!.textContent).toContain('a tool ran')
    })

    it('returns to everything', () => {
      seed()
      const { container } = render(<ActivityView />)
      fireEvent.click(screen.getByText('Policy'))
      fireEvent.click(screen.getByText('All'))
      expect(container.querySelectorAll('tbody tr')).toHaveLength(3)
    })

    it('a filter matching nothing says so rather than showing an empty table', () => {
      seed()
      render(<ActivityView />)
      fireEvent.click(screen.getByText('Ingestion'))
      expect(screen.getByText('No activity recorded yet.')).toBeDefined()
    })
  })
})
