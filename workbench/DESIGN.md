# Sovereign AI Workbench — DESIGN.md

*Lives at `workbench/DESIGN.md` inside a checkout of `deepseek-ai/deepseek-harness`.
This is the frozen contract for the MRPL Sovereign On-Premise Agentic AI Workbench
(SIH 2026, PS #26117). Read this together with `workbench/AGENTS.md` before writing
any code.*

> **Read this like a junior dev, not like a spec-lawyer.** Every section explains
> *why* a rule exists before it states the rule. If you only have time to read one
> thing before you start building your plugin, read §6 (your plugin's contract
> card) and §7 (the frozen shared vocabulary). Everything else is background that
> makes those two sections make sense.

---

## 0. How to use this document

This project is split into ~12 independent packages ("plugins"). **Each plugin is
built by a different agent, working alone, who has read only:**

1. A short task prompt naming which plugin to build.
2. This file, `DESIGN.md`.
3. `AGENTS.md` (the how-to-build-it instructions).

That agent will **never see** the source code the other 11 agents write. The only
thing standing between "12 plugins that snap together" and "12 plugins that don't
compile against each other" is this document being unambiguous. So:

- Anything in §7 ("Frozen Contract") is **load-bearing**. Copy names exactly.
  Do not rename, do not "improve," do not add a field you think is missing —
  raise it in an Open Question (§12) instead.
- Anything outside §7 is architectural context. It explains *why* the contract
  looks the way it does, but the contract itself is what other plugins depend on.
- If your plugin needs to call another plugin's capability, the *only* way it may
  do so is through the frozen `ctx` keys, event names, and TypeScript types in §7
  — never by importing another plugin's package directly.

---

## 1. What we are actually building (and what we are not)

The problem statement (PS #26117, MRPL) asks for a **self-hosted, air-gapped AI
workbench** that lets engineers at a refinery do confidential knowledge work
(approval notes, inspection reports, P&IDs, code, spreadsheets) with an AI
assistant that behaves like Claude/Codex, without any data leaving the premises.

Three source documents feed this design:

| Source | What it fixes |
|---|---|
| `Problem_Statement` | The actual PS requirements — what the workbench must demonstrably do |
| `Plugin_design_idea` | The team's proposed 12-plugin architecture and diagrams |
| `SIH_2026_..._Source_of_Truth.docx` | The team's own guardrails on scope, USP, and what NOT to build |
| `deepseek-ai/deepseek-harness` (this repo) | The actual agent runtime we build *on top of*, not instead of |

**Important reconciliation.** The Source of Truth document is explicit that the
project must not claim "RAG," "multi-agent architecture," "local LLM," or
"orchestration framework" as its innovation — those are commodity building
blocks. DeepSeek Harness already **is** a production-grade, plugin-based agent
runtime with sessions, tools, sandboxed code execution, a filesystem capability,
a web capability, subagents, and multimodal-capable model adapters, all governed
by Cordis's effect system. That means several boxes in `Plugin_design_idea`'s
diagram are **already solved by the harness** and must not be rebuilt:

| `Plugin_design_idea` box | Already provided by `deepseek-harness` core | Workbench's job |
|---|---|---|
| Agent Runtime Adapter | The harness *is* the agent runtime (`core/agent-loop`, `llm/llm`) | Add task-aware **model selection** across multiple mounted adapters — see §6.4 |
| Code & Analysis Agent sandbox | `packages/e2b`, `packages/code-runtime` | Add policy gating + an engineering-calculation preset, not a new sandbox |
| Research Agent web access | `packages/web` (Service Definition + search/fetch + tool Consumer) | Add classification-aware gating so only `PUBLIC`-tagged queries reach it |
| File read/write tools | `packages/fs` (`dsh-tool-fs`) | Add classification-aware access policy on top |
| "Agents" (Document/Engineering/Code/Research/Artifact) | `packages/preset` (per-session composition from `cordis.yml`) | Ship these as **presets**, not new infrastructure plugins — see §6.12 |

So the workbench is **not** "DeepSeek Harness + a chatbot skin." It is a set of
governance, knowledge, and multimodal plugins that mount beside the harness's
existing plugins and make every capability **identity-aware, classification-aware,
and audited**. The one sentence from the source-of-truth doc is the north star:

> *A sovereign, on-premise agentic AI workbench that gives authorized industrial
> users the capabilities of modern AI assistants over confidential multimodal
> enterprise data, while keeping data within the organization's security boundary
> and controlling every external tool, network and data-flow capability through
> policy.*

### What we explicitly do NOT build

- A new LLM, a new vector database, a new sandbox, or a new agent framework.
- A new bash/subprocess/filesystem tool — the harness already has one.
- 15+ shallow agents. We ship 5 presets (§6.12), built from the plugins below.
- Any plugin that talks to the network *directly* — every network-capable
  capability (web search, external API) must be reached only through the harness's
  existing capability, gated by `wb-policy` (§6.2).

---

## 2. High-level architecture

```
                         ┌──────────────────────────┐
                         │        wb-ui (client)     │   Secure Workbench UI
                         └─────────────┬─────────────┘
                                       │ SDK (JSON-RPC / dsh-sdk)
                         ┌─────────────┴─────────────┐
                         │   DeepSeek Harness runtime │   agent-loop, sessions,
                         │   (this repo, unmodified)  │   tools registry, llm
                         └─────────────┬─────────────┘
                                       │ Cordis plugin tree
        ┌───────────────┬─────────────┼──────────────┬───────────────┐
        ▼               ▼             ▼              ▼               ▼
   wb-identity      wb-policy     wb-model-      wb-tool-       wb-audit
   (RBAC/session)   (control      gateway        gateway        (provenance
                     plane)       (task→model     (tools/pre-    log)
                                  routing)        execute hook)
        │               │             │              │               │
        └───────┬───────┴──────┬──────┴───────┬──────┴───────┬───────┘
                ▼               ▼              ▼              ▼
           wb-ingestion      wb-rag        wb-vision      wb-artifacts
           (parse/OCR/       (permission-  (drawings,     (docx/xlsx/pptx
            chunk/embed)      aware         P&IDs, scans)  with provenance)
                               retrieval)
                │               │              │              │
                └───────────────┴──────┬───────┴──────────────┘
                                        ▼
                                  wb-presets
                          (Document / Engineering / Code /
                           Research / Artifact agent compositions,
                           built from cordis.yml, zero new services)
                                        │
                                        ▼
                                 wb-admin-console
                          (reads wb-audit + wb-policy config; no
                           new data path of its own)
```

Every arrow that crosses a security-relevant boundary (file access, tool call,
network call, model call carrying classified context) passes through
`wb-policy` first. This is enforced mechanically, not by convention: `wb-policy`
registers on the harness's own `tools/pre-execute` extension point (see
`docs/cookbook/adding-a-tool.md` in this repo) and on `wb-rag`'s retrieval path,
so a plugin cannot "forget" to call it.

---

## 3. Repository layout

```
workbench/
├── DESIGN.md              # this file — the frozen contract
├── AGENTS.md               # how to build one plugin
├── README.md               # 10-line pointer for humans
├── cordis/
│   ├── workbench.cordis.yml       # the bundle: stacks every wb-* plugin over dsh-base
│   └── presets/                   # one <id>/agent.cordis.yml per persona (§6.12)
│       ├── document-analyst.cordis.yml
│       ├── engineering-vision.cordis.yml
│       ├── code-analysis.cordis.yml
│       ├── research.cordis.yml
│       └── artifact.cordis.yml
└── packages/
    ├── wb-types/            # frozen shared TypeScript contract — do not edit (§7)
    ├── wb-identity/
    ├── wb-policy/
    ├── wb-audit/
    ├── wb-model-gateway/
    ├── wb-ingestion/
    ├── wb-rag/
    ├── wb-vision/
    ├── wb-tool-gateway/
    ├── wb-artifacts/
    ├── wb-ui/
    ├── wb-admin-console/
    └── wb-presets/          # cordis.yml + persona prompts only, no service code
```

Each `packages/<name>/` is a self-contained npm workspace package, following the
same shape the harness itself uses for `packages/<group>/<pkg>/`
(`docs/cookbook/adding-a-package.md`): `package.json`, `tsconfig.json`,
`src/index.ts`, `README.md`. One agent owns exactly one `packages/<name>/`
directory and must never edit files outside it (except `wb-presets`, which by
design only writes to `cordis/presets/`).

---

## 4. Naming and namespacing rules

The harness already owns short `ctx` keys like `ctx.tools`, `ctx.fs`, `ctx.llm`,
`ctx.sessions`, `ctx.identity` (anonymous identity), `ctx.agents`. To guarantee we
never collide with a harness key (now or after a harness upgrade), **every
workbench-owned `ctx` key, package name, event name, and tool name is prefixed.**

| Kind | Prefix | Example |
|---|---|---|
| npm package | `@mrpl/dsh-workbench-<name>` | `@mrpl/dsh-workbench-policy` |
| Cordis `ctx` key | `wb<PascalCase>` | `ctx.wbPolicy`, `ctx.wbIdentity` |
| Event namespace | `wb/<domain>/<verb>` | `wb/policy/decision`, `wb/audit/record` |
| Tool name (model-facing) | `wb_<snake_case>` | `wb_generate_approval_note` |
| Data classification enum | `WbClassification` | `'PUBLIC' \| 'INTERNAL' \| 'CONFIDENTIAL' \| 'RESTRICTED'` |

No plugin registers a bare (unprefixed) `ctx` key, tool name, or event. This is
mechanically checkable and should be part of every plugin's own review checklist
(§9 of `AGENTS.md`).

---

## 5. Data classification and the access matrix

Four classification levels, ordered PUBLIC < INTERNAL < CONFIDENTIAL < RESTRICTED.
Every document, RAG chunk, tool call, and model request carries one of these as
metadata. This table is the canonical policy default; `wb-policy` implements it
and the Admin Console can override it per role, never per request.

| Capability | PUBLIC | INTERNAL | CONFIDENTIAL | RESTRICTED |
|---|:---:|:---:|:---:|:---:|
| Local model inference | ALLOW | ALLOW | ALLOW | ALLOW |
| Internal RAG / documents | ALLOW | ALLOW | ALLOW | ALLOW |
| Local code sandbox (`e2b`/`code-runtime`) | ALLOW | ALLOW | ALLOW | ALLOW |
| Internal DB / internal API | ALLOW | ALLOW | ALLOW | APPROVAL |
| Web search (`packages/web`) | ALLOW | ALLOW | APPROVAL | DENY |
| External API | ALLOW | APPROVAL | DENY | DENY |
| External upload / attachment egress | ALLOW | DENY | DENY | DENY |

`wb-policy` decisions are one of five values (not a binary allow/deny — see
`WbDecision` in §7.2): `ALLOW`, `DENY`, `REQUIRE_APPROVAL`,
`ALLOW_WITH_REDACTION`, `ALLOW_METADATA_ONLY`.

---

## 6. Plugin catalog

Priority mirrors `Plugin_design_idea`: 🔴 essential for the SIH demo, 🟠 important
for a credible final product.

| # | Plugin | Priority | One-line purpose | Depends on (`inject`) |
|---|---|---|---|---|
| 0 | `wb-types` | 🔴 | Frozen shared TypeScript contract, zero runtime logic | *(none)* |
| 1 | `wb-identity` | 🔴 | User/role/department/clearance session context | `wb-types` |
| 2 | `wb-policy` | 🔴 | Central ALLOW/DENY/APPROVAL decision engine | `wb-identity`, `wb-types`, harness `tools` |
| 3 | `wb-audit` | 🔴 | Append-only provenance log of every decision + tool call | `wb-policy`, `wb-types`, harness `sessions` |
| 4 | `wb-model-gateway` | 🔴 | Capability-based routing across mounted `llm-*` adapters | `wb-types`, harness `llm` |
| 5 | `wb-rag` | 🔴 | Permission-aware retrieval; authorization *before* context reaches the model | `wb-identity`, `wb-policy`, `wb-types` |
| 6 | `wb-vision` | 🔴 | OCR + drawing/P&ID/photo understanding, registered as tools | `wb-model-gateway`, `wb-types`, harness `tools` |
| 7 | `wb-tool-gateway` | 🔴 | Tool manifest registry + policy hook on every tool call | `wb-policy`, `wb-types`, harness `tools` |
| 8 | `wb-ingestion` | 🟠 | Upload → validate → classify → parse/OCR → chunk → embed → index pipeline | `wb-vision`, `wb-policy`, `wb-types` |
| 9 | `wb-artifacts` | 🟠 | Generates approval notes / reports / xlsx / pptx with embedded provenance | `wb-audit`, `wb-types`, harness `tools` |
| 10 | `wb-ui` | 🔴 | Secure Workbench chat/workspace/security-indicator client | harness SDK (`dsh-sdk`), `wb-types` |
| 11 | `wb-admin-console` | 🟠 | Policy dashboard: users, blocked requests, live security events | `wb-audit`, `wb-policy` (read-only) |
| 12 | `wb-presets` | 🟠 | 5 agent personas as `cordis.yml`, composed from the above — no new code | *(config only, no `inject`)* |

`inject` names above are the **conceptual** dependency, expressed through the
frozen `ctx` keys in §7 — a plugin never imports another plugin's package.

---

### 6.0 `wb-types` — the frozen shared contract

**This package ships fully written in §7 of this document.** No agent "builds"
it in the creative sense — copy the code block verbatim into
`packages/wb-types/src/index.ts`. It has no `ctx`, no Cordis plugin export, and
no runtime behavior: it is TypeScript types, enums, and small pure helper
functions (branded-id constructors) that every other plugin lists as a
`dependency` in `package.json` (not `devDependency`, not `peerDependency` — this
is a real runtime import for the branded-id helpers).

### 6.1 `wb-identity` — Identity & RBAC

**Purpose.** Turn "who is logged in" into a structured object every other
plugin can reason about, and make that object an *input to policy*, not a
login-only concern.

**Provides:** `ctx.wbIdentity` (see `WbIdentityService` in §7.3).

**Behavior.**
- On session start, resolves the authenticated user (from the harness's own
  session/transport identity — do not build a new login system; consume
  whatever principal the deployment's SSO/reverse proxy already attaches) into
  a `WbUser` record (§7.3).
- `WbUser` is looked up from a pluggable `WbUserDirectoryProvider` — ship one
  file-backed provider (`$DSH_HOME/workbench/users.yaml`) as the default, so
  the demo works offline; document how a real deployment swaps it for an LDAP
  provider later (this is a Service Definition/Provider seam like the harness's
  own `packages/credentials`).
- Emits `wb/identity/resolved` (§7.4) once per session, before any tool call
  is dispatched. `wb-policy` requires this event to have fired before it will
  ALLOW anything for that session; if identity never resolves, every request
  fails loud with `DENY` (`reason: "IDENTITY_UNRESOLVED"`), not a silent bypass.

**Non-goals.** No password storage, no OAuth flow implementation — that is the
deployment's reverse proxy / SSO's job. This plugin only shapes and exposes the
principal it is handed.

### 6.2 `wb-policy` — Policy Gateway ⭐

**Purpose.** The single place every ALLOW/DENY decision is made. This is the
plugin the whole USP rests on — read `docs/cookbook/adding-a-tool.md`'s
"Execution policy and observation" section in this repo before starting.

**Provides:** `ctx.wbPolicy` (see `WbPolicyService` in §7.3), and it **mounts
a listener on the harness's own `tools/pre-execute` event** (documented in
`packages/core/tools/README.md` of this repo) so every tool call — from any
plugin, including harness-native ones like `dsh-tool-fs` or `dsh-tool-web` —
is evaluated, not just workbench tools.

**Behavior.**
- Exposes `ctx.wbPolicy.evaluate(request: WbPolicyRequest): Promise<WbPolicyDecision>`
  implementing the matrix in §5, overridable per-role via config.
- On `tools/pre-execute`, builds a `WbPolicyRequest` from the tool call's name,
  the classification of any file/document argument it can resolve (ask
  `wb-rag`/`wb-ingestion` metadata when the argument is a known document id),
  and the current `WbUser` from `ctx.wbIdentity`. A `DENY` or `REQUIRE_APPROVAL`
  result rejects the call before it runs; `REQUIRE_APPROVAL` surfaces through
  the harness's own interaction/approval capability (`packages/interaction`) —
  do not build a second approval UI.
- Every decision, ALLOW included, is published as `wb/policy/decision`
  (§7.4) for `wb-audit` to consume. Nothing about policy state is only visible
  in logs; it must be reconstructable from the event stream (mirrors the
  harness's own "model-visible ⟺ logged" rule, applied here to "governed ⟺
  logged").
- Config is data, not code: the classification-vs-capability matrix and the
  per-role overrides are `Config` fields (Schemastery-validated, see
  `AGENTS.md` §6), never hardcoded `if` statements, so MRPL admins can tune it
  without a rebuild.

**Non-goals.** Does not implement UI, does not decide *what* a tool does, only
*whether* it may run. Does not talk to the network itself.

### 6.3 `wb-audit` — Audit & Provenance

**Purpose.** Answer "why did this answer happen?" for any past request.

**Provides:** `ctx.wbAudit` (see §7.3). `record(entry: WbAuditEntry): void`.

**Behavior.**
- Subscribes to `wb/policy/decision`, the harness's own `tools/result` and
  `session/event` (append-only log, per `docs/architecture.md`), and
  `wb/rag/retrieved` (§7.4), and writes one `WbAuditEntry` per meaningful
  operation to an append-only local store (JSONL under
  `$DSH_HOME/workbench/audit/`, rotated daily — do not invent a database
  dependency for the demo).
- Never mutates or deletes a written entry. A correction is a new entry that
  references the old one's id.
- Exposes a read API (`ctx.wbAudit.query(filter)`) used only by
  `wb-admin-console`; does not expose a model-facing tool (an agent must not be
  able to edit its own audit trail).

**Non-goals.** Not a general logging framework — only the six event types
listed in §7.4 are recorded. Do not attach full document contents to an audit
entry; reference the document id and a short reason instead (keeps the audit
log itself out of `CONFIDENTIAL`/`RESTRICTED` territory where practical, and
keeps it small enough to actually review).

### 6.4 `wb-model-gateway` — Model Gateway

**Purpose.** Resolve *"I need `vision_reasoning`"* to *"use the
`llm-qwen-vl-local` adapter mounted as `id: llm-vision` in `cordis.yml`"* —
so no other plugin ever hardcodes a model name.

**Provides:** `ctx.wbModelGateway.resolve(capability: WbModelCapability): WbModelHandle`
(§7.3). `WbModelCapability` is one of `'reasoning' | 'vision_reasoning' |
'embedding' | 'rerank' | 'ocr'` — see §7.2.

**Behavior.**
- Reads a `Config` map from `capability` → the `id` of a mounted harness `llm-*`
  (or embedding/reranker) plugin, validated against what is actually present in
  the Cordis tree at boot (misconfiguration — a capability pointing at an
  unmounted `id` — fails loud at load, per the harness's own convention).
  This is the literal mechanism behind the PS requirement "automatically pick
  the right one for a given task... New open weight models should be addable
  later without redesigning the system": adding a model is one new `cordis.yml`
  row plus one `Config` mapping edit, never a code change.
- Every other workbench plugin that needs a model calls
  `ctx.wbModelGateway.resolve(...)` and gets back a handle it then uses through
  the harness's own `ctx.llm` Service Consumer role — `wb-model-gateway` never
  reimplements the LLM streaming contract, it only picks *which* adapter answers.

**Non-goals.** Does not itself call a model. Does not implement a new adapter —
adapters are ordinary harness `llm-*` plugins mounted in `cordis.yml`
(`docs/cookbook/adding-an-llm-adapter.md` in this repo is the reference if a new
open-weight model needs a new adapter written).

### 6.5 `wb-rag` — Enterprise RAG

**Purpose.** Retrieval that authorizes *before* an LLM ever sees the text —
per the Source of Truth's explicit rule: *"Authorization happens before context
reaches the LLM."*

**Provides:** `ctx.wbRag.retrieve(query: string, user: WbUser): Promise<WbRagResult>`
(§7.3).

**Behavior.**
1. Embeds the query via `wb-model-gateway.resolve('embedding')`.
2. Queries the local vector index (any embedded/local vector store is an
   implementation detail behind this plugin — do not expose the vector store
   as a `ctx` key; nothing outside `wb-rag` may depend on which one is used).
3. **Before** reranking or returning anything, filters candidate chunks by
   calling `ctx.wbPolicy.evaluate(...)` per chunk's classification against the
   requesting `WbUser`'s clearance — never the reverse order.
4. Reranks the authorized set via `wb-model-gateway.resolve('rerank')`.
5. Returns `WbRagResult` with `chunks` and `citations` (§7.2) — every chunk
   carries its source document id and page/section so `wb-artifacts` and
   `wb-ui` can render a citation.
6. Emits `wb/rag/retrieved` (§7.4) for audit, listing which chunks were
   authorized and which were filtered out (and why), so a denied retrieval is
   just as visible in the audit trail as an allowed one.

**Non-goals.** Does not parse or OCR documents (that's `wb-ingestion`), does
not decide policy itself (calls `wb-policy`), does not render UI.

### 6.6 `wb-vision` — Multimodal / Vision

**Purpose.** Give agents eyes: OCR, scanned-document layout, and
drawing/P&ID understanding, exposed as ordinary harness tools.

**Provides:** two model-facing tools, registered via `ctx.tools.register(defineTool(...))`
exactly as `docs/cookbook/adding-a-tool.md` describes:

- `wb_ocr_extract` — image/PDF page in, structured text + layout out.
- `wb_vision_analyze` — image + a natural-language question in (e.g. *"what
  equipment is connected to pump P-101?"*), structured findings + bounding-box
  evidence out.

Also provides `ctx.wbVision.describe(image, prompt)` (§7.3) as a plain service
method, for other plugins (`wb-ingestion`) that need vision without going
through the model-facing tool-call path.

**Behavior.**
- Both tools resolve their model through `wb-model-gateway.resolve('vision_reasoning')`
  or `resolve('ocr')` — never hardcode a vision model name.
- `output.schema` returns structured JSON (extracted fields, bounding boxes,
  confidence), never a plain string, so `wb-rag`/`wb-artifacts` can consume it
  programmatically (per the harness's own Code Mode guidance — "design
  `output.schema` as a useful programmatic API").
- Every tool call goes through the harness's own `tools/pre-execute` and is
  therefore automatically policy-checked by `wb-policy` (§6.2) — `wb-vision`
  does not add its own gate.

**Non-goals.** Does not persist results — that's `wb-ingestion`'s or the
caller agent's job.

### 6.7 `wb-tool-gateway` — Controlled Tool Execution

**Purpose.** Own the **tool manifest** — the metadata every tool declares about
itself — so `wb-policy` has something structured to evaluate instead of
guessing from a tool's name string.

**Provides:** `ctx.wbToolGateway.registerManifest(manifest: WbToolManifest)`
(§7.3) and `ctx.wbToolGateway.getManifest(toolName): WbToolManifest | undefined`.

**Behavior.**
- Every workbench tool-registering plugin (`wb-vision`, `wb-artifacts`, and any
  future one) calls `registerManifest` alongside `ctx.tools.register`, once,
  at `apply()` time. The manifest carries `tool_id`, `risk_level` (`'local' |
  'enterprise' | 'external'`), `required_permissions`, `data_classification`
  (max classification the tool is allowed to touch), and `network_access`
  (`'none' | 'internal' | 'external'`) — the exact fields from
  `Plugin_design_idea` §9.
- `wb-policy` reads this registry (via `ctx.wbToolGateway.getManifest`) inside
  its `tools/pre-execute` listener instead of hardcoding tool names — this is
  what makes the policy engine extensible without touching `wb-policy`'s code
  when a 13th tool is added later.
- For harness-native tools that will never call `registerManifest` themselves,
  `wb-tool-gateway` ships a small `Config`-driven static table mapping their
  well-known names to a manifest, so they are governed too
  (`Plugin_design_idea`'s capability matrix explicitly includes
  Files/Python/Web/DB for every agent).

  **Key the table on the tool's registered name, not its package name.**
  `dsh-tool-fs` / `tool-fs` is a *package*; the names that actually reach
  `tools/pre-execute` are `read`, `write`, `edit`, `read_image`. Getting this
  wrong does not fail open — `wb-policy` denies every unmanifested tool — it
  denies *everything*, which looks like a policy bug rather than a naming one.
  The names below are the ones the base bundle
  (`packages/bundle/base/cordis.patch.yml`) actually mounts, read from each
  package's `defineTool` call:

  | Package (base-bundle row id) | Registered tool names |
  |---|---|
  | `fs/tool-fs` | `read`, `write`, `edit`, `read_image` |
  | `fs/tool-fs-search` | `glob`, `grep` |
  | `fs/tool-str-replace-editor` | `str_replace_editor` |
  | `shell/tool-bash` | `bash` |
  | `shell/tool-bash-persistent` | `bash` |
  | `shell/tool-pwsh` | `pwsh` |
  | `web/tool-web` | `web_fetch`, `web_search` |
  | `todo/tool-todo` | `todo_write` |
  | `lsp/tool-lsp` | `lsp` |
  | `skill/tool-skill` | `skill` |
  | `jobs/tool-jobs` | `job_list`, `job_output`, `job_kill` |
  | `goal/tool-goal` | `create_goal`, `get_goal`, `update_goal` |
  | `subagent/tool-subagent*` | subagent delegation/control/report tools |
  | `workflow/tool-workflow`, `workflow/tool-ralph` | workflow tools |

  Note `bash` is registered by **two** packages (`tool-bash` and
  `tool-bash-persistent`), so the toolId→manifest table is not 1:1 with
  packages — one manifest governs both.

**Non-goals.** Does not itself make ALLOW/DENY decisions (that's `wb-policy`);
this plugin only answers "what kind of thing is this tool," it is a directory,
not an executor (see the harness's own `Directory` vs `Registry` naming
distinction in `docs/cookbook/adding-a-package.md` — this is a `Directory`).

### 6.8 `wb-ingestion` — Document Ingestion

**Purpose.** The pipeline in `Plugin_design_idea` §9: upload → validate →
classify → parse/OCR → chunk → embed → index, kept separate from `wb-rag`'s
retrieval concern per that same document's explicit instruction.

**Provides:** `ctx.wbIngestion.enqueue(file: WbIngestFile): Promise<WbDocumentId>`
(§7.3).

**Behavior.**
- Validates file type/size, assigns a `WbDocumentId` (branded id, §7.1).
- Classification is **assigned by the uploading user's declared value at
  minimum, and the workbench never auto-downgrades it** — auto-classification
  (e.g., detecting a P&ID and suggesting CONFIDENTIAL) is allowed to
  *raise* the suggested level for human confirmation, never lower it silently.
- Text documents parse directly; image/scanned content calls
  `ctx.wbVision.describe(...)` (from `wb-vision`) for OCR before chunking.
- Chunks + metadata (source id, page, classification, ACL) are hand off to the
  local vector index that `wb-rag` reads — `wb-ingestion` writes to that index,
  `wb-rag` only reads it; the index's storage format is decided by whichever
  plugin implements it first and documented in that plugin's own `README.md`
  (not part of this frozen contract, since nothing outside these two plugins
  touches it directly).
- Emits `wb/ingestion/completed` (§7.4) with the resulting `WbDocumentId` and
  its assigned classification, for `wb-audit`.

**Non-goals.** Does not implement embeddings itself — calls
`wb-model-gateway.resolve('embedding')`.

### 6.9 `wb-artifacts` — Artifact Generator

**Purpose.** Turn grounded findings into a real deliverable — approval note,
report, or an actual `.docx`/`.xlsx`/`.pptx` file — carrying provenance, per
`Plugin_design_idea` §13 and the PS's explicit requirement for real files, not
just chat replies.

**Provides:** model-facing tools `wb_generate_report`, `wb_generate_approval_note`,
`wb_generate_spreadsheet`, `wb_generate_presentation` — all registered the same
way as `wb-vision`'s tools, each with a `WbToolManifest` registered through
`wb-tool-gateway`.

**Behavior.**
- Input: a title, a list of `WbCitation`s (from a prior `wb-rag` retrieval —
  the tool's parameter schema *requires* at least one citation for
  report/approval-note generation; an agent cannot generate an "evidence-backed"
  artifact with zero evidence), and free-form findings text.
- Output: the generated file's path plus a `WbAuditEntry`-shaped provenance
  block embedded in the document itself (sources, tools used, policy decisions
  relevant to this generation) — mirrors the exact "Generated Report" example
  in `Plugin_design_idea` §13.
- File generation itself should reuse the harness's own filesystem write path
  (`dsh-tool-fs` / `ctx.fs`) rather than writing files directly, so writes stay
  inside the same observed/diffed pipeline as everything else the agent does.

**Non-goals.** Does not retrieve evidence itself (caller must have already
called `wb-rag`) and does not decide what the report says — it formats what the
model gives it plus the required citations.

### 6.10 `wb-ui` — Secure Workbench UI

**Purpose.** The screen in `Plugin_design_idea` §3 — chat, sources, agents,
activity, security, artifacts — built as a harness **client plugin**
(`packages/client/*` convention in this repo: extends
`tsconfig.base.client.json`, declares `dsh.client` in `package.json`, exports
`./client`).

**Provides:** no `ctx` service (a UI plugin is a leaf, nothing else depends on
it). Consumes the harness's own `dsh-sdk` (session/event stream) plus
`wb-audit`'s read API and `wb-policy`'s live decision stream
(`wb/policy/decision`) to drive the **security indicator** required by
`Plugin_design_idea` §3: a persistent 🟢 *Local / Sovereign* badge that flips to
🔴 *External request blocked by policy* the moment a `DENY` fires for the
active session.

**Non-goals.** Does not implement business logic — every action the UI offers
is a call into the harness SDK or a workbench tool; the UI never talks to
`wb-policy`/`wb-rag`/etc. directly except through those two read-only,
event-stream integrations named above.

### 6.11 `wb-admin-console` — Admin & Policy Console

**Purpose.** `Plugin_design_idea` §14's dashboard — users, active agents,
documents, policy decisions, blocked requests — plus the ability to edit the
per-role override table that `wb-policy` reads (§6.2).

**Provides:** no `ctx` service consumed by other plugins. Reads `ctx.wbAudit.query(...)`
and `ctx.wbPolicy`'s config surface; writes only to `wb-policy`'s `Config`
override store (never bypasses it with a second policy path).

**Non-goals.** Does not implement its own audit storage or its own policy
evaluation — read/write only, against the two plugins above.

### 6.12 `wb-presets` — Agent compositions

**Purpose.** Resolve the "12 plugins vs. don't make every agent a separate
infrastructure plugin" tension from `Plugin_design_idea` §15/§16 the way the
harness itself resolves it: a **preset** is a `cordis.yml` fragment plus a
persona string, using `packages/preset`'s existing "per-session agent
composition from preset `cordis.yml` files" mechanism in this repo. This is
config authorship, not service code.

**Deliverable:** five preset **directories** under `workbench/cordis/presets/`,
each holding an `agent.cordis.yml`. This is not a stylistic choice: harness
preset discovery (`packages/preset/agent-presets/src/discovery.ts`) defines
`COMPOSITION_FILE = 'agent.cordis.yml'` and treats the *directory name* as the
preset id. A flat `<name>.cordis.yml` file is ignored by `scanRoot()` and the
preset simply never appears in the roster.

Tool columns below name **registered tool names**, not package names — the
same distinction §6.7 draws (`read`/`write`/`edit` are tools; `tool-fs` is
their package).

| Preset directory | Composes (by frozen tool/ctx name, §7) | Capability row (§5-style matrix) |
|---|---|---|
| `document-analyst/agent.cordis.yml` | `wb-rag`, harness `read`/`glob`/`grep` (read-only), citation-required system prompt | Files ✓ RAG ✓ Vision ○ Python ✗ |
| `engineering-vision/agent.cordis.yml` | `wb-rag`, `wb_vision_analyze`, `wb_ocr_extract`, `read`/`glob`/`grep` | Files ✓ RAG ✓ Vision ✓ Python ✓ |
| `code-analysis/agent.cordis.yml` | harness `e2b`/`code-runtime`, `read`/`write`/`edit`, `wb-rag` (for spec lookup) | Files ✓ RAG ✓ Python ✓ Web ✗ |
| `research/agent.cordis.yml` | harness `web_search`/`web_fetch` (gated PUBLIC-only by `wb-policy`), `wb-rag` | RAG ✓ Web ✓* External API ✗ |
| `artifact/agent.cordis.yml` | `wb-rag`, `wb_generate_*` family | Files ✓ RAG ✓ Artifacts ✓ |

Note the `dsh-web-app` bundle (`packages/bundle/web-app/cordis.patch.yml`)
disables many harness tools at the host level on the assumption that each
session's preset re-enables what its persona needs — so a preset that wants
`read` or `web_search` must include an explicit row re-enabling it.

Each preset's persona prompt states, in plain language, which tools the agent
has and that every tool call is policy-governed — this is what makes the
policy engine's existence *visible in the product*, per `Plugin_design_idea`
§3's UI requirement, not just enforced silently in the backend.

**Non-goals.** Writes zero TypeScript. If a preset needs a capability that
doesn't exist yet, that is a missing plugin, not a reason to write ad hoc code
inside `wb-presets`.

---

## 7. Frozen contract — copy exactly

This is the part every one of the twelve agents must treat as read-only truth.

### 7.1 Branded ids

```ts
// workbench/packages/wb-types/src/index.ts (excerpt)
export type Branded<T, B extends string> = T & { readonly __brand: B }

export type WbUserId = Branded<string, 'WbUserId'>
export type WbDocumentId = Branded<string, 'WbDocumentId'>
export type WbSessionId = Branded<string, 'WbSessionId'>
export type WbAuditEntryId = Branded<string, 'WbAuditEntryId'>

export const asWbUserId = (v: string): WbUserId => v as WbUserId
export const asWbDocumentId = (v: string): WbDocumentId => v as WbDocumentId
export const asWbSessionId = (v: string): WbSessionId => v as WbSessionId
export const asWbAuditEntryId = (v: string): WbAuditEntryId => v as WbAuditEntryId
```

### 7.2 Shared enums and value types

```ts
export type WbClassification = 'PUBLIC' | 'INTERNAL' | 'CONFIDENTIAL' | 'RESTRICTED'

export type WbDecisionKind =
  | 'ALLOW'
  | 'DENY'
  | 'REQUIRE_APPROVAL'
  | 'ALLOW_WITH_REDACTION'
  | 'ALLOW_METADATA_ONLY'

export interface WbPolicyDecision {
  decision: WbDecisionKind
  reason: string
  /** Present only for ALLOW_WITH_REDACTION. */
  redactions?: string[]
}

export interface WbPolicyRequest {
  user: WbUserId
  agentPreset: string
  action: 'send_data' | 'read_data' | 'invoke_tool' | 'model_request'
  resource?: WbDocumentId | string
  classification: WbClassification
  destination: 'local' | 'internal' | 'internet' | 'external_api'
  tool?: string
}

export type WbModelCapability =
  | 'reasoning'
  | 'vision_reasoning'
  | 'embedding'
  | 'rerank'
  | 'ocr'

export interface WbModelHandle {
  /** The mounted cordis.yml `id` this capability resolved to. */
  adapterId: string
  capability: WbModelCapability
}

export interface WbUser {
  id: WbUserId
  displayName: string
  department: string
  role: string
  clearance: WbClassification
  allowedAgentPresets: string[]
  allowedToolCategories: Array<'local' | 'enterprise' | 'external'>
  networkPermissions: Array<'web_search' | 'external_api'>
}

export interface WbCitation {
  documentId: WbDocumentId
  title: string
  page?: number
  section?: string
}

export interface WbRagResult {
  chunks: Array<{ text: string; citation: WbCitation; classification: WbClassification }>
  citations: WbCitation[]
  /** Chunks that matched but were filtered by policy — for transparency in the UI/audit. */
  filtered: Array<{ citation: WbCitation; reason: string }>
}

export type WbToolRiskLevel = 'local' | 'enterprise' | 'external'
export type WbToolNetworkAccess = 'none' | 'internal' | 'external'

export interface WbToolManifest {
  toolId: string // must equal the tool's registered name, e.g. 'wb_vision_analyze'
  riskLevel: WbToolRiskLevel
  requiredPermissions: string[]
  dataClassificationCeiling: WbClassification
  networkAccess: WbToolNetworkAccess
}

export interface WbAuditEntry {
  id: WbAuditEntryId
  at: string // ISO 8601
  sessionId: WbSessionId
  userId: WbUserId
  kind: 'policy_decision' | 'tool_result' | 'session_event' | 'rag_retrieval' | 'ingestion_completed'
  summary: string
  payload: Record<string, unknown>
}
```

### 7.3 Service Definitions (the `ctx` keys)

Every plugin below is a **Service Definition** in the harness's capability-seam
sense (`docs/architecture.md` § Capability seams): the interface is fixed here;
*how* it's implemented is that plugin's own business.

```ts
// Provided by wb-identity
interface WbIdentityService {
  current(sessionId: WbSessionId): WbUser | undefined
}

// Provided by wb-policy
interface WbPolicyService {
  evaluate(request: WbPolicyRequest): Promise<WbPolicyDecision>
}

// Provided by wb-audit
interface WbAuditService {
  record(entry: Omit<WbAuditEntry, 'id' | 'at'>): void
  query(filter: Partial<Pick<WbAuditEntry, 'sessionId' | 'userId' | 'kind'>>): WbAuditEntry[]
}

// Provided by wb-model-gateway
interface WbModelGatewayService {
  resolve(capability: WbModelCapability): WbModelHandle
}

// Provided by wb-rag
interface WbRagService {
  retrieve(query: string, user: WbUser): Promise<WbRagResult>
}

// Provided by wb-vision
interface WbVisionService {
  describe(image: Buffer | string, prompt: string): Promise<Record<string, unknown>>
}

// Provided by wb-tool-gateway
interface WbToolGatewayService {
  registerManifest(manifest: WbToolManifest): void
  getManifest(toolId: string): WbToolManifest | undefined
}

// Provided by wb-ingestion
interface WbIngestionService {
  enqueue(file: { path: string; declaredClassification: WbClassification }): Promise<WbDocumentId>
}
```

Declaration merging registers each on Cordis `Context` exactly as the harness's
own services do (see any `packages/*/src/index.ts` for the pattern) — under
the matching key from this table:

| Service | `ctx` key |
|---|---|
| `WbIdentityService` | `ctx.wbIdentity` |
| `WbPolicyService` | `ctx.wbPolicy` |
| `WbAuditService` | `ctx.wbAudit` |
| `WbModelGatewayService` | `ctx.wbModelGateway` |
| `WbRagService` | `ctx.wbRag` |
| `WbVisionService` | `ctx.wbVision` |
| `WbToolGatewayService` | `ctx.wbToolGateway` |
| `WbIngestionService` | `ctx.wbIngestion` |

### 7.4 Events

| Event | Payload | Producer | Consumers |
|---|---|---|---|
| `wb/identity/resolved` | `{ sessionId: WbSessionId; user: WbUser }` | `wb-identity` | `wb-policy`, `wb-audit` |
| `wb/policy/decision` | `WbPolicyRequest & WbPolicyDecision` | `wb-policy` | `wb-audit`, `wb-ui` |
| `wb/rag/retrieved` | `{ sessionId: WbSessionId; result: WbRagResult }` | `wb-rag` | `wb-audit` |
| `wb/ingestion/completed` | `{ documentId: WbDocumentId; classification: WbClassification }` | `wb-ingestion` | `wb-audit` |

All follow the harness's own typed-event convention: declaration-merged into
the relevant event map, documented with `@mode` and `@param` JSDoc
(`AGENTS.md` §6 has the exact template).

### 7.5 Tool names (model-facing, frozen)

| Tool | Registered by | Manifest risk level |
|---|---|---|
| `wb_ocr_extract` | `wb-vision` | `local` |
| `wb_vision_analyze` | `wb-vision` | `local` |
| `wb_generate_report` | `wb-artifacts` | `local` |
| `wb_generate_approval_note` | `wb-artifacts` | `local` |
| `wb_generate_spreadsheet` | `wb-artifacts` | `local` |
| `wb_generate_presentation` | `wb-artifacts` | `local` |

No other plugin registers a tool starting with `wb_` without adding a row here
first (raise an Open Question, §12).

---

## 8. Composition: how it all boots

`workbench/cordis/workbench.cordis.yml` is a **bundle** in the harness sense
(`docs/architecture.md` § Profiles and bundles): it stacks every `wb-*` plugin
as new rows *after* `dsh-base`, following the exact `id`/`name`/`config` row
shape shown in this repo's own `examples/*/cordis.yml` files. A worked skeleton:

```yaml
# workbench/cordis/workbench.cordis.yml
# Stacks over dsh-base (packages/bundle/base). Load order matters: identity
# and policy must mount before anything that calls ctx.wbPolicy.

- id: wb-types-noop        # wb-types has no plugin export; nothing to mount

- id: wb-identity
  name: '@mrpl/dsh-workbench-identity'
  config:
    userDirectory: file
    userDirectoryPath: '$DSH_HOME/workbench/users.yaml'

- id: wb-policy
  name: '@mrpl/dsh-workbench-policy'
  config:
    matrix: '$DSH_HOME/workbench/policy-matrix.yaml'   # defaults to §5's table

- id: wb-audit
  name: '@mrpl/dsh-workbench-audit'
  config:
    root: '$DSH_HOME/workbench/audit'

- id: wb-model-gateway
  name: '@mrpl/dsh-workbench-model-gateway'
  config:
    routing:
      reasoning: llm-deepseek
      vision_reasoning: llm-vision-local
      embedding: embedding-local
      rerank: reranker-local
      ocr: llm-vision-local

- id: wb-tool-gateway
  name: '@mrpl/dsh-workbench-tool-gateway'

- id: wb-vision
  name: '@mrpl/dsh-workbench-vision'

- id: wb-ingestion
  name: '@mrpl/dsh-workbench-ingestion'

- id: wb-rag
  name: '@mrpl/dsh-workbench-rag'
  config:
    indexPath: '$DSH_HOME/workbench/vector-index'

- id: wb-artifacts
  name: '@mrpl/dsh-workbench-artifacts'
```

`wb-ui` and `wb-admin-console` mount as **client** plugins under the harness's
web profile (`dsh-web-app`), not in this backend bundle — see
`packages/client/AGENTS.md` in this repo for that split. `wb-presets` files are
not mounted here at all; they are selected per session (`dsh --profile web
--preset document-analyst`, mirroring `packages/preset`'s existing mechanism).

---

## 9. Non-negotiable invariants

These are the demo's actual "proof of the sovereign claim" (PS §Expected
Solution) and must hold regardless of which agent built which plugin:

1. **Every tool call crosses `wb-policy`.** Enforced structurally: `wb-policy`
   listens on the harness's shared `tools/pre-execute`, which every tool call
   passes through by construction, not by each tool remembering to check.
2. **RAG authorization happens before the LLM sees text**, never after
   (§6.5 step 3 before step 4).
3. **No workbench plugin makes a raw network call.** All network-capable work
   goes through the harness's existing `packages/web` capability, which
   `wb-policy` gates like any other tool.
4. **Nothing is ALLOWed silently.** Every `WbPolicyDecision`, including ALLOW,
   is published as `wb/policy/decision` and recorded by `wb-audit`.
5. **A missing/misconfigured routing entry in `wb-model-gateway` fails at
   boot**, never falls back to a silently wrong model.
6. **Classification is never silently downgraded** (`wb-ingestion`, §6.8).

The demo's network monitor / log proof (PS §Expected Solution) is simply: show
`wb-audit`'s log for a session and show that every `destination: 'external_api'
| 'internet'` entry is `DENY` unless the query was `PUBLIC` and explicitly
`ALLOW`ed — invariant 3 is what makes that log meaningful rather than
decorative.

---

## 10. What "done" looks like for the SIH demo

Per the PS's Expected Solution, the minimum integrated slice is:

- Model auto-selection shown across ≥2 task types → `wb-model-gateway` routing
  a reasoning-only chat vs. a `wb_vision_analyze` call to two different mounted
  adapters, visible in `wb-ui`/`wb-audit`.
- End-to-end agentic task: scanned inspection report → `wb-ingestion` →
  `wb-vision` OCR → `wb-rag` retrieval of related SOPs → `wb-artifacts`
  generates a `.docx` approval note with citations — the `engineering-vision`
  or `document-analyst` preset, unmodified, run start to finish.
- A coding task run and verified in the harness's own sandbox (no new plugin;
  `code-analysis` preset).
- A visible network monitor / audit view proving no external call fired
  (`wb-admin-console` reading `wb-audit`).

---

## 11. What we are NOT building (restated from the Source of Truth)

No custom LLM, no custom vector database, no custom agent framework, no 15
specialized agents, no fancy chatbot animations, no autonomous agents with
unrestricted tools, no cloud inference path for confidential data, no huge
model zoo, no microservices added purely for demo polish. If a plugin
implementation is reaching for any of these, stop and re-read §1.

---

## 12. Open questions (append here, do not silently resolve)

Use this section as the single place to flag anything §7 doesn't cover. Add a
dated bullet with your plugin name; do not invent a new shared name to work
around a gap.

- *(none yet — first agent to hit a gap, add it here)*

- **wb-audit (2026-08-26):** `wb/policy/decision` and `wb/ingestion/completed` event payloads lack `sessionId` and `userId` fields required by `WbAuditEntry`. Currently skipped during recording. Needs resolution before those event kinds can be audit-logged.

- **wb-rag (2026-08-27):** §7 `WbRagRequest` lacks `agentPreset` and `sessionId` fields; `WbRagResult` lacks `filtered` (excluded chunks with policy-reason). Current implementation uses sentinels (`agentPreset: 'unknown'`, `sessionId: asWbSessionId('unknown')`) and `WbFilteredChunk[]` — proposed addition to §7 types in next revision.

- **wb-identity (2026-08-28):** The harness has no authenticated identity concept. `ctx.identity` does not exist; `packages/identity/anonymous-user-id` is a random telemetry UUID only. `wb-identity` defines the `SessionPrincipalProvider` extension point so deployments can inject their own principal resolution logic, but there is no default implementation that extracts a principal from an authenticated context. This is a genuine gap: either the harness gains an `identity` capability, or a future plugin provides a bridge. For now, tests use inline `SessionPrincipalProvider` implementations; real deployments must supply their own.

- **wb-ingestion (2026-08-28):** §7 `WbPolicyRequest.action` has no variant for "ingest/upload document." The listed actions (`send_data`, `read_data`, `invoke_tool`, `model_request`) do not cleanly map to ingestion — `send_data` implies egress, not local document processing. `wb-ingestion` lists `wb-policy` as a dependency (§6 row 8) but cannot call `ctx.wbPolicy.evaluate()` without a valid action. Either add an `ingest_document` action to §7.2, or bless `send_data`/`local` as the intended mapping and document the semantic. `wb-ingestion` injects `wbPolicy` for forward-compatibility but does not call it until this is resolved.

- **wb-ingestion (2026-08-28):** §7 lacks a frozen `IndexChunk` type for the JSONL vector index format shared between `wb-ingestion` (writer) and `wb-rag` (reader). Both plugins must agree on the shape. Proposed addition to §7.2:

  ```ts
  export interface IndexChunk {
    text: string
    documentId: WbDocumentId
    title: string
    page?: number
    section?: string
    classification: WbClassification
    embedding: number[]
  }
  ```

  Currently defined in `wb-ingestion/src/types.ts` and documented in its README. Should be promoted to §7.2 so both plugins compile against the same frozen definition.

- **wb-presets (2026-08-28):** §3 and §6.12 specify the deliverable as five flat files (`document-analyst.cordis.yml`, etc.) under `workbench/cordis/presets/`. The actual harness preset discovery system (`packages/preset/agent-presets/src/discovery.ts`, `scanRoot()`) requires directories containing `agent.cordis.yml` — flat `.cordis.yml` files are explicitly ignored (tested at `discovery.spec.ts` lines 127–136). The flat files are delivered as specified; reconciliation requires either (a) renaming the deliverable to `<id>/agent.cordis.yml` directories, (b) adding a discovery shim that wraps flat files, or (c) confirming the flat-file spec is intentional and the harness convention does not apply here. Flagged without resolution pending integration review.

- **wb-presets (2026-08-28):** The `dsh-web-app` bundle (`packages/bundle/web-app/cordis.patch.yml` lines 314–429) disables 23 harness tools at the host level, including `tool-fs`, `tool-web`, `tool-bash`, `tool-todo`, and others. The rationale is that the Web surface is multi-session and each session mounts a preset that selectively re-enables the tools that persona needs. Any workbench preset that needs a disabled harness tool must include an explicit row re-enabling it. This is a shared gotcha for every plugin agent building preset-adjacent pieces — document in AGENTS.md or here so it is not rediscovered per-plugin.

- **wb-presets (2026-08-28):** No preset-validation command exists in the shared tooling. A flat `.cordis.yml` file cannot be validated against the composed tree without booting the harness. Proposed: a lightweight `verify-wb-presets` script that checks YAML syntax, row shape (`id`/`name` present), tool-name membership against §7.5, and persona policy-governed statement presence. Currently verification is structural assertions only, not a harness dry-run.

- **wb-model-gateway (2026-08-28):** §7 `WbModelCapability` values ('embedding', 'rerank', 'ocr') have no corresponding adapter-level capability signal in the harness `LlmAdapter`/`LlmModelInfo` type system. Adapter validation for these capabilities is existence-only (adapter is mounted), not capability-compatible. For 'reasoning' and 'vision_reasoning', partial validation is possible via `inputModalities` and `reasoning` fields on `LlmResolvedModelInfo`.

- **wb-tool-gateway (2026-08-28):** §6.7 named the harness-native tools as `dsh-tool-fs`/`dsh-tool-web`/`dsh-tool-bash`, which are *package* names. The names that reach `tools/pre-execute` are the tools' registered names (`read`, `write`, `edit`, `read_image`, `glob`, `grep`, `bash`, `web_search`, `web_fetch`, …). §6.7 now carries the verified table. Two follow-ons a human integrator should rule on: (a) `subagent` and `workflow` tools take their registered names from config at registration time, so no static table can name them and they are unmanifested — and therefore denied — by default; should the demo profile pre-supply manifests for them through `Config.staticManifests`? (b) `WbToolGatewayService` has no `listManifests()`, which `wb-admin-console` will likely need to render a governed-tool inventory; adding it is a §7.3 change.

- **wb-vision (2026-08-28):** §7.2 `WbModelHandle` carries `adapterId` and `capability` but no model id, while the harness's `ctx.llm.stream` requires both `provider` and `model`. `wb-vision` currently resolves the model itself (own `Config.models`, falling back to the adapter's first `listModels()` entry). Every plugin that calls a model will otherwise reinvent this rule. Proposed §7.2 addition: `WbModelHandle.model: string`, resolved once inside `wb-model-gateway` where the routing config already lives.

- **wb-vision (2026-08-28):** §7.3 `WbVisionService.describe(image: Buffer | string, prompt)` carries no media type alongside the `Buffer` variant, but the attachment service requires a declared `ImageMediaType` and raw bytes are not self-describing without a sniffing dependency. The implementation assumes PNG for the `Buffer` form and infers from the extension for the path form. Proposed: `describe(image, prompt, mediaType?)`, or narrow the signature to a path.

- **RESOLVED (2026-08-28) — §7.2 `WbPolicyRequest.sessionId` added.** The request now carries the session it belongs to. This closes two separate reports at once: `wb-policy` was calling `WbIdentityService.current()` — which is session-keyed — with the request's *user* id behind a cast, so every caller passing a real `WbUserId` (`wb-rag` does) missed the lookup and was denied, silently emptying every retrieval; and because `WbPolicyDecisionEvent = WbPolicyRequest & WbPolicyDecision`, the event now carries `sessionId` alongside the `user` it already had, which is exactly what `wb-audit` was waiting on to record policy decisions at all. Both are implemented.

- **RESOLVED (2026-08-28) — §7.3 `WbRagService.retrieve` takes `sessionId`.** Implements the addition `wb-rag` proposed on 2026-08-27. Per-chunk authorization goes through `wbPolicy.evaluate`, which authenticates the principal from the session; a user id alone cannot be authenticated, so `retrieve(query, user)` could not produce a valid request. `agentPreset` now comes from the principal rather than the `'unknown'` sentinel, so per-role overrides can actually fire.

- **wb-policy (2026-08-28):** `ALLOW_WITH_REDACTION` and `ALLOW_METADATA_ONLY` are now DENIED at the `tools/pre-execute` gate rather than passed through as a full allow. A pre-execution gate has no result to redact, and passing the call through unmodified made a stricter matrix setting behave as the loosest one. Direct `evaluate()` callers able to enforce the restriction (`wb-rag` filters on it today) are unaffected. Open question for the integrator: enforcing redaction on tool *output* would need a `tools/post-execute` consumer, which is a plugin nobody owns yet — until then these two decision kinds are only meaningful on the data path, not the tool path.

- **wb-policy (2026-08-28):** with no resolvable document argument, the gate now evaluates a call at the tool manifest's `dataClassificationCeiling` rather than the constant `'PUBLIC'` it used before (`PUBLIC` is the *least* restrictive band in §5, so the matrix's classification axis was pinned to its loosest row on every decision). The ceiling is a conservative proxy, not the real thing: §6.2 asks the gate to resolve the classification of a document argument by asking `wb-rag`/`wb-ingestion` metadata, and no lookup for that exists in §7.3. Proposed: a `WbIngestionService.classificationOf(documentId)` read, or an equivalent on `wb-rag`.
