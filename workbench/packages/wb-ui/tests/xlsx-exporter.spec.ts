import { describe, expect, it } from 'vitest'
import { createXlsxBlob } from '../src/client/artifacts/xlsx-exporter.ts'

describe('createXlsxBlob', () => {
  it('generates a valid OpenXML .xlsx binary Blob from tabular markdown data', async () => {
    const tableData = `| Department | Q1 Budget | Q2 Budget | Status |
| Operations | 450000 | 480000 | Approved |
| Security | 120000 | 135000 | Approved |
| Compliance | 85000 | 90000 | Pending |`

    const blob = await createXlsxBlob(
      'Quarterly_Budget_Analysis.xlsx',
      tableData,
      [
        {
          documentId: 'doc-fin-01',
          title: 'Financial_Policy_2026.pdf',
          page: 12,
          section: 'Section 4 - Operational Allocations',
        },
      ],
      {
        classification: 'CONFIDENTIAL',
        toolsUsed: ['wb_generate_spreadsheet', 'SOVRA Workbench'],
        author: 'Finance Controller',
      },
    )

    expect(blob).toBeDefined()
    expect(blob.size).toBeGreaterThan(1000)
    expect(blob.type).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  })

  it('generates a valid .xlsx Blob from comma-separated (CSV) lines', async () => {
    const csvData = `Sensor ID,Reading,Unit,Threshold,Verdict
SENS-01,98.6,Celsius,100.0,NORMAL
SENS-02,105.2,Celsius,100.0,ALERT
SENS-03,42.1,PSI,60.0,NORMAL`

    const blob = await createXlsxBlob(
      'Sensor_Telemetry_Summary.xlsx',
      csvData,
      [],
      {
        classification: 'INTERNAL',
      },
    )

    expect(blob).toBeDefined()
    expect(blob.size).toBeGreaterThan(1000)
    expect(blob.type).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  })
})
