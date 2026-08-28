# Build `wb-ui` — Secure Workbench UI plugin

You are building **one** plugin inside a larger multi-agent build: the
Sovereign AI Workbench, a set of Cordis plugins mounted on top of the
DeepSeek Harness agent runtime. Eleven other agents are independently
building the other plugins; you will never see their code and they will
never see yours. The only thing that lets your work integrate correctly
later is that you follow the frozen contract below exactly, without
improvising names.

## Required reading, in this order

1. `workbench/DESIGN.md` — read in full once for context, then read §6.10
   ("`wb-ui` — Secure Workbench UI") closely; it is your contract card. Also
   read §4, §7.2 (`WbPolicyDecision`/`WbDecisionKind` — what your security
   indicator reacts to), §7.4 (the `wb/policy/decision` event you consume),
   and §12.
2. `workbench/AGENTS.md` — general build process, and **§5** ("If your
   plugin is a client (UI) plugin") specifically.
3. `workbench/packages/wb-types/src/index.ts` — frozen shared types. Import
   `WbDecisionKind`, `WbPolicyDecisionEvent` (or the relevant event payload
   shape); never redefine them.
4. Find and read `packages/client/AGENTS.md` in this repo — the actual
   contract for a client plugin: `tsconfig.base.client.json`, `dsh.client`
   in `package.json`, `./client` export, the shared `tsdown.client.ts`
   preset. Also find one existing client package under `packages/client/`
   (or wherever client plugins live in this repo — search for
   `dsh.client` in `package.json` files) and use it as your structural
   template.
5. Find and read the harness's own SDK docs/package for session/event
   streaming from a client (search for `dsh-sdk` or similar in this repo) —
   this is what drives your chat/workspace views.
6. `docs/testing.md` (repo root) — read the "Web browser snapshot" tier
   description to understand how this repo tests UI, even though full
   snapshot-tier testing is out of scope for this prototype; also read
   "Unit" tier and "Prefer the real implementation over a mock."

## Your role

`Plugin_design_idea` §3's screen: chat, sources, agents, activity, security,
artifacts — the thing users actually see, and the thing that makes the
workbench's governance **visible**, not just enforced silently in the
backend.

- Package: `@mrpl/dsh-workbench-ui`, at `workbench/packages/wb-ui/`, built
  as a harness client plugin (not a backend Cordis service plugin — no
  `ctx.wb*` service of your own; you are a leaf, nothing else depends on
  you).
- Consumes: the harness's own SDK session/event stream (for chat, agent
  activity, generated artifacts) plus **read-only** integrations with
  `wb-audit`'s query API and the `wb/policy/decision` event stream (from
  `wb-policy` — both siblings you won't see built).
- **The security indicator is the one hard, testable requirement**: a
  persistent 🟢 *Local / Sovereign* badge that flips to 🔴 *External request
  blocked by policy* the moment a `DENY` fires for the active session, and
  flips back appropriately. This is the UI surfacing of the whole project's
  USP — treat it as first-class, not a decorative afterthought.
- Screens per `Plugin_design_idea` §3: Chat, Sources, Agents, Activity,
  Security, Artifacts. Build all of them, but the security indicator is the
  one with an explicit correctness bar above.

## Dependencies you consume

- The harness's own SDK — real, not faked; use whatever test utilities this
  repo already provides for client-side SDK testing (look for existing
  client package tests).
- `wb-audit`'s `query()` and the `wb/policy/decision` event — **fake both**,
  matching `WbAuditService` and the event payload type from `wb-types`,
  since neither sibling plugin exists in your workspace. Your fake event
  source should let a test fire a `DENY` and assert the indicator state
  changes, then fire an `ALLOW` (or session reset) and assert it changes
  back per your documented rule.

## Non-goals — do not build these

- No business logic. Every action the UI offers is a call into the harness
  SDK or a workbench tool (`wb_ocr_extract`, `wb_generate_report`, etc.) —
  the UI never talks to `wb-policy`/`wb-rag`/`wb-ingestion`/etc. directly
  except through the two read-only integrations named above.
- No second policy-evaluation path in the client for "should I show this
  button" — if you need to gray out an action based on permissions, drive it
  from data the backend already exposes (e.g. the `WbUser`'s
  `allowedAgentPresets`/`allowedToolCategories` fields, surfaced through
  whatever session-init payload the SDK already provides), don't
  re-implement policy logic client-side.
- No new backend service — if you find yourself wanting a `ctx.wb*` key of
  your own, stop; that's out of scope for a UI plugin per `DESIGN.md` §6.10.

## Workflow — tests first, then implementation, then verification

**Step 1 — write failing tests before any implementation.** At minimum:
- **Security indicator, table-driven**: for each `WbDecisionKind` value
  (`ALLOW`, `DENY`, `REQUIRE_APPROVAL`, `ALLOW_WITH_REDACTION`,
  `ALLOW_METADATA_ONLY`), fire the fake `wb/policy/decision` event and
  assert the indicator's displayed state — decide explicitly what each of
  the five maps to (only `DENY` clearly maps to the 🔴 state per
  `DESIGN.md`; document your mapping for the other four rather than leaving
  it implicit) and test every one.
- The indicator reverts from 🔴 to 🟢 per your documented rule (e.g. next
  `ALLOW` for the same session, or explicit session reset) — test that rule
  specifically, don't just test that 🔴 can be reached.
- Chat/Activity screens render a streamed sequence of SDK session events
  without dropping or reordering them (use the repo's existing client-test
  utilities for the SDK, real not faked).
- Sources/Artifacts screens render citations/generated-file entries from
  fixture data matching `WbCitation`/artifact-result shapes.
- Security/Activity screens render `wb-audit` query results from your fake,
  including a `DENY` entry rendered distinctly from an `ALLOW` entry.
- HMR-safety / clean unmount test appropriate to the client framework this
  repo's other client plugins use (find the pattern in an existing client
  package's tests).

**Step 2 — implement** the minimum plugin code to pass those tests.

**Step 3 — expand tests** for edge cases found while implementing (a burst
of decisions arriving faster than the UI can render, a session with no
decisions yet at all — indicator should default to 🟢, not an unstyled/blank
state).

**Step 4 — verify**, from `workbench/packages/wb-ui/`:
```
pnpm install
pnpm run typecheck
pnpm run lint
pnpm run test
pnpm run build
```

**Step 5 — self-check** against `AGENTS.md` §9, then write `README.md`
covering: the six screens and what each renders, your exact
`WbDecisionKind` → indicator-state mapping (this must be easy for a
reviewer to find), the read-only integrations you depend on, and a
"Deviations" section for anything about the harness's client-plugin
conventions or SDK you had to infer.

## If you hit a gap

Do not invent a workbench-wide name to fill it. Note it under "Deviations"
in your `README.md` and append a dated bullet to `DESIGN.md` §12.
