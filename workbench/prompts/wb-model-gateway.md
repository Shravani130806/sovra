# Build `wb-model-gateway` — Model Gateway plugin

You are building **one** plugin inside a larger multi-agent build: the
Sovereign AI Workbench, a set of Cordis plugins mounted on top of the
DeepSeek Harness agent runtime. Eleven other agents are independently
building the other plugins; you will never see their code and they will
never see yours. The only thing that lets your work integrate correctly
later is that you follow the frozen contract below exactly, without
improvising names.

## Required reading, in this order

1. `workbench/DESIGN.md` — read in full once for context, then read §6.4
   ("`wb-model-gateway` — Model Gateway") closely; it is your contract card.
   Also read §4, §7 in full, §8 (composition — the `routing` config example
   under `wb-model-gateway` in `workbench.cordis.yml`), §9 (invariant 5: a
   missing/misconfigured routing entry must fail at boot, never fall back
   silently), and §12.
2. `workbench/AGENTS.md` — general build process, coding conventions, §9
   "done" checklist.
3. `workbench/packages/wb-types/src/index.ts` — frozen shared types. Import
   `WbModelCapability` and `WbModelHandle`; never redefine them.
4. `docs/cookbook/adding-an-llm-adapter.md` (repo root) — read this to
   understand what a mounted `llm-*` (or embedding/reranker) plugin looks
   like *from the outside*: its Cordis `id`, what capability/service it
   registers on `ctx`. You are not writing a new adapter; you are writing
   the thing that picks between already-mounted ones.
5. `docs/testing.md` (repo root) — "Unit" tier and "Prefer the real
   implementation over a mock" sections.
6. Skim `packages/extensions/tool-cordis/tests/cordis-lifecycle.spec.ts` for
   Cordis testing idioms.

## Your role

Resolve *"I need `vision_reasoning`"* to *"use the adapter mounted at id
`llm-vision-local`"* — so no other workbench plugin ever hardcodes a model
name, and adding a new open-weight model later is a config change, not a
code change (this is the literal mechanism behind the PS requirement quoted
in `DESIGN.md` §6.4).

- Package: `@mrpl/dsh-workbench-model-gateway`, at
  `workbench/packages/wb-model-gateway/`.
- Provides: `ctx.wbModelGateway` implementing `WbModelGatewayService` from
  `wb-types` (`resolve(capability: WbModelCapability): WbModelHandle`).
- `Config`: a `routing` map from each `WbModelCapability` value
  (`'reasoning' | 'vision_reasoning' | 'embedding' | 'rerank' | 'ocr'`) to the
  Cordis `id` string of a mounted adapter — see the example block under
  `wb-model-gateway` in `workbench/cordis/workbench.cordis.yml`.
- **At `apply()` time**, validate every configured `routing` entry against
  what is actually present in the live `ctx` (i.e. an adapter with that `id`
  is genuinely mounted and exposes a capability compatible with the declared
  `WbModelCapability`). A `routing` entry naming an unmounted or
  incompatible `id` must throw at plugin load — this is a hard requirement,
  not a nice-to-have; `DESIGN.md` §9 invariant 5 depends on it.
- `resolve()` itself does not call a model — it only returns a
  `WbModelHandle` (`{ adapterId, capability }`) that the *caller* then uses
  through the harness's own `ctx.llm` Service Consumer role. You do not
  reimplement LLM streaming.

## Dependencies you consume

- The harness's own mounted `llm-*` (and embedding/reranker) adapters via
  `ctx.llm` or whatever the real capability/service surface is in this repo
  (find it — read `docs/cookbook/adding-an-llm-adapter.md` and, if needed,
  one real `llm-*` package under `packages/` — do not guess at the shape).
  This is real, not faked, in your integration-style tests; use the real
  harness `Context` and mount a couple of minimal stub `llm-*`-shaped test
  plugins (registering the same capability surface a real adapter would) so
  your validation-at-load logic is exercised against something real, per
  "prefer the real implementation over a mock" — a stub adapter that
  registers the genuine capability interface is fine; a hand-rolled fake of
  *your own* resolve logic is not what's being tested here.

## Non-goals — do not build these

- No new LLM adapter, no new model, no quantization logic — that's
  `docs/cookbook/adding-an-llm-adapter.md` territory and out of scope here.
- No policy/classification logic — you don't decide *whether* a model may be
  used for a given request, only *which mounted adapter* answers a given
  capability request. (`wb-policy`, a sibling plugin, decides the former.)
- No caching/retry/fallback-to-a-different-model-on-error logic unless
  `DESIGN.md` §6.4 explicitly calls it out (it doesn't) — keep `resolve()`
  a pure lookup against validated config.

## Workflow — tests first, then implementation, then verification

**Step 1 — write failing tests before any implementation.** At minimum:
- Each of the five `WbModelCapability` values resolves to the correct
  `WbModelHandle.adapterId` per a fixture `routing` config, against a live
  `Context` with matching stub adapters mounted.
- A `routing` entry naming an `id` that is **not** mounted throws at plugin
  `apply()` time — assert the plugin fails to load, not that `resolve()`
  throws later on first use.
- A `routing` entry naming an `id` that **is** mounted but does not expose a
  capability compatible with the declared `WbModelCapability` (e.g. an
  embedding-only adapter mapped to `'reasoning'`) also fails loudly at load.
- A capability with no `routing` entry at all fails loudly at load (missing
  config is misconfiguration, not a runtime `undefined`).
- `resolve()` never itself makes a network/model call — assert this by *not*
  giving your stub adapters any way to be "called" and confirming tests
  still pass (i.e. `resolve()` alone should never trigger anything on the
  stub beyond a capability-presence check).
- HMR-safety test per `docs/testing.md`.

**Step 2 — implement** the minimum plugin code to pass those tests.

**Step 3 — expand tests** for edge cases found while implementing (e.g. two
capabilities pointing at the same `id` — should be allowed, since one
adapter can serve multiple capabilities; a `routing` config with an unknown
capability key not in the `WbModelCapability` union — should fail Schemastery
validation, not silently ignore the extra key).

**Step 4 — verify**, from `workbench/packages/wb-model-gateway/`:
```
pnpm install
pnpm run typecheck
pnpm run lint
pnpm run test
pnpm run build
```

**Step 5 — self-check** against `AGENTS.md` §9, then write `README.md` per
`AGENTS.md` §8 (service API, config shape with a worked example, validation
behavior, and a "Deviations" section noting exactly which harness LLM
capability surface you integrated against).

## If you hit a gap

Do not invent a workbench-wide name to fill it. Note it under "Deviations"
in your `README.md` and append a dated bullet to `DESIGN.md` §12.
