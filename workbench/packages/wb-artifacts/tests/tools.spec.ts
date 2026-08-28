import { describe, it, expect, afterEach } from 'vitest'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as os from 'node:os'
import { Context } from '@deepseek-ai/cordis'
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt'
import { ToolRuntime } from '@deepseek-ai/dsh-tools'
import { CallId } from '@deepseek-ai/dsh-llm'
import type {
  WbToolGatewayService,
  WbToolManifest,
} from '@mrpl/dsh-workbench-types'

import * as wbArtifacts from '../src/index.ts'

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

class FakeWbToolGateway implements WbToolGatewayService {
  manifests = new Map<string, WbToolManifest>()

  registerManifest(manifest: WbToolManifest): void {
    this.manifests.set(manifest.toolId, manifest)
  }

  getManifest(toolId: string): WbToolManifest | undefined {
    return this.manifests.get(toolId)
  }
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

let tmpDir: string
let ctx: Context

async function setup() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wb-artifacts-test-'))
  ctx = new Context()
  const gateway = new FakeWbToolGateway()
  ctx.provide('wbToolGateway', gateway as never)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(wbArtifacts, { outputDir: tmpDir })
  return { ctx, gateway, tmpDir }
}

let callCounter = 0
function callTool(name: string, args: unknown) {
  return ctx.tools.execute({
    signal: AbortSignal.timeout(30_000),
    callId: CallId(`call-${++callCounter}`),
    name,
    arguments: args,
  })
}

