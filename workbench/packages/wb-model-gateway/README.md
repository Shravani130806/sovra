# @mrpl/dsh-workbench-model-gateway

Capability-based model routing for the Sovereign AI Workbench.

## Service API

Provides `ctx.wbModelGateway` implementing `WbModelGatewayService`:

```ts
interface WbModelGatewayService {
  resolve(capability: WbModelCapability): WbModelHandle
}
```

- `capability` — one of `'reasoning' | 'vision_reasoning' | 'embedding' | 'rerank' | 'ocr'`
- Returns `{ adapterId: string, capability: WbModelCapability }` — the mounted adapter id the caller then uses through `ctx.llm`

`resolve()` is a pure lookup: it never calls a model or makes a network request.

## Config

```ts
interface Config {
  routing: Record<WbModelCapability, string>
}
```

Maps each `WbModelCapability` to the cordis.yml `id` of a mounted harness adapter. Example from `workbench.cordis.yml`:

```yaml
- id: wb-model-gateway
  name: '@mrpl/dsh-workbench-model-gateway'
  config:
    routing:
      reasoning: llm-deepseek
      vision_reasoning: llm-vision-local
      embedding: embedding-local
      rerank: reranker-local
      ocr: llm-vision-local
```

Adding a new open-weight model is one new row in the base bundle plus one line here — never a code change (DESIGN.md §6.4).

## Validation behavior

At boot (`apply()` time), every routing entry is validated against the live Cordis context:

1. **Adapter existence**: each `routing` entry must name an adapter that is genuinely mounted in `ctx.llm` (verified via `ctx.llm.listProviders()`). A routing entry naming an unmounted adapter throws at plugin load, never at first `resolve()` call.

2. **Schemastery config shape**: the `routing` object must contain exactly the five `WbModelCapability` keys. Missing required keys are rejected by Schemastery. Extra unknown keys are silently stripped (Schemastery default behavior).

3. **Capability compatibility** (partial — see Deviations below): for `'reasoning'` and `'vision_reasoning'`, the harness adapter type system provides partial modality signals. For `'embedding'`, `'rerank'`, and `'ocr'`, validation is existence-only — the adapter is mounted but no capability-type signal exists.

## Events

None. This plugin does not emit events.

## Deviations from DESIGN.md §7

**Adapter capability validation gap**: The harness `LlmAdapter`/`LlmModelInfo` type system exposes `inputModalities?: ('text' | 'image')[]` and `reasoning?: LlmModelReasoningInfo`, but has no concept of `'embedding'`, `'rerank'`, or `'ocr'` adapter types. There is no adapter-level `purpose` or `capabilityKind` field.

- For `'reasoning'`: validated via `resolveModelInfo()` reasoning field (if adapter supports it).
- For `'vision_reasoning'`: validated via `inputModalities` including `'image'`.
- For `'embedding'`, `'rerank'`, `'ocr'`: existence-only — adapter is mounted in `ctx.llm.listProviders()`, but no capability-type check is possible.

This satisfies DESIGN.md §9 invariant 5 ("a missing/misconfigured routing entry fails at boot") without requiring a capability signal the harness doesn't expose. See DESIGN.md §12 for the gap entry.
