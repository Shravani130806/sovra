# `@mrpl/dsh-workbench-vision`

Gives workbench agents eyes: OCR, scanned-document layout, and drawing/P&ID
understanding. Registers the two frozen model-facing tools from DESIGN.md §7.5
and provides `ctx.wbVision` for plugins that need vision without going through
a tool call.

No vision model name appears anywhere in this package — every call resolves its
adapter through `ctx.wbModelGateway`. This plugin adds **no** policy check of
its own; the harness's `tools/pre-execute` hook already routes every tool call
through `wb-policy` (AGENTS.md §4 point 5).

## Model Experience

### `wb_ocr_extract`

Extracts text and layout from an image or scanned PDF page.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `image` | `string` | yes | Base64-encoded image bytes |
| `mediaType` | `'image/png' \| 'image/jpeg' \| 'image/webp' \| 'image/gif'` | yes | Media type of those bytes |

Returns a structured object, never a bare string, so `wb-rag` and
`wb-artifacts` can consume it programmatically:

```json
{
  "text": "PUMP P-101\nSUCTION 6\"",
  "blocks": [{ "text": "PUMP P-101", "box": [0.1, 0.2, 0.3, 0.05], "confidence": 0.94 }]
}
```

`box` is `[x, y, width, height]` in fractions of the image, origin top-left.

### `wb_vision_analyze`

Answers a question about a drawing, P&ID, or photo.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `image` | `string` | yes | Base64-encoded image bytes |
| `mediaType` | as above | yes | Media type of those bytes |
| `question` | `string` | yes | What to determine from the image |

```json
{
  "answered": true,
  "findings": [{ "summary": "P-101 discharges to vessel V-200", "box": [0.4, 0.3, 0.2, 0.1], "confidence": 0.81 }],
  "reason": ""
}
```

**A question the image cannot answer is a successful call with
`answered: false` and a `reason`** — not a thrown error. The model is
instructed to say so rather than guess. Only a malformed input or an
unreachable model is a tool error.

## Service API

`ctx.wbVision` implements `WbVisionService` from `@mrpl/dsh-workbench-types`
(DESIGN.md §7.3).

| Method | Behavior |
|---|---|
| `describe(image: Buffer \| string, prompt: string): Promise<Record<string, unknown>>` | One image + prompt call, returning the model's parsed JSON. Accepts raw bytes or a filesystem path. |

`describe()` is the path `wb-ingestion` uses for OCR before chunking. It
deliberately bypasses the tool-call pipeline and is therefore **not**
policy-checked — a caller reaching it is already inside its own governed
operation.

## Configuration

| Field | Type | Default | Purpose |
|---|---|---|---|
| `models` | `Partial<Record<WbModelCapability, string>>` | `{}` | Model id to request from the resolved adapter, per capability. Absent capabilities use the adapter's first listed model. |
| `maxImageBytes` | `number` | `5000000` | Cap on decoded image bytes accepted by `describe()` and both tools. |

## How an image reaches the model

Images cross into an LLM request only as an `ImageAttachmentRef` — an opaque
`attachmentId` owned by `ctx.attachments`, never raw bytes and never a path.
So both tools and `describe()` follow the same route as the harness's own
`read_image` tool: decode → `ctx.attachments.saveImage(...)` → build an
`ImageBlock` into a user message → `ctx.llm.stream(...)`. The attachment store
owns media-type verification and the size/dimension limits.

## Cancellation

Both tools honor `exec.signal`, and `describe()` accepts one internally. An
aborted call stops consuming the model stream and rejects rather than resolving
with a partial transcription presented as a complete one.

## Events

None. This plugin emits no events; its tool calls are observed through the
harness's own `tools/pre-execute` / `tools/result` stream like any other tool.

## Deviations from DESIGN.md

1. **`WbModelHandle` does not carry a model id, so this plugin picks one.**
   `resolve(capability)` returns `{ adapterId, capability }`, but
   `ctx.llm.stream` requires both `provider` **and** `model`. `adapterId` is
   the provider route; the model is chosen here from `Config.models`, falling
   back to the adapter's first `listModels()` entry. Every other plugin that
   calls a model will have to invent the same rule independently, so this is
   flagged in DESIGN.md §12 as a proposed `model` field on `WbModelHandle`.

2. **`resolve('ocr')` is not verified to return an OCR-capable adapter.**
   Per `wb-model-gateway`'s own README, the harness `LlmAdapter`/`LlmModelInfo`
   type system has no `ocr`/`embedding`/`rerank` capability signal, so
   validation there is existence-only. `wb_ocr_extract` therefore treats an
   unusable answer as a structured tool error rather than assuming the routed
   adapter can do OCR.

3. **PDF pages are not rasterized here.** The tool accepts an image of a page.
   Turning a multi-page PDF into page images belongs upstream in
   `wb-ingestion`, which owns the parse step; adding a PDF rasterizer
   dependency to this package would duplicate that ownership.

4. **`describe(image: Buffer, …)` assumes PNG.** The frozen signature carries
   no media type alongside the buffer, and bytes alone are not self-describing
   without a sniffing dependency. A path input infers its media type from the
   extension. Callers with non-PNG bytes should pass a path, or the signature
   needs a media-type parameter (a §7.3 change, not a local decision).

## Known Limitations and Deferred Work

- The OCR and analyze prompts are hardcoded English instructions. A bilingual
  deployment will want them configurable; no plugin consumes them yet, so the
  field was not invented ahead of a real need.
- `confidence` is passed through from the model unvalidated. Nothing yet
  enforces the documented `0..1` range, because no consumer reads it.
- No batching. Each call is one image; a 200-page scanned document ingests as
  200 calls. `ctx.jobs` is the harness's answer for long-running work and would
  be the place to add it if ingestion throughput becomes a real constraint.
