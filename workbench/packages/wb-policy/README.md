# @mrpl/dsh-workbench-policy

Central policy gateway for the Sovereign AI Workbench. Evaluates every tool call against a configurable classification × capability matrix and publishes all decisions as events for audit.

## Purpose

Provides the `ctx.wbPolicy.evaluate(request)` method for direct policy checks and registers a `tools/pre-execute` listener to gate all tool calls automatically. The plugin resolves the user identity, checks tool manifests, looks up the classification × capability matrix, and applies role overrides before returning an `ALLOW`, `DENY`, or `REQUIRE_APPROVAL` decision.

## Service API

Access via `ctx.wbPolicy`:

```typescript
// Evaluate a policy request
const decision = await ctx.wbPolicy.evaluate({
  user: asWbUserId('user-1'),
  agentPreset: 'document-analyst',
  action: 'invoke_tool',           // 'send_data' | 'read_data' | 'invoke_tool' | 'model_request'
  classification: 'CONFIDENTIAL',  // 'PUBLIC' | 'INTERNAL' | 'CONFIDENTIAL' | 'RESTRICTED'
  destination: 'internet',         // 'local' | 'internal' | 'internet' | 'external_api'
  tool: 'web_search',              // optional tool name
})

// decision.decision: 'ALLOW' | 'DENY' | 'REQUIRE_APPROVAL' | 'ALLOW_WITH_REDACTION' | 'ALLOW_METADATA_ONLY'
// decision.reason: human-readable reason string
```

## Config

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `matrix` | `PolicyMatrix` | §5 default matrix | Classification × capability matrix (4 classifications × 7 capabilities) |
| `roleOverrides` | `RoleOverrides` | `{}` | Per-role overrides applied on top of the matrix |

### §5 Default Matrix

| Capability | PUBLIC | INTERNAL | CONFIDENTIAL | RESTRICTED |
|---|---|---|---|---|
| Local model inference | ALLOW | ALLOW | ALLOW | ALLOW |
| Internal RAG / documents | ALLOW | ALLOW | ALLOW | ALLOW |
| Local code sandbox | ALLOW | ALLOW | ALLOW | ALLOW |
| Internal DB / internal API | ALLOW | ALLOW | ALLOW | REQUIRE_APPROVAL |
| Web search | ALLOW | ALLOW | REQUIRE_APPROVAL | DENY |
| External API | ALLOW | REQUIRE_APPROVAL | DENY | DENY |
| External upload / egress | ALLOW | DENY | DENY | DENY |

### Action + Destination → Capability Mapping

| Action | Destination | Capability |
|---|---|---|
| `model_request` | any | `local_model_inference` |
| `read_data` | any | `internal_rag` |
| `invoke_tool` | `local` | `local_code_sandbox` |
| `invoke_tool` | `internal` | `internal_db_api` |
| `invoke_tool` | `internet` | `web_search` |
| `invoke_tool` | `external_api` | `external_api` |
| `send_data` | `local` | `internal_rag` |
| `send_data` | `internal` | `internal_rag` |
| `send_data` | `internet` | `external_upload` |
| `send_data` | `external_api` | `external_upload` |

Unsupported action + destination combinations are rejected with `DENY`.

## Events

Emits:
- `wb/policy/decision` — every `evaluate()` call, including ALLOW decisions, for audit logging

## Extension Points

- **`tools/pre-execute`** — The plugin registers a waterfall listener that maps `evaluate()` results to `PreToolDecision` (`allow` / `deny` / `ask`). REQUIRE_APPROVAL routes through the harness auto-resolve mechanism (`ctx.approval.request()`).

## Behavior

1. **Identity resolution**: Looks up the user via `ctx.wbIdentity.current()`. Denies with `IDENTITY_UNRESOLVED` if unavailable.
2. **Tool manifest check** (for `invoke_tool`): Looks up the tool via `ctx.wbToolGateway.getManifest()`. Denies with `NO_MANIFEST` if the tool has no registered manifest.
3. **Clearance ceiling check**: If the user's clearance is below the tool's data classification ceiling, denies with `CLEARANCE_INSUFFICIENT`.
4. **Capability resolution**: Maps action + destination to a matrix capability key.
5. **Role override**: Checks the user's role against `roleOverrides` before falling back to the matrix.
6. **Matrix lookup**: Resolves the decision from the classification × capability matrix.
7. **Fail-closed default**: If no rule matches, denies with `NO_RULE`.

## Design Notes

- **ALLOW_WITH_REDACTION / ALLOW_METADATA_ONLY**: Cannot be enforced in `tools/pre-execute` (which only supports allow/deny/ask). These require direct `evaluate()` calls by components capable of enforcing those restrictions (e.g., RAG/data layer). For the pre-execute hook, these are treated as allow.
- **Fail-closed**: Unknown classifications, unsupported combinations, and missing matrix entries all produce DENY.
- **HMR-safe**: All registrations go through `ctx.effect()` and are disposed cleanly on plugin unload.

## Model Experience

Indirectly, through `wb-policy`/`wb-tool-gateway` — the policy gateway determines which tools the model may invoke but does not inject context into model requests.

## Known Limitations and Deferred Work

- **Tool classification hardcoded to PUBLIC**: `buildRequestFromExecution()` defaults to `classification: 'PUBLIC'`. The tool's actual data classification should come from the manifest or a classification service; currently the manifest's `dataClassificationCeiling` is checked separately but the matrix lookup always uses PUBLIC.
- **Role overrides require user identity**: Role-based overrides depend on `ctx.wbIdentity` being available. Without it, all requests are denied.
