/**
 * `LlmAdapter` over Ollama's HTTP API.
 *
 * Ollama serves open-weight models on the machine itself, which is what makes
 * the sovereignty claim real rather than aspirational: the corpus is embedded,
 * retrieved and reasoned over without a byte leaving the premises.
 *
 * The wire format is NDJSON rather than SSE — one JSON object per line, each
 * carrying an incremental `message.content` — so this does not reuse the
 * harness's SSE reader.
 * @module @mrpl/dsh-workbench-ollama/adapter
 */

import { LlmAdapter, attributionHeaders } from '@deepseek-ai/dsh-llm'
import type {
  GenerateOptions,
  LlmModelInfo,
  LlmResolvedModelInfo,
  StreamChunk,
} from '@deepseek-ai/dsh-llm'
import { requireOnPremiseUrl } from './host-guard.ts'

/** One message as Ollama's `/api/chat` expects it. */
interface OllamaMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
  /** Base64 image payloads, for vision models. */
  images?: string[]
}

/** One NDJSON frame from `/api/chat`. */
interface OllamaChatFrame {
  message?: { role?: string; content?: string }
  done?: boolean
  error?: string
  prompt_eval_count?: number
  eval_count?: number
}

/** How a caller supplies image bytes to a vision model. */
export interface ImageResolver {
  /**
   * Resolve an attachment id to base64 bytes.
   *
   * Images reach the harness as an `ImageAttachmentRef` holding an opaque id,
   * never raw bytes, so an adapter cannot read them without the attachment
   * store. A deployment without vision leaves this unset and image blocks are
   * dropped with a note rather than silently vanishing.
   */
  (attachmentId: string): Promise<string | undefined>
}

/**
 * Flatten harness content blocks into Ollama's message shape.
 * @param messages - the assembled request messages.
 * @param resolveImage - how to turn an attachment id into base64 bytes.
 * @returns messages Ollama's chat endpoint accepts.
 */
export async function toOllamaMessages(
  messages: GenerateOptions['messages'],
  system: string | undefined,
  resolveImage?: ImageResolver,
): Promise<OllamaMessage[]> {
  const out: OllamaMessage[] = []
  if (system) out.push({ role: 'system', content: system })

  for (const message of messages) {
    const text: string[] = []
    const images: string[] = []

    for (const block of message.content) {
      if (block.type === 'text') {
        text.push(block.text)
      } else if (block.type === 'image') {
        const data = await resolveImage?.(String(block.attachment.attachmentId))
        if (data) images.push(data)
        // An unresolvable image is announced rather than dropped: a vision
        // answer built from an image the model never received would look
        // confident and be baseless.
        else text.push('[an image could not be loaded for this request]')
      } else if (block.type === 'tool-result') {
        // Ollama's chat API has no tool-result role; fold it into the user
        // turn so the model still sees what the tool returned.
        text.push(
          block.content.map((b) => (b.type === 'text' ? b.text : '')).join('\n'),
        )
      }
    }

    out.push({
      role: message.role === 'assistant' ? 'assistant' : message.role === 'system' ? 'system' : 'user',
      content: text.join('\n'),
      ...(images.length > 0 ? { images } : {}),
    })
  }
  return out
}

/**
 * Adapter for one Ollama server.
 *
 * Registered with `ctx.llm.registerAdapter([...routes], new OllamaAdapter(...))`,
 * so every plugin reaches it through `ctx.llm` and `wb-model-gateway` routing
 * — no plugin holds an Ollama reference of its own.
 */
export class OllamaAdapter extends LlmAdapter {
  private readonly base: URL

  /**
   * @param baseUrl - the Ollama endpoint; must be on-premise.
   * @param resolveImage - optional image resolver for vision models.
   * @throws when `baseUrl` is malformed or not a private address.
   */
  constructor(
    baseUrl: string,
    private readonly resolveImage?: ImageResolver,
  ) {
    super()
    this.base = requireOnPremiseUrl(baseUrl)
  }

