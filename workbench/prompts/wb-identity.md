# Build `wb-identity` — Identity & RBAC plugin

You are building **one** plugin inside a larger multi-agent build: the
Sovereign AI Workbench, a set of Cordis plugins mounted on top of the
DeepSeek Harness agent runtime. Eleven other agents are independently
building the other plugins; you will never see their code and they will
never see yours. The only thing that lets your work integrate correctly
later is that you follow the frozen contract below exactly, without
improvising names.

## Required reading, in this order

1. `workbench/DESIGN.md` — read in full once for context, then read §6.1
   ("`wb-identity` — Identity & RBAC") closely; it is your contract card.
   Also read §4 (naming rules), §7.1–7.3 (frozen types and your service
   interface), and §12 (Open Questions — how to flag a gap, never invent
   around one).
2. `workbench/AGENTS.md` — the general build process, package skeleton,
   coding conventions, and the "done" checklist in §9. Follow it exactly.
3. `workbench/packages/wb-types/src/index.ts` — the frozen shared types.
   Import from this package; never redefine `WbUser`, `WbClassification`,
   `WbSessionId`, etc. locally.
4. `docs/cookbook/adding-a-package.md` (repo root) — the package skeleton
   and checklist this repo itself uses; your package should look like an
   ordinary harness package.
5. `docs/testing.md` (repo root) — read the "Unit" tier section and "Prefer
   the real implementation over a mock" section. The stricter tiers
   (coverage gate, real-API e2e, snapshot) are **out of scope** for this
   prototype; the Unit tier's practices are not.
6. Skim one existing package's test file for the harness's Cordis testing
   pattern: `packages/extensions/tool-cordis/tests/cordis-lifecycle.spec.ts`
   shows `new Context()` + `ctx.plugin(...)` + `ctx.effect(...)` idioms.

## Your role

Turn "who is logged in" into a structured `WbUser` object every other
workbench plugin can reason about, and make session identity resolution an
*event* other plugins (especially `wb-policy`) can depend on having already
happened.

- Package: `@mrpl/dsh-workbench-identity`, at `workbench/packages/wb-identity/`.
- Provides: `ctx.wbIdentity` implementing `WbIdentityService` from `wb-types`
  (`current(sessionId): WbUser | undefined`).
- Emits `wb/identity/resolved` (payload `WbIdentityResolvedEvent` from
  `wb-types`) once per session, before any tool call for that session is
  dispatched.
- Resolves the `WbUser` via a pluggable `WbUserDirectoryProvider` seam (your
  own type, not in `wb-types` — this is internal to your plugin). Ship one
  default provider: a file-backed one reading
  `$DSH_HOME/workbench/users.yaml` (path from `Config`, see below).
- `Config` fields (Schemastery-validated): `userDirectory: 'file'` (leave room
  to add other provider kinds later without breaking config shape) and
  `userDirectoryPath: string`.

## Non-goals — do not build these

- No login form, no password storage, no OAuth/SSO flow. You consume
  whatever principal the deployment's transport/reverse-proxy already
  attaches to the session (treat "how a raw principal string arrives on the
  session" as an injected/testable seam you can stub — do not hardcode how
  the harness's own transport exposes it; if you can't find a clean seam,
  fake it behind your own small interface and note it in your README's
  "Deviations" section rather than guessing at harness internals).
- No policy decisions — you only shape and expose the principal you're
  handed. `wb-policy` (a different plugin, do not build it here) decides
  what the user is allowed to do.

## Faking your dependencies for tests

You have no dependency on another `wb-*` plugin. You only depend on
`wb-types` (real) and the harness's own `Context`/session primitives — use
the harness's own testing idioms for those (see reading item 6), not a fake.

## Workflow — tests first, then implementation, then verification

**Step 1 — write failing tests before any implementation.** At minimum,
cover:
- A session with a valid principal resolves to a `WbUser` matching the fixture
  in your file-backed provider, and `ctx.wbIdentity.current(sessionId)`
  returns it.
- `wb/identity/resolved` fires exactly once per session, with the resolved
  `WbUser`, before the test simulates any tool call.
- An unresolvable principal (no matching directory entry) does **not** throw
  and does **not** silently invent a default user — `current()` returns
  `undefined` and no `wb/identity/resolved` event fires for that session
  (this is what makes `wb-policy`'s "fail loud, not silent" invariant in
  `DESIGN.md` §6.1 possible downstream — don't quietly work around it here).
- Malformed `users.yaml` fails loudly at plugin load (misconfiguration must
  not resolve to a half-working state).
- An HMR-safety test: dispose the plugin's fiber, assert the `ctx.wbIdentity`
  service and any listeners are cleanly removed (per `docs/testing.md`'s
  "Every registry gets an HMR-safety test" rule).

**Step 2 — implement** the minimum plugin code to make those tests pass,
following the `name`/`inject`/`apply`/`Config` shape in `AGENTS.md` §3.

**Step 3 — expand tests** for any edge case you discover while implementing
(multiple sessions for the same user; a session that never gets a principal
at all).

**Step 4 — verify**, from `workbench/packages/wb-identity/`:
```
pnpm install
pnpm run typecheck
pnpm run lint
pnpm run test
pnpm run build
```
All must pass before you consider this done.

**Step 5 — self-check** against `AGENTS.md` §9's checklist, then write
`README.md` per `AGENTS.md` §8's shape (service API, config, events,
extension points; a "Deviations" section if you had to stub anything
undocumented).

## If you hit a gap

If `DESIGN.md` §7 doesn't cover something you need (e.g. exactly how a
principal arrives on a session), do not invent a workbench-wide name to fill
it. Implement the most conservative reasonable thing behind your own
plugin-local interface, note it under "Deviations" in your `README.md`, and
append a dated bullet to `DESIGN.md` §12 describing the gap.
