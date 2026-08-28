# Integration verification — Sovereign AI Workbench

You are not building a new plugin. All twelve units in `workbench/packages/`
and `workbench/cordis/presets/` have already been built, each by a separate
agent working alone from `workbench/DESIGN.md` + `workbench/AGENTS.md` +
their own plugin-specific prompt, each testing only against **faked**
versions of its sibling dependencies. Nobody has yet proven the real pieces
fit together. That is your job.

You have a wider mandate than any single plugin-builder agent had: you may
read and touch every package, and — unlike them — you are allowed to resolve
an open contract question by amending `DESIGN.md` §7 / `wb-types` directly,
because you're the first agent with the full picture. Every such change must
still be logged (§7 below), never made silently.

**Your deliverable is a working, composed system plus a written trail of
every gap you found and how you resolved it — not just a pass/fail report.**

---

## 0. Required reading before you touch anything

1. `workbench/DESIGN.md` in full — you need the whole contract in your head,
   not just one plugin's card. Pay special attention to §5 (the matrix), §7
   (frozen contract), §9 (non-negotiable invariants — this is your primary
   test spec), §10 (what "done" looks like — your scenario tests), and §12
   (Open Questions — **read this first of all**, since every plugin agent
   was told to log gaps here instead of guessing; this section is your map
   of where integration is most likely to break).
2. `workbench/AGENTS.md` in full — the conventions every plugin was told to
   follow; you're checking compliance against this, not inventing new rules.
3. `workbench/packages/wb-types/src/index.ts` — the frozen contract as it
   currently stands.
4. Every plugin's `README.md`, specifically each one's **"Deviations"**
   section. Build yourself a table: plugin → every deviation it declared →
   whether that deviation is still consistent with what its actual siblings
   now expect. This table is the single most useful artifact you can produce
   before writing a single test.
5. `docs/testing.md` (repo root) — the harness's own testing tiers. You are
   primarily operating at the "Unit" and "Test the real entry path" tiers
   from that document, applied across package boundaries instead of within
   one package. Also re-read "Verify the world, not the self-report" — it
   applies doubly here, since a passing test that only checks your own
   plugin's fake was called correctly proves nothing about the real
   sibling's actual behavior.
6. `workbench/cordis/workbench.cordis.yml` and every file under
   `workbench/cordis/presets/`.

Before writing any test, produce two artifacts and keep them updated as you
go (put both in a new `workbench/INTEGRATION_LOG.md`, described fully in
§7):

- **The Deviations/Open-Questions table** from reading item 4 above.
- **A contract-usage audit**: for every frozen name in `DESIGN.md` §7 (every
  branded id, enum, interface, `ctx` key, event name, tool name), grep every
  package under `workbench/packages/` for it and confirm (a) no package
  locally redefines it instead of importing from `wb-types`, and (b) every
  package that's supposed to provide or consume it per the §6 dependency
  table actually does. Log any mismatch you find here immediately, before
  you've even run a test — a redefinition or missing usage is a
  near-certain integration bug and worth flagging early.

---

## 1. Testing methodology overview

Work through five stages, in order. Do not skip ahead to Stage 3 or 4 hoping
things work — each stage exists because it catches a class of bug the next
stage's tests would otherwise misattribute.

| Stage | What it proves | What a failure here tells you |
|---|---|---|
| 1. Baseline | Every package still passes its own tests in isolation | A regression happened after the plugin was "done" — fix before going further |
| 2. Boot | The composed bundle mounts without error | A structural/config problem, not yet a behavioral one |
| 3. Contract conformance | Every real cross-plugin dependency edge behaves the way the *consumer's* fake assumed | Exactly one plugin (or the contract itself) is wrong — this is where most real bugs surface |
| 4. System invariants | The six non-negotiable rules in `DESIGN.md` §9 hold across the real composed system | A cross-cutting design problem, possibly needing a `DESIGN.md` §7 amendment |
| 5. End-to-end scenarios | The actual SIH demo scenarios in `DESIGN.md` §10 work start to finish | Everything upstream was individually correct but doesn't add up to the product |

