# Integration log — Sovereign AI Workbench

Verification of the composed system against `DESIGN.md`. Every finding below
came from a real run, not a code read.

---

## Closing report

### `DESIGN.md` §9 invariants

| # | Invariant | Status | Test |
|---|---|---|---|
| 1 | Every tool call reachable by the central policy check | **PASS** | [`tests/invariants/every-call-crosses-policy.spec.ts`](tests/invariants/every-call-crosses-policy.spec.ts) |
| 2 | Retrieval authorizes before content reaches a model | **PASS (scoped)** | [`tests/invariants/rag-authorizes-before-rerank.spec.ts`](tests/invariants/rag-authorizes-before-rerank.spec.ts) |
| 3 | No plugin makes a raw network call | **PASS** | [`tests/invariants/no-raw-network-calls.spec.ts`](tests/invariants/no-raw-network-calls.spec.ts) |
| 4 | Nothing approved/allowed silently | **PASS** | [`tests/invariants/nothing-allowed-silently.spec.ts`](tests/invariants/nothing-allowed-silently.spec.ts) |
| 5 | Misconfiguration fails loud at load | **PASS** | [`tests/invariants/misconfig-fails-loud.spec.ts`](tests/invariants/misconfig-fails-loud.spec.ts) |
| 6 | Classification never silently downgraded | **PASS** | [`tests/invariants/classification-never-downgraded.spec.ts`](tests/invariants/classification-never-downgraded.spec.ts) |

Invariant 2 is marked **scoped**: the ordering guarantee is asserted as "every
candidate crossed policy, and the returned set is exactly the authorized set",
not as a call-order assertion around a reranker. `wb-rag`'s reranker is still a
stub that makes no model call, so there is no reranker invocation to order
against. This is honest coverage of what exists, not a pass by redefinition —
see finding 6.

### `DESIGN.md` §10 demo scenarios

| Scenario | Status | Test |
|---|---|---|
| Model auto-selection | **PASS** | [`tests/e2e/model-auto-selection.spec.ts`](tests/e2e/model-auto-selection.spec.ts) |
| Inspection report → approval note | **PASS (service chain, not preset-driven)** | [`tests/e2e/inspection-report-to-approval-note.spec.ts`](tests/e2e/inspection-report-to-approval-note.spec.ts) |
| Coding task in sandbox | **NOT RUN** | — |
| Network-monitor proof | **PASS** | [`tests/e2e/network-monitor-proof.spec.ts`](tests/e2e/network-monitor-proof.spec.ts) |

### Findings by classification

| Class | Count | Findings |
|---|---|---|
| (a) contract violation | 1 | 3 |
| (b) contract gap, resolved inconsistently | 2 | 1, 5 |
| (c) ordinary bug | 2 | 2, 4 |
| (d) harness API mismatch | 1 | 1 |
| (e) missing write-path | 0 | — |

Finding 1 is counted under both (b) and (d): the gap is contractual, its
trigger was a wrong assumption about Cordis `inject` semantics.

The ratio is worth reading before the next round of plugins is built this way.
Two of the three most serious findings (2, 3) are **clearance logic that every
plugin's own suite passed**, because each side tested against a fake that
encoded its own reading. That is not sloppiness in any one agent — it is the
predictable outcome of a process where no test ever mounts two real plugins
together. The standing recommendation is that `AGENTS.md` require a
seam test for every capability edge, not only per-package tests.

### Go / no-go for the SIH demo

**GO, with one caveat.**

All six invariants hold against the real composed system, and 265 tests pass
(223 package-level, 42 integration). The caveat is not a red test: it is that
**retrieval is lexical, not semantic** — `wb-rag`'s embedding is a hash of the
query string and its reranker is a pass-through (finding 6). Retrieval is
self-consistent because `wb-ingestion` embeds identically, so the demo will
retrieve and cite correctly on curated fixtures. It will not behave like
semantic search on an unrehearsed query. Decide deliberately whether the demo
script stays on fixtures.

Smallest remaining red item blocking a *full* §10 pass: no preset-driven agent
turn has ever been executed (finding 7).

---

## [2026-08-28] Finding 1 — an incomplete governance stack booted silently

**Stage found:** 2
**Classification:** (b) contract gap / (d) harness API mismatch
**Symptom:** Composing the bundle without `wb-identity` produced a context that
booted cleanly, registered `wb-vision`'s two tools, and had **no**
`tools/pre-execute` listener at all. No error anywhere.
**Root cause:** `wb-policy` declared `inject = ['wbIdentity', 'wbToolGateway']`.
Cordis `inject` is required-only — `Inject.resolve` in `vendor/cordis/src/registry.ts`
has no optional concept — so a missing service leaves the plugin unapplied and
waiting, not failing. An unapplied `wb-policy` gates nothing, which is exactly
the silent partial mount §9 invariant 1 forbids.
**Resolution:** `wb-policy` now declares `inject = []` and resolves both
services through `ctx.get()` at decision time. The gate always mounts; a
missing identity service denies (`IDENTITY_UNRESOLVED`) and a missing manifest
directory denies (`NO_TOOL_GATEWAY`). Fixed in `packages/wb-policy`.
**Contract changes:** none.
**Regression coverage added:** `tests/boot.spec.ts` — "wb-policy still mounts
and still gates when wb-identity is absent". Nothing at package level could have
caught this: `wb-policy`'s own suite always provided both services, so its
`inject` list was never exercised against a context missing one.
**Re-verified:** `tests/boot.spec.ts`, `packages/wb-policy` (58), all
`tests/contract` and `tests/invariants`.

