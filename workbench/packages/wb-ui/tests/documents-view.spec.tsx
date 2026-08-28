import { describe, expect, it, beforeEach, vi } from 'vitest'
import { asWbDocumentId } from '@mrpl/dsh-workbench-types'
import { act, render, screen, fireEvent } from './render.tsx'
import { DocumentsView } from '../src/client/documents/DocumentsView.tsx'
import {
  completeUpload, getDocumentsState, resetDocuments, setDocuments,
} from '../src/client/live/documents-store.ts'
import { getNavigationState, resetNavigation } from '../src/client/live/navigation-store.ts'

const file = (name: string) => new File(['contents'], name, { type: 'text/plain' })

describe('DocumentsView', () => {
  beforeEach(() => {
    resetDocuments()
    resetNavigation()
  })

  it('defaults the classification picker to INTERNAL', () => {
    render(<DocumentsView />)
    expect((screen.getByLabelText('Classification') as HTMLSelectElement).value).toBe('INTERNAL')
  })

  it('offers all four bands', () => {
    render(<DocumentsView />)
    const options = [...(screen.getByLabelText('Classification') as HTMLSelectElement).options]
    expect(options.map((o) => o.value)).toEqual(['PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'RESTRICTED'])
  })

  it('queues a chosen file at the selected band', () => {
    const onIngest = vi.fn()
    render(<DocumentsView onIngest={onIngest} />)
    fireEvent.change(screen.getByLabelText('Classification'), { target: { value: 'CONFIDENTIAL' } })
    fireEvent.change(screen.getByLabelText('Choose files'), { target: { files: [file('pid.pdf')] } })
    expect(onIngest).toHaveBeenCalledWith(expect.any(String), expect.any(File), 'CONFIDENTIAL')
    expect(getDocumentsState().uploads[0]).toMatchObject({
      filename: 'pid.pdf', declaredClassification: 'CONFIDENTIAL', status: 'queued',
    })
  })

  it('the band is chosen before the file is read, so nothing lands unclassified', () => {
    render(<DocumentsView />)
    fireEvent.change(screen.getByLabelText('Classification'), { target: { value: 'RESTRICTED' } })
    fireEvent.change(screen.getByLabelText('Choose files'), { target: { files: [file('a.txt')] } })
    expect(getDocumentsState().uploads[0]!.declaredClassification).toBe('RESTRICTED')
  })

  it('accepts a dropped file', () => {
    const onIngest = vi.fn()
    const { container } = render(<DocumentsView onIngest={onIngest} />)
    const zone = container.querySelector('[class*="dropzone"]')!
    fireEvent.drop(zone, { dataTransfer: { files: [file('dropped.md')] } })
    expect(onIngest).toHaveBeenCalled()
  })

  it('queues every file of a multi-select', () => {
    render(<DocumentsView />)
    fireEvent.change(screen.getByLabelText('Choose files'), {
      target: { files: [file('a.txt'), file('b.txt')] },
    })
    expect(getDocumentsState().uploads).toHaveLength(2)
  })

  it('shows an auto-classification raise rather than hiding it', () => {
    // An operator who declared INTERNAL must see the document is stored higher.
    render(<DocumentsView />)
    fireEvent.change(screen.getByLabelText('Choose files'), { target: { files: [file('pid.pdf')] } })
    const jobId = getDocumentsState().uploads[0]!.id
    act(() => completeUpload(jobId, {
      id: asWbDocumentId('d1'), title: 'pid.pdf', classification: 'CONFIDENTIAL',
      declaredClassification: 'INTERNAL', chunks: 4, ingestedAt: new Date().toISOString(),
    }))
    expect(screen.getByText(/raised to CONFIDENTIAL/)).toBeDefined()
  })

  it('surfaces a downgrade as a failed upload', () => {
    // §9 invariant 6: displaying the lower band would make the UI complicit.
    render(<DocumentsView />)
    fireEvent.change(screen.getByLabelText('Classification'), { target: { value: 'RESTRICTED' } })
    fireEvent.change(screen.getByLabelText('Choose files'), { target: { files: [file('x.txt')] } })
    act(() => completeUpload(getDocumentsState().uploads[0]!.id, {
      id: asWbDocumentId('d1'), title: 'x.txt', classification: 'PUBLIC',
      declaredClassification: 'RESTRICTED', chunks: 1, ingestedAt: new Date().toISOString(),
    }))
    expect(screen.getByText(/downgraded/)).toBeDefined()
  })

  it('says the corpus is empty rather than showing a bare table', () => {
    render(<DocumentsView />)
    expect(screen.getByText('No documents ingested yet.')).toBeDefined()
  })

  it('lists ingested documents with their stored band', () => {
    setDocuments([{
      id: asWbDocumentId('d1'), title: 'SOP 4.2', classification: 'CONFIDENTIAL',
      declaredClassification: 'CONFIDENTIAL', chunks: 12, ingestedAt: '2026-08-28T10:00:00.000Z',
    }])
    render(<DocumentsView />)
    expect(screen.getByText('SOP 4.2')).toBeDefined()
    expect(screen.getByTestId('doc-band').textContent).toBe('CONFIDENTIAL')
    expect(screen.getByText('12')).toBeDefined()
  })

  it('clicking a document opens it in the viewer', () => {
    setDocuments([{
      id: asWbDocumentId('d-sop'), title: 'SOP 4.2', classification: 'INTERNAL',
      declaredClassification: 'INTERNAL', chunks: 3, ingestedAt: '2026-08-28T10:00:00.000Z',
    }])
    render(<DocumentsView />)
    fireEvent.click(screen.getByText('SOP 4.2'))
    expect(getNavigationState()).toMatchObject({ route: 'documents', documentId: 'd-sop' })
  })
})
