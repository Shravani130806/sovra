# Build `wb-vision` — Multimodal / Vision plugin

You are building **one** plugin inside a larger multi-agent build: the
Sovereign AI Workbench, a set of Cordis plugins mounted on top of the
DeepSeek Harness agent runtime. Eleven other agents are independently
building the other plugins; you will never see their code and they will
never see yours. The only thing that lets your work integrate correctly
later is that you follow the frozen contract below exactly, without
improvising names.

## Required reading, in this order

1. `workbench/DESIGN.md` — read in full once for context, then read §6.6
   ("`wb-vision` — Multimodal / Vision") closely; it is your contract card.
   Also read §4, §7 in full, §7.5 (your two frozen tool names), §9
   (invariant: tool calls are policy-checked automatically — you don't add
   your own gate), and §12.
2. `workbench/AGENTS.md` — general build process, and **§4 in full**
   ("If your plugin registers a model-facing tool" — this applies directly
   to you, read every numbered point), §9 "done" checklist.
3. `workbench/packages/wb-types/src/index.ts` — frozen shared types. Import
   `WbVisionService`, `WbModelCapability`; never redefine them.
4. `docs/cookbook/adding-a-tool.md` (repo root) — read in full. Follow its
   `defineTool` pattern exactly: typed `parameters`, a structured
   `output.schema` (never a bare string — your results have fields
   `wb-rag`/`wb-artifacts` need to consume programmatically), and an
   appropriate `presentCall`/`presentResult` pair.
   Also read `packages/fs/tool-fs/src` for the **`read_image`** tool — it is
   the harness's existing answer to "how do image bytes enter a tool in this
   codebase," and it is a better model for `wb_ocr_extract`'s input parameter
   than inventing your own encoding.
5. `docs/testing.md` (repo root) — "Unit" tier and "Prefer the real
   implementation over a mock" sections.
6. Skim `packages/extensions/tool-cordis/tests/cordis-lifecycle.spec.ts` for
   Cordis testing idioms.

## Your role

Give agents eyes: OCR, scanned-document layout, and drawing/P&ID/photo
understanding.

