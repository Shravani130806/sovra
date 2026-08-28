# @mrpl/dsh-workbench-audit

Append-only provenance log of every decision and tool call in the Sovereign AI Workbench.

## Purpose

Records `WbAuditEntry` objects to daily-rotated JSONL files (`audit-YYYY-MM-DD.jsonl`) under `$DSH_HOME/workbench/audit/`. Subscribes to workbench and harness events to automatically log:

- **tool_result**: Tool call results from `session/event` with `type: 'tool/result'`
- **session_event**: Other session events (excluding high-volume types)
- **rag_retrieval**: RAG retrieval completions from `wb/rag/retrieved`

Skipped event kinds (no valid `WbAuditEntry` can be constructed):
- `wb/policy/decision` — lacks `sessionId`/`userId` in payload
- `wb/ingestion/completed` — lacks `sessionId`/`userId` in payload

High-volume session events skipped to avoid flooding the log:
- `assistant/chunk`
- `request/header`
- `request/context`
- `session/end-seed`

## Service API

Access via `ctx.wbAudit`:

```typescript
// Record an audit entry
ctx.wbAudit.record({
  sessionId: asWbSessionId('s1'),
  userId: asWbUserId('u1'),
  kind: 'tool_result',
  summary: 'Tool result for call in step 1',
  payload: { /* event data */ },
})

// Query audit entries
const entries = ctx.wbAudit.query({
  sessionId: asWbSessionId('s1'),  // optional filter
  userId: asWbUserId('u1'),        // optional filter
  kind: 'tool_result',             // optional filter
})
```

## Config

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `root` | `string` | `$DSH_HOME/workbench/audit` | Directory for JSONL audit files |

## Events

Listens to:
- `session/event` — harness session events
- `wb/rag/retrieved` — RAG retrieval completions
- `wb/policy/decision` — policy decisions (skipped, see Deviations)
- `wb/ingestion/completed` — ingestion completions (skipped, see Deviations)

## Deviations from DESIGN.md

- `wb/policy/decision` and `wb/ingestion/completed` events lack `sessionId` and `userId` fields required by `WbAuditEntry`. These event kinds are currently skipped during recording. Tracked in DESIGN.md §12.