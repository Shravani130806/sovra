# Build `wb-admin-console` — Admin & Policy Console plugin

You are building **one** plugin inside a larger multi-agent build: the
Sovereign AI Workbench, a set of Cordis plugins mounted on top of the
DeepSeek Harness agent runtime. Eleven other agents are independently
building the other plugins; you will never see their code and they will
never see yours. The only thing that lets your work integrate correctly
later is that you follow the frozen contract below exactly, without
improvising names.

## Required reading, in this order

1. `workbench/DESIGN.md` — read in full once for context, then read §6.11
   ("`wb-admin-console` — Admin & Policy Console") closely; it is your
   contract card. Also read §4, §5 (the matrix this console lets an admin
   override), §7 in full, §7.3 (`WbAuditService`, `WbPolicyService`), and
   §12.
2. `workbench/AGENTS.md` — general build process, and **§5** ("If your
   plugin is a client (UI) plugin") specifically.
3. `workbench/packages/wb-types/src/index.ts` — frozen shared types. Import
   `WbAuditEntry`, `WbPolicyRequest`, `WbClassification`; never redefine
   them.
4. Find and read `packages/client/AGENTS.md` in this repo — the client
   plugin contract. Find one existing client package as a structural
   template.
5. `docs/testing.md` (repo root) — "Unit" tier and "Prefer the real
   implementation over a mock" sections.

## Your role

`Plugin_design_idea` §14's dashboard: users, active agents, documents,
policy decisions, blocked requests, plus the ability to edit the per-role
policy override table that `wb-policy` reads.

- Package: `@mrpl/dsh-workbench-admin-console`, at
  `workbench/packages/wb-admin-console/`, built as a harness client plugin.
- Provides no `ctx` service consumed by other plugins — you are a leaf.
- **Read path**: `ctx.wbAudit.query(...)` (from `wb-audit`, a sibling) —
  drives the "Users / Active Agents / Documents / Policy Decisions / Blocked
  Requests" counters and the live security-events feed in
  `Plugin_design_idea` §14's mock.
- **Write path**: writes only to `wb-policy`'s (another sibling) `Config`
  override store — the same one `wb-policy` itself reads from at
  `evaluate()` time. You must **not** implement a second, parallel policy
  path; every override you write must be one `wb-policy` will actually
  honor. Since you can't see `wb-policy`'s implementation, define the
  override write path as a call against the `WbPolicyService` interface
  from `wb-types` plus whatever admin-facing extension you need — if
  `WbPolicyService` as frozen doesn't expose a write method, that's a gap:
  don't invent one silently, note it under "Deviations" and append a bullet
  to `DESIGN.md` §12 proposing the addition (e.g. a
  `setOverride(role, override)` method), and build your console against a
  faked version of that proposed method in the meantime so your own
  plugin's tests are still meaningful.

## Dependencies you consume

- `ctx.wbAudit` (`wb-audit`) — **already built** at
  `workbench/packages/wb-audit/`; read its `src/index.ts` and README first.
  Its real `query(filter)` accepts `{ sessionId?, userId?, kind? }`. Fake it
  for your own tests with fixture `WbAuditEntry` data covering all five
  `kind` values so your counters and feed have something to render against.

  **Know this before you design your counters:** `wb-audit` as built does
  *not* record `wb/policy/decision` or `wb/ingestion/completed` — both
  handlers are deliberate no-ops pending the §12 gap on missing
  `sessionId`/`userId` in those event payloads. So against the *live* system
  today, your "Policy Decisions" and "Blocked Requests" counters read zero,
  and the security-events feed is empty. Build and test against fixtures as
  planned, but state this plainly in your README: your dashboard's two
  headline numbers are blocked on a contract gap you do not own and must not
  work around by reading policy state from anywhere else.
- `ctx.wbPolicy`'s config-override surface (`wb-policy`) — **already built**;
  read its `src/index.ts` first. The gap anticipated above is **confirmed,
  not hypothetical**: the built service exposes exactly one public method,
  `evaluate(request)`. There is no write/override method to call. Proceed
  exactly as instructed — propose one in `DESIGN.md` §12, build against a
  fake of your proposal, and document the assumed shape.

## Non-goals — do not build these

- No own audit storage, no own policy evaluation logic — read/write only,
  against the two plugins above, through their frozen (or proposed, if
  gapped) interfaces.
- No user/role/department management beyond what's needed to display and
  override policy — you are not `wb-identity`; you don't create or edit
  `WbUser` records, only read them via audit entries/fixtures for display.
- No direct file/document management — "Documents: 12,430" in the mock is a
  count from audit/ingestion data, not a document-management UI of its own.

## Workflow — tests first, then implementation, then verification

**Step 1 — write failing tests before any implementation.** At minimum:
- Dashboard counters (Users, Active Agents, Documents, Policy Decisions,
  Blocked Requests) compute correctly from a fixture set of
  `WbAuditEntry` records passed through your faked `ctx.wbAudit.query(...)`
  — assert each counter against a hand-checked expected value for the
  fixture, not just "renders something."
- The live security-events feed renders `DENY` entries visibly distinct
  from `ALLOW`/other entries, in the correct chronological order, from
  fixture data.
- An admin submitting a policy override for a role calls your write path
  with the exact shape you documented (against your faked/proposed
  `wb-policy` write method) — assert the call, and assert the UI reflects
  the change optimistically or after confirmation (decide and document
  which, then test that behavior).
- An override write that the fake reports as rejected (e.g. an invalid
  role) surfaces a clear error in the UI, not a silent no-op.
- Empty-state rendering: no audit entries yet → dashboard shows zeroes, not
  a broken/blank layout.
- HMR-safety / clean unmount test appropriate to this repo's client-plugin
  testing pattern.

**Step 2 — implement** the minimum plugin code to pass those tests.

**Step 3 — expand tests** for edge cases found while implementing (a very
large audit dataset — does your dashboard need pagination? decide and
document; a role with no existing override yet vs. one being edited).

**Step 4 — verify**, from `workbench/packages/wb-admin-console/`:
```
pnpm install
pnpm run typecheck
pnpm run lint
pnpm run test
pnpm run build
```

**Step 5 — self-check** against `AGENTS.md` §9, then write `README.md`
covering: the dashboard's data sources and counter definitions, the exact
override write-path shape you assumed or proposed, and a "Deviations"
section — this plugin is the most likely of the twelve to need one, since
the write path isn't fully specified in `DESIGN.md` §7. Be explicit about
what you proposed in `DESIGN.md` §12 so a human integrator can reconcile it
with whatever `wb-policy`'s actual agent built.

## If you hit a gap

Do not invent a workbench-wide name to fill it. Note it under "Deviations"
in your `README.md` and append a dated bullet to `DESIGN.md` §12 — this is
expected for this particular plugin given the write-path gap noted above,
so treat it as a normal, anticipated step, not a failure.
