# workbench/AGENTS.md

*DeepSeek Harness reads `AGENTS.md` files as agent context (see the root
`AGENTS.md` and `docs/architecture.md` in this repo). This file governs
everything under `workbench/`. If you are an agent whose task is "build plugin
X for the Sovereign AI Workbench," this is your instruction manual. Read
`workbench/DESIGN.md` in full first — it is the contract this file tells you
how to implement.*

---

## 0. The one rule that matters most

**You are building exactly one package under `workbench/packages/<your-plugin>/`.
You will never see the other eleven plugins' source code, and they will never
see yours.** The only reason this works is that `DESIGN.md` §7 is frozen. So:

- Copy type names, `ctx` keys, event names, and tool names from `DESIGN.md` §7
  **character-for-character**. Do not "clean up" a name.
- If something you need isn't in `DESIGN.md` §7, do not invent it. Add a bullet
  to `DESIGN.md` §12 (Open Questions) describing the gap, implement the most
  conservative reasonable thing to unblock yourself, and say so clearly in your
  plugin's `README.md` under a "Deviations" heading. Do not guess at another
  plugin's internals to fill the gap.
- Never edit a file outside `workbench/packages/<your-plugin>/` — with the one
  exception that every plugin appends (never rewrites) to `DESIGN.md` §12 if it
  hits an open question, and `wb-presets` also writes to
  `workbench/cordis/presets/`.

If you take away nothing else: **the contract in `DESIGN.md` §7 is more
important than anything clever you could add.** A boring plugin that matches
the contract integrates on the first try. A clever plugin that drifts from it
breaks eleven other people's work.

---

## 1. Before you write any code

1. Re-read `DESIGN.md` §6.N for your specific plugin's contract card
   (purpose, provides, behavior, non-goals). That section is more detailed
   than this file for anything plugin-specific.
