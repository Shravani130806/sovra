import { describe, expect, it, beforeEach } from 'vitest'
import { asWbDocumentId } from '@mrpl/dsh-workbench-types'
import { render, screen, fireEvent } from './render.tsx'
import { DocumentViewer } from '../src/client/documents/DocumentViewer.tsx'
import { resetDocuments, setDocuments } from '../src/client/live/documents-store.ts'
import { getNavigationState, openDocument, resetNavigation } from '../src/client/live/navigation-store.ts'

describe('DocumentViewer', () => {
  beforeEach(() => {
    resetDocuments()
    resetNavigation()
  })

  it('renders not found state when no valid document is open', () => {
    render(<DocumentViewer />)
    expect(screen.getByText('Document Not Found')).toBeDefined()
    expect(screen.getByText('The requested document was not found in the sovereign corpus.')).toBeDefined()
  })

  it('renders targeted document metadata and content when documentId is selected', () => {
    setDocuments([
      {
        id: asWbDocumentId('doc-101'),
        title: 'Compressor Maintenance Guide.pdf',
        classification: 'CONFIDENTIAL',
        declaredClassification: 'CONFIDENTIAL',
        chunks: 64,
        chunksData: [
          { id: 'c1', text: 'Step 1: Verify compressor valve seals.', page: 1, section: '3.2' },
          { id: 'c2', text: 'Step 2: Inspect secondary pressure gauges.', page: 2, section: '3.3' },
        ],
        ingestedAt: '2026-08-28T10:00:00.000Z',
      },
    ])

    openDocument(asWbDocumentId('doc-101'), { page: 1, section: '3.2' })
    render(<DocumentViewer />)

    expect(screen.getByText('Compressor Maintenance Guide.pdf')).toBeDefined()
    expect(screen.getAllByText('CONFIDENTIAL').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('Page 1 / 64')).toBeDefined()
    expect(screen.getByText('Target: 3.2')).toBeDefined()
    expect(screen.getByText('Step 1: Verify compressor valve seals.')).toBeDefined()
    expect(screen.getByText('doc-101')).toBeDefined()
  })

  it('back button navigates back to documents list', () => {
    setDocuments([
      {
        id: asWbDocumentId('doc-101'),
        title: 'Compressor Guide.pdf',
        classification: 'INTERNAL',
        declaredClassification: 'INTERNAL',
        chunks: 1,
        ingestedAt: '2026-08-28T10:00:00.000Z',
      },
    ])
    openDocument(asWbDocumentId('doc-101'))
    render(<DocumentViewer />)

    fireEvent.click(screen.getByLabelText('Back to documents'))
    expect(getNavigationState().route).toBe('documents')
    expect(getNavigationState().documentId).toBeUndefined()
  })
})
