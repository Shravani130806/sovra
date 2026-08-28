# Build `wb-policy` — Policy Gateway plugin ⭐

You are building **one** plugin inside a larger multi-agent build: the
Sovereign AI Workbench, a set of Cordis plugins mounted on top of the
DeepSeek Harness agent runtime. Eleven other agents are independently
building the other plugins; you will never see their code and they will
never see yours. The only thing that lets your work integrate correctly
later is that you follow the frozen contract below exactly, without
improvising names.

This plugin is the one the project's entire security claim rests on. Read
carefully.

## Required reading, in this order

1. `workbench/DESIGN.md` — read in full once for context, then read §6.2
   ("`wb-policy` — Policy Gateway ⭐") closely; it is your contract card.
   Also read §4, §5 (the classification-vs-capability matrix — your default
   policy), §7 in full (frozen types and your service interface), §9
   (non-negotiable invariants — several are about you directly), and §12.
2. `workbench/AGENTS.md` — general build process, package skeleton, coding
   conventions, §9 "done" checklist. Follow it exactly.
3. `workbench/packages/wb-types/src/index.ts` — frozen shared types. Import
   from this package; never redefine `WbPolicyRequest`, `WbPolicyDecision`,
   `WbDecisionKind`, `WbClassification`, etc. locally.
4. `docs/cookbook/adding-a-tool.md` (repo root) — read the section on
   execution policy / observation hooks around tool calls. This is the
   mechanism you plug into: the harness's own `tools/pre-execute` extension
   point. Find and read the actual extension-point type/registration API in
   `packages/core/tools` in this repo (look for how a listener registers on
   pre-execute) so your plugin uses the real, current API rather than a
   guessed one.
5. `docs/testing.md` (repo root) — "Unit" tier and "Prefer the real
   implementation over a mock" sections. Stricter tiers are out of scope for
   this prototype.
6. Skim `packages/extensions/tool-cordis/tests/cordis-lifecycle.spec.ts` for
   the harness's Cordis testing idioms (`new Context()`, `ctx.plugin(...)`,
   `ctx.effect(...)`).

## Your role

The single place every ALLOW/DENY/APPROVAL decision is made, for every tool
call in the entire composed system — not just workbench tools.

- Package: `@mrpl/dsh-workbench-policy`, at `workbench/packages/wb-policy/`.
- Provides: `ctx.wbPolicy` implementing `WbPolicyService` from `wb-types`
  (`evaluate(request: WbPolicyRequest): Promise<WbPolicyDecision>`).
- **Mounts a listener on the harness's `tools/pre-execute` hook** so every
  tool call in the tree is evaluated automatically, not just ones a caller
  remembers to check manually.
- Implements the classification × capability matrix from `DESIGN.md` §5 as
  the default, with `decision` one of the five `WbDecisionKind` values —
  never a plain boolean.
- Publishes **every** decision, including `ALLOW`, as event `wb/policy/decision`
  (payload shape `WbPolicyDecisionEvent` from `wb-types`) so nothing is
  ALLOWed silently (`DESIGN.md` §9 invariant 4).
- `Config`: the matrix itself and any per-role overrides are `Config` fields
  (Schemastery-validated, e.g. loaded from a YAML path), never hardcoded
  `if` statements — an MRPL admin must be able to tune this without a
  rebuild.
- A `REQUIRE_APPROVAL` decision must not block silently forever — route it
  through the harness's own interaction/approval capability
  (`packages/interaction` in this repo). Read that package's public API
  before wiring this; do not build a second approval UI.

## Dependencies you consume

- `ctx.wbIdentity` (from `wb-identity`, a sibling plugin you will not see
  built) — you call `ctx.wbIdentity.current(sessionId)` to get the `WbUser`
  for a request. **Fake this for your tests** (see below); depend on it only
  through the `WbIdentityService` interface in `wb-types`.
- The harness's own `tools` capability (for the `tools/pre-execute` hook).
  This is real, not faked — use the real harness `Context`/tools plugin in
  your tests per "prefer the real implementation over a mock."

## Faking your dependencies for tests

`wb-identity` will not exist in your workspace when you build this. Write a
small test-only fake Cordis plugin that provides `ctx.wbIdentity` with a
hardcoded/parameterized `current()` — matching the `WbIdentityService`
interface from `wb-types` exactly — and mount it alongside your plugin in
your test `Context`. Never guess at `wb-identity`'s internal implementation;
only its public interface is your contract.

## Non-goals — do not build these

- No UI. No decision about *what a tool does*, only *whether it may run*.
- No direct network calls of any kind — you gate the harness's own network
  capability, you don't add a new one.
- No tool-name-string special-casing as your primary mechanism — the actual
  design (see `DESIGN.md` §6.7) is that `wb-tool-gateway` (a sibling plugin)
  will maintain a `WbToolManifest` directory you're meant to consult via
  `ctx.wbToolGateway.getManifest(toolId)`. That plugin does not exist yet
  either — **fake it too**, the same way you fake `wb-identity`, using the
  `WbToolGatewayService` interface from `wb-types`. If a tool has no manifest
  (`getManifest` returns `undefined`), default to the most conservative
  reasonable decision (do not default-allow an unmanifested tool) and note
  this default explicitly in your README.

## Workflow — tests first, then implementation, then verification

**Step 1 — write failing tests before any implementation.** At minimum:
- **One test per row of the §5 matrix** (7 capability rows × 4 classification
  columns) — this is explicitly required by `DESIGN.md` §6.2 ("must have a
  test proving each row"). Table-drive this; don't write 28 near-duplicate
  `it()` blocks by hand.
- `evaluate()` for `REQUIRE_APPROVAL` actually invokes the interaction/approval
  capability rather than blocking silently or auto-resolving.
- Every call to `evaluate()`, including `ALLOW` results, publishes
  `wb/policy/decision` with a payload matching `WbPolicyDecisionEvent`.
- The `tools/pre-execute` listener: a `DENY` decision actually prevents tool
  execution (test through the real harness tool-call path, not by calling
  your internal function directly — this is the "test the real entry path"
  rule from `docs/testing.md`).
- Config-driven override: a role-specific override in `Config` changes the
  outcome for a request that would otherwise hit the §5 default.
- Malformed/missing matrix config fails loudly at plugin load.
- An unmanifested tool (fake `wb-tool-gateway` returns `undefined`) resolves
  to your documented conservative default, not an accidental `ALLOW`.
- HMR-safety test per `docs/testing.md`.

**Step 2 — implement** the minimum plugin code to pass those tests.

**Step 3 — expand tests** for edge cases found while implementing (e.g. a
request with no resolvable `WbUser` at all — `wb-identity` never resolved).

**Step 4 — verify**, from `workbench/packages/wb-policy/`:
```
pnpm install
pnpm run typecheck
pnpm run lint
pnpm run test
pnpm run build
```

**Step 5 — self-check** against `AGENTS.md` §9, then write `README.md` per
`AGENTS.md` §8 (service API, config, events, extension points, and a
"Deviations" section covering your unmanifested-tool default and any
approval-capability integration detail you had to infer).

## If you hit a gap

Do not invent a workbench-wide name to fill it. Note it under "Deviations"
in your `README.md` and append a dated bullet to `DESIGN.md` §12.
