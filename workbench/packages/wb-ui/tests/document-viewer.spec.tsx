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

  it('renders default document details when no specific document is open', () => {
    render(<DocumentViewer />)
    expect(screen.getByText('Engineering Safety Manual.pdf')).toBeDefined()
    expect(screen.getByText('RESTRICTED')).toBeDefined()
  })

  it('renders targeted document metadata when documentId is selected', () => {
    setDocuments([
      {
        id: asWbDocumentId('doc-101'),
        title: 'Compressor Maintenance Guide.pdf',
        classification: 'CONFIDENTIAL',
        declaredClassification: 'CONFIDENTIAL',
        chunks: 64,
        ingestedAt: '2026-08-28T10:00:00.000Z',
      },
    ])

    openDocument(asWbDocumentId('doc-101'), { page: 15, section: '3.2' })
    render(<DocumentViewer />)

    expect(screen.getByText('Compressor Maintenance Guide.pdf')).toBeDefined()
    expect(screen.getByText('CONFIDENTIAL')).toBeDefined()
    expect(screen.getByText('Page 15 / 64')).toBeDefined()
    expect(screen.getByText('Section 3.2')).toBeDefined()
    expect(screen.getByText('Page 15 • Section 3.2')).toBeDefined()
  })

  it('back button navigates back to documents list', () => {
    openDocument(asWbDocumentId('doc-101'))
    render(<DocumentViewer />)

    fireEvent.click(screen.getByLabelText('Back to documents'))
    expect(getNavigationState().route).toBe('documents')
    expect(getNavigationState().documentId).toBeUndefined()
  })
})
