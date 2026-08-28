# @mrpl/dsh-workbench-rag

Permission-aware retrieval plugin for the Sovereign AI Workbench. Embeds a
query, searches an on-disk JSONL vector index, authorizes candidates via
`ctx.wbPolicy.evaluate()` BEFORE reranking, reranks via
`ctx.wbModelGateway.resolve('rerank')`, and returns `WbRagResult` + emits
`wb/rag/retrieved`.

## Pipeline

```
embed → query index → authorize candidates → rerank → return
```

Authorization happens BEFORE reranking (DESIGN.md §9 invariant 2).

## Config

| Field | Type | Required | Description |
|---|---|---|---|
| `indexPath` | `string` | yes | Path to on-disk JSONL vector index file |

## ctx API

`ctx.wbRag` — implements `WbRagService` from `@mrpl/dsh-workbench-types`.

- `retrieve(request: WbRagRequest): Promise<WbRagResult>` — full pipeline:
  embed query, search index, authorize, rerank, return.

## Events

| Event | Payload | When |
|---|---|---|
| `wb/rag/retrieved` | `WbRagResult` | Once per `retrieve()` call |

## Key Behaviors

- **Missing index file** (ENOENT): returns empty result, not an error.
- **Non-ALLOW decisions**: all non-ALLOW `WbDecisionKind` values (DENY,
  REQUIRE_APPROVAL, ALLOW_WITH_REDACTION, ALLOW_METADATA_ONLY) exclude chunks
  from `chunks`/`citations` and appear in `filtered` with reason.
- **Citations mirror chunks**: `citations` is a strict mirror of `chunks` only
  — the agent must not cite text it never received.
- **Embedding/rerank through gateway**: capabilities resolved via
  `ctx.wbModelGateway`, not `ctx.llm`.
- **destination: 'local'**: policy requests specify local/on-premises
  destination.
- **No short-circuit on missing clearance**: always calls
  `ctx.wbPolicy.evaluate()` — policy is the single decision point.

## Dependencies

- `@mrpl/dsh-workbench-types` — shared types (`WbPolicyRequest`,
  `WbPolicyResponse`, `WbDecisionKind`, `WbModelGateway`, `WbRagRequest`,
  `WbRagResult`, `WbCitation`, `WbFilteredChunk`, branded ids)
- `@deepseek-ai/cordis` — peer dependency (plugin system)
- `@deepseek-ai/schemastery` — peer dependency (Config schema)

## Testing

17 vitest unit tests covering:

- All policy decision kinds (ALLOW, DENY, REQUIRE_APPROVAL,
  ALLOW_WITH_REDACTION, ALLOW_METADATA_ONLY)
- Citation/chunk symmetry
- Event emission
- Empty and missing index files
- Effect cleanup on fiber disposal

```sh
pnpm run test
```

## Build

```sh
pnpm run typecheck
pnpm run lint
pnpm run test
pnpm run build   # tsc emits lib/ (tsdown is a workbench-wide concern)
```
