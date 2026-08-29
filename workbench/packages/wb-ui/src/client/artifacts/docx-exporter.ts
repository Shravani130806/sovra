/**
 * Real OpenXML Word Document (.docx) generation for Sovereign AI Workbench.
 *
 * Converts structured text, markdown, findings, citations, and provenance
 * into valid Microsoft Word (.docx) binary Blobs using the `docx` library.
 *
 * @module @mrpl/dsh-workbench-ui/client/artifacts/docx-exporter
 */

import {
  Document as DocxDocument,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
} from 'docx'
import type { WbCitation } from '@mrpl/dsh-workbench-types'

export interface ProvenanceInfo {
  generatedAt?: string | undefined
  toolsUsed?: string[] | undefined
  author?: string | undefined
  classification?: string | undefined
}

/**
 * Creates a genuine binary OpenXML .docx Blob.
 */
export async function createDocxBlob(
  title: string,
  content: string,
  citations: readonly WbCitation[] = [],
  provenance?: ProvenanceInfo,
): Promise<Blob> {
  const paragraphs: Paragraph[] = []

  // Document Main Header
  paragraphs.push(
    new Paragraph({
      children: [
        new TextRun({
          text: title.replace(/\.docx?$/i, '').replace(/_/g, ' '),
          bold: true,
          size: 36,
          color: '1E293B',
        }),
      ],
      heading: HeadingLevel.HEADING_1,
      alignment: AlignmentType.CENTER,
      spacing: { after: 300 },
    }),
  )

  // Classification & Metadata Banner if present
  if (provenance?.classification) {
    paragraphs.push(
      new Paragraph({
        children: [
          new TextRun({
            text: `CLASSIFICATION: ${provenance.classification.toUpperCase()}`,
            bold: true,
            size: 20,
            color: provenance.classification.toUpperCase() === 'RESTRICTED' ? 'DC2626' : '059669',
          }),
        ],
        alignment: AlignmentType.CENTER,
        spacing: { after: 200 },
      }),
    )
  }

  // Body content parsing (handles markdown headers, bullets, and plain lines)
  const rawLines = content.split('\n')
  for (const rawLine of rawLines) {
    const line = rawLine.trimEnd()
    const trimmed = line.trim()

    if (!trimmed) {
      paragraphs.push(new Paragraph({ spacing: { after: 120 } }))
      continue
    }

    if (trimmed.startsWith('# ')) {
      paragraphs.push(
        new Paragraph({
          children: [new TextRun({ text: trimmed.slice(2), bold: true, size: 28, color: '0F172A' })],
          heading: HeadingLevel.HEADING_1,
          spacing: { before: 200, after: 120 },
        }),
      )
    } else if (trimmed.startsWith('## ')) {
      paragraphs.push(
        new Paragraph({
          children: [new TextRun({ text: trimmed.slice(3), bold: true, size: 24, color: '1E293B' })],
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 160, after: 100 },
        }),
      )
    } else if (trimmed.startsWith('### ')) {
      paragraphs.push(
        new Paragraph({
          children: [new TextRun({ text: trimmed.slice(4), bold: true, size: 20, color: '334155' })],
          heading: HeadingLevel.HEADING_3,
          spacing: { before: 120, after: 80 },
        }),
      )
    } else if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      paragraphs.push(
        new Paragraph({
          children: [new TextRun({ text: `• ${trimmed.slice(2)}`, size: 22, color: '1E293B' })],
          bullet: { level: 0 },
          spacing: { after: 80 },
        }),
      )
    } else {
      paragraphs.push(
        new Paragraph({
          children: [new TextRun({ text: line, size: 22, color: '334155' })],
          spacing: { after: 100 },
        }),
      )
    }
  }

  // Sources & Citations section
  if (citations && citations.length > 0) {
    paragraphs.push(
      new Paragraph({
        children: [new TextRun({ text: 'Sources & Citations', bold: true, size: 24, color: '0F172A' })],
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 300, after: 120 },
      }),
    )

    for (const c of citations) {
      paragraphs.push(
        new Paragraph({
          children: [
            new TextRun({ text: `${c.title}${c.documentId ? ` (${c.documentId})` : ''}`, size: 22, bold: true }),
            ...(c.page != null ? [new TextRun({ text: ` — Page ${c.page}`, size: 22, italics: true })] : []),
            ...(c.section ? [new TextRun({ text: ` [${c.section}]`, size: 22, italics: true })] : []),
          ],
          bullet: { level: 0 },
          spacing: { after: 60 },
        }),
      )
    }
  }

  // Governance & Provenance Table
  const generatedAt = provenance?.generatedAt ?? new Date().toISOString()
  const toolsUsed = (provenance?.toolsUsed ?? ['Sovereign AI Workbench (SOVRA)']).join(', ')
  const author = provenance?.author ?? 'SOVRA Air-Gapped Agent'

  paragraphs.push(
    new Paragraph({
      children: [new TextRun({ text: 'Provenance & Governance Record', bold: true, size: 24, color: '0F172A' })],
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 300, after: 120 },
    }),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({
          children: [
            new TableCell({
              children: [new Paragraph({ children: [new TextRun({ text: 'Generated At', bold: true, size: 20 })] })],
              borders: { top: { style: BorderStyle.SINGLE, size: 1, color: 'CBD5E1' } },
            }),
            new TableCell({
              children: [new Paragraph({ children: [new TextRun({ text: generatedAt, size: 20 })] })],
              borders: { top: { style: BorderStyle.SINGLE, size: 1, color: 'CBD5E1' } },
            }),
          ],
        }),
        new TableRow({
          children: [
            new TableCell({
              children: [new Paragraph({ children: [new TextRun({ text: 'System & Tooling', bold: true, size: 20 })] })],
            }),
            new TableCell({
              children: [new Paragraph({ children: [new TextRun({ text: toolsUsed, size: 20 })] })],
            }),
          ],
        }),
        new TableRow({
          children: [
            new TableCell({
              children: [new Paragraph({ children: [new TextRun({ text: 'Author / Agent', bold: true, size: 20 })] })],
            }),
            new TableCell({
              children: [new Paragraph({ children: [new TextRun({ text: author, size: 20 })] })],
            }),
          ],
        }),
      ],
    }),
  )

  const doc = new DocxDocument({
    sections: [
      {
        properties: {},
        children: paragraphs,
      },
    ],
  })

  return Packer.toBlob(doc)
}