---

## [2026-08-28] Finding 2 — the clearance comparison was inverted

**Stage found:** 3
**Classification:** (c) ordinary bug
**Symptom:** `tests/contract/policy-into-rag.spec.ts` asserted a PUBLIC-clearance
user is filtered from a RESTRICTED chunk. The real engine **allowed** it.
**Root cause:** `clearanceMeetsCeiling` returned `userLevel <= ceilingLevel`.
With `PUBLIC` at index 0 and `RESTRICTED` at index 3, `0 <= 3` passes — so
every under-cleared principal passed. The denial message the function guards
reads *"user clearance PUBLIC below tool ceiling RESTRICTED"*, which describes
exactly the case the code let through: the message and the comparison
contradicted each other.
**Resolution:** the comparison is now `clearanceRank(user) >= clearanceRank(band)`,
with the ordering stated once in a named `CLEARANCE_ORDER`. Fixed in
`packages/wb-policy`.
**Contract changes:** none — §5 and §7 already implied this ordering.
**Regression coverage added:** `packages/wb-policy/tests/policy.spec.ts`,
"clearance is checked against the data, for every action", including a
one-band-short case so a re-inversion cannot pass. Added to the package's own
suite, not only the workbench-level one.
**Re-verified:** `packages/wb-policy` (58), `tests/contract/policy-into-rag.spec.ts`,
all `tests/invariants`.

---

## [2026-08-28] Finding 3 — clearance was never checked for non-tool actions

**Stage found:** 3
**Classification:** (a) contract violation
**Symptom:** Found while fixing finding 2 — even with the comparison corrected,
a PUBLIC user still read RESTRICTED chunks.
**Root cause:** the only clearance check lived inside `evaluate()`'s
`action === 'invoke_tool'` branch, and compared the user against a **tool's**
manifest ceiling. Every other action — `read_data`, `send_data`,
`model_request` — skipped clearance entirely. `read_data` is how `wb-rag`
authorizes every chunk, so per-chunk authorization consulted the §5 matrix
without ever comparing the principal to the data.
**Resolution:** `evaluate()` now compares `user.clearance` to
`request.classification` for **every** action, before the capability matrix is
resolved. Fixed in `packages/wb-policy`.
**Contract changes:** none. §7.2 already gives `WbUser.clearance` and
`WbPolicyRequest.classification`; nothing said they were only sometimes
compared.
**Regression coverage added:** the same package-level describe block as finding
2, plus `tests/contract/policy-into-rag.spec.ts` at the seam.
**Re-verified:** `packages/wb-policy` (58), every `tests/contract` and
`tests/invariants` file.

---

## [2026-08-28] Finding 4 — matrix suite tested with an under-cleared principal

**Stage found:** 3 (surfaced by the finding-2/3 fixes)
**Classification:** (c) ordinary bug, in a test
**Symptom:** After finding 3, eight `wb-policy` matrix rows failed.
**Root cause:** the suite's `createMockUser()` had `clearance: 'INTERNAL'` while
the table iterates `CONFIDENTIAL` and `RESTRICTED` rows. With clearance
enforced, those rows short-circuit before the matrix is consulted — so the
suite had never actually been testing the matrix for its two most sensitive
bands.
**Resolution:** the fixture principal is fully cleared, with a comment saying
why, so the matrix suite tests the matrix and clearance is covered separately.
**Contract changes:** none.
**Regression coverage added:** the separate clearance describe block means the
two concerns can no longer mask each other.
**Re-verified:** `packages/wb-policy` (58).

---

## [2026-08-28] Finding 5 — `indexPath` reads like a directory

**Stage found:** 3
**Classification:** (b) contract gap, minor
**Symptom:** My first integration harness passed a directory and got `EISDIR`
out of `wb-rag`.
**Root cause:** **not** a plugin disagreement — `wb-ingestion` (`appendFileSync`)
and `wb-rag` (`readFileSync`) both correctly treat `indexPath` as a file. The
default value is `$DSH_HOME/workbench/vector-index`, which has no extension and
reads like a directory. The mistake was mine, and it is worth recording because
the next integrator will make it too.
**Resolution:** test harness corrected. No plugin change.
**Contract changes:** none. Recommendation only: default the value to
`vector-index.jsonl`, since §6.8 leaves the format to the implementing plugins
and the name is the only signal a reader gets.
**Regression coverage added:** none needed — both plugins were already correct.
**Re-verified:** `tests/contract/policy-into-rag.spec.ts`,
`tests/contract/audit-consumes-events.spec.ts`.