2. Skim (don't deep-read) these existing docs in this repo, only as needed for
   your plugin:
   - `docs/architecture.md` — Cordis, capability seams, events, turn flow.
   - `docs/cordis-primer.md` — if you've never used Cordis before.
   - `docs/cookbook/adding-a-package.md` — package skeleton and checklist.
   - `docs/cookbook/adding-a-tool.md` — **required** if your plugin registers
     a model-facing tool (`wb-vision`, `wb-artifacts`).
   - `docs/cookbook/adding-an-llm-adapter.md` — only if you are `wb-model-gateway`
     and need to understand what a mounted `llm-*` adapter looks like from the
     outside (you are not writing one).
3. Confirm which `ctx` keys your plugin **provides** and which it **consumes**
   from `DESIGN.md` §6's dependency table and §7.3. You only ever call a
   dependency's public service method — never reach into its internals.

---

## 2. Package skeleton

Every plugin (except `wb-presets`, see §7 below) is a standalone npm workspace
package following the harness's own convention
(`docs/cookbook/adding-a-package.md`), scoped to keep it clearly separate from
`@deepseek-ai/*` packages:

```
workbench/packages/<name>/
  package.json
  tsconfig.json
  src/
    index.ts        # plugin export: name / inject / apply / Config
    types.ts         # plugin-local types only (shared types live in wb-types)
    ...
  README.md          # what this plugin does, its ctx API, its config, its events
```

`package.json` — copy this shape, adjusting name/description/deps:

```json
{
  "name": "@mrpl/dsh-workbench-<name>",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "lib/index.js",
  "types": "lib/types/index.d.ts",
  "exports": {
    ".": { "types": "./lib/types/index.d.ts", "default": "./lib/index.js" }
  },
  "files": ["lib/index.js", "lib/types/**/*.d.ts"],
  "dependencies": {
    "@mrpl/dsh-workbench-types": "workspace:*"
  },
  "peerDependencies": {
    "@deepseek-ai/cordis": "workspace:*"
  },
  "devDependencies": {
    "@deepseek-ai/cordis": "workspace:*"
  }
}
```

Add `@deepseek-ai/schemastery` to `dependencies` if you declare a `Config`
(almost every plugin does). Add any harness package you `inject` (e.g.
`@deepseek-ai/dsh-tools` if you register tools) to both `peerDependencies` and
`devDependencies`, matching this repo's own rule in its root `AGENTS.md`
("Conventions" section) that every dsh peer dependency is mirrored in
`devDependencies`.

`tsconfig.json` extends the repo root config the same way an internal package
would:

```json
{
  "extends": "../../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "lib" },
  "references": [
    { "path": "../../../vendor/cosmokit" },
    { "path": "../../../vendor/cordis" },
    { "path": "../wb-types" }
  ]
}
```
(Add `../../../vendor/schemastery` to `references` if you use `Config`, and a
`{ "path": "../<dep>" }` row for every other `wb-*` package you depend on.)

---

## 3. The plugin itself: `name` / `inject` / `apply` / `Config`

Every workbench plugin is an ordinary Cordis plugin, exactly the shape shown
in `docs/cookbook/adding-a-tool.md`'s minimal example and every real package
under `packages/` in this repo:

```ts
import type { Context, Schema } from '@deepseek-ai/cordis'

export const name = 'wb-<your-plugin>'
export const inject = ['tools' /* only if you register tools */, /* other wb-* deps */]

export interface Config {
  // Schemastery-validated fields — see DESIGN.md §6.N "Behavior" for what
  // must be configurable for your plugin (routing tables, matrices, paths).
}

export const Config: Schema<Config> = Schema.object({
  // ...
})

export function apply(ctx: Context, config: Config) {
  // Register your ctx key here via a Cordis Service, or via ctx.effect()/
  // ctx.on() for events and tool registrations. Every registration is an
  // effect: disposing this plugin's fiber must cleanly unregister it.
}
```

Follow the harness's own hard rules from its root `AGENTS.md` — they apply to
`workbench/` too, since this is one Cordis app tree at runtime:

- **Registrations are effects.** Use `ctx.effect()` / `ctx.on()`; a registry's
  `register()` returns the disposer.
- **No hardcoded tunables.** Anything DESIGN.md's "Behavior" subsection says is
  configurable (the policy matrix, the model-capability routing table, storage
  paths) is a `Config` field, not a constant.
- **Misconfiguration fails loud at load** when it's self-contained (e.g. an
  invalid Schemastery shape) and at the earliest resolvable point otherwise
  (e.g. `wb-model-gateway` finding a `routing` entry that names an unmounted
  `id` — check this at `apply()` time against the live `ctx`, not lazily on
  first use).
- **Switch on discriminant tags** (`WbDecisionKind`, `WbClassification`, etc.)
  and end closed unions in `assertNever` so a future enum addition is a
  compile error everywhere it matters, not a silent no-op.
- **Opaque cross-plugin ids are branded.** Use `WbUserId`/`WbDocumentId`/etc.
  from `wb-types`, never a bare `string`, at any point one of these ids
  crosses your plugin's boundary.
- **Trust TypeScript at typed same-process boundaries; validate at real
  boundaries.** Don't runtime-validate a value TypeScript already guarantees
  from an in-process `ctx` call. Do validate anything arriving as parsed
  config, a model/tool JSON argument, a durable file, or an upload — i.e.
  `wb-ingestion`'s file input, and any tool's `args`, need real validation;
  `wb-rag` calling `wb-policy.evaluate(...)` does not need to re-check the
  shape of what it just constructed.
- **An empty `catch` names what it swallows** and why nothing else can reach
  it.
- **Do not comment on facts obvious from the code.** Say why, not what.

---

## 4. If your plugin registers a model-facing tool

Only `wb-vision` and `wb-artifacts` do this today. If that's your task:

