# Build `wb-audit` — Audit & Provenance plugin

You are building **one** plugin inside a larger multi-agent build: the
Sovereign AI Workbench, a set of Cordis plugins mounted on top of the
DeepSeek Harness agent runtime. Eleven other agents are independently
building the other plugins; you will never see their code and they will
never see yours. The only thing that lets your work integrate correctly
later is that you follow the frozen contract below exactly, without
improvising names.

## Required reading, in this order

1. `workbench/DESIGN.md` — read in full once for context, then read §6.3
   ("`wb-audit` — Audit & Provenance") closely; it is your contract card.
   Also read §4, §7 in full, §9 (invariant 4: nothing is ALLOWed silently —
   you are the plugin that makes this checkable), §10 (what "done" looks
   like — your log is the literal demo proof), and §12.
2. `workbench/AGENTS.md` — general build process, coding conventions, §9
   "done" checklist.
3. `workbench/packages/wb-types/src/index.ts` — frozen shared types. Import
   `WbAuditEntry`, `WbAuditEntryId`, `asWbAuditEntryId`, and the event
   payload types (`WbPolicyDecisionEvent`, `WbRagRetrievedEvent`,
   `WbIngestionCompletedEvent`) from here; never redefine them.
4. `docs/cookbook/adding-a-package.md` (repo root) — package skeleton.
5. `docs/testing.md` (repo root) — "Unit" tier and "Prefer the real
   implementation over a mock" sections.
6. Skim `packages/extensions/tool-cordis/tests/cordis-lifecycle.spec.ts` for
   Cordis testing idioms.

## Your role

Answer "why did this answer happen?" for any past request, from an
append-only local log.

- Package: `@mrpl/dsh-workbench-audit`, at `workbench/packages/wb-audit/`.
- Provides: `ctx.wbAudit` implementing `WbAuditService` from `wb-types`
  (`record(entry)`, `query(filter)`).
- Subscribes to: `wb/policy/decision`, the harness's own `tool/result` and
  `session/event` (find the real event names/shapes in this repo — search
  `packages/core` for the session event stream, do not guess), and
  `wb/rag/retrieved` and `wb/ingestion/completed` (frozen names, `DESIGN.md`
  §7.4). Each maps to one `WbAuditEntry.kind`.
- Writes one `WbAuditEntry` per meaningful operation to an append-only local
  store: JSONL under `$DSH_HOME/workbench/audit/`, rotated daily. `Config`:
  `root: string` (the audit directory path).
- **Never mutates or deletes a written entry.** A correction is a new entry
  referencing the old one's id in its `payload`.
- `query()` is read-only and is the only surface `wb-admin-console` (a
  sibling plugin, not built here) is meant to use.

## Dependencies you consume

- Events from `wb-policy`, `wb-rag`, `wb-ingestion` (siblings you won't see
  built) — but events are structurally decoupled: you don't call their
  services, you just listen on the frozen event names/payload types from
  `wb-types`. This means you do **not** need to fake a service interface for
  them; just emit the frozen event shapes yourself in tests to exercise your
  listener.
- The harness's own session/tool-result events — real, not faked; use the
  real harness `Context` in your tests per "prefer the real implementation
  over a mock." If you cannot find a stable public event for
  `tool/result`/`session/event` in this repo, implement against what you can
  find, note the exact API you used under "Deviations," and flag the gap in
  `DESIGN.md` §12 rather than guessing silently.

## Non-goals — do not build these

- Not a general logging framework — only the five `WbAuditEntry.kind` values
  from `wb-types` are recorded; do not add new kinds without going through
  `DESIGN.md` §12 first.
- Do not attach full document contents to an audit entry. Reference the
  document id and a short reason/summary instead — keep entries small and
  keep the audit log itself out of `CONFIDENTIAL`/`RESTRICTED` territory
  where practical.
- No model-facing tool. An agent must never be able to query or edit its own
  audit trail through a tool call — `query()` is only reachable from
  `wb-admin-console`'s backend code, never registered via `ctx.tools.register`.
- No database dependency for this prototype — local JSONL is sufficient and
  required (do not add Postgres/SQLite as a hidden requirement other plugins
  would need to stand up too).

## Workflow — tests first, then implementation, then verification

**Step 1 — write failing tests before any implementation.** At minimum:
- Emitting a `wb/policy/decision` event results in exactly one
  `WbAuditEntry` with `kind: 'policy_decision'` retrievable via `query()`.
- Same for `wb/rag/retrieved` → `'rag_retrieval'` and
  `wb/ingestion/completed` → `'ingestion_completed'`.
- `record()` entries are assigned a unique `WbAuditEntryId` and an ISO 8601
  `at` timestamp even though the caller doesn't supply them (per the
  `Omit<WbAuditEntry, 'id' | 'at'>` parameter type in `WbAuditService`).
- Entries persist across a simulated process restart (write to JSONL, create
  a fresh plugin instance pointed at the same `root`, confirm `query()` still
  finds them) — this is your durability guarantee, test it for real, not by
  asserting an in-memory array.
- `query()` filtering by `sessionId`, `userId`, and `kind` each work, alone
  and combined.
- No method exists (or is reachable) that deletes or mutates a prior entry —
  assert this structurally (no `delete`/`update` on the public interface),
  not just by convention.
- Daily rotation: entries written on two different simulated dates land in
  two different files (or however you implement rotation — assert the
  externally observable behavior: old data survives, `query()` still finds
  everything).
- HMR-safety test per `docs/testing.md`.

**Step 2 — implement** the minimum plugin code to pass those tests.

**Step 3 — expand tests** for edge cases found while implementing (e.g.
concurrent writes from two sessions, a malformed/corrupt existing JSONL line
on load — should skip and log, not crash the whole audit subsystem).

**Step 4 — verify**, from `workbench/packages/wb-audit/`:
```
pnpm install
pnpm run typecheck
pnpm run lint
pnpm run test
pnpm run build
```

**Step 5 — self-check** against `AGENTS.md` §9, then write `README.md` per
`AGENTS.md` §8 (service API, config, events consumed, storage format, and a
"Deviations" section for whatever real harness event names/shapes you had to
discover rather than assume).

## If you hit a gap

Do not invent a workbench-wide name to fill it. Note it under "Deviations"
in your `README.md` and append a dated bullet to `DESIGN.md` §12.
