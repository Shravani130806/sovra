import { describe, expect, it } from 'vitest'
import { createDocxBlob } from '../src/client/artifacts/docx-exporter.ts'

describe('createDocxBlob', () => {
  it('generates a valid docx binary Blob from title, content, citations, and provenance', async () => {
    const blob = await createDocxBlob(
      'Safety_Inspection_Report.docx',
      '# Executive Summary\nAll air-gapped security protocols verified.\n- Pressure check passed\n- Temperature nominal',
      [
        {
          documentId: 'doc-1',
          title: 'SOP-Safety-Manual.pdf',
          page: 4,
          section: 'Section 2.1',
        },
      ],
      {
        classification: 'INTERNAL',
        toolsUsed: ['wb_generate_report', 'SOVRA Workbench'],
        author: 'Security Officer',
      },
    )

    expect(blob).toBeDefined()
    expect(blob.size).toBeGreaterThan(1000)
    // Microsoft Word OpenXML MIME type
    expect(blob.type).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document')
  })
})