Put every new test you write under `workbench/tests/`, organized as:

```
workbench/tests/
├── contract/        # Stage 3 — one file per dependency edge
├── invariants/       # Stage 4 — one file per DESIGN.md §9 invariant
└── e2e/               # Stage 5 — one file per DESIGN.md §10 scenario
```

These are new, real, `vitest` suites at the workbench level (not inside any
one package), following this repo's own conventions from `docs/testing.md`
("Unit" tier: `tests/**` directories, HMR-safety where a registry is
involved; "prefer the real implementation over a mock" — at this level, that
means real sibling plugins, not real external LLM APIs; mock the model/OCR
call itself the same way the individual plugins did, per their own
Deviations notes on what they stubbed, but nothing else).

---

## 2. Stage 1 — Baseline: every package still passes alone

Before testing composition, confirm nothing has silently rotted.

```sh
# from the workbench workspace root
pnpm install
for pkg in workbench/packages/*/; do
  echo "=== $pkg ==="
  (cd "$pkg" && pnpm run typecheck && pnpm run lint && pnpm run test && pnpm run build)
done
```

Any failure here is Stage 1's finding: **fix it inside that package only**,
add a regression test if one was missing, and re-run before moving on. Do
not proceed to Stage 2 with a red baseline — a composition failure on top of
an already-broken package tells you nothing useful.

---

## 3. Stage 2 — Boot: the composed bundle mounts

Mount `workbench/cordis/workbench.cordis.yml` for real, with every `wb-*`
package's actual export — no fakes anywhere in this stage.

Required assertions:

