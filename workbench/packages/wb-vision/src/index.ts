/**
 * `wb-vision` — OCR, scanned-document layout, and drawing/P&ID understanding.
 *
 * Registers the two frozen model-facing tools from DESIGN.md §7.5
 * (`wb_ocr_extract`, `wb_vision_analyze`) and provides `ctx.wbVision` for
 * plugins that need vision without going through a tool call.
 *
 * Every call resolves its model through `ctx.wbModelGateway` — no vision model
 * name appears here — and adds **no** policy check of its own: the harness's
 * `tools/pre-execute` hook already routes every tool call through `wb-policy`.
 * @module @mrpl/dsh-workbench-vision
 */

import { readFile } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { MessageId } from '@deepseek-ai/dsh-llm'
import type { Message, StreamChunk } from '@deepseek-ai/dsh-llm'
import type { ImageAttachmentRef, ImageMediaType } from '@deepseek-ai/dsh-attachment'
import type {
  WbModelCapability,
  WbModelGatewayService as WbModelGatewayContract,
  WbToolGatewayService as WbToolGatewayContract,
  WbToolManifest,
  WbVisionService as WbVisionContract,
} from '@mrpl/dsh-workbench-types'

export const name = 'wb-vision'

export const inject = ['tools', 'llm', 'attachments', 'wbModelGateway', 'wbToolGateway'] as const

/** Deployment configuration. */
export interface Config {
  /**
   * Model id to request from the resolved adapter, per capability.
   *
   * `WbModelHandle` carries only the adapter id, so a model still has to be
   * chosen; when a capability is absent here the first model the adapter lists
   * is used. See the §12 gap noted in the README.
   */
  models: Partial<Record<WbModelCapability, string>>
  /** Cap on decoded image bytes accepted by `describe()` and both tools. */
  maxImageBytes: number
}

export const Config: z<Config> = z.object({
  models: z.dict(z.string()).default({}),
  maxImageBytes: z.natural().default(5_000_000),
})

declare module '@deepseek-ai/cordis' {
  interface Context {
    wbVision: WbVisionService
    /** Capability→adapter routing, provided by wb-model-gateway. */
    wbModelGateway: WbModelGatewayContract
    /** Tool manifest directory, provided by wb-tool-gateway. */
    wbToolGateway: WbToolGatewayContract
  }
}

/** Media types the attachment service accepts; magic-byte checking there stays authoritative. */
const MEDIA_TYPE_BY_EXTENSION: Readonly<Record<string, ImageMediaType>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
}

/** The manifests both tools publish to `wb-tool-gateway`, per DESIGN.md §7.5. */
const TOOL_MANIFESTS: readonly WbToolManifest[] = [
  {
    toolId: 'wb_ocr_extract',
    riskLevel: 'local',
    requiredPermissions: ['vision.ocr'],
    dataClassificationCeiling: 'RESTRICTED',
    networkAccess: 'none',
  },
  {
    toolId: 'wb_vision_analyze',
    riskLevel: 'local',
    requiredPermissions: ['vision.analyze'],
    dataClassificationCeiling: 'RESTRICTED',
    networkAccess: 'none',
  },
]

/** One OCR text block with its evidence box. */
interface OcrBlock {
  text: string
  /** `[x, y, width, height]` in fractions of the image, origin top-left. */
  box: number[]
  confidence: number
}

/** One answer to a vision question, with the region it was read from. */
interface VisionFinding {
  summary: string
  box: number[]
  confidence: number
}

/**
 * Decode a base64 tool argument into bytes.
 * @param encoded - base64 text supplied by the model.
 * @returns the decoded bytes.
 * @throws when the argument is empty or is not valid base64.
 */
function decodeBase64Image(encoded: string): Buffer {
  if (!encoded) throw new Error('image is empty; supply base64-encoded image bytes')
  const buffer = Buffer.from(encoded, 'base64')
  // Buffer.from silently drops invalid characters, so a non-empty argument that
  // decodes to nothing (or re-encodes differently) was never valid base64.
  if (buffer.length === 0 || buffer.toString('base64').replace(/=+$/, '') !== encoded.replace(/=+$/, '')) {
    throw new Error('image is not valid base64-encoded image data')
  }
  return buffer
}

/**
 * Parse the model's reply as the JSON its prompt demanded.
 * @param raw - the concatenated model text.
 * @returns the parsed object.
 * @throws when the model answered in prose instead of the declared JSON, which
 *   must surface as a tool error rather than an empty-looking success.
 */
function parseModelJson(raw: string): Record<string, unknown> {
  const trimmed = raw.trim()
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start === -1 || end <= start) {
    throw new Error(`vision model did not return the requested JSON object; got: ${trimmed.slice(0, 200)}`)
  }
  const parsed: unknown = JSON.parse(trimmed.slice(start, end + 1))
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('vision model returned JSON that is not an object')
  }
  return parsed as Record<string, unknown>
}

