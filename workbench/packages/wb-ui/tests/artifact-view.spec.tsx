import { describe, expect, it, beforeEach, vi } from 'vitest'
import { asWbAuditEntryId } from '@mrpl/dsh-workbench-types'
import { render, screen, fireEvent, waitFor } from './render.tsx'
import { ArtifactView } from '../src/client/components/ArtifactView.tsx'
import { publishAuditEntry, resetWorkbenchState } from '../src/client/live/workbench-store.ts'

describe('ArtifactView', () => {
  beforeEach(() => {
    resetWorkbenchState()
  })

  it('renders nothing when no artifacts exist', () => {
    const { container } = render(<ArtifactView />)
    expect(container.firstChild).toBeNull()
  })

  it('renders artifact cards when artifacts are published', () => {
    publishAuditEntry({
      id: asWbAuditEntryId('a1'),
      at: '2026-08-28T10:00:00.000Z',
      kind: 'tool_result',
      summary: 'Generated approval note',
      principal: 'doc-analyst',
      payload: {
        name: 'wb_generate_approval_note',
        value: { path: '/artifacts/approval-note-p101.docx', citations: [{ title: 'SOP 4.2' }] },
      },
    })

    render(<ArtifactView />)
    expect(screen.getByText('Generated Artifacts')).toBeDefined()
    expect(screen.getByText('approval-note-p101.docx')).toBeDefined()
    expect(screen.getByText('approval note')).toBeDefined()
    expect(screen.getByText('1 sources')).toBeDefined()
    expect(screen.getByText('Local')).toBeDefined()
  })

  it('clicking preview opens the details modal and close button dismisses it', () => {
    publishAuditEntry({
      id: asWbAuditEntryId('a1'),
      at: '2026-08-28T10:00:00.000Z',
      kind: 'tool_result',
      summary: 'Generated report',
      principal: 'doc-analyst',
      payload: {
        name: 'wb_generate_report',
        value: { path: 'report.docx', citations: [] },
      },
    })

    render(<ArtifactView />)
    expect(screen.queryByRole('dialog')).toBeNull()

    fireEvent.click(screen.getByText('Preview'))
    expect(screen.getByRole('dialog')).toBeDefined()
    expect(screen.getByText('On-Premise / Sovereign')).toBeDefined()

    fireEvent.click(screen.getByLabelText('Close'))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('clicking download triggers file blob download', async () => {
    const createObjectUrlSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-url')
    const revokeObjectUrlSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    publishAuditEntry({
      id: asWbAuditEntryId('a1'),
      at: '2026-08-28T10:00:00.000Z',
      kind: 'tool_result',
      summary: 'Generated report',
      principal: 'doc-analyst',
      payload: {
        name: 'wb_generate_report',
        value: { path: 'report.docx', citations: [] },
      },
    })

    render(<ArtifactView />)
    fireEvent.click(screen.getByText('Download'))

    await waitFor(() => {
      expect(createObjectUrlSpy).toHaveBeenCalled()
      expect(clickSpy).toHaveBeenCalled()
      expect(revokeObjectUrlSpy).toHaveBeenCalled()
    })

    createObjectUrlSpy.mockRestore()
    revokeObjectUrlSpy.mockRestore()
    clickSpy.mockRestore()
  })
})
