import { describe, expect, it, beforeEach } from 'vitest'
import { render, screen, fireEvent } from './render.tsx'
import { MessageList } from '../src/client/conversation/MessageList.tsx'
import {
  appendDelta, finishTurn, resetChat, startTurn, upsertToolNode,
} from '../src/client/live/chat-store.ts'
import { publishRetrievalCitations, resetWorkbenchState } from '../src/client/live/workbench-store.ts'
import { asWbDocumentId } from '@mrpl/dsh-workbench-types'

describe('MessageList', () => {
  beforeEach(() => {
    resetChat()
    resetWorkbenchState()
  })

  it('renders nothing before a turn exists', () => {
    const { container } = render(<MessageList />)
    expect(container.querySelectorAll('p')).toHaveLength(0)
  })

  it('renders the user question and the streamed answer', () => {
    startTurn('what feeds P-101?', new AbortController())
    appendDelta('P-101 is fed from V-100.')
    render(<MessageList />)
    expect(screen.getByText(/what feeds P-101/)).toBeDefined()
    expect(screen.getByText(/fed from V-100/)).toBeDefined()
  })

  it('renders user attachments as badges', () => {
    startTurn('Please review', new AbortController(), ['report.pdf', 'diagram.png'])
    render(<MessageList />)
    expect(screen.getByText('📎 report.pdf')).toBeDefined()
    expect(screen.getByText('📎 diagram.png')).toBeDefined()
    expect(screen.getByText(/Please review/)).toBeDefined()
  })

  it('shows a working indicator only while a turn is empty and streaming', () => {
    startTurn('q', new AbortController())
    const view = render(<MessageList />)
    expect(screen.getByText('Working…')).toBeDefined()
    view.unmount()

    appendDelta('answer')
    render(<MessageList />)
    expect(screen.queryByText('Working…')).toBeNull()
  })

  it('renders [n] markers as citation superscripts, not literal text', () => {
    startTurn('q', new AbortController())
    appendDelta('The seal is degraded [1] and vibration is high [2].')
    const { container } = render(<MessageList />)
    const sups = container.querySelectorAll('sup')
    expect([...sups].map((s) => s.textContent)).toEqual(['1', '2'])
  })

  it('renders model text as text — markup cannot reach the page', () => {
    // Model output is untrusted; rendering it as HTML would let a document in
    // the corpus inject markup into the operator's UI.
    startTurn('q', new AbortController())
    appendDelta('<img src=x onerror="alert(1)">')
    const { container } = render(<MessageList />)
    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByText(/onerror/)).toBeDefined()
  })

  describe('tool cards', () => {
    it('shows the tool name and an argument preview', () => {
      startTurn('q', new AbortController())
      upsertToolNode({ callId: 'c1', name: 'wb_ocr_extract', args: { mediaType: 'image/png' }, status: 'running' })
      render(<MessageList />)
      expect(screen.getByText('wb_ocr_extract')).toBeDefined()
      expect(screen.getByText(/mediaType: image\/png/)).toBeDefined()
    })

    it('truncates a long argument so a base64 payload cannot swamp the card', () => {
      startTurn('q', new AbortController())
      upsertToolNode({ callId: 'c1', name: 'wb_ocr_extract', args: { image: 'A'.repeat(500) }, status: 'running' })
      render(<MessageList />)
      expect(screen.getByText(/…/)).toBeDefined()
    })

    it('carries the policy verdict as a badge', () => {
      startTurn('q', new AbortController())
      upsertToolNode({ callId: 'c1', name: 'web_search', status: 'denied', decision: 'DENY' })
      render(<MessageList />)
      expect(screen.getByText('DENY')).toBeDefined()
    })

    it('shows the denial reason on the card, not only in the audit log', () => {
      startTurn('q', new AbortController())
      upsertToolNode({
        callId: 'c1', name: 'web_search', status: 'denied',
        decision: 'DENY', decisionReason: 'CLEARANCE_INSUFFICIENT',
      })
      render(<MessageList />)
      expect(screen.getByText('CLEARANCE_INSUFFICIENT')).toBeDefined()
    })

    it('badges each decision kind distinctly', () => {
      startTurn('q', new AbortController())
      upsertToolNode({ callId: 'c1', name: 'a', decision: 'ALLOW', status: 'done' })
      upsertToolNode({ callId: 'c2', name: 'b', decision: 'REQUIRE_APPROVAL', status: 'pending' })
      upsertToolNode({ callId: 'c3', name: 'c', decision: 'ALLOW_WITH_REDACTION', status: 'done' })
      render(<MessageList />)
      for (const kind of ['ALLOW', 'REQUIRE_APPROVAL', 'ALLOW_WITH_REDACTION']) {
        expect(screen.getByText(kind), `${kind} badge missing`).toBeDefined()
      }
    })

    it('the result is collapsed until asked for', () => {
      startTurn('q', new AbortController())
      upsertToolNode({ callId: 'c1', name: 'read', status: 'done', result: 'file contents here' })
      render(<MessageList />)
      expect(screen.queryByText('file contents here')).toBeNull()
      fireEvent.click(screen.getByRole('button', { expanded: false }))
      expect(screen.getByText('file contents here')).toBeDefined()
    })
  })

  it('sources and artifacts appear only once the answer has settled', () => {
    // Showing them early implies the answer is already grounded when it may
    // yet change.
    startTurn('q', new AbortController())
    appendDelta('partial')
    const view = render(<MessageList />)
    expect(screen.queryByText(/Sources/i)).toBeNull()
    view.unmount()

    // Citations are what the Sources panel renders; without them it correctly
    // shows nothing at all rather than an empty panel.
    publishRetrievalCitations([{ documentId: asWbDocumentId('d1'), title: 'SOP 4.2', page: 4 }])
    finishTurn()
    render(<MessageList />)
    expect(screen.getByText('Sources')).toBeDefined()
    expect(screen.getByText('SOP 4.2')).toBeDefined()
  })
})
