import { describe, expect, it, beforeEach } from 'vitest'
import { asWbDocumentId } from '@mrpl/dsh-workbench-types'
import { render, screen, fireEvent } from './render.tsx'
import { SourcesView } from '../src/client/components/SourcesView.tsx'
import { publishRetrievalCitations, resetWorkbenchState } from '../src/client/live/workbench-store.ts'
import { getNavigationState, resetNavigation } from '../src/client/live/navigation-store.ts'

describe('SourcesView', () => {
  beforeEach(() => {
    resetWorkbenchState()
    resetNavigation()
  })

  it('renders nothing when no retrieval has run', () => {
    // Not an empty panel: that would imply retrieval ran and found nothing.
    const { container } = render(<SourcesView />)
    expect(container.firstChild).toBeNull()
  })

  it('numbers citations to match the [n] markers in the answer', () => {
    publishRetrievalCitations([
      { documentId: asWbDocumentId('d1'), title: 'SOP 4.2', page: 4 },
      { documentId: asWbDocumentId('d2'), title: 'P&ID Unit 400', section: '3.1' },
    ])
    render(<SourcesView />)
    expect(screen.getByText('1')).toBeDefined()
    expect(screen.getByText('2')).toBeDefined()
  })

  it('shows a page locator', () => {
    publishRetrievalCitations([{ documentId: asWbDocumentId('d1'), title: 'SOP', page: 12 }])
    render(<SourcesView />)
    expect(screen.getByText('Page 12')).toBeDefined()
  })

  it('shows a section locator when there is no page', () => {
    publishRetrievalCitations([{ documentId: asWbDocumentId('d1'), title: 'SOP', section: '4.2' }])
    render(<SourcesView />)
    expect(screen.getByText('Section 4.2')).toBeDefined()
  })

  it('says "Full document" when neither is given, rather than showing nothing', () => {
    publishRetrievalCitations([{ documentId: asWbDocumentId('d1'), title: 'SOP' }])
    render(<SourcesView />)
    expect(screen.getByText('Full document')).toBeDefined()
  })

  it('clicking a citation opens that document at the cited location', () => {
    // Without this a citation is a label, not something an engineer can check.
    publishRetrievalCitations([{ documentId: asWbDocumentId('d-sop'), title: 'SOP 4.2', page: 12 }])
    render(<SourcesView />)
    fireEvent.click(screen.getByText('SOP 4.2'))
    expect(getNavigationState()).toMatchObject({
      route: 'documents', documentId: 'd-sop', locator: { page: 12 },
    })
  })

  it('carries a section locator through the click', () => {
    publishRetrievalCitations([{ documentId: asWbDocumentId('d1'), title: 'Manual', section: '7.3' }])
    render(<SourcesView />)
    fireEvent.click(screen.getByText('Manual'))
    expect(getNavigationState().locator).toEqual({ section: '7.3' })
  })

  it('replaces its list when a new retrieval runs', () => {
    publishRetrievalCitations([{ documentId: asWbDocumentId('d1'), title: 'First' }])
    const view = render(<SourcesView />)
    expect(screen.getByText('First')).toBeDefined()
    view.unmount()

    publishRetrievalCitations([{ documentId: asWbDocumentId('d2'), title: 'Second' }])
    render(<SourcesView />)
    expect(screen.queryByText('First')).toBeNull()
    expect(screen.getByText('Second')).toBeDefined()
  })
})
