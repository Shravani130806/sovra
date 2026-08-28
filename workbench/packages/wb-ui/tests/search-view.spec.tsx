import { describe, expect, it, beforeEach } from 'vitest'
import { asWbAuditEntryId, asWbDocumentId } from '@mrpl/dsh-workbench-types'
import { render, screen, fireEvent } from './render.tsx'
import { SearchView } from '../src/client/search/SearchView.tsx'
import { resetDocuments, setDocuments } from '../src/client/live/documents-store.ts'
import { resetChat, startTurn } from '../src/client/live/chat-store.ts'
import { publishAuditEntry, resetWorkbenchState } from '../src/client/live/workbench-store.ts'
import { getNavigationState, resetNavigation } from '../src/client/live/navigation-store.ts'

describe('SearchView', () => {
  beforeEach(() => {
    resetDocuments()
    resetChat()
    resetWorkbenchState()
    resetNavigation()
  })

  it('renders initial empty search prompt', () => {
    render(<SearchView />)
    expect(screen.getByText('Type to start searching your Sovereign Workspace.')).toBeDefined()
  })

  it('searches across documents, chat turns, and activity', () => {
    setDocuments([
      {
        id: asWbDocumentId('d1'),
        title: 'Safety Valve SOP.pdf',
        classification: 'RESTRICTED',
        declaredClassification: 'RESTRICTED',
        chunks: 10,
        ingestedAt: '2026-08-28T10:00:00.000Z',
      },
    ])

    startTurn('Please inspect the safety valve V-204', new AbortController())

    publishAuditEntry({
      id: asWbAuditEntryId('a1'),
      at: '2026-08-28T10:00:00.000Z',
      kind: 'policy_decision',
      summary: 'Policy check for safety valve analysis',
      principal: 'doc-analyst',
    })

    render(<SearchView />)
    const input = screen.getByPlaceholderText('Search documents, conversations, and activity...')
    fireEvent.change(input, { target: { value: 'safety' } })

    expect(screen.getByText('Documents')).toBeDefined()
    expect(screen.getByText('Safety Valve SOP.pdf')).toBeDefined()

    expect(screen.getByText('Conversations')).toBeDefined()
    expect(screen.getByText('Please inspect the safety valve V-204')).toBeDefined()

    expect(screen.getByText('Activity')).toBeDefined()
    expect(screen.getByText('Policy check for safety valve analysis')).toBeDefined()
  })

  it('shows no results message when query matches nothing', () => {
    render(<SearchView />)
    const input = screen.getByPlaceholderText('Search documents, conversations, and activity...')
    fireEvent.change(input, { target: { value: 'nonexistent-term-xyz' } })

    expect(screen.getByText('No results found for "nonexistent-term-xyz"')).toBeDefined()
  })

  it('clicking a document search result opens that document', () => {
    setDocuments([
      {
        id: asWbDocumentId('doc-valves'),
        title: 'Valve Catalog.pdf',
        classification: 'INTERNAL',
        declaredClassification: 'INTERNAL',
        chunks: 5,
        ingestedAt: '2026-08-28T10:00:00.000Z',
      },
    ])

    render(<SearchView />)
    const input = screen.getByPlaceholderText('Search documents, conversations, and activity...')
    fireEvent.change(input, { target: { value: 'Valve' } })

    fireEvent.click(screen.getByText('Valve Catalog.pdf'))
    expect(getNavigationState().route).toBe('documents')
    expect(getNavigationState().documentId).toBe('doc-valves')
  })
})
