import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Context } from '@deepseek-ai/cordis'
import type {
  WbVisionService,
  WbModelGatewayService,
  WbModelHandle,
  WbModelCapability,
  WbPolicyService,
  WbPolicyRequest,
  WbPolicyDecision,
  WbIngestionCompletedEvent,
  WbClassification,
} from '@mrpl/dsh-workbench-types'
import { asWbSessionId, asWbUserId } from '@mrpl/dsh-workbench-types'

import { apply as wbIngestionApply, Config } from '../src/index.ts'
import type { IndexChunk } from '../src/types.ts'

// ---------------------------------------------------------------------------
// Test fakes
// ---------------------------------------------------------------------------

class FakeWbVision implements WbVisionService {
  calls: Array<{ image: Buffer | string; prompt: string }> = []

  async describe(image: Buffer | string, prompt: string): Promise<Record<string, unknown>> {
    this.calls.push({ image, prompt })
    return { text: 'Fake OCR output for testing', page: 1 }
  }
}

class FakeWbModelGateway implements WbModelGatewayService {
  resolveCalls: WbModelCapability[] = []

  resolve(capability: WbModelCapability): WbModelHandle {
    this.resolveCalls.push(capability)
    return { adapterId: `fake-${capability}`, capability }
  }
}

class FakeWbPolicy implements WbPolicyService {
  calls: WbPolicyRequest[] = []