/**
 * Vision capability backing `ctx.wbVision` and both model-facing tools.
 *
 * Holds no state between calls: `describe()` and each tool invocation stand
 * alone, and nothing is persisted here (that is `wb-ingestion`'s job).
 */
export class WbVisionService extends Service<Config> implements WbVisionContract {
  static inject = ['tools', 'llm', 'attachments', 'wbModelGateway', 'wbToolGateway'] as const
  /** Cordis reads the schema off the plugin runtime, so it must live on the class. */
  static Config = Config

  constructor(
    ctx: Context,
    private readonly config: Config,
  ) {
    super(ctx, 'wbVision')
  }

  /**
   * Describe an image against a free-form prompt.
   *
   * The plain-service path used by `wb-ingestion`; it bypasses the tool-call
   * pipeline deliberately, so it is NOT policy-checked — a caller reaching it
   * is already inside a governed operation of its own.
   * @param image - raw image bytes, or a filesystem path to an image file.
   * @param prompt - what to extract or answer.
   * @returns the model's parsed JSON answer.
   * @throws when the image cannot be read, or the model answers in prose.
   */
  async describe(image: Buffer | string, prompt: string): Promise<Record<string, unknown>> {
    const { data, mediaType, name: displayName } = await this.loadImage(image)
    return this.ask('vision_reasoning', data, mediaType, displayName, prompt)
  }

  /**
   * Normalize either `describe()` input into bytes plus a declared media type.
   * @param image - raw bytes, or a path to an image file.
   * @returns the bytes, the media type inferred from the path, and a display name.
   */
  private async loadImage(
    image: Buffer | string,
  ): Promise<{ data: Buffer; mediaType: ImageMediaType; name: string }> {
    if (Buffer.isBuffer(image)) {
      return { data: image, mediaType: 'image/png', name: 'image.png' }
    }
    const mediaType = MEDIA_TYPE_BY_EXTENSION[extname(image).toLowerCase()]
    if (!mediaType) {
      throw new Error(`unsupported image type for "${image}"; expected one of ${Object.keys(MEDIA_TYPE_BY_EXTENSION).join(', ')}`)
    }
    return { data: await readFile(image), mediaType, name: basename(image) }
  }

  /**
   * Resolve the capability's adapter and model, then run one image+text call.
   * @param capability - which model role answers this call.
   * @param data - the image bytes.
   * @param mediaType - the declared media type.
   * @param displayName - a name for the stored attachment; never a path.
   * @param prompt - the instruction sent alongside the image.
   * @param signal - caller cancellation, honored for the whole call.
   * @returns the model's parsed JSON answer.
   */
  private async ask(
    capability: WbModelCapability,
    data: Buffer,
    mediaType: ImageMediaType,
    displayName: string,
    prompt: string,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    if (data.length > this.config.maxImageBytes) {
      throw new Error(`image is ${data.length} bytes, above the ${this.config.maxImageBytes}-byte limit`)
    }

    const handle = this.ctx.wbModelGateway.resolve(capability)
    const model = await this.resolveModel(handle.adapterId, capability)

    // Images reach a model only as an attachment reference — never raw bytes
    // and never a path — so the store owns validation and the durable identity.
    const attachment: ImageAttachmentRef = await this.ctx.attachments.saveImage({
      data,
      mediaType,
      name: displayName,
    })

    const messages: Message[] = [
      {
        id: MessageId(`wb-vision-${capability}-${attachment.attachmentId}`),
        // A hand-built one-shot request, not loop-assembled context: the image
        // and question originate from the caller, so the source is plain user.
        source: { kind: 'user' },
        role: 'user',
        content: [
          { type: 'image', attachment },
          { type: 'text', text: prompt },
        ],
      },
    ]

    let raw = ''
    for await (const chunk of this.ctx.llm.stream({
      provider: handle.adapterId,
      model,
      messages,
      system:
        'You are a vision model for an industrial engineering workbench. ' +
        'Answer ONLY with a single JSON object matching the schema described in the user message. ' +
        'Do not wrap it in prose or code fences.',
      signal,
    } as Parameters<Context['llm']['stream']>[0])) {
      const streamed = chunk as StreamChunk
      if (streamed.type === 'text-delta') raw += streamed.text
      if (signal?.aborted) throw new Error('vision call cancelled')
    }

    return parseModelJson(raw)
  }

  /**
   * Choose the model id to request from a resolved adapter.
   * @param adapterId - the provider route `wb-model-gateway` resolved to.
   * @param capability - the capability being served, for the config lookup.
   * @returns the configured model id, or the adapter's first listed model.
   * @throws when the adapter lists no models and none is configured.
   */
  private async resolveModel(adapterId: string, capability: WbModelCapability): Promise<string> {
    const configured = this.config.models[capability]
    if (configured) return configured
    const models = await this.ctx.llm.listModels(adapterId)
    const first = models[0]
    if (!first) {
      throw new Error(
        `wb-vision: adapter "${adapterId}" lists no models and no models.${capability} is configured`,
      )
    }
    return first.id
  }

