# @mrpl/dsh-workbench-ui

**Priority: 🔴 Essential**

## Purpose

Secure Workbench chat/workspace/security-indicator client. This is the client plugin for the Sovereign AI Workbench defined in `workbench/DESIGN.md`.

It provides NO backend `ctx` service. It consumes the harness `dsh-sdk`, the harness session/event stream, `wb-audit` read API, and `wb-policy` live decision stream.

## Architecture

This package registers directly into the client framework's `dsh-client-ui-slots`. It replaces the generic harness `ui-conversation` and `ui-sidebar` components by providing specific React components into the `sidebar`, `conversation`, and `details` slots.

- **SidebarRoot**: Replaces the left sidebar with MRPL branding and primary navigation. Includes the Local/Sovereign Security Indicator.
- **ConversationRoot**: Replaces the main chat frame with the Sovereign AI workspace, preset selections, and the customized chat composer.
- **DetailsRoot**: Replaces the details panel with an Activity and Security timeline.

## Security indicator: the one thing that must not be mocked

`DESIGN.md` §6.10 requires a persistent 🟢 *Local / Sovereign* badge that flips
to 🔴 *External request blocked by policy* the moment a `DENY` fires for the
active session. That badge is the product's proof that the policy engine
exists, so it reads live state rather than a fixture.

`src/client/policy/policy-store.ts` holds the last decision seen for the
active session. Everything else in `src/client/mock/` is fixture data awaiting
real wiring; this deliberately is not.

**The integration point is one function.** When the transport receives a
`wb/policy/decision` event (§7.4), call:

```ts
import { publishPolicyDecision } from './policy/policy-store.ts'

publishPolicyDecision(event) // event: WbPolicyDecisionEvent
```

Also call `markPolicyProcessing()` when a request goes in flight, and
`resetPolicyState()` when the active session changes — a verdict must never
carry from one session into another.

Two behaviors are load-bearing and covered by tests:

- **`isLocal` is one-way within a session.** Once an allowed request reaches
  `internet` or `external_api`, the session is no longer purely sovereign and a
  later local `ALLOW` does not restore the green badge. A *denied* off-premise
  request leaves `isLocal` true, because nothing left the premises.
- **`badgeFor` is exhaustive over `WbDecisionKind`.** `ALLOW_WITH_REDACTION`
  and `ALLOW_METADATA_ONLY` render as their own "partial" tone rather than
  falling through to "External Access Allowed" — both withhold content, and
  presenting them as unrestricted access would misstate what policy did.
  Adding a decision kind to the frozen union now fails the build here.

## Deviations

- ~~**Everything except the security indicator still reads fixtures.**~~
  **RESOLVED 2026-08-28.** Activity, sources and artifacts now read live state
  from `src/client/live/`, fed by `src/host/bridge.ts` from `wb-audit` and the
  `wb/rag/retrieved` and `wb/policy/decision` streams. What remains fixture
  data is chat message history and navigation, which need the harness session
  stream (`dsh-sdk`) rather than a workbench service — a different integration,
  tracked separately.

## Live panels and their sources

`wb-ui` is a client plugin and cannot hold `ctx.wbAudit` directly, so each
panel reads a store and `src/host/bridge.ts` publishes into it host-side —
the same seam shape the security indicator already used.

| Panel | Source | Seam |
|---|---|---|
| Security badge | `wb/policy/decision` | `publishPolicyDecision` |
| Activity | `wbAudit.subscribe`, backfilled from a bounded `query` | `publishAuditEntry` |
| Sources | `wb/rag/retrieved` | `publishRetrievalCitations` |
| Artifacts | `tool_result` entries for the four `wb_generate_*` tools | `publishAuditEntry` |
| Composer posture | `wb/policy/decision` | `publishChatDecision` |

Activity and artifacts derive from the same append-only log the audit console
reads, so there is no second source that could disagree with it. The sources
panel **replaces** on each retrieval rather than accumulating: carrying a
previous query's citations forward would attribute evidence to an answer that
never used it.

## Known Limitations and Deferred Work

- No component-render tests. Coverage is on `policy-store` and `badgeFor` —
  the logic where a defect misstates the security posture. Rendering assertions
  need a DOM environment this package does not yet configure.
- The dev harness under `src/dev/` mocks `@mrpl/dsh-workbench-types` through a
  Vite alias, so it exercises the components but not the real frozen types.