  private url(path: string): string {
    return new URL(path, this.base).toString()
  }

  /**
   * List the models this server has pulled.
   * @param _provider - the route; one adapter instance serves one server.
   * @returns the models Ollama reports, or none when it is unreachable.
   */
  override async listModels(_provider: string): Promise<readonly LlmModelInfo[]> {
    try {
      const response = await fetch(this.url('/api/tags'), { headers: attributionHeaders() })
      if (!response.ok) return []
      const body = (await response.json()) as { models?: Array<{ name?: string }> }
      return (body.models ?? [])
        .filter((m): m is { name: string } => typeof m.name === 'string')
        .map((m) => ({ provider: _provider, id: m.name, name: m.name }))
    } catch {
      // A model list is advisory (the base class says so); an unreachable
      // server must not make model discovery throw and take a boot down with
      // it. A real call will surface the failure with a usable message.
      return []
    }
  }

  override async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    // Ollama serves multimodal and text models through one endpoint and does
    // not advertise modality, so nothing here can be claimed beyond identity.
    return { provider, id: model, name: model }
  }

  /**
   * Stream one chat completion.
   * @param options - the assembled request.
   * @returns NDJSON frames translated to harness stream chunks.
   */
  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const messages = await toOllamaMessages(options.messages, options.system, this.resolveImage)

    const response = await fetch(this.url('/api/chat'), {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...attributionHeaders() },
      body: JSON.stringify({
        model: options.model,
        messages,
        stream: true,
        options: {
          ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
          ...(options.maxTokens !== undefined ? { num_predict: options.maxTokens } : {}),
          ...(options.stop?.length ? { stop: options.stop } : {}),
        },
      }),
      ...(options.signal ? { signal: options.signal } : {}),
    })

    if (!response.ok || !response.body) {
      const detail = await response.text().catch(() => '')
      throw new Error(
        `ollama: ${options.model} request failed (${response.status})` +
          `${detail ? `: ${detail.slice(0, 300)}` : ''}. ` +
          `Is the model pulled? Try: ollama pull ${options.model}`,
      )
    }

    yield { type: 'block-start', index: 0, blockType: 'text' }

    let text = ''
    let promptTokens = 0
    let completionTokens = 0

    for await (const frame of readNdjson(response.body, options.signal)) {
      if (frame.error) throw new Error(`ollama: ${frame.error}`)
      const delta = frame.message?.content
      if (delta) {
        text += delta
        yield { type: 'text-delta', index: 0, text: delta }
      }
      if (frame.done) {
        promptTokens = frame.prompt_eval_count ?? 0
        completionTokens = frame.eval_count ?? 0
      }
    }

    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield {
      type: 'usage',
      usage: { inputTokens: promptTokens, outputTokens: completionTokens },
    }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

/**
 * Read an NDJSON body one frame at a time.
 *
 * Ollama emits one JSON object per line and a frame may be split across TCP
 * reads, so partial lines are buffered rather than parsed — parsing a fragment
 * would drop tokens mid-answer.
 * @param body - the response stream.
 * @param signal - caller cancellation.
 * @returns each decoded frame in order.
 */
async function* readNdjson(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncIterable<OllamaChatFrame> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      if (signal?.aborted) return
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      let newline = buffer.indexOf('\n')
      while (newline !== -1) {
        const line = buffer.slice(0, newline).trim()
        buffer = buffer.slice(newline + 1)
        if (line) yield JSON.parse(line) as OllamaChatFrame
        newline = buffer.indexOf('\n')
      }
    }
    const tail = buffer.trim()
    if (tail) yield JSON.parse(tail) as OllamaChatFrame
  } finally {
    // Releasing matters on the abort path: an un-released reader keeps the
    // socket open after the caller has stopped waiting for it.
    reader.releaseLock()
  }
}