1. Follow `docs/cookbook/adding-a-tool.md` exactly — `defineTool`, typed
   `parameters`, a structured `output.schema` (never a bare string when the
   result has fields another plugin or the UI needs), and a `presentCall`
   /`presentResult` pair suited to what the tool does (`generic` is the safe
   default; use `diff` only if you're literally writing a file).
2. Your tool's `name` must be the exact `wb_*` name from `DESIGN.md` §7.5. Do
   not add a new tool name without adding a row there first (§12 process).
3. Register a matching `WbToolManifest` via `ctx.wbToolGateway.registerManifest(...)`
   in the same `apply()`, right after `ctx.tools.register(...)`. A tool
   without a manifest is invisible to `wb-policy`. `wb-tool-gateway` is a
   directory, not a decider: `getManifest` returns `undefined` for a tool it
   has never been told about, and it is **`wb-policy`** that turns that
   `undefined` into `DENY` (`reason: "NO_MANIFEST"`). So forgetting this step
   doesn't create a security hole, but it does mean your tool will never
   actually run in the composed system. Test for this.
4. Honor `exec.signal` if your tool does any real work (OCR/vision calls,
   file generation) — cancel in-flight work when it fires, per the harness's
   `execute()` contract rules.
5. Do not build your own policy check inside the tool. `tools/pre-execute`
   already routes through `wb-policy` for every tool in the tree — adding a
   second, tool-local check is redundant and risks disagreeing with the
   central one.

---

## 5. If your plugin is a client (UI) plugin

Only `wb-ui` and `wb-admin-console`. Follow `packages/client/AGENTS.md` in
this repo for the client-side contract: extend `tsconfig.base.client.json`,
declare `dsh.client` in `package.json`, export `./client`, use the shared
`tsdown.client.ts` preset. Consume only the read-only integrations named in
`DESIGN.md` §6.10/§6.11 — a UI plugin has no `ctx` service of its own and no
other plugin should ever need to depend on it.

---

## 6. If you are `wb-types`

You are not really "building" a plugin — copy `DESIGN.md` §7.1–7.2 verbatim
into `workbench/packages/wb-types/src/index.ts`. Add nothing beyond what's
there. This package has:
- no `ctx`, no Cordis plugin export (no `name`/`inject`/`apply`),
- no runtime dependency beyond plain TypeScript,
- a `package.json` with no `peerDependencies` on `@deepseek-ai/cordis` at all.

Every other plugin lists `@mrpl/dsh-workbench-types` as a real `dependency`
(not `devDependency`) because the branded-id constructor functions
(`asWbUserId`, etc.) are called at runtime, not just used as types.

If you are the agent assigned to any *other* plugin and `wb-types` doesn't
exist yet in your workspace, create it yourself from `DESIGN.md` §7 verbatim
before starting your own plugin — do not redefine `WbUser`, `WbClassification`,
etc. locally "for now." A locally redefined copy is exactly the kind of drift
this whole document exists to prevent.

---

## 7. If you are `wb-presets`

Different shape entirely — no TypeScript, no `package.json`. Your deliverable
is the five `cordis.yml` files under `workbench/cordis/presets/` described in
`DESIGN.md` §6.12's table, each following the `id`/`name`/`config` row
convention used throughout this repo's own `examples/*/cordis.yml` (study
`examples/headless-agent/cordis.yml` and `examples/jsonrpc-agent/cordis.yml`
in this repo for the real pattern — persona strings, per-agent tool config,
comments explaining non-obvious choices).

Because you only reference other plugins by their frozen `ctx` keys and
`wb_*` tool names (never their source), you can do this task correctly even if
none of the other eleven plugins have been built yet — that's the point of
freezing the contract.

Each preset file needs:
- a short header comment stating which agent persona this is and what it may
  and may not touch (mirrors the harness's own comment style in its example
  compositions),
- a `persona` string in its `agent-spine`-equivalent config block that
  explicitly tells the model what tools it has and that every action is
  policy-governed (this is what makes governance visible in the product, per
  `DESIGN.md` §6.12),
- only tool/`ctx` names that exist in `DESIGN.md` §7 or are documented harness
  packages (`dsh-tool-fs`, `dsh-tool-web`, `e2b`/`code-runtime`).

---

## 8. Testing and verification — what "done" means