- Package: `@mrpl/dsh-workbench-vision`, at `workbench/packages/wb-vision/`.
- Registers two model-facing tools via `ctx.tools.register(defineTool(...))`:
  - `wb_ocr_extract` — image/PDF page in, structured text + layout out.
  - `wb_vision_analyze` — image + a natural-language question in (e.g. *"what
    equipment is connected to pump P-101?"*), structured findings +
    bounding-box evidence out.
- Also provides `ctx.wbVision` implementing `WbVisionService` from
  `wb-types` (`describe(image, prompt): Promise<Record<string, unknown>>`),
  a plain service method for other plugins (`wb-ingestion`, a sibling) that
  need vision without going through the model-facing tool-call path.
- Both the tools and `describe()` resolve their model through
  `ctx.wbModelGateway.resolve('vision_reasoning')` or `resolve('ocr')` —
  **never hardcode a vision model name or call an adapter directly.**
- Registers a `WbToolManifest` for each of your two tools via
  `ctx.wbToolGateway.registerManifest(...)`, immediately after
  `ctx.tools.register(...)` for that tool, per `AGENTS.md` §4 point 3.
- Honor `exec.signal` — cancel in-flight OCR/vision work when it fires.

## Dependencies you consume

- `ctx.wbModelGateway` (from `wb-model-gateway`) — `resolve(capability):
  WbModelHandle`. **This sibling is already built** at
  `workbench/packages/wb-model-gateway/`; read its `src/index.ts` and README
  before faking anything, and fake only what you still need.
  The harness's real model-call surface is **`ctx.llm`** — confirmed, not
  "or similar": `wb-model-gateway` declares `inject = ['llm']`. See
  `docs/cookbook/adding-an-llm-adapter.md` for the call shape.
  Stub `ctx.llm` so it returns deterministic canned vision/OCR output, and
  keep the real harness tool-registration and `Context` machinery around that
  one faked boundary — per "mock only the expensive or non-deterministic
  boundary (the model), keep everything downstream real."

  One thing that sibling's README will tell you and you must not design
  around: `resolve('ocr')` validation is **existence-only**. The harness
  `LlmAdapter`/`LlmModelInfo` type system has no `ocr`/`embedding`/`rerank`
  capability signal, so the handle you get back is a mounted adapter that is
  *not* verified to be OCR-capable. Do not assume the returned handle
  guarantees OCR support; if the adapter answers unusably, that is a
  structured tool-level error, not an assertion failure.
- `ctx.wbToolGateway` (from `wb-tool-gateway`) — **build order puts this
  sibling ahead of you**, so prefer the real service over a fake if it is
  present in the tree; fall back to a fake matching `WbToolGatewayService`
  from `wb-types` only if it is not. Either way, assert your plugin actually
  calls `registerManifest` for both tools.
- The harness's own `tools` capability for `ctx.tools.register` — real, not
  faked.

## Non-goals — do not build these

- No policy check of your own inside either tool's `execute()`. The
  harness's `tools/pre-execute` hook already routes every tool call through
  `wb-policy` — adding a second, tool-local check is redundant and risks
  disagreeing with the central one (`AGENTS.md` §4 point 5).
- No persistence of results — that's `wb-ingestion`'s or the calling agent's
  job; your tools and `describe()` are stateless per call.
- No new vision model, no new OCR engine implementation — you call out to
  whatever adapter `wb-model-gateway` resolves you to.

## Workflow — tests first, then implementation, then verification

**Step 1 — write failing tests before any implementation.** At minimum:
- `wb_ocr_extract` called through the real tool registry (not by calling
  your internal function directly — per "test the real entry path") with a
  fixture image/PDF-page input returns structured text/layout matching your
  `output.schema`, using the faked model boundary for a deterministic
  result.
- `wb_vision_analyze` likewise, including a case where the question can't be
  answered from the image (structured "no finding" result, not a thrown
  error, unless the input is genuinely malformed).
- Both tools call `ctx.wbModelGateway.resolve(...)` with the correct
  capability (`'ocr'` vs `'vision_reasoning'`) — assert this against your
  fake gateway.
- Both tools register a `WbToolManifest` exactly once each, at plugin
  `apply()` time — assert both calls were recorded with sane
  `riskLevel`/`dataClassificationCeiling`/`networkAccess` values. Per §7.5
  both tools are `riskLevel: 'local'`; both run entirely against a local
  adapter, so `networkAccess` should be `'none'`, and neither manifest's
  `toolId` may drift from the frozen `wb_ocr_extract` / `wb_vision_analyze`
  names.
- A manifest is registered for a tool whose `toolId` matches the name passed
  to `ctx.tools.register` — assert they are the same string, because a
  mismatch means `wb-policy` denies your tool at every call
  (`NO_MANIFEST`) while both registrations individually look fine.
- `ctx.wbVision.describe(image, prompt)` works standalone (not just via the
  tools) and resolves through the same faked model boundary.
- Cancellation: a call whose `exec.signal` fires mid-flight stops promptly
  and does not resolve with a stale/partial result presented as success.
- Malformed input (unreadable image bytes, empty buffer) is a structured
  tool-level error, not an unhandled throw that crashes the fiber.
- HMR-safety test per `docs/testing.md`.

**Step 2 — implement** the minimum plugin code to pass those tests.

**Step 3 — expand tests** for edge cases found while implementing (large
image handling, multi-page PDF input if you choose to support it — document
whether you do).

**Step 4 — verify**, from `workbench/packages/wb-vision/`:
```
pnpm install
pnpm run typecheck
pnpm run lint
pnpm run test
pnpm run build
```

**Step 5 — self-check** against `AGENTS.md` §9 (including the tool-specific
bullets), then write `README.md` per `AGENTS.md` §8, with a full "Model
Experience" section describing both tools' parameters/output shapes (this
one is genuinely model-visible, don't skip it), and a "Deviations" section
for whatever real harness model-call surface you integrated against.

## If you hit a gap

Do not invent a workbench-wide name to fill it. Note it under "Deviations"
in your `README.md` and append a dated bullet to `DESIGN.md` §12.
