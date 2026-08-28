# Build `wb-artifacts` — Artifact Generator plugin

You are building **one** plugin inside a larger multi-agent build: the
Sovereign AI Workbench, a set of Cordis plugins mounted on top of the
DeepSeek Harness agent runtime. Eleven other agents are independently
building the other plugins; you will never see their code and they will
never see yours. The only thing that lets your work integrate correctly
later is that you follow the frozen contract below exactly, without
improvising names.

## Required reading, in this order

1. `workbench/DESIGN.md` — read in full once for context, then read §6.9
   ("`wb-artifacts` — Artifact Generator") closely; it is your contract
   card. Also read §4, §7 in full, §7.5 (your four frozen tool names), and
   §12.
2. `workbench/AGENTS.md` — general build process, and **§4 in full**
   ("If your plugin registers a model-facing tool" — applies directly to
   you), §9 "done" checklist.
3. `workbench/packages/wb-types/src/index.ts` — frozen shared types. Import
   `WbCitation`, `WbAuditEntry`, `WbToolManifest`; never redefine them.
4. `docs/cookbook/adding-a-tool.md` (repo root) — read in full. Follow its
   `defineTool` pattern exactly.
5. `docs/testing.md` (repo root) — "Unit" tier and "Prefer the real
   implementation over a mock" sections.
6. Skim `packages/extensions/tool-cordis/tests/cordis-lifecycle.spec.ts` for
   Cordis testing idioms.

## Your role

Turn grounded findings into a real deliverable — approval note, report, or
an actual `.docx`/`.xlsx`/`.pptx` file — carrying embedded provenance.

- Package: `@mrpl/dsh-workbench-artifacts`, at
  `workbench/packages/wb-artifacts/`.
- Registers four model-facing tools via `ctx.tools.register(defineTool(...))`:
  `wb_generate_report`, `wb_generate_approval_note`,
  `wb_generate_spreadsheet`, `wb_generate_presentation`.
- Each tool's input schema requires: a `title`, **at least one `WbCitation`**
  (import the type from `wb-types` — do not accept zero citations for
  report/approval-note generation; the schema itself should make this
  unrepresentable, not just a runtime check), and free-form findings text.
- Each tool's output: the generated file's path, plus a provenance block
  embedded in the document itself — sources (from the citations), tools
  used, and any policy decisions relevant to this generation. Mirror the
  "Generated Report" example format in `Plugin_design_idea` §13 (referenced
  from `DESIGN.md` §6.9).
- File generation reuses the harness's own filesystem write path
  (`ctx.fs`/`dsh-tool-fs` — find the actual API in this repo, e.g.
  `packages/fs`) rather than writing files directly with Node's `fs` module,
  so writes stay inside the same observed/diffed pipeline as everything else
  an agent does.
- Registers a `WbToolManifest` for each of your four tools via
  `ctx.wbToolGateway.registerManifest(...)`, per `AGENTS.md` §4 point 3.
- Honor `exec.signal` for any generation that takes real time (multi-page
  document assembly).

## Dependencies you consume

- `ctx.wbToolGateway` (`wb-tool-gateway`, a sibling) — fake it, matching
  `WbToolGatewayService`; assert your plugin calls `registerManifest` for
  all four tools.
- `ctx.wbAudit` (`wb-audit`, a sibling, listed as a dependency in
  `DESIGN.md`'s catalog table) — fake it if your implementation records
  anything through it directly; note that most of the time the provenance
  block embedded *in the generated file* is your actual deliverable, and
  `wb-audit`'s own record of the tool call happens automatically via the
  harness's `tool/result` event regardless of what you do here — don't
  duplicate that, just document which path you rely on.
- The harness's own filesystem write capability (`ctx.fs`/`dsh-tool-fs`) —
  real, not faked, per "prefer the real implementation over a mock"; write
  to a temp directory in tests and assert real files exist with real
  content.

## Non-goals — do not build these

- Does not retrieve evidence itself — the caller (an agent, via `wb-rag`)
  must already have citations in hand before calling your tools. Do not add
  a hidden retrieval call inside `wb-artifacts`.
- Does not decide what the report *says* — you format what the model gives
  you plus the required citations; you are not a second reasoning step.
- No policy check of your own inside `execute()` — same rule as every other
  tool-registering plugin (`AGENTS.md` §4 point 5); `tools/pre-execute`
  already covers you.
- Do not implement `.docx`/`.xlsx`/`.pptx` generation from scratch with a
  hand-rolled binary format — use a real, appropriate library for each
  format and say which one you chose and why in your README.

## Workflow — tests first, then implementation, then verification

**Step 1 — write failing tests before any implementation.** At minimum:
- Each of the four tools, called through the real tool registry (not your
  internal function directly), with a valid title/citations/findings input,
  produces a real file at the returned path, written through the faked
  `ctx.fs` boundary (assert the fake was called with sensible arguments; if
  you test against a real temp-dir filesystem instead, assert the file
  genuinely exists and its content round-trips, e.g. a generated `.xlsx`
  opens and contains the expected data — "verify the world, not the
  self-report," per `docs/testing.md`).
- An input with **zero citations** is rejected at the schema level for
  `wb_generate_report`/`wb_generate_approval_note` — assert the tool
  registry itself refuses the call (schema validation), not that your
  `execute()` body checks and throws.
- The generated file's embedded provenance block lists every citation from
  the input, matching `WbCitation` shape.
- Each tool registers exactly one `WbToolManifest` at `apply()` time —
  assert against the faked `wb-tool-gateway`.
- Cancellation via `exec.signal` mid-generation stops promptly without
  leaving a half-written file presented as a successful result.
- Malformed input beyond what the schema itself catches (e.g. a citation
  with an empty `documentId`) is a structured tool-level error.
- HMR-safety test per `docs/testing.md`.

**Step 2 — implement** the minimum plugin code to pass those tests.

**Step 3 — expand tests** for edge cases found while implementing (very long
findings text, many citations, special characters in the title that could
break a filename).

**Step 4 — verify**, from `workbench/packages/wb-artifacts/`:
```
pnpm install
pnpm run typecheck
pnpm run lint
pnpm run test
pnpm run build
```

**Step 5 — self-check** against `AGENTS.md` §9, then write `README.md` per
`AGENTS.md` §8, with a full "Model Experience" section for all four tools
(this plugin is heavily model-visible), which document-generation libraries
you chose per format and why, and a "Deviations" section for anything you
had to infer about the harness's filesystem write API.

## If you hit a gap

Do not invent a workbench-wide name to fill it. Note it under "Deviations"
in your `README.md` and append a dated bullet to `DESIGN.md` §12.
