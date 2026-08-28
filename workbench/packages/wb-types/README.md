# @mrpl/dsh-workbench-types

Frozen shared TypeScript contract for every Sovereign AI Workbench plugin.
Authoritative source: `workbench/DESIGN.md` §7. This package has no Cordis
plugin export and no dependency beyond plain TypeScript.

Do not edit this package while building any other workbench plugin. If the
contract is missing something you need, propose the addition in
`workbench/DESIGN.md` §12 rather than changing this file unilaterally — see
`workbench/AGENTS.md` §6 and §10.

## Contents

- **Branded ids** — `WbUserId`, `WbDocumentId`, `WbSessionId`, `WbAuditEntryId`
  and their `asWb*` constructors. Use these instead of a bare `string` at any
  point an id crosses a plugin boundary.
- **Value types and enums** — `WbClassification`, `WbDecisionKind`,
  `WbPolicyRequest`/`WbPolicyDecision`, `WbModelCapability`/`WbModelHandle`,
  `WbUser`, `WbCitation`, `WbRagResult`, `WbToolManifest`, `WbAuditEntry`.
- **Service Definition interfaces** — the exact shape each `ctx.wb*` service
  must implement: `WbIdentityService`, `WbPolicyService`, `WbAuditService`,
  `WbModelGatewayService`, `WbRagService`, `WbVisionService`,
  `WbToolGatewayService`, `WbIngestionService`.
- **Event payload types** — paired with the event-name table in
  `workbench/DESIGN.md` §7.4.

## Model Experience

None — this package contributes no prompt text, tool schema, or model-visible
behavior of its own; it is a compile-time contract consumed indirectly through
the plugins that implement the interfaces it defines.

## Known Limitations and Deferred Work

- **No runtime schema validation.** These are TypeScript types only. Any
  plugin receiving one of these shapes across a real boundary (parsed config,
  a tool argument, a file, a wire message) must validate it there, per
  `workbench/AGENTS.md` §3 ("Trust TypeScript at typed same-process
  boundaries; validate at real boundaries").
