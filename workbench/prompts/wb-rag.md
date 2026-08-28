# Build `wb-rag` — Enterprise RAG plugin

You are building **one** plugin inside a larger multi-agent build: the
Sovereign AI Workbench, a set of Cordis plugins mounted on top of the
DeepSeek Harness agent runtime. Eleven other agents are independently
building the other plugins; you will never see their code and they will
never see yours. The only thing that lets your work integrate correctly
later is that you follow the frozen contract below exactly, without
improvising names.

## Required reading, in this order

1. `workbench/DESIGN.md` — read in full once for context, then read §6.5
   ("`wb-rag` — Enterprise RAG") closely; it is your contract card. Also
   read §4, §5 (classification matrix — the basis for per-chunk filtering),
   §7 in full, §9 (invariant 2: **authorization happens before context
   reaches the LLM, never after** — this is the single most important rule
   in this plugin), and §12.
2. `workbench/AGENTS.md` — general build process, coding conventions
   (especially "validate at real boundaries" — your retrieval input/output
   crosses a real trust boundary between untrusted-scope chunks and the
   model), §9 "done" checklist.
3. `workbench/packages/wb-types/src/index.ts` — frozen shared types. Import
   `WbRagService`, `WbRagResult`, `WbCitation`, `WbUser`, `WbClassification`;
   never redefine them.
4. `docs/testing.md` (repo root) — "Unit" tier and "Prefer the real
   implementation over a mock" sections.
5. Skim `packages/extensions/tool-cordis/tests/cordis-lifecycle.spec.ts` for
   Cordis testing idioms.

## Your role

Retrieval that authorizes candidates **before** reranking or returning
anything — never filters after the fact, never lets an LLM see a chunk it
wasn't authorized to see even transiently.

- Package: `@mrpl/dsh-workbench-rag`, at `workbench/packages/wb-rag/`.
- Provides: `ctx.wbRag` implementing `WbRagService` from `wb-types`
  (`retrieve(query, user): Promise<WbRagResult>`).
- Pipeline, in this exact order (per `DESIGN.md` §6.5):
  1. Embed the query via `ctx.wbModelGateway.resolve('embedding')`.
  2. Query a local vector index (implementation detail — pick anything
     reasonable for a local prototype; do not expose the vector store as a
     `ctx` key, nothing outside this plugin may depend on which one you
     used).
  3. **Before reranking**, filter candidates by calling
     `ctx.wbPolicy.evaluate(...)` per chunk's classification against the
     requesting `WbUser`'s clearance.
  4. Rerank the authorized set via `ctx.wbModelGateway.resolve('rerank')`.
  5. Return `WbRagResult` — `chunks` (with `citation` and
     `classification`), `citations`, and `filtered` (chunks that matched but
     were denied, with `reason` — this is required, not optional: a denied
     retrieval must be just as visible as an allowed one).
- Emit `wb/rag/retrieved` (payload `WbRagRetrievedEvent` from `wb-types`)
  once per `retrieve()` call, listing both authorized and filtered chunks,
  for `wb-audit` (a sibling plugin) to consume.
- `Config`: `indexPath: string` for the local vector index.

## Dependencies you consume

- `ctx.wbModelGateway` (`wb-model-gateway`, a sibling) — fake it, matching
  `WbModelGatewayService`, returning a deterministic embedding vector /
  rerank ordering for test fixtures.
- `ctx.wbPolicy` (`wb-policy`, a sibling) — fake it, matching
  `WbPolicyService`. This fake is the one your tests care about most:
  parameterize it so different test cases can force `ALLOW`/`DENY`/etc. per
  chunk, so you can assert your step-3-before-step-4 ordering rigorously
  (see Step 1 below).

## Non-goals — do not build these

- No document parsing or OCR — that's `wb-ingestion`'s job. You only read
  from the index `wb-ingestion` writes to.
- No policy decision logic of your own — you call `ctx.wbPolicy.evaluate`,
  you don't reimplement the §5 matrix here.
- No UI, no citation rendering — you return structured `WbCitation` data,
  `wb-ui`/`wb-artifacts` render it.
- Do not skip the "authorize before rerank" step for performance reasons —
  this is a named invariant in `DESIGN.md` §9, not a suggestion.

## Workflow — tests first, then implementation, then verification

**Step 1 — write failing tests before any implementation.** At minimum:
- **Ordering test, the most important one in this plugin**: instrument your
  fake `ctx.wbPolicy` and fake reranker so a test can assert
  `evaluate()` was called for every retrieved candidate *before* the
  reranker was ever invoked with any of them — not just "both happened,"
  the actual sequencing. If you can't express this as a strict ordering
  assertion, your implementation is probably violating the invariant.
- A chunk whose policy check returns `DENY` never appears in `chunks` or
  `citations`, and does appear in `filtered` with a `reason`.
- A chunk whose policy check returns `ALLOW_METADATA_ONLY` — decide and test
  one explicit behavior (e.g. included with text redacted to metadata only,
  or excluded entirely) and document your choice; don't leave it undefined.
- `retrieve()` embeds the query through `ctx.wbModelGateway.resolve('embedding')`
  and reranks through `resolve('rerank')` — assert against your fake.
- `wb/rag/retrieved` fires once per `retrieve()` call with a payload whose
  `result.filtered` matches what was actually denied in that call.
- Empty result set (nothing in the index matches) returns a well-formed
  empty `WbRagResult`, not a thrown error.
- HMR-safety test per `docs/testing.md`.

**Step 2 — implement** the minimum plugin code to pass those tests.

**Step 3 — expand tests** for edge cases found while implementing (very
large candidate sets, a `WbUser` with no `clearance` field populated —
should this be a config error or a runtime `DENY`-everything? decide and
test it).

**Step 4 — verify**, from `workbench/packages/wb-rag/`:
```
pnpm install
pnpm run typecheck
pnpm run lint
pnpm run test
pnpm run build
```

**Step 5 — self-check** against `AGENTS.md` §9, then write `README.md` per
`AGENTS.md` §8 (service API, config, events, your vector-index
implementation choice and why it's an internal detail, and a "Deviations"
section for your `ALLOW_METADATA_ONLY` handling and any other judgment call).

## If you hit a gap

Do not invent a workbench-wide name to fill it. Note it under "Deviations"
in your `README.md` and append a dated bullet to `DESIGN.md` §12.