Run these from `workbench/packages/<your-plugin>/` (or the workspace root
scoped to your package, once workspaces are wired) before declaring your
plugin finished. This is a **subset** of the harness's own root checks
(`AGENTS.md` "Commands"), scoped to what a single new package actually needs:

```sh
pnpm install
pnpm run typecheck   # strict: true, noImplicitAny — no `any` without a comment
pnpm run lint
pnpm run test         # unit tests for your service methods / tool execute()
pnpm run build        # tsc emits lib/types, tsdown bundles runtime
```

Minimum test coverage for "done," matched to what your plugin actually is:

- A **service plugin** (`wb-identity`, `wb-policy`, `wb-audit`,
  `wb-model-gateway`, `wb-rag`, `wb-vision`, `wb-tool-gateway`, `wb-ingestion`,
  `wb-artifacts`): unit tests for every public method on your `ctx.wb*`
  service, covering at minimum the ALLOW and DENY (or equivalent success/
  failure) paths named in your `DESIGN.md` contract card. `wb-policy`
  specifically must have a test proving each row of the §5 matrix.
- A **tool-registering plugin** (`wb-vision`, `wb-artifacts`): a test that
  calls the tool through the registry (not by calling your internal function
  directly) so schema validation is exercised too, per this repo's own
  testing guidance in `docs/cookbook/adding-a-tool.md`.
- A **client plugin** (`wb-ui`, `wb-admin-console`): at minimum a smoke test
  that the security indicator flips on a `wb/policy/decision` DENY event.
- `wb-presets`: no unit tests; validate with `dsh --profile web --dump-config`
  (per `docs/architecture.md`) to confirm the composed tree boots without a
  misconfiguration error.

Write your `README.md` following the shape in `docs/cookbook/adding-a-package.md`
step 4 (service API, config, events, extension points, then a short "Model
Experience" note only if your plugin is genuinely model-visible — most
workbench plugins can use the "Indirectly, through wb-policy/wb-tool-gateway"
form rather than writing a full section).

---

## 9. Checklist before you say you're finished

- [ ] Every `ctx` key, event name, tool name, and type I used matches
      `DESIGN.md` §7 exactly — no local redefinitions of a frozen type.
- [ ] I did not edit any file outside `workbench/packages/<my-plugin>/`
      (or, for `wb-presets`, outside `workbench/cordis/presets/`), except
      possibly appending one dated bullet to `DESIGN.md` §12.
- [ ] Every registration (`ctx` service, event listener, tool) goes through
      `ctx.effect()`/`ctx.on()`/`ctx.tools.register()` — nothing leaks state
      outside the plugin's own lifecycle.
- [ ] Every `Config` field that `DESIGN.md` §6.N calls out as configurable is
      actually a `Config` field, not a constant.
- [ ] If I registered a tool: it has a matching `WbToolManifest`, its
      `output.schema` is structured (not a bare string), and it honors
      `exec.signal`.
- [ ] I did not add a policy check of my own — I call `ctx.wbPolicy.evaluate`
      or rely on `tools/pre-execute` already covering me; I did not duplicate
      or bypass it.
- [ ] `pnpm run typecheck && pnpm run lint && pnpm run test && pnpm run build`
      all pass from my package.
- [ ] My `README.md` documents my `ctx` API, `Config` schema, and events, and
      lists any deviation from `DESIGN.md` under a "Deviations" heading.
- [ ] If I hit something `DESIGN.md` §7 didn't cover, it's recorded in
      `DESIGN.md` §12 with my plugin name and today's date — I did not
      silently invent a name to route around the gap.

---

## 10. Changing the contract

If, while building your plugin, you become convinced `DESIGN.md` §7 is
actually wrong (not just incomplete) — e.g. a type is missing a field every
consumer will need — **do not silently redefine it.** Append the proposed
change to `DESIGN.md` §12 with your reasoning, implement your own plugin
against the *existing* contract in the meantime (even if a little awkward),
and flag it clearly in your `README.md`'s "Deviations" section so a human
integrator can decide whether to amend §7 for everyone before the next round
of plugin-building agents run.
