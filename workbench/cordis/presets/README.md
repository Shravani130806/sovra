# wb-presets — Agent preset compositions

Config-only deliverable: five `cordis.yml` files under `workbench/cordis/presets/`
that define agent personas for the Sovereign AI Workbench. No TypeScript, no
`package.json`, no `ctx` service.

## Presets

| Preset file | Persona | Capabilities (§5 matrix) |
|---|---|---|
| `document-analyst.cordis.yml` | Document Analyst | Files ✓ RAG ✓ Vision ○ Python ✗ |
| `engineering-vision.cordis.yml` | Engineering Vision Analyst | Files ✓ RAG ✓ Vision ✓ Python ✓ |
| `code-analysis.cordis.yml` | Code Analysis Agent | Files ✓ RAG ✓ Python ✓ Web ✗ |
| `research.cordis.yml` | Research Agent | RAG ✓ Web ✓* External API ✗ |
| `artifact.cordis.yml` | Artifact Generation Agent | Files ✓ RAG ✓ Artifacts ✓ |

### document-analyst.cordis.yml

Reads enterprise documents and retrieves from the RAG system. Read-only
filesystem access. No code execution, vision, web, or file modification.

**Composes:** `tool-fs` (harness, re-enabled from web-app disable),
`@mrpl/dsh-workbench-rag`.

### engineering-vision.cordis.yml

Reads files, analyzes images/technical drawings/P&IDs via vision tools,
extracts text from scanned documents via OCR, retrieves from RAG, and
executes Python for engineering calculations.

**Composes:** `tool-fs` (harness), `@mrpl/dsh-workbench-rag`,
`@mrpl/dsh-workbench-vision` (registers `wb_vision_analyze` and
`wb_ocr_extract`).

### code-analysis.cordis.yml

Executes code in a sandboxed runtime, reads files, and retrieves
specifications from RAG. No web search.

**Composes:** `tool-fs` (harness), `@deepseek-ai/dsh-code-runtime`
(harness, per DESIGN.md §6.12), `@mrpl/dsh-workbench-rag`.

### research.cordis.yml

Searches the web (PUBLIC-classified queries only, gated by `wb-policy`)
and retrieves from RAG. No code, vision, or file modification.

**Composes:** `tool-web` (harness, re-enabled from web-app disable,
fetch disabled), `@mrpl/dsh-workbench-rag`.

### artifact.cordis.yml

Reads files, retrieves evidence from RAG, and generates reports, approval
notes, spreadsheets, and presentations with embedded provenance. No web,
code, or vision.

**Composes:** `tool-fs` (harness), `@mrpl/dsh-workbench-rag`,
`@mrpl/dsh-workbench-artifacts` (registers `wb_generate_report`,
`wb_generate_approval_note`, `wb_generate_spreadsheet`,
`wb_generate_presentation`).

## Persona design

Every persona string explicitly names the tools the model has access to and
states that every tool call is policy-governed by `wb-policy`. This is what
makes governance visible in the product (DESIGN.md §6.12): the model tells
the user that tool calls may be denied, and instructs the model to explain
denials rather than retry silently.

The research persona additionally notes that web search is restricted to
PUBLIC-classified queries, making the classification-aware gating explicit
in the model-visible prompt.

## Harness tool re-enabling

The `dsh-web-app` bundle (`packages/bundle/web-app/cordis.patch.yml`) disables
23 harness tools at the host level. Presets that need a disabled tool must
include an explicit row re-enabling it. The affected tools in these presets:

- `tool-fs` (disabled by web-app; re-enabled in document-analyst,
  engineering-vision, code-analysis, artifact)
- `tool-web` (disabled by web-app; re-enabled in research)

This is documented as an Open Question in DESIGN.md §12.

## Relationship to the harness preset system

The harness preset discovery system (`packages/preset/agent-presets`) expects
directories containing `agent.cordis.yml`, not flat `.cordis.yml` files. The
deliverable uses flat files per DESIGN.md §3 and §6.12. These flat files are
contract-compliant but will not be discovered by the real preset system without
reconciliation (see Deviations).

## Verification

No harness dry-run command validates these preset files in isolation. Structural
verification was performed against the complete checklist in the implementation
plan:

- Every tool name referenced appears in DESIGN.md §7.5 (for `wb_*` tools) or
  in the confirmed harness package list (`dsh-tool-fs`, `dsh-tool-web`,
  `dsh-code-runtime`)
- Every file is valid YAML matching the row shape (`id`/`name`/`config`)
- Every persona string contains an explicit policy-governed statement
- Every file's capability set matches its §6.12 row

A lightweight `verify-wb-presets` script is proposed in DESIGN.md §12 to
automate these checks.

## Deviations

- **Flat files vs. directories:** DESIGN.md §3 and §6.12 specify flat
  `.cordis.yml` files. The harness preset discovery system requires directories
  with `agent.cordis.yml` inside (confirmed via `packages/preset/agent-presets/src/discovery.ts`
  `scanRoot()` and `discovery.spec.ts` lines 127–136). The flat files are
  delivered as specified; reconciliation is an Open Question in DESIGN.md §12.
- **wb-rag as explicit row:** `@mrpl/dsh-workbench-rag` is already globally
  mounted by `workbench/cordis/workbench.cordis.yml`. Including it as an
  explicit row in each preset is a judgment call for self-documentation — it
  makes the dependency visible in the preset file without relying on the reader
  knowing the bundle's composition. This is safe (the Loader resolves to the
  existing global instance) but optional.
- **code-runtime vs. tool-bash:** DESIGN.md §6.12 specifies code-analysis
  composes "harness e2b/code-runtime", not bash. The preset follows §6.12
  exactly. If integration reveals that `dsh-code-runtime` needs
  `tool-presentation` (Code Mode) to be useful, that is an integration finding,
  not a reason to deviate from the frozen contract.
- **Chinese-language display names:** The shipped harness presets use Chinese
  names in `preset.yml` (e.g., `name: 标准模式`). These flat-file presets have
  no `preset.yml` companion, so this convention does not apply here.
