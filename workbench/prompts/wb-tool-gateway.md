# Build `wb-tool-gateway` — Controlled Tool Execution plugin

You are building **one** plugin inside a larger multi-agent build: the
Sovereign AI Workbench, a set of Cordis plugins mounted on top of the
DeepSeek Harness agent runtime. Eleven other agents are independently
building the other plugins; you will never see their code and they will
never see yours. The only thing that lets your work integrate correctly
later is that you follow the frozen contract below exactly, without
improvising names.

## Required reading, in this order

1. `workbench/DESIGN.md` — read in full once for context, then read §6.7
   ("`wb-tool-gateway` — Controlled Tool Execution") closely; it is your
   contract card. Also read §4, §7 in full (especially `WbToolManifest`,
   `WbToolRiskLevel`, `WbToolNetworkAccess`), §7.5 (the frozen `wb_*` tool
   name table — the tools that will register manifests with you), and §12.
2. `workbench/AGENTS.md` — general build process, §4 ("If your plugin
   registers a model-facing tool" — read this even though you don't register
   tools yourself, because you consume manifests from plugins that do), §9
   "done" checklist.
3. `workbench/packages/wb-types/src/index.ts` — frozen shared types. Import
   `WbToolManifest`, `WbToolRiskLevel`, `WbToolNetworkAccess`; never redefine
   them.
4. `docs/cookbook/adding-a-tool.md` (repo root) — read in full. You need to
   understand the tool registration API (`ctx.tools.register`,
   `defineTool`) well enough to know what a tool "name" is and how a
   registry/directory-style plugin conventionally sits alongside it in this
   repo.
5. `docs/testing.md` (repo root) — "Unit" tier and "Prefer the real
   implementation over a mock" sections.
6. Skim `packages/extensions/tool-cordis/tests/cordis-lifecycle.spec.ts` for
   Cordis testing idioms.

## Your role

Own the **tool manifest directory** — structured metadata about every tool
in the system — so `wb-policy` (a sibling plugin) has something to evaluate
instead of guessing from a tool's name string, and so adding a 13th tool
later never requires touching `wb-policy`'s code.

- Package: `@mrpl/dsh-workbench-tool-gateway`, at
  `workbench/packages/wb-tool-gateway/`.
- Provides: `ctx.wbToolGateway` implementing `WbToolGatewayService` from
  `wb-types` (`registerManifest(manifest)`, `getManifest(toolId)`).
- This is a **directory, not an executor** — you never intercept or run a
  tool call yourself (that's `wb-policy`'s job, hooking the harness's
  `tools/pre-execute`). You only answer "what kind of thing is this tool."
- For harness-native tools that will never call `registerManifest`
  themselves, ship a `Config`-driven static table mapping their registered
  tool names to a manifest, so they are governed too — `DESIGN.md` §6.7
  requires this explicitly (the capability matrix in `Plugin_design_idea`
  covers Files/Python/Web/DB for every agent, not just workbench-added
  tools).

  **Key this table on the tool's registered name, never its package name.**
  `dsh-tool-fs` / `tool-fs` is a package; the names that actually arrive at
  `tools/pre-execute` are `read`, `write`, `edit`, `read_image`. This is the
  single most likely way to get this plugin wrong, and it does not fail
  visibly: `wb-policy` denies any tool with no manifest (`NO_MANIFEST`), so a
  table keyed on package names denies *every* harness tool call and reads
  like a policy bug.

  `DESIGN.md` §6.7 now carries the verified name table — use it as your
  starting set, and re-derive it yourself from each package's `defineTool`
  call (`grep -rhoE "name: '[a-z0-9_]+'" packages/<group>/<pkg>/src`) rather
  than trusting either document blindly. Scope the table to the `tool-*` rows
  the base bundle actually mounts
  (`grep -nE "^\s*- id: tool-" packages/bundle/base/cordis.patch.yml`).

  Two specifics you must handle explicitly, not discover late:
  - `bash` is registered by **both** `shell/tool-bash` and
    `shell/tool-bash-persistent`. Your table is keyed by tool name, so one
    `bash` manifest governs both packages — this is not a duplicate
    registration, and it must not collide with whatever duplicate-handling
    rule you choose below.
  - `read_image` (in `fs/tool-fs`) reads image bytes, so its
    `dataClassificationCeiling` deserves separate thought from `read`.

