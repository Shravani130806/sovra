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
import ExcelJS from 'exceljs'
import PptxGenJS from 'pptxgenjs'

import type { WbCitation } from '@mrpl/dsh-workbench-types'

import type { ProvenanceBlock } from './provenance.ts'

// ---------------------------------------------------------------------------
// Document generation
// ---------------------------------------------------------------------------

export async function generateDocx(
  title: string,
  findings: string,
  citations: readonly WbCitation[],
  provenance: ProvenanceBlock,
): Promise<Buffer> {
  const doc = new DocxDocument({
    sections: [
      {
        properties: {},
        children: [
          new Paragraph({
            children: [new TextRun({ text: title, bold: true, size: 32 })],
            heading: HeadingLevel.HEADING_1,
            alignment: AlignmentType.CENTER,
          }),
          new Paragraph({ text: '' }),
          new Paragraph({
            children: [new TextRun({ text: 'Findings', bold: true, size: 28 })],
            heading: HeadingLevel.HEADING_2,
          }),
          new Paragraph({ text: findings }),
          new Paragraph({ text: '' }),
          new Paragraph({
            children: [
              new TextRun({ text: 'Sources', bold: true, size: 28 }),
            ],
            heading: HeadingLevel.HEADING_2,
          }),
          ...citations.map(
            (c) =>
              new Paragraph({
                children: [
                  new TextRun({
                    text: `${c.title} (${c.documentId})`,
                    size: 22,
                  }),
                  ...(c.page != null
                    ? [
                        new TextRun({
                          text: ` — p. ${c.page}`,
                          size: 22,
                          italics: true,
                        }),
                      ]
                    : []),
                ],
              }),
          ),
          new Paragraph({ text: '' }),
          new Paragraph({
            children: [
              new TextRun({ text: 'Provenance', bold: true, size: 28 }),
            ],
            heading: HeadingLevel.HEADING_2,
          }),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({
                children: [
                  new TableCell({
                    children: [new Paragraph('Generated At')],
                    borders: { top: { style: BorderStyle.SINGLE, size: 1 } },
                  }),
                  new TableCell({
                    children: [new Paragraph(provenance.generatedAt)],
                    borders: { top: { style: BorderStyle.SINGLE, size: 1 } },
                  }),
                ],
              }),
              new TableRow({
                children: [
                  new TableCell({
                    children: [new Paragraph('Tools Used')],
                  }),
                  new TableCell({
                    children: [
                      new Paragraph(provenance.toolsUsed.join(', ')),
                    ],
                  }),
                ],
              }),
            ],
          }),
        ],
      },
    ],
  })

  return Packer.toBuffer(doc) as unknown as Promise<Buffer>
}

// ---------------------------------------------------------------------------
// Spreadsheet generation
// ---------------------------------------------------------------------------

export async function generateXlsx(
  title: string,
  findings: string,
  citations: readonly WbCitation[],
  provenance: ProvenanceBlock,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'wb-artifacts'
  workbook.created = new Date()

  const findingsSheet = workbook.addWorksheet('Findings')
  findingsSheet.columns = [
    { header: 'Title', key: 'title', width: 40 },
    { header: 'Content', key: 'content', width: 80 },
  ]
  findingsSheet.addRow({ title, content: findings })

  const sourcesSheet = workbook.addWorksheet('Sources')
  sourcesSheet.columns = [
    { header: 'Document ID', key: 'documentId', width: 30 },
    { header: 'Title', key: 'title', width: 40 },
    { header: 'Page', key: 'page', width: 10 },
    { header: 'Section', key: 'section', width: 30 },
  ]
  for (const c of citations) {
    sourcesSheet.addRow({
      documentId: c.documentId,
      title: c.title,
      page: c.page ?? '',
      section: c.section ?? '',
    })
  }

  const provenanceSheet = workbook.addWorksheet('Provenance')
  provenanceSheet.columns = [
    { header: 'Field', key: 'field', width: 25 },
    { header: 'Value', key: 'value', width: 60 },
  ]
  provenanceSheet.addRow({ field: 'Generated At', value: provenance.generatedAt })
  provenanceSheet.addRow({
    field: 'Tools Used',
    value: provenance.toolsUsed.join(', '),
  })

  return workbook.xlsx.writeBuffer() as unknown as Promise<Buffer>
}

// ---------------------------------------------------------------------------
// Presentation generation
// ---------------------------------------------------------------------------

export async function generatePptx(
  title: string,
  findings: string,
  citations: readonly WbCitation[],
  provenance: ProvenanceBlock,
): Promise<Buffer> {
  const pptx = new PptxGenJS()
  pptx.author = 'wb-artifacts'
  pptx.title = title

  // Title slide
  const titleSlide = pptx.addSlide()
  titleSlide.addText(title, {
    x: 1,
    y: 1,
    w: 8,
    h: 1.5,
    fontSize: 32,
    bold: true,
    color: '1F4E79',
  })
  titleSlide.addText(`Generated: ${provenance.generatedAt}`, {
    x: 1,
    y: 3,
    w: 8,
    h: 0.5,
    fontSize: 12,
    color: '666666',
  })

  // Findings slide
  const findingsSlide = pptx.addSlide()
  findingsSlide.addText('Findings', {
    x: 0.5,
    y: 0.5,
    w: 9,
    h: 0.8,
    fontSize: 24,
    bold: true,
  })
  findingsSlide.addText(findings, {
    x: 0.5,
    y: 1.5,
    w: 9,
    h: 4,
    fontSize: 14,
    valign: 'top',
  })

  // Sources slide
  if (citations.length > 0) {
    const sourcesSlide = pptx.addSlide()
    sourcesSlide.addText('Sources', {
      x: 0.5,
      y: 0.5,
      w: 9,
      h: 0.8,
      fontSize: 24,
      bold: true,
    })
    const sourceTexts = citations.map(
      (c) => `${c.title} (${c.documentId})${c.page != null ? ` — p. ${c.page}` : ''}`,
    )
    sourcesSlide.addText(sourceTexts.join('\n'), {
      x: 0.5,
      y: 1.5,
      w: 9,
      h: 4,
      fontSize: 12,
      valign: 'top',
    })
  }

  // Provenance slide
  const provSlide = pptx.addSlide()
  provSlide.addText('Provenance', {
    x: 0.5,
    y: 0.5,
    w: 9,
    h: 0.8,
    fontSize: 24,
    bold: true,
  })
  provSlide.addText(
    `Generated: ${provenance.generatedAt}\nTools: ${provenance.toolsUsed.join(', ')}`,
    {
      x: 0.5,
      y: 1.5,
      w: 9,
      h: 2,
      fontSize: 12,
      valign: 'top',
    },
  )

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const buffer: any = await pptx.write({ outputType: 'nodebuffer' })
  return buffer as Buffer
}