  async evaluate(request: WbPolicyRequest): Promise<WbPolicyDecision> {
    this.calls.push(request)
    return { decision: 'ALLOW', reason: 'fake-allow' }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let testDir: string

function tmpDir(): string {
  return join(
    tmpdir(),
    `wb-ingestion-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  )
}

function writeFile(name: string, content: string | Buffer): string {
  const filePath = join(testDir, name)
  const dir = filePath.substring(0, filePath.lastIndexOf('/'))
  mkdirSync(dir, { recursive: true })
  writeFileSync(filePath, content, typeof content === 'string' ? 'utf-8' : undefined)
  return filePath
}

function readJsonlLines(indexPath: string): IndexChunk[] {
  let content: string
  try {
    content = readFileSync(indexPath, 'utf-8')
  } catch {
    return []
  }
  return content
    .split('\n')
    .filter((line: string) => line.trim() !== '')
    .map((line: string) => JSON.parse(line) as IndexChunk)
}

async function setup(indexPath?: string) {
  const ctx = new Context()
  const vision = new FakeWbVision()
  const gateway = new FakeWbModelGateway()
  const policy = new FakeWbPolicy()
  ctx.provide('wbVision', vision as never)
  ctx.provide('wbModelGateway', gateway as never)
  ctx.provide('wbPolicy', policy as never)
  const idx = indexPath ?? join(testDir, 'index.jsonl')
  const fiber = await ctx.plugin(wbIngestionApply, {
    maxFileSize: 50 * 1024 * 1024,
    allowedMimeTypes: ['text/*', 'application/pdf', 'image/*'],
    indexPath: idx,
    chunkSize: 1000,
    chunkOverlap: 200,
  })
  return { ctx, vision, gateway, policy, fiber }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

/** The principal every ingestion in these tests is authorized as. */
const TEST_USER = asWbUserId('u-ingest')
const TEST_SESSION = asWbSessionId('s-ingest')

describe('wb-ingestion', () => {
  beforeEach(() => {
    testDir = tmpDir()
    mkdirSync(testDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  it('enqueue() resolves to WbDocumentId, chunks indexed at declared classification, event fires', async () => {
    const filePath = writeFile('test-doc.txt', 'Hello world, this is a test document with enough content to chunk.')
    const indexPath = join(testDir, 'index.jsonl')
    const { ctx } = await setup(indexPath)

    const events: WbIngestionCompletedEvent[] = []
    ctx.on('wb/ingestion/completed', (event: WbIngestionCompletedEvent) => { events.push(event) })

    const docId = await ctx.wbIngestion.enqueue({
      path: filePath,
      declaredClassification: 'INTERNAL',
      user: TEST_USER,
      sessionId: TEST_SESSION,
    })

    expect(docId).toBeDefined()
    expect(typeof docId).toBe('string')

    const chunks = readJsonlLines(indexPath)
    expect(chunks.length).toBeGreaterThanOrEqual(1)
    expect(chunks[0]!.documentId).toBe(docId)
    expect(chunks[0]!.classification).toBe('INTERNAL')

    expect(events).toHaveLength(1)
    expect(events[0]!.documentId).toBe(docId)
    expect(events[0]!.classification).toBe('INTERNAL')
  })

  it('rejects files with disallowed MIME type, nothing indexed, no event', async () => {
    const filePath = writeFile('malware.exe', Buffer.from([0x00, 0x01, 0x02]))
    const indexPath = join(testDir, 'index.jsonl')
    const { ctx } = await setup(indexPath)

    const events: WbIngestionCompletedEvent[] = []
    ctx.on('wb/ingestion/completed', (event: WbIngestionCompletedEvent) => { events.push(event) })

    await expect(
      ctx.wbIngestion.enqueue({
        path: filePath,
        declaredClassification: 'PUBLIC',
        user: TEST_USER,
        sessionId: TEST_SESSION,
      }),
    ).rejects.toThrow(/MIME type|not allowed|unsupported/)

    expect(readJsonlLines(indexPath)).toHaveLength(0)
    expect(events).toHaveLength(0)
  })

  it('rejects files exceeding maxFileSize, nothing indexed, no event', async () => {
    const largeContent = 'x'.repeat(1024 * 1024)
    const filePath = writeFile('large.txt', largeContent)
    const indexPath = join(testDir, 'index.jsonl')

    const smallCtx = new Context()
    smallCtx.provide('wbVision', new FakeWbVision() as never)
    smallCtx.provide('wbModelGateway', new FakeWbModelGateway() as never)
    smallCtx.provide('wbPolicy', new FakeWbPolicy() as never)
    const fiber = await smallCtx.plugin(wbIngestionApply, {
      maxFileSize: 100 * 1024,
      allowedMimeTypes: ['text/*'],
      indexPath,
      chunkSize: 1000,
      chunkOverlap: 200,
    })

    const events: WbIngestionCompletedEvent[] = []
    smallCtx.on('wb/ingestion/completed', (event: WbIngestionCompletedEvent) => { events.push(event) })

    await expect(
      smallCtx.wbIngestion.enqueue({
        path: filePath,
        declaredClassification: 'PUBLIC',
        user: TEST_USER,
        sessionId: TEST_SESSION,
      }),
    ).rejects.toThrow(/size|exceeds|limit/)

    expect(readJsonlLines(indexPath)).toHaveLength(0)
    expect(events).toHaveLength(0)
    await fiber.dispose()
  })

  it('rejects empty files, nothing indexed, no event', async () => {
    const filePath = writeFile('empty.txt', '')
    const indexPath = join(testDir, 'index.jsonl')
    const { ctx } = await setup(indexPath)

    const events: WbIngestionCompletedEvent[] = []
    ctx.on('wb/ingestion/completed', (event: WbIngestionCompletedEvent) => { events.push(event) })

    await expect(
      ctx.wbIngestion.enqueue({
        path: filePath,
        declaredClassification: 'PUBLIC',
        user: TEST_USER,
        sessionId: TEST_SESSION,
      }),
    ).rejects.toThrow(/empty/)

    expect(readJsonlLines(indexPath)).toHaveLength(0)
    expect(events).toHaveLength(0)
  })

  it('calls ctx.wbVision.describe() for image files, OCR text in indexed chunks', async () => {
    const pngHeader = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
      0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41,
      0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
      0x00, 0x00, 0x02, 0x00, 0x01, 0xe2, 0x21, 0xbc,
      0x33, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e,
      0x44, 0xae, 0x42, 0x60, 0x82,
    ])
    const filePath = writeFile('scan.png', pngHeader)
    const indexPath = join(testDir, 'index.jsonl')
    const { ctx, vision } = await setup(indexPath)

    await ctx.wbIngestion.enqueue({
      path: filePath,
      declaredClassification: 'CONFIDENTIAL',
      user: TEST_USER,
      sessionId: TEST_SESSION,
    })

    expect(vision.calls).toHaveLength(1)
    expect(vision.calls[0]!.prompt).toContain('OCR')

    const chunks = readJsonlLines(indexPath)
    expect(chunks.length).toBeGreaterThanOrEqual(1)
    const allText = chunks.map((c: IndexChunk) => c.text).join(' ')
    expect(allText).toContain('Fake OCR output for testing')
    expect(chunks[0]!.classification).toBe('CONFIDENTIAL')
  })

  it('stored classification is always exactly the declared one (never auto-downgraded)', async () => {
    const filePath = writeFile('classified.txt', 'Some internal document content.')
    const indexPath = join(testDir, 'index.jsonl')
    const { ctx } = await setup(indexPath)

    const events: WbIngestionCompletedEvent[] = []
    ctx.on('wb/ingestion/completed', (event: WbIngestionCompletedEvent) => { events.push(event) })

    await ctx.wbIngestion.enqueue({
      path: filePath,
      declaredClassification: 'CONFIDENTIAL',
      user: TEST_USER,
      sessionId: TEST_SESSION,
    })

    const chunks = readJsonlLines(indexPath)
    for (const chunk of chunks) {
      expect(chunk.classification).toBe('CONFIDENTIAL')
    }
    expect(events[0]!.classification).toBe('CONFIDENTIAL')
  })

  it('resolves embedding capability through wb-model-gateway', async () => {
    const filePath = writeFile('embed.txt', 'Content for embedding test.')
    const indexPath = join(testDir, 'index.jsonl')
    const { ctx, gateway } = await setup(indexPath)

    await ctx.wbIngestion.enqueue({
      path: filePath,
      declaredClassification: 'PUBLIC',
      user: TEST_USER,
      sessionId: TEST_SESSION,
    })

    expect(gateway.resolveCalls).toContain('embedding')
  })

  it('handles concurrent enqueue calls without JSONL corruption', async () => {
    const indexPath = join(testDir, 'index.jsonl')
    const { ctx } = await setup(indexPath)

    const files = Array.from({ length: 5 }, (_: unknown, i: number) =>
      writeFile(`concurrent-${i}.txt`, `Document ${i} with enough content for chunking purposes.`),
    )

    const results = await Promise.all(
      files.map((path: string) =>
        ctx.wbIngestion.enqueue({
          path,
          declaredClassification: 'PUBLIC',
        }),
      ),
    )

    expect(results).toHaveLength(5)
    for (const id of results) {
      expect(id).toBeDefined()
    }

    const lines = readJsonlLines(indexPath)
    expect(lines.length).toBeGreaterThanOrEqual(5)
    const docIds = new Set(results.map(String))
    for (const chunk of lines) {
      expect(docIds.has(String(chunk.documentId))).toBe(true)
      expect(chunk.text).toBeTruthy()
    }
  })

  it('rejects files whose content cannot be parsed, not silent zero chunks', async () => {
    const filePath = writeFile('unknown.bin', Buffer.from([0xff, 0xfe, 0xfd]))
    const indexPath = join(testDir, 'index.jsonl')

    const customCtx = new Context()
    customCtx.provide('wbVision', new FakeWbVision() as never)
    customCtx.provide('wbModelGateway', new FakeWbModelGateway() as never)
    customCtx.provide('wbPolicy', new FakeWbPolicy() as never)
    const fiber = await customCtx.plugin(wbIngestionApply, {
      maxFileSize: 50 * 1024 * 1024,
      allowedMimeTypes: ['application/octet-stream'],
      indexPath,
      chunkSize: 1000,
      chunkOverlap: 200,
    })

    await expect(
      customCtx.wbIngestion.enqueue({
        path: filePath,
        declaredClassification: 'PUBLIC',
        user: TEST_USER,
        sessionId: TEST_SESSION,
      }),
    ).rejects.toThrow(/parse|unsupported|format/)

    expect(readJsonlLines(indexPath)).toHaveLength(0)
    await fiber.dispose()
  })

  it('cleans up when fiber is disposed', async () => {
    const { ctx, fiber } = await setup()
    expect(ctx.wbIngestion).toBeDefined()
    expect(typeof ctx.wbIngestion.enqueue).toBe('function')

    await fiber.dispose()
  })
})
