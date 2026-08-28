import { defineTool } from '@deepseek-ai/dsh-tools'
import type { WbCitation } from '@mrpl/dsh-workbench-types'

import { buildProvenance } from './provenance.ts'
import { generateDocx, generateXlsx, generatePptx } from './generate.ts'
import { writeArtifact } from './write.ts'

const outputSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    filePath: { type: 'string', required: true },
    provenance: {
      type: 'object',
      required: true,
      additionalProperties: false,
      properties: {
        sources: {
          type: 'array',
          required: true,
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              documentId: { type: 'string', required: true },
              title: { type: 'string', required: true },
              page: { type: 'number' },
              section: { type: 'string' },
            },
          },
        },
        toolsUsed: { type: 'array', required: true, items: { type: 'string' } },
        generatedAt: { type: 'string', required: true },
      },
    },
  },
} as const

export function registerArtifactTools(
  ctx: { tools: { register: (def: any) => any } },
  outputDir: string,
) {
  ctx.tools.register(
    defineTool({
      name: 'wb_generate_report',
      description:
        'Generate a Word document (.docx) report from grounded findings and citations with a provenance block.',
      parameters: {
        title: { type: 'string', required: true, description: 'Title of the report.' },
        citations: {
          type: 'array',
          required: true,
          description: 'Source citations backing the findings.',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              documentId: { type: 'string', required: true },
              title: { type: 'string', required: true },
              page: { type: 'number' },
              section: { type: 'string' },
            },
          },
        },
        findings: { type: 'string', required: true, description: 'The grounded findings text.' },
      },
      output: {
        schema: outputSchema,
        render: (_args: unknown, value: unknown) => {
          const v = value as { filePath: string }
          return [{ type: 'text' as const, text: `Generated report at ${v.filePath}` }]
        },
      },
      execute(args, _exec) {
        const a = args as unknown as { title: string; citations: WbCitation[]; findings: string }
        if (!a.citations || a.citations.length === 0) {
          throw new Error('wb_generate_report requires at least one citation')
        }
        const provenance = buildProvenance(a.citations, ['wb_generate_report'])
        return generateDocx(a.title, a.findings, a.citations, provenance).then(
          (buffer) => {
            const filePath = `${outputDir}/${a.title.replace(/\s+/g, '_')}.docx`
            return writeArtifact(filePath, buffer).then(() => ({
              filePath,
              provenance,
            }))
          },
        )
      },
      presentCall: (args: unknown) => {
        const a = args as { title: string }
        return { card: 'generic' as const, title: `Generating report: ${a.title}`, kind: 'other' as const }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'wb_generate_approval_note',
      description:
        'Generate a Word document (.docx) approval note with findings and citations, including a provenance block.',
      parameters: {
        title: { type: 'string', required: true, description: 'Title of the approval note.' },
        citations: {
          type: 'array',
          required: true,
          description: 'Source citations backing the findings.',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              documentId: { type: 'string', required: true },
              title: { type: 'string', required: true },
              page: { type: 'number' },
              section: { type: 'string' },
            },
          },
        },
        findings: { type: 'string', required: true, description: 'The grounded findings text.' },
      },
      output: {
        schema: outputSchema,
        render: (_args: unknown, value: unknown) => {
          const v = value as { filePath: string }
          return [{ type: 'text' as const, text: `Generated approval note at ${v.filePath}` }]
        },
      },
      execute(args, _exec) {
        const a = args as unknown as { title: string; citations: WbCitation[]; findings: string }
        if (!a.citations || a.citations.length === 0) {
          throw new Error('wb_generate_approval_note requires at least one citation')
        }
        const provenance = buildProvenance(a.citations, ['wb_generate_approval_note'])
        return generateDocx(a.title, a.findings, a.citations, provenance).then(
          (buffer) => {
            const filePath = `${outputDir}/${a.title.replace(/\s+/g, '_')}.docx`
            return writeArtifact(filePath, buffer).then(() => ({
              filePath,
              provenance,
            }))
          },
        )
      },
      presentCall: (args: unknown) => {
        const a = args as { title: string }
        return { card: 'generic' as const, title: `Generating approval note: ${a.title}`, kind: 'other' as const }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'wb_generate_spreadsheet',
      description:
        'Generate an Excel spreadsheet (.xlsx) with findings and sources, including a provenance block.',
      parameters: {
        title: { type: 'string', required: true, description: 'Title of the spreadsheet.' },
        citations: {
          type: 'array',
          description: 'Source citations backing the findings.',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              documentId: { type: 'string', required: true },
              title: { type: 'string', required: true },
              page: { type: 'number' },
              section: { type: 'string' },
            },
          },
        },
        findings: { type: 'string', required: true, description: 'The grounded findings text.' },
      },
      output: {
        schema: outputSchema,
        render: (_args: unknown, value: unknown) => {
          const v = value as { filePath: string }
          return [{ type: 'text' as const, text: `Generated spreadsheet at ${v.filePath}` }]
        },
      },
      execute(args, _exec) {
        const a = args as unknown as { title: string; citations?: WbCitation[]; findings: string }
        const citations = a.citations ?? []
        const provenance = buildProvenance(citations, ['wb_generate_spreadsheet'])
        return generateXlsx(a.title, a.findings, citations, provenance).then(
          (buffer) => {
            const filePath = `${outputDir}/${a.title.replace(/\s+/g, '_')}.xlsx`
            return writeArtifact(filePath, buffer).then(() => ({
              filePath,
              provenance,
            }))
          },
        )
      },
      presentCall: (args: unknown) => {
        const a = args as { title: string }
        return { card: 'generic' as const, title: `Generating spreadsheet: ${a.title}`, kind: 'other' as const }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'wb_generate_presentation',
      description:
        'Generate a PowerPoint presentation (.pptx) with findings and sources, including a provenance block.',
      parameters: {
        title: { type: 'string', required: true, description: 'Title of the presentation.' },
        citations: {
          type: 'array',
          description: 'Source citations backing the findings.',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              documentId: { type: 'string', required: true },
              title: { type: 'string', required: true },
              page: { type: 'number' },
              section: { type: 'string' },
            },
          },
        },
        findings: { type: 'string', required: true, description: 'The grounded findings text.' },
      },
      output: {
        schema: outputSchema,
        render: (_args: unknown, value: unknown) => {
          const v = value as { filePath: string }
          return [{ type: 'text' as const, text: `Generated presentation at ${v.filePath}` }]
        },
      },
      execute(args, _exec) {
        const a = args as unknown as { title: string; citations?: WbCitation[]; findings: string }
        const citations = a.citations ?? []
        const provenance = buildProvenance(citations, ['wb_generate_presentation'])
        return generatePptx(a.title, a.findings, citations, provenance).then(
          (buffer) => {
            const filePath = `${outputDir}/${a.title.replace(/\s+/g, '_')}.pptx`
            return writeArtifact(filePath, buffer).then(() => ({
              filePath,
              provenance,
            }))
          },
        )
      },
      presentCall: (args: unknown) => {
        const a = args as { title: string }
        return { card: 'generic' as const, title: `Generating presentation: ${a.title}`, kind: 'other' as const }
      },
    }),
  )
}