---

## [2026-08-28] Finding 6 — retrieval is lexical, and the reranker is a stub

**Stage found:** 4
**Classification:** (b) contract gap — declared, not hidden
**Symptom:** Invariant 2's ordering assertion had nothing to observe: no
reranker call is ever made.
**Root cause:** `wb-rag` calls `resolve('embedding')` and `resolve('rerank')`
and discards both handles; the query is embedded by `deterministicEmbed`, a
hash, and `rerankChunks` returns its input. `wb-ingestion` embeds chunks the
same way. Both READMEs declare this.
**Resolution:** none applied — this is declared prototype scope, not drift, and
replacing it needs a real embedding adapter this environment has no model
server for. Recorded here so the go/no-go above states it rather than a demo
discovering it.
**Contract changes:** none.
**Regression coverage added:** the invariant-2 test asserts what is verifiable
(every candidate crossed policy; returned set equals authorized set) and its
comment states plainly why it cannot assert call order.
**Re-verified:** `tests/invariants/rag-authorizes-before-rerank.spec.ts`.

---

## [2026-08-28] Finding 7 — no preset-driven agent turn has been executed

**Stage found:** 5
**Classification:** (b) contract gap in verification coverage
**Symptom:** §10's scenarios are specified as preset runs "start to finish".
Every test here drives plugin services directly instead.
**Root cause:** a preset-driven turn needs the harness agent loop against a live
model (`DEEPSEEK_API_KEY`) and, for the coding scenario, a working
`e2b`/`code-runtime` sandbox. Neither is available in this environment.
**Resolution:** not resolved. `inspection-report-to-approval-note.spec.ts`
covers the real plugin chain and says in its own module docs that it is not
preset-driven. `coding-task-sandbox.spec.ts` was not written rather than
written as something weaker wearing the scenario's name.
**Contract changes:** none.
**Regression coverage added:** none — this is the gap, not a fix.
**Re-verified:** n/a. **This is the one item blocking a full §10 pass.**

---

## Contract-usage audit

Run before any test, per the brief.

**No frozen name is redefined outside `wb-types`.** All 38 exported names in
§7 were grepped across every package; each has exactly one definition.

**Every §7.3 `ctx` key has exactly one provider:**

| Key | Provider |
|---|---|
| `wbIdentity` | `wb-identity` |
| `wbPolicy` | `wb-policy` |
| `wbAudit` | `wb-audit` |
| `wbModelGateway` | `wb-model-gateway` |
| `wbRag` | `wb-rag` |
| `wbVision` | `wb-vision` |
| `wbToolGateway` | `wb-tool-gateway` |
| `wbIngestion` | `wb-ingestion` |

**All six §7.5 tool names** are registered by the plugin §7.5 assigns them to,
and each carries a manifest whose `toolId` matches its registered name
(verified live in `tests/contract/tool-gateway-into-vision.spec.ts`).

**All four §7.4 events** have exactly one real emitter and reach `wb-audit`
from it (verified live in `tests/contract/audit-consumes-events.spec.ts`).

### Deviations still open

| Plugin | Declared deviation | Still consistent with siblings? |
|---|---|---|
| `wb-rag` | embedding/rerank are stubs | Yes — `wb-ingestion` embeds identically. Finding 6. |
| `wb-ingestion` | does not call `wbPolicy`; no `action` variant for ingest | Yes, unchanged. Uploads remain ungoverned. |
| `wb-ingestion` | auto-classification not implemented | Yes — downgrade prevention still holds (invariant 6 passes). |
| `wb-model-gateway` | `ocr`/`embedding`/`rerank` validation is existence-only | Yes — `wb-vision` is written not to assume otherwise. |
| `wb-identity` | no default principal provider | Yes — the harness must supply one; the integration harness does. |
| `wb-artifacts` | writes via `node:fs`, not `ctx.fs` | Yes, unchanged. Artifacts stay outside the observed write path. |
| `wb-ui` | everything but the security badge is fixture data | Yes, unchanged. |
| `wb-admin-console` | polls audit; no pagination | Yes, unchanged. |

## Stand-ins used, and why

Two, both at boundaries a CI box cannot supply, declared here per the brief:

- **`ctx.llm`** — stub adapters that exist, list a model, and return a canned
  reply. No model server is available. Every plugin still resolves its adapter
  through the real `wb-model-gateway`.
- **`ctx.attachments.saveImage`** — returns a reference without real image
  decoding. The real store needs byte-level image validation this environment's
  fixtures do not provide.

Everything else — identity, policy, tool gateway, audit, rag, vision,
ingestion, and the harness's real `ToolRuntime` — is the real implementation.
