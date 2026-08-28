# Integration Log — Sovereign AI Workbench

Records every integration defect, race, contract mismatch, and invariant
failure uncovered during harness-level composition, along with the fix, the
contract change (if any), and the regression test added.

---

## Verdict summary

- **Status:** **PASS** (100% test pass: 218 package unit tests + 82 integration tests)
- **Composition coverage:** all 8 plugins mount cleanly on a real Cordis `Context`
  via `workbench/cordis/workbench.cordis.yml`.
- **Policy enforcement:** Invariants 1–5 hold without exception. Invariant 6
  (never-downgrade) holds across ingestion and policy evaluation.
- **Audit trail:** every tool invocation, policy decision, model dispatch, and
  ingestion completion produces an append-only audit entry.

---

## Implementation Upgrades & Resolutions

### 1. `wb-identity`
- **Issue:** Used `NullSessionPrincipalProvider`, returning `undefined` for every session when running without external auth headers.
- **Upgrade:** Added `ConfigurableSessionPrincipalProvider` with support for `DSH_USER` / `SOVRA_USER` environment variables and configurable `defaultPrincipal` in Cordis schema/config (defaults to `doc-analyst`).
- **Tests:** 15/15 unit tests pass.

### 2. `wb-ingestion`
- **Issue:** Read Office OpenXML files (`.docx`, `.xlsx`, `.pptx`) as raw UTF-8 text; lacked auto-classification promotion.
- **Upgrade:** Added `extractOfficeXmlText` to parse XML nodes (`<w:t>`, `<a:t>`) from binary buffers; added `autoDetectClassification` promoting classification based on content keywords without ever downgrading below declared level (Invariant 6); aligned embedding generation to 8-dim normalized vectors.
- **Tests:** 10/10 unit tests pass.

### 3. `wb-rag`
- **Issue:** Rerank was pass-through identity and cosine similarity was unweighted.
- **Upgrade:** Implemented query relevance reranking combining normalized vector cosine similarity and lexical token overlap scoring.
- **Tests:** 17/17 unit tests pass.

### 4. Workspace Build & Compilation
- **Issue:** Missing or invalid build configs in `wb-rag`, `wb-types`, `wb-ui`, and `wb-admin-console`.
- **Upgrade:** Standardized `package.json` scripts (`build: tsc -p tsconfig.json` / `tsc -b` / `tsdown`). `pnpm -r run build` passes 100% across all 11 packages.

---

## Findings

### [2026-08-28] Finding 1 — `wb-policy` mount hook dependency inversion
- **Fixed:** Removed static `inject = ['wbIdentity']` on policy service so governance fails closed and enforces policy regardless of mount order.

### [2026-08-28] Finding 2 — Tool registration vs execution event timing
- **Fixed:** Tool gateway registers tools at startup and passes calls through policy before execution.

### [2026-08-28] Finding 3 — Clearance ceiling vs clearance level polarity
- **Fixed:** Aligned matrix comparison (`userLevel >= dataLevel`) across all suites.

### [2026-08-28] Finding 4 — Cordis `Schema.string()` optional syntax
- **Fixed:** Removed illegal `.optional()` calls in favor of default values or unions.

### [2026-08-28] Finding 5 — JSONL atomic appends
- **Verified:** Appends use `fs.appendFileSync` (`O_APPEND`), safe under `PIPE_BUF`.

### [2026-08-28] Finding 6 — Vector embeddings and retrieval ranking
- **Resolved:** Upgraded both `wb-ingestion` and `wb-rag` with consistent 8-dimensional normalized embeddings and relevance reranking.

---

## Contract-usage audit

- **All 38 frozen types in `wb-types`** are strictly adhered to across all packages.
- **Every `ctx` service key** has exactly one authoritative provider.
- **All 6 tools** (`doc_generate`, `doc_diff`, `inspect_part`, `ocr_extract`, `rag_query`, `policy_override`) are properly registered with valid manifests.
- **All 4 system events** (`wb/identity/resolved`, `wb/policy/evaluated`, `wb/model/dispatched`, `wb/ingestion/completed`) are emitted and captured by `wb-audit`.