- The bundle boots with a well-formed config (use the example `routing`
  table already in `workbench.cordis.yml`, backed by minimal *stub* `llm-*`
  adapters that only need to exist and declare the right capability — this
  is the one place a stand-in is appropriate, since a real model server
  isn't available in CI; note this stub in your log).
- Every `inject` dependency declared by a plugin (`wb-policy` injecting
  identity/tools, `wb-rag` injecting policy/model-gateway, etc. — cross-check
  against the dependency table in `DESIGN.md` §6) actually resolves against
  a really-mounted sibling, not a missing one.
- Deliberately break the config in each of these ways, one at a time, and
  confirm the bundle **fails to boot with a clear error**, not a silent
  partial mount:
  - A `wb-model-gateway` `routing` entry pointing at an unmounted adapter
    `id` (this is `DESIGN.md` §9 invariant 5 — test it here at the
    composition level, not just inside `wb-model-gateway`'s own package).
  - A required sibling package simply absent from the bundle (comment out
    `wb-identity`'s row and confirm `wb-policy` fails to boot rather than
    silently operating with no identity).
  - A malformed `wb-policy` matrix config file.
- Restore the good config after each negative case and confirm a clean boot
  again before moving to the next negative case (isolate failures).

If a plugin's own package-level tests never exercised its `inject` list
against a *real* Context with real siblings, that's exactly the gap this
stage exists to catch — log it, then decide per §6 below whether the fix
belongs in that plugin (missing `inject` declaration) or here (a genuinely
new boot-order test worth keeping permanently under `workbench/tests/`).

---

## 4. Stage 3 — Contract conformance: real siblings instead of fakes

For every dependency edge in `DESIGN.md` §6's table, re-run (a real version
of) the consuming plugin's own "faked dependency" tests, but with the real
sibling mounted instead of the fake. One file per edge under
`workbench/tests/contract/`:

| File | Real edge under test |
|---|---|
| `identity-into-policy.spec.ts` | `wb-policy` calling real `ctx.wbIdentity.current(...)` |
| `identity-into-policy-boundary.spec.ts` | `wb-policy`'s `tools/pre-execute` listener against a real tool call, real `wb-identity` session resolution |
| `model-gateway-into-vision.spec.ts` | `wb-vision`'s two tools and `describe()` resolving through real `ctx.wbModelGateway` |
| `tool-gateway-into-policy.spec.ts` | `wb-policy` consulting real `ctx.wbToolGateway.getManifest(...)` instead of its own fake |
| `tool-gateway-into-vision-and-artifacts.spec.ts` | `wb-vision` and `wb-artifacts` calling real `ctx.wbToolGateway.registerManifest(...)`, and the manifests actually landing where `wb-policy` will look for them |
| `policy-into-rag.spec.ts` | `wb-rag`'s per-chunk authorization calling real `ctx.wbPolicy.evaluate(...)` — **re-run the ordering assertion from `wb-rag`'s own prompt (policy-check-before-rerank), now with the real policy engine's actual latency/behavior, not an instant fake** |
| `model-gateway-into-rag.spec.ts` | `wb-rag`'s embedding/rerank calls against real `ctx.wbModelGateway` |
| `vision-into-ingestion.spec.ts` | `wb-ingestion` calling real `ctx.wbVision.describe(...)` for an image fixture |
| `policy-into-ingestion.spec.ts` | Whatever `wb-ingestion` actually decided to do with `ctx.wbPolicy` (check its README — it may have declared it doesn't call policy at all; if so, this file documents and confirms that decision rather than asserting a call that was never promised) |
| `audit-consumes-events.spec.ts` | `wb-audit` actually receiving `wb/policy/decision`, `wb/rag/retrieved`, `wb/ingestion/completed` from the *real* emitting plugins, not synthetic fixture events |
| `tool-gateway-into-artifacts.spec.ts` | `wb-artifacts`'s four tools registering manifests with the real `wb-tool-gateway` |
| `audit-into-ui.spec.ts` | `wb-ui`'s security indicator and `wb-admin-console`'s dashboard against real `ctx.wbAudit.query(...)` and the real `wb/policy/decision` stream |
| `policy-writeback-console.spec.ts` | Whatever `wb-admin-console` actually implemented for writing policy overrides — this is the edge most likely to have a real gap (see `wb-admin-console`'s own prompt, which flagged this). Test against the real `wb-policy`; if the write path `wb-admin-console` assumed doesn't exist on the real `wb-policy`, this is your first concrete Stage 3 failure to triage (§6) |

For each file: **the question is not "does it run," it's "does the real
sibling's behavior match what the consuming plugin's own tests assumed."**
A green Stage 1 baseline on both sides plus a red Stage 3 test means the two
plugins individually satisfy the contract in different, incompatible ways —
that is the exact failure mode this whole prompt exists to catch.

---

## 5. Stage 4 — System invariants (`DESIGN.md` §9)

One file per invariant under `workbench/tests/invariants/`, run against the
fully composed real bundle from Stage 2.

1. **`every-call-crosses-policy.spec.ts`** — register a probe: a harness
   tool call through *any* mounted tool (including a plain harness-native
   one like `dsh-tool-fs`), then assert `wb-audit` recorded a matching
   `policy_decision` entry for that exact call. Do this for at least one
   workbench tool and one harness-native tool, to prove the gate isn't
   accidentally scoped to only `wb_*`-prefixed tools.
2. **`rag-authorizes-before-rerank.spec.ts`** — seed the real vector index
   (via real `wb-ingestion`) with chunks at mixed classifications, retrieve
   as a low-clearance `WbUser`, and assert: (a) no denied chunk's text ever
   reached the reranker call (instrument via a thin real-adapter wrapper
   that just logs what it was asked to rerank, not a fake — you're
   confirming the real `wb-rag` pipeline's actual call order, not a
   contract mock's), and (b) the denied chunks appear in `WbRagResult.filtered`
   with a reason.
3. **`no-raw-network-calls.spec.ts`** — this is the PS's actual "proof of
   the sovereign claim" (`DESIGN.md` §Expected Solution / §10). Run a
   representative battery of actions across all five presets with network
   egress instrumented/blocked at the process boundary (check whether this
   repo already has a network-isolation test harness — search for
   `network` or `egress` in `docs/testing.md` and `packages/` before
   building your own; reuse it if it exists). Assert zero outbound calls
   for any `CONFIDENTIAL`/`RESTRICTED`-classified action, and exactly the
   expected `PUBLIC`-only web call for the one Research-preset case that
   should be allowed per §5. A failure here is the single highest-severity
   finding this prompt can produce — treat it as a stop-ship issue (§6).
4. **`nothing-allowed-silently.spec.ts`** — run one action per row of the §5
   matrix and assert `wb-audit`'s log contains exactly one `policy_decision`
   entry per action, `ALLOW` rows included, not just the `DENY` ones.
5. **`misconfig-fails-loud.spec.ts`** — this duplicates part of Stage 2's
   negative-boot cases; keep it here too as a permanent regression test
   distinct from the ad hoc Stage 2 exploration, covering at minimum the
   unmounted-routing-target case.
6. **`classification-never-downgraded.spec.ts`** — ingest a document
   declared `CONFIDENTIAL` through real `wb-ingestion`, retrieve it through
   real `wb-rag`, and assert the classification attached to every resulting
   chunk is still `CONFIDENTIAL` (never silently lowered anywhere in the
   ingestion → index → retrieval path, across the real plugin boundary).

Any invariant failure gets triaged per §6 before you move to Stage 5 —
these are the properties the entire security story depends on; do not let a
green Stage 5 demo paper over a red Stage 4 invariant.

---

## 6. Failure triage — classify before you fix

When a test fails at Stage 2, 3, or 4, classify it before touching code.
Fixing the wrong side of a mismatch creates a second bug on top of the
first.

| Class | What it looks like | Correct remedy |
|---|---|---|
| **(a) Contract violation** | One plugin's real behavior doesn't match `DESIGN.md` §7's frozen types/interfaces, even though its own isolated tests pass (its fake let it drift) | Fix the offending plugin to match the frozen contract. **Never** change `DESIGN.md` §7 to match a plugin's convenient-but-wrong behavior. |
| **(b) Contract gap, resolved inconsistently** | `DESIGN.md` §7 genuinely didn't specify something (e.g. `ALLOW_METADATA_ONLY` handling), and two plugins each made a different — individually reasonable — assumption, both logged under "Deviations" | Pick one canonical resolution. Amend `DESIGN.md` §7 (and `wb-types` if it's a type-level gap) to state it explicitly. Patch **every** plugin whose behavior deviates from the now-explicit contract, not just the one you noticed first. Log the amendment in `INTEGRATION_LOG.md`. |
| **(c) Ordinary bug** | Logic error entirely within one plugin, unrelated to any cross-plugin assumption — should have been caught by that plugin's own unit tests but wasn't | Fix inside that package only. Add the missing regression test to that package's own `tests/`, not just to your new workbench-level suite. |
| **(d) Harness API mismatch** | A plugin agent guessed at a real harness API (event name, service shape, capability surface) and got it wrong, or the API has since changed | Fix against the real, current harness API — verify by reading the actual source under `packages/` in this repo, not by re-guessing. Update that plugin's README "Deviations" section to reflect the corrected understanding. |
| **(e) Missing/incomplete write-path** | A consumer plugin (most likely `wb-admin-console`) assumed a method the provider's `WbPolicyService`/etc. never actually exposes | This is a (b)-shaped gap specifically about an interface's *surface*, not just its behavior: add the missing method to the frozen interface in `wb-types` (e.g. `WbPolicyService.setOverride(...)`), implement it in the real provider plugin, and update the consumer to call the real thing instead of its assumed shape. |

For every fix, regardless of class: after fixing, **re-run the failing
test, that plugin's full own Stage-1 suite, and every Stage 3/4 test that
touches that plugin** — not just the one test that first failed. A fix that
only makes the one red test green without re-checking its neighbors is how
a second regression slips in unnoticed.

---

## 7. `workbench/INTEGRATION_LOG.md` — keep this current throughout

Create this file at the start and append to it continuously, not just at
the end. One entry per finding, in this shape:

```md
## [YYYY-MM-DD] <short title>

**Stage found:** 1 / 2 / 3 / 4 / 5
**Classification:** (a) contract violation / (b) contract gap / (c) bug /
  (d) harness API mismatch / (e) missing write-path
**Symptom:** what failed and how you noticed
**Root cause:** the actual mismatch, in one or two sentences
**Resolution:** what you changed, and in which package(s)
**Contract changes:** none, or exactly what changed in `DESIGN.md` §7 /
  `wb-types`, with the section reference
**Regression coverage added:** which test file(s), and why they'd have
  caught this earlier if they'd existed
**Re-verified:** which suites you re-ran after the fix (must include the
  originally failing test + that plugin's own Stage-1 suite + any other
  Stage 3/4 test touching the same plugin)
```

This log is itself a deliverable — it's what lets a human reviewer trust
the "it works now" claim instead of re-deriving it from a diff.

---

## 8. Stage 5 — End-to-end scenarios (`DESIGN.md` §10)

Only attempt this stage once Stages 1–4 are fully green. One file per
scenario under `workbench/tests/e2e/`, run against the real composed
system with the `document-analyst`/`engineering-vision`/`code-analysis`
presets, unmodified:

1. **`model-auto-selection.spec.ts`** — drive a plain reasoning chat turn
   and a `wb_vision_analyze` call in the same session; assert (via
   `wb-audit` or a direct `wb-model-gateway` observation point) that two
   different mounted adapter `id`s actually answered them.
2. **`inspection-report-to-approval-note.spec.ts`** — the full chain: a
   fixture scanned inspection report → `wb-ingestion` → `wb-vision` OCR →
   `wb-rag` retrieval of related fixture SOP documents → `wb-artifacts`
   generating a real `.docx` approval note with citations. Assert a real
   file exists on disk with real embedded citations matching the SOPs used,
   via the `engineering-vision` or `document-analyst` preset run start to
   finish, not by calling each plugin's service methods directly out of
   order.
3. **`coding-task-sandbox.spec.ts`** — a real calculation task through the
   `code-analysis` preset, run and verified in the harness's own sandbox
   (`e2b`/`code-runtime`) — assert the actual computed result, not just that
   the tool call didn't error.
4. **`network-monitor-proof.spec.ts`** — replay the `no-raw-network-calls`
   invariant test's battery of actions but frame the assertion as the demo
   artifact itself: produce a human-readable summary (from `wb-audit`
   query results) suitable for showing a judge, proving zero external calls
   fired for confidential-data actions across a realistic full session.

A Stage 5 failure almost always traces back to a Stage 3/4 gap that wasn't
fully closed — if you hit one, drop back to the relevant contract/invariant
test, fix and re-verify there first, then re-run the Stage 5 scenario. Don't
patch the end-to-end test itself to route around a lower-level problem.

---

## 9. Final report

When all five stages are green, write a closing section at the top of
`workbench/INTEGRATION_LOG.md`:

- One line per `DESIGN.md` §9 invariant: PASS, with a link to its test file.
- One line per `DESIGN.md` §10 demo scenario: PASS, with a link to its test
  file.
- A count of findings by classification (a)–(e), so a human reviewer can see
  at a glance whether most issues were sloppy contract drift (a/c) versus
  genuine spec gaps (b/e) versus stale-assumption bugs about the harness (d)
  — that ratio is useful signal about where to tighten `DESIGN.md` before
  the next round of plugins gets built this way.
- An explicit go/no-go statement for the SIH demo, and if no-go, the
  smallest remaining red item blocking it.

Do not declare the system integrated until every item in that report is
genuinely green from a real run, not from memory of an earlier pass — rerun
the full suite (`pnpm run test` at the workbench workspace root, covering
`packages/*/tests`, `tests/contract`, `tests/invariants`, `tests/e2e`) one
final time immediately before writing this report.