## Dependencies you consume

None at the service level — you are a leaf directory. `registerManifest`
callers (`wb-vision`, `wb-artifacts`, siblings you won't see built) and the
reader (`wb-policy`, also a sibling) only need your public interface, which
is already frozen in `wb-types`. You do not need to fake anything to test
your own plugin in isolation — write test manifests inline.

## Non-goals — do not build these

- No ALLOW/DENY decision logic of any kind — that belongs entirely to
  `wb-policy`. If you find yourself writing an `if (riskLevel === ...)
  deny()`, stop — that's the wrong plugin.
- No tool execution, no `tools/pre-execute` hook of your own — you are read
  as data by whatever plugin *does* hook that (`wb-policy`), you don't hook
  it yourself.
- Do not silently invent a manifest for an unknown tool — `getManifest` for
  an unregistered, non-static-table tool name returns `undefined`; let the
  caller (`wb-policy`) decide what to do with that. `wb-policy` as built
  already turns `undefined` into `DENY` (`reason: "NO_MANIFEST"`), so the
  safe default already exists — in the right plugin. Do not add a second one
  here. (`AGENTS.md` §4 point 3 previously misattributed that default-deny to
  this plugin; it has been corrected.)

## Workflow — tests first, then implementation, then verification

**Step 1 — write failing tests before any implementation.** At minimum:
- `registerManifest(manifest)` followed by `getManifest(manifest.toolId)`
  returns the same manifest.
- `getManifest` for a name that was never registered and isn't in the
  static harness-native table returns `undefined` — not a default/guessed
  manifest.
- Every harness-native tool name in your static table resolves to a
  manifest with `riskLevel`/`dataClassificationCeiling`/`networkAccess`
  values that make sense for what that tool actually does (e.g. a raw
  filesystem write tool should not default to `networkAccess: 'external'`,
  a web-search tool should not default to `riskLevel: 'local'`) — write one
  assertion per harness-native tool you cover, naming it explicitly so a
  reviewer can see your reasoning per tool.
- `registerManifest` called twice for the same `toolId` with different
  content: decide and test one explicit behavior (last-write-wins, or throw
  on duplicate) — do not leave this undefined behavior; document your choice
  in the README. Test this separately from the static table: a
  `registerManifest` call for a `toolId` the static table already covers is a
  distinct case (which wins?), and you must decide and test that too.
- A manifest with a `toolId` that doesn't match the harness's own registered
  tool name for that tool is still stored as given (you don't cross-validate
  against the live tools registry — that's out of scope; note this
  explicitly if you considered and rejected doing so).
- HMR-safety test per `docs/testing.md`: dispose the fiber, assert
  previously `registerManifest`'d entries contributed *by that fiber* are
  gone (but note in your test whether static-table entries, which aren't
  fiber-scoped the same way, should survive — decide and assert one way).

**Step 2 — implement** the minimum plugin code to pass those tests.

**Step 3 — expand tests** for edge cases found while implementing.

**Step 4 — verify**, from `workbench/packages/wb-tool-gateway/`:
```
pnpm install
pnpm run typecheck
pnpm run lint
pnpm run test
pnpm run build
```

**Step 5 — self-check** against `AGENTS.md` §9, then write `README.md` per
`AGENTS.md` §8 (service API, the full static harness-native tool table with
your reasoning per entry, duplicate-registration behavior, and a
"Deviations" section for any harness-native tool name you couldn't confirm
from this repo's source and had to infer).

## If you hit a gap

Do not invent a workbench-wide name to fill it. Note it under "Deviations"
in your `README.md` and append a dated bullet to `DESIGN.md` §12.
