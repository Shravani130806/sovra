/**
 * Real OpenXML Excel Spreadsheet (.xlsx) generation for Sovereign AI Workbench.
 *
 * Converts tabular data, CSV, markdown tables, key-value rows, findings,
 * citations, and provenance into valid Microsoft Excel (.xlsx) binary Blobs
 * using the `exceljs` library.
 *
 * @module @mrpl/dsh-workbench-ui/client/artifacts/xlsx-exporter
 */

import ExcelJS from 'exceljs'
import type { WbCitation } from '@mrpl/dsh-workbench-types'

export interface SpreadsheetProvenanceInfo {
  generatedAt?: string | undefined
  toolsUsed?: string[] | undefined
  author?: string | undefined
  classification?: string | undefined
}

/**
 * Parses markdown table rows or comma-separated lines into 2D string grid.
 */
function parseTableData(content: string): string[][] {
  const lines = content.split('\n').map((l) => l.trim()).filter(Boolean)
  const rows: string[][] = []

  const isMarkdownTable = lines.some((l) => l.startsWith('|') && l.endsWith('|'))

  if (isMarkdownTable) {
    for (const line of lines) {
      if (!line.startsWith('|')) continue
      // Skip markdown separator row |---|---|
      if (/^\|[-:\s|]+\|$/.test(line)) continue
      const cells = line
        .slice(1, -1)
        .split('|')
        .map((c) => c.trim())
      if (cells.length > 0) {
        rows.push(cells)
      }
    }
  } else {
    // Check for CSV / TSV / plain lines
    for (const line of lines) {
      if (line.includes('\t')) {
        rows.push(line.split('\t').map((c) => c.trim()))
      } else if (line.includes(',') && !line.startsWith('#')) {
        rows.push(line.split(',').map((c) => c.trim().replace(/^["']|["']$/g, '')))
      } else if (line.includes(':') && !line.startsWith('#')) {
        const parts = line.split(':')
        rows.push([parts[0]!.trim(), parts.slice(1).join(':').trim()])
      } else {
        rows.push([line])
      }
    }
  }

  return rows
}

/**
 * Creates a genuine binary OpenXML .xlsx Spreadsheet Blob.
 */
export async function createXlsxBlob(
  title: string,
  content: string,
  citations: readonly WbCitation[] = [],
  provenance?: SpreadsheetProvenanceInfo,
): Promise<Blob> {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = provenance?.author ?? 'SOVRA Air-Gapped Agent'
  workbook.created = provenance?.generatedAt ? new Date(provenance.generatedAt) : new Date()

  // --- Sheet 1: Data / Content ---
  const dataSheet = workbook.addWorksheet('Data')
  const rows = parseTableData(content)

  if (rows.length > 0) {
    // Check if first row looks like a header
    const firstRow = rows[0]!
    const maxCols = Math.max(...rows.map((r) => r.length))

    // Set column headers and width
    dataSheet.columns = Array.from({ length: maxCols }, (_, i) => ({
      header: firstRow[i] ?? `Column ${i + 1}`,
      key: `col_${i}`,
      width: 25,
    }))

    // Header styling
    const headerRow = dataSheet.getRow(1)
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1E293B' },
    }
    headerRow.alignment = { vertical: 'middle', horizontal: 'center' }

    // If rows had a distinct header, add subsequent rows; otherwise add all
    const dataRows = rows.length > 1 ? rows.slice(1) : rows
    for (const r of dataRows) {
      const rowObj: Record<string, string | number> = {}
      r.forEach((cellVal, idx) => {
        // Try parsing number if applicable
        const numVal = Number(cellVal)
        rowObj[`col_${idx}`] = !isNaN(numVal) && cellVal.trim() !== '' ? numVal : cellVal
      })
      const addedRow = dataSheet.addRow(rowObj)
      addedRow.alignment = { vertical: 'middle' }
    }
  } else {
    dataSheet.columns = [
      { header: 'Title', key: 'title', width: 35 },
      { header: 'Content', key: 'content', width: 60 },
    ]
    dataSheet.addRow({ title, content: content || 'Empty spreadsheet' })
  }

  // --- Sheet 2: Sources & Citations (if any) ---
  if (citations && citations.length > 0) {
    const sourcesSheet = workbook.addWorksheet('Sources & Citations')
    sourcesSheet.columns = [
      { header: 'Document Title', key: 'title', width: 40 },
      { header: 'Document ID', key: 'docId', width: 30 },
      { header: 'Page', key: 'page', width: 12 },
      { header: 'Section', key: 'section', width: 30 },
    ]

    const sourceHeader = sourcesSheet.getRow(1)
    sourceHeader.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    sourceHeader.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF0F766E' },
    }

    for (const c of citations) {
      sourcesSheet.addRow({
        title: c.title,
        docId: c.documentId ?? '',
        page: c.page ?? '',
        section: c.section ?? '',
      })
    }
  }

  // --- Sheet 3: Governance & Provenance ---
  const provSheet = workbook.addWorksheet('Provenance')
  provSheet.columns = [
    { header: 'Governance Attribute', key: 'attr', width: 30 },
    { header: 'Value', key: 'val', width: 50 },
  ]

  const provHeader = provSheet.getRow(1)
  provHeader.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  provHeader.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF334155' },
  }

  provSheet.addRow({ attr: 'Document Title', val: title })
  provSheet.addRow({ attr: 'Generated At', val: provenance?.generatedAt ?? new Date().toISOString() })
  provSheet.addRow({ attr: 'Tools / System', val: (provenance?.toolsUsed ?? ['Sovereign AI Workbench']).join(', ') })
  provSheet.addRow({ attr: 'Author / Agent', val: provenance?.author ?? 'SOVRA Air-Gapped Agent' })
  provSheet.addRow({ attr: 'Classification Level', val: provenance?.classification ?? 'INTERNAL' })

  const buffer = await workbook.xlsx.writeBuffer()
  return new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}