  /** Run one tool-side image call, sharing decode/limit handling between both tools. */
  async runToolCall(
    capability: WbModelCapability,
    encodedImage: string,
    mediaType: ImageMediaType,
    prompt: string,
    signal: AbortSignal,
  ): Promise<Record<string, unknown>> {
    const data = decodeBase64Image(encodedImage)
    return this.ask(capability, data, mediaType, `upload${extname(mediaType) || ''}`, prompt, signal)
  }
}

const OCR_PROMPT =
  'Transcribe every legible text region in this image. Reply with JSON: ' +
  '{"text": "<all text, reading order>", "blocks": [{"text": "...", "box": [x, y, w, h], "confidence": 0..1}]} ' +
  'where box values are fractions of the image with origin at the top-left.'

/**
 * Mount the vision capability: the service, both frozen tools, and one manifest
 * per tool.
 * @param ctx - the plugin context.
 * @param config - validated deployment configuration.
 */
export function apply(ctx: Context, config: Config): void {
  const service = new WbVisionService(ctx, config)

  for (const manifest of TOOL_MANIFESTS) {
    ctx.wbToolGateway.registerManifest(manifest)
  }

  ctx.tools.register(
    defineTool({
      name: 'wb_ocr_extract',
      description:
        'Extract text and layout from an image or a scanned PDF page. Returns the full transcription plus per-block text with bounding boxes.',
      parameters: {
        image: { type: 'string', required: true, description: 'Base64-encoded image bytes' },
        mediaType: {
          type: 'string',
          required: true,
          enum: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
          description: 'Media type of the supplied bytes',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            text: { type: 'string' },
            blocks: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  text: { type: 'string' },
                  box: { type: 'array', items: { type: 'number' } },
                  confidence: { type: 'number' },
                },
              },
            },
          },
        },
        render: (_args, value) => [
          { type: 'text', text: (value as { text?: string }).text ?? '' },
        ],
      },
      presentCall: (args) => ({
        card: 'generic' as const,
        title: `OCR ${(args as { mediaType?: string }).mediaType ?? 'image'}`,
        kind: 'read' as const,
      }),
      async execute(args, exec) {
        const result = await service.runToolCall(
          'ocr',
          args.image,
          args.mediaType as ImageMediaType,
          OCR_PROMPT,
          exec.signal,
        )
        return {
          text: typeof result.text === 'string' ? result.text : '',
          blocks: Array.isArray(result.blocks) ? (result.blocks as OcrBlock[]) : [],
        }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'wb_vision_analyze',
      description:
        'Answer a question about an engineering drawing, P&ID, or photo. Returns structured findings with bounding-box evidence, and reports honestly when the image does not answer the question.',
      parameters: {
        image: { type: 'string', required: true, description: 'Base64-encoded image bytes' },
        mediaType: {
          type: 'string',
          required: true,
          enum: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
          description: 'Media type of the supplied bytes',
        },
        question: { type: 'string', required: true, description: 'What to determine from the image' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            answered: { type: 'boolean' },
            findings: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  summary: { type: 'string' },
                  box: { type: 'array', items: { type: 'number' } },
                  confidence: { type: 'number' },
                },
              },
            },
            reason: { type: 'string' },
          },
        },
        render: (_args, value) => {
          const v = value as { answered?: boolean; findings?: VisionFinding[]; reason?: string }
          if (!v.answered) return [{ type: 'text', text: v.reason ?? 'No finding in this image.' }]
          return [{ type: 'text', text: (v.findings ?? []).map((f) => f.summary).join('\n') }]
        },
      },
      presentCall: (args) => ({
        card: 'generic' as const,
        title: (args as { question?: string }).question ?? 'Analyze image',
        kind: 'search' as const,
      }),
      async execute(args, exec) {
        const prompt =
          `Answer this question about the image: ${args.question}\n` +
          'Reply with JSON: {"answered": true|false, "findings": [{"summary": "...", "box": [x, y, w, h], ' +
          '"confidence": 0..1}], "reason": "<why, when answered is false>"}. ' +
          'Set answered to false rather than guessing when the image does not show the answer.'
        const result = await service.runToolCall(
          'vision_reasoning',
          args.image,
          args.mediaType as ImageMediaType,
          prompt,
          exec.signal,
        )
        return {
          answered: result.answered === true,
          findings: Array.isArray(result.findings) ? (result.findings as VisionFinding[]) : [],
          reason: typeof result.reason === 'string' ? result.reason : '',
        }
      },
    }),
  )
}

export default WbVisionService