afterEach(async () => {
  if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

describe('wb-artifacts plugin', () => {
  describe('tool registration', () => {
    it('registers exactly four tools', async () => {
      const { ctx } = await setup()
      const names = ctx.tools.schemas().map((s) => s.name)
      expect(names).toContain('wb_generate_report')
      expect(names).toContain('wb_generate_approval_note')
      expect(names).toContain('wb_generate_spreadsheet')
      expect(names).toContain('wb_generate_presentation')
      expect(names.length).toBe(4)
    })

    it('each tool has a description and parameters', async () => {
      const { ctx } = await setup()
      for (const schema of ctx.tools.schemas()) {
        expect(schema.description).toBeDefined()
        expect(schema.parameters).toBeDefined()
      }
    })

    it('registers a WbToolManifest for each tool', async () => {
      const { gateway } = await setup()
      expect(gateway.manifests.size).toBe(4)
      expect(gateway.getManifest('wb_generate_report')).toBeDefined()
      expect(gateway.getManifest('wb_generate_approval_note')).toBeDefined()
      expect(gateway.getManifest('wb_generate_spreadsheet')).toBeDefined()
      expect(gateway.getManifest('wb_generate_presentation')).toBeDefined()
    })

    it('manifests have riskLevel local and networkAccess none', async () => {
      const { gateway } = await setup()
      for (const manifest of gateway.manifests.values()) {
        expect(manifest.riskLevel).toBe('local')
        expect(manifest.networkAccess).toBe('none')
      }
    })
  })

  // ---------------------------------------------------------------------------
  // Tool execution — wb_generate_report
  // ---------------------------------------------------------------------------

  describe('wb_generate_report', () => {
    it('creates a .docx file and returns provenance', async () => {
      await setup()
      const result = await callTool('wb_generate_report', {
        title: 'Test Report',
        citations: [
          { documentId: 'doc-1', title: 'Source A', page: 5 },
        ],
        findings: 'All tests passed.',
      })

      expect(result.isError).toBe(false)
      if (result.isError) throw new Error('expected success')
      const v = result.value as { filePath: string; provenance: { sources: unknown[]; toolsUsed: string[]; generatedAt: string } }
      expect(typeof v.filePath).toBe('string')
      expect(v.filePath).toMatch(/\.docx$/)

      const stat = await fs.stat(v.filePath)
      expect(stat.size).toBeGreaterThan(0)

      expect(v.provenance).toBeDefined()
      expect(v.provenance.sources).toHaveLength(1)
      expect(v.provenance.toolsUsed).toContain('wb_generate_report')
      expect(v.provenance.generatedAt).toBeTruthy()
    })

    it('rejects when citations are missing', async () => {
      await setup()
      const result = await callTool('wb_generate_report', {
        title: 'Bad',
        citations: [],
        findings: 'text',
      })
      expect(result.isError).toBe(true)
    })
  })

  // ---------------------------------------------------------------------------
  // Tool execution — wb_generate_approval_note
  // ---------------------------------------------------------------------------

  describe('wb_generate_approval_note', () => {
    it('creates a .docx file and returns provenance', async () => {
      await setup()
      const result = await callTool('wb_generate_approval_note', {
        title: 'Approval Note',
        citations: [
          { documentId: 'doc-2', title: 'Source B' },
        ],
        findings: 'Approved.',
      })

      expect(result.isError).toBe(false)
      if (result.isError) throw new Error('expected success')
      const v = result.value as { filePath: string; provenance: { toolsUsed: string[] } }
      expect(v.filePath).toMatch(/\.docx$/)
      const stat = await fs.stat(v.filePath)
      expect(stat.size).toBeGreaterThan(0)
      expect(v.provenance.toolsUsed).toContain('wb_generate_approval_note')
    })
  })

  // ---------------------------------------------------------------------------
  // Tool execution — wb_generate_spreadsheet
  // ---------------------------------------------------------------------------

  describe('wb_generate_spreadsheet', () => {
    it('creates a .xlsx file and returns provenance', async () => {
      await setup()
      const result = await callTool('wb_generate_spreadsheet', {
        title: 'Data Sheet',
        citations: [
          { documentId: 'doc-3', title: 'Source C', page: 12, section: 'Appendix' },
        ],
        findings: 'Revenue data.',
      })

      expect(result.isError).toBe(false)
      if (result.isError) throw new Error('expected success')
      const v = result.value as { filePath: string; provenance: { toolsUsed: string[] } }
      expect(v.filePath).toMatch(/\.xlsx$/)
      const stat = await fs.stat(v.filePath)
      expect(stat.size).toBeGreaterThan(0)
      expect(v.provenance.toolsUsed).toContain('wb_generate_spreadsheet')
    })

    it('allows empty citations', async () => {
      await setup()
      const result = await callTool('wb_generate_spreadsheet', {
        title: 'Empty Sources',
        citations: [],
        findings: 'No sources.',
      })

      expect(result.isError).toBe(false)
      if (result.isError) throw new Error('expected success')
      const v = result.value as { filePath: string; provenance: { sources: unknown[] } }
      expect(v.filePath).toMatch(/\.xlsx$/)
      expect(v.provenance.sources).toHaveLength(0)
    })
  })

  // ---------------------------------------------------------------------------
  // Tool execution — wb_generate_presentation
  // ---------------------------------------------------------------------------

  describe('wb_generate_presentation', () => {
    it('creates a .pptx file and returns provenance', async () => {
      await setup()
      const result = await callTool('wb_generate_presentation', {
        title: 'Slide Deck',
        citations: [
          { documentId: 'doc-4', title: 'Source D' },
        ],
        findings: 'Key findings.',
      })

      expect(result.isError).toBe(false)
      if (result.isError) throw new Error('expected success')
      const v = result.value as { filePath: string; provenance: { toolsUsed: string[] } }
      expect(v.filePath).toMatch(/\.pptx$/)
      const stat = await fs.stat(v.filePath)
      expect(stat.size).toBeGreaterThan(0)
      expect(v.provenance.toolsUsed).toContain('wb_generate_presentation')
    })

    it('allows empty citations', async () => {
      await setup()
      const result = await callTool('wb_generate_presentation', {
        title: 'No Sources Deck',
        citations: [],
        findings: 'Empty.',
      })

      expect(result.isError).toBe(false)
      if (result.isError) throw new Error('expected success')
      const v = result.value as { filePath: string; provenance: { sources: unknown[] } }
      expect(v.filePath).toMatch(/\.pptx$/)
      expect(v.provenance.sources).toHaveLength(0)
    })
  })

  // ---------------------------------------------------------------------------
  // Provenance block
  // ---------------------------------------------------------------------------

  describe('provenance block', () => {
    it('includes all source citations', async () => {
      await setup()
      const result = await callTool('wb_generate_report', {
        title: 'Multi-Source',
        citations: [
          { documentId: 'doc-a', title: 'Alpha', page: 1 },
          { documentId: 'doc-b', title: 'Beta', section: 'Intro' },
          { documentId: 'doc-c', title: 'Gamma' },
        ],
        findings: 'Three sources.',
      })

      expect(result.isError).toBe(false)
      if (result.isError) throw new Error('expected success')
      const v = result.value as { provenance: { sources: { documentId: string }[] } }
      expect(v.provenance.sources).toHaveLength(3)
      expect(v.provenance.sources[0].documentId).toBe('doc-a')
      expect(v.provenance.sources[1].documentId).toBe('doc-b')
      expect(v.provenance.sources[2].documentId).toBe('doc-c')
    })

    it('generatedAt is a valid ISO timestamp', async () => {
      await setup()
      const result = await callTool('wb_generate_report', {
        title: 'Timestamp Test',
        citations: [{ documentId: 'doc-x', title: 'X' }],
        findings: 'Check timestamp.',
      })

      expect(result.isError).toBe(false)
      if (result.isError) throw new Error('expected success')
      const v = result.value as { provenance: { generatedAt: string } }
      const parsed = new Date(v.provenance.generatedAt)
      expect(parsed.getTime()).not.toBeNaN()
    })
  })

  // ---------------------------------------------------------------------------
  // HMR safety
  // ---------------------------------------------------------------------------

  describe('HMR safety', () => {
    it('unregisters all tools when its fiber is disposed', async () => {
      const ctx = new Context()
      const gateway = new FakeWbToolGateway()
      ctx.provide('wbToolGateway', gateway as never)
      await ctx.plugin(SystemPrompt)
      await ctx.plugin(ToolRuntime)
      const fiber = await ctx.plugin(wbArtifacts, { outputDir: tmpDir })

      const namesBefore = ctx.tools.schemas().map((s) => s.name)
      expect(namesBefore).toContain('wb_generate_report')
      expect(gateway.manifests.size).toBe(4)

      await fiber.dispose()

      const namesAfter = ctx.tools.schemas().map((s) => s.name)
      expect(namesAfter).not.toContain('wb_generate_report')
      expect(namesAfter).not.toContain('wb_generate_approval_note')
      expect(namesAfter).not.toContain('wb_generate_spreadsheet')
      expect(namesAfter).not.toContain('wb_generate_presentation')
      // WbToolGatewayService has no unregisterManifest; manifests persist
      // until the gateway itself is disposed.
    })
  })
})
