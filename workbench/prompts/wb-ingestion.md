# Build `wb-ingestion` — Document Ingestion plugin

You are building **one** plugin inside a larger multi-agent build: the
Sovereign AI Workbench, a set of Cordis plugins mounted on top of the
DeepSeek Harness agent runtime. Eleven other agents are independently
building the other plugins; you will never see their code and they will
never see yours. The only thing that lets your work integrate correctly
later is that you follow the frozen contract below exactly, without
improvising names.

## Required reading, in this order

1. `workbench/DESIGN.md` — read in full once for context, then read §6.8
   ("`wb-ingestion` — Document Ingestion") closely; it is your contract
   card. Also read §4, §5, §7 in full, §9 (invariant 6: **classification is
   never silently downgraded** — the core rule of this plugin), and §12.
2. `workbench/AGENTS.md` — general build process, coding conventions
   (especially "validate at real boundaries" — uploaded files are exactly
   the kind of real boundary that needs real validation), §9 "done"
   checklist.
3. `workbench/packages/wb-types/src/index.ts` — frozen shared types. Import
   `WbIngestionService`, `WbDocumentId`, `asWbDocumentId`,
   `WbClassification`, `WbIngestionCompletedEvent`; never redefine them.
4. `docs/testing.md` (repo root) — "Unit" tier and "Prefer the real
   implementation over a mock" sections.
5. Skim `packages/extensions/tool-cordis/tests/cordis-lifecycle.spec.ts` for
   Cordis testing idioms.

## Your role

The pipeline: upload → validate → classify → parse/OCR → chunk → embed →
index — kept deliberately separate from `wb-rag`'s retrieval concern.

- Package: `@mrpl/dsh-workbench-ingestion`, at
  `workbench/packages/wb-ingestion/`.
- Provides: `ctx.wbIngestion` implementing `WbIngestionService` from
  `wb-types` (`enqueue(file): Promise<WbDocumentId>`).
- Validates file type/size before doing anything else; reject
  (throw/reject the promise with a clear reason) anything that fails
  validation rather than attempting to process it.
- Assigns a `WbDocumentId` (via `asWbDocumentId`) to every accepted file.
- **Classification rule, the most important one here**: the classification
  is the uploading user's `declaredClassification` **at minimum**. You may
  run auto-classification heuristics (e.g. detecting a P&ID-like drawing)
  that suggest a *higher* level for human confirmation, but you must never
  silently lower the declared classification. If you don't implement
  auto-classification at all for this prototype, that's fine — just never
  violate the "never downgrade" rule with whatever you do implement.
- Text documents parse directly (implementation detail, your choice of
  library). Image/scanned content calls `ctx.wbVision.describe(...)` (from
  `wb-vision`, a sibling plugin) for OCR before chunking.
- Chunks + metadata (source id, page, classification, ACL) are written to
  the local vector index that `wb-rag` (another sibling) reads. The index's
  storage format/location is your implementation detail to decide and
  document in your own `README.md` — nothing outside `wb-ingestion` and
  `wb-rag` needs to agree on it beyond "there is a local index `wb-rag` can
  read," so document your format clearly enough that a human wiring the two
  together later (or the `wb-rag` agent, if built after you) can match it.
- Emits `wb/ingestion/completed` (payload `WbIngestionCompletedEvent` from
  `wb-types`) with the resulting `WbDocumentId` and assigned classification,
  for `wb-audit`.

## Dependencies you consume

- `ctx.wbVision` (`wb-vision`, a sibling) — fake it, matching
  `WbVisionService`, returning deterministic OCR/description output for
  image-type test fixtures.
- `ctx.wbModelGateway` (`wb-model-gateway`, a sibling) for embeddings — fake
  it, matching `WbModelGatewayService`.
- `ctx.wbPolicy` (`wb-policy`, a sibling) — `DESIGN.md` §6 lists this as a
  dependency for classification-aware access assignment; fake it, matching
  `WbPolicyService`, if your implementation calls it (e.g. to validate that
  the declared classification is a value the uploading user is actually
  permitted to assert). If you decide not to call it, document why in your
  README rather than silently omitting the dependency.

## Non-goals — do not build these

- No retrieval logic — `wb-rag` reads what you write; you don't implement
  `retrieve()` yourself.
- No new OCR/vision implementation — call `ctx.wbVision.describe(...)`.
- No UI for reviewing an auto-classification suggestion — if you implement
  suggestion-only upgrades, exposing them for human confirmation is
  `wb-ui`/`wb-admin-console`'s job; you just don't apply an unconfirmed
  upgrade automatically without documenting exactly what "applying" means
  in your implementation.

## Workflow — tests first, then implementation, then verification

**Step 1 — write failing tests before any implementation.** At minimum:
- A valid text file: `enqueue()` resolves to a `WbDocumentId`, chunks land
  in the index at the declared classification, and `wb/ingestion/completed`
  fires with that classification.
- An invalid file (wrong type, over size limit, empty): `enqueue()` rejects
  with a clear reason and nothing is written to the index and no
  `wb/ingestion/completed` fires.
- An image/scanned-type file: `enqueue()` calls `ctx.wbVision.describe(...)`
  (assert against your fake) before chunking, and the OCR output ends up in
  the indexed chunks.
- **The downgrade-prevention test, the most important one here**: if you
  implement any auto-classification logic, prove explicitly that a
  suggestion below the declared level never gets applied — feed a fixture
  that would trigger a lower auto-suggestion and assert the stored
  classification is still the declared (higher) one. If you don't implement
  auto-classification, write a test proving the stored classification always
  equals exactly the declared one, so the invariant is still checked even in
  the simplest implementation.
- Embeddings are requested through `ctx.wbModelGateway.resolve('embedding')`
  — assert against your fake, not a hardcoded model call.
- HMR-safety test per `docs/testing.md`.

**Step 2 — implement** the minimum plugin code to pass those tests.

**Step 3 — expand tests** for edge cases found while implementing (very
large multi-page documents, concurrent `enqueue()` calls, a file whose type
your parser can't handle at all — should fail loud with a clear reason, not
silently produce zero chunks).

**Step 4 — verify**, from `workbench/packages/wb-ingestion/`:
```
pnpm install
pnpm run typecheck
pnpm run lint
pnpm run test
pnpm run build
```

**Step 5 — self-check** against `AGENTS.md` §9, then write `README.md` per
`AGENTS.md` §8 (service API, config, events, your index storage format
documented clearly enough for `wb-rag` to match, your classification
handling, and a "Deviations" section for whether/how you use `ctx.wbPolicy`).

## If you hit a gap

Do not invent a workbench-wide name to fill it. Note it under "Deviations"
in your `README.md` and append a dated bullet to `DESIGN.md` §12.
