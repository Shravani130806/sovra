# Build `wb-presets` — Agent preset compositions

You are building **one** unit inside a larger multi-agent build: the
Sovereign AI Workbench, a set of Cordis plugins mounted on top of the
DeepSeek Harness agent runtime. Eleven other agents are independently
building the other units; you will never see their code and they will
never see yours. Unlike the other eleven, **this unit is config authorship,
not TypeScript** — you write zero service code. Because you only reference
other units by their frozen `ctx` keys and `wb_*` tool names (never their
source), you can complete this correctly even if none of the other eleven
plugins have been built yet.

## Required reading, in this order

1. `workbench/DESIGN.md` — read in full once for context, then read §6.12
   ("`wb-presets` — Agent compositions") closely; it is your contract card
   — it has the exact table of which preset composes which tools. Also read
   §1 (the reconciliation table — several "agent capabilities" already exist
   in the harness, e.g. code sandbox and web search; you compose those too,
   not just workbench-built tools), §5 (classification matrix — your
   personas must describe this accurately to the model), §7.5 (frozen
   `wb_*` tool names), §8 (composition — how the backend bundle mounts
   before presets are selected), and §12.
2. `workbench/AGENTS.md` — general build process, and **§7** ("If you are
   `wb-presets`") specifically — read it closely, it overrides the general
   package-skeleton instructions in §2-§3 for you.
3. `workbench/packages/wb-types/src/index.ts` — skim for the frozen
   `WbClassification`/tool-adjacent types so your persona text describes
   them accurately; you don't import this package (no TypeScript here), you
   just need to be consistent with it in prose.
4. Find and read two real example compositions in this repo:
   `examples/headless-agent/cordis.yml` and
   `examples/jsonrpc-agent/cordis.yml` (or whichever two `cordis.yml`
   example files this repo actually ships — confirm the real paths by
   listing `examples/`). Study their `id`/`name`/`config` row shape, comment
   style, and how a persona/system-prompt string is set.
5. `docs/architecture.md` (repo root) — read the "Profiles and bundles"
   section for how a preset composes over a base profile, and confirm the
   real CLI invocation shape for selecting one (e.g.
   `dsh --profile web --preset <name>`) — use the actual flag names this
   repo documents, not the illustrative ones in `DESIGN.md` §8.
6. Find the harness's own `packages/preset` (or equivalently-named) package
   in this repo and read its README for the exact preset-file schema/
   discovery convention (file naming, required top-level keys) before
   writing anything — your five files must be valid input to whatever that
   package actually expects, not to a guessed schema.

## Your role

Produce five preset **directories** under `workbench/cordis/presets/`, each
containing an `agent.cordis.yml`, per the table in `DESIGN.md` §6.12:

| Directory | Composes | Capability shape |
|---|---|---|
| `document-analyst/agent.cordis.yml` | `wb-rag`, harness `read`/`glob`/`grep` (read-only), citation-required persona | Files ✓ RAG ✓ Vision ○ Python ✗ |
| `engineering-vision/agent.cordis.yml` | `wb-rag`, `wb_vision_analyze`, `wb_ocr_extract`, `read`/`glob`/`grep` | Files ✓ RAG ✓ Vision ✓ Python ✓ |
| `code-analysis/agent.cordis.yml` | harness `e2b`/`code-runtime`, `read`/`write`/`edit`, `wb-rag` (spec lookup) | Files ✓ RAG ✓ Python ✓ Web ✗ |
| `research/agent.cordis.yml` | harness `web_search`/`web_fetch` (gated PUBLIC-only by `wb-policy`), `wb-rag` | RAG ✓ Web ✓* External API ✗ |
| `artifact/agent.cordis.yml` | `wb-rag`, the `wb_generate_*` tool family | Files ✓ RAG ✓ Artifacts ✓ |

**The directory form is mandatory, not stylistic.** Harness preset discovery
(`packages/preset/agent-presets/src/discovery.ts`) defines
`COMPOSITION_FILE = 'agent.cordis.yml'` and takes the *directory name* as the
preset id; a flat `<name>.cordis.yml` is ignored by `scanRoot()` and the
preset never appears in the roster. An earlier revision of `DESIGN.md`
specified flat files — it has been corrected; if you find flat files already
present under `cordis/presets/`, converting them is part of your job.

Tool columns name **registered tool names**, not package names: `read`,
`glob`, `grep`, `web_search`, `web_fetch` are tools; `tool-fs` and `tool-web`
are the packages that register them (`DESIGN.md` §6.7 has the verified
table). Referencing `dsh-tool-fs` where a tool name belongs produces a preset
that composes nothing.

Note also that the `dsh-web-app` bundle
(`packages/bundle/web-app/cordis.patch.yml`) disables many harness tools at
the host level, on the assumption each session's preset re-enables what its
persona needs — so a preset that wants `read` or `web_search` must carry an
explicit row re-enabling it.

Each file needs, per `DESIGN.md` §6.12 and `AGENTS.md` §7:
- A header comment naming the persona and what it may/may not touch.
- A `persona`/system-prompt string that explicitly tells the model which
  tools it has **and that every action is policy-governed** — this sentence
  is what makes governance visible in the product; do not omit it or write
  it vaguely (e.g. state plainly that tool calls may be denied by policy and
  the agent should explain that to the user rather than retry silently).
- Only tool/`ctx` names that exist in `DESIGN.md` §7 or are documented real
  harness packages you confirmed in reading item 4/6 above — never a name
  you're not sure exists.

## Faking your dependencies for "tests"

You have no service code, so there is nothing to unit-test with vitest. Your
equivalent of "tests" is a set of **structural assertions about each preset
file**, written before you write the file's real content, exactly like a
checklist-as-code:

- Every tool name referenced in the file appears verbatim in `DESIGN.md`
  §7.5 (for `wb_*` tools) or in your reading-item-4/6 confirmed list of real
  harness tool names (for `dsh-tool-fs`, `dsh-tool-web`, `e2b`/
  `code-runtime`).
- The file is valid YAML and matches the real preset schema from reading
  item 6 (not a guessed shape).
- The persona string contains an explicit statement that tool calls are
  policy-governed and may be denied.
- The file's composed capability set matches its row in the table above —
  i.e. `code-analysis.cordis.yml` does not accidentally include
  `dsh-tool-web`, `research.cordis.yml` does not accidentally include a
  `wb_generate_*` tool, etc.

## Non-goals — do not build these

- No TypeScript, no `package.json`, no `ctx` service of any kind.
- No new capability that doesn't already exist somewhere in `DESIGN.md` §7
  or the harness itself — if a preset "needs" something that doesn't exist
  yet, that is a missing plugin, not a reason to write ad hoc config that
  references a name nobody else will implement. Flag it in `DESIGN.md` §12
  instead and build the preset as close to the intended capability as
  currently possible, noting the gap in your own notes.

## Workflow — checklist first, then the five files, then verification

**Step 1 — write your structural checklist (the "tests")** before writing
any preset file's real content: for each of the five files, list out
exactly which tool/`ctx` names it will reference and confirm each one
against `DESIGN.md` §7.5 or your confirmed real-harness-name list from
reading items 4/6. Write this checklist down (a plain markdown scratch file
is fine, or inline comments at the top of each `cordis.yml` before you fill
in the rest) so it's checkable, not just something you did mentally.

**Step 2 — write the five `cordis.yml` files**, one at a time, checking each
against its own checklist entry as you go.

**Step 3 — expand your checklist** for anything you notice while writing
(e.g. `research.cordis.yml` needs to make the PUBLIC-only web gating
explicit in its persona text, not just rely on `wb-policy` silently
enforcing it — the whole point per `DESIGN.md` §6.12 is that governance is
*visible*, so say so in the prompt text itself).

**Step 4 — verify.** Since there's no vitest suite here, verification is:
1. Re-run your Step 1 checklist against the final files and confirm every
   item passes.
2. If the harness provides a config-validation/dry-run command (check
   `docs/architecture.md` and the harness's own CLI `--help` output or
   `docs/cli.md`-equivalent for something like a `--dump-config` or
   `--validate` flag), run it against each preset composed over
   `workbench/cordis/workbench.cordis.yml` and confirm no error. If no such
   command exists in this repo, say so explicitly in your README rather than
   fabricating a command that doesn't exist.
3. `pnpm run lint` at the repo root if it lints YAML/config files (check
   `docs/architecture.md`/root `AGENTS.md` "Commands" for whether this
   applies to `workbench/cordis/**`); if not applicable, note that too.

**Step 5 — self-check** against `AGENTS.md` §9 (the parts that apply to a
config-only deliverable — the checklist bullets about `ctx` keys/tool names
matching the frozen contract still apply directly), then write
`workbench/cordis/presets/README.md` documenting each preset's purpose,
composed capabilities, and persona intent, plus a "Deviations" section for
any preset schema detail you had to infer.

## If you hit a gap

Do not invent a workbench-wide name to fill it. Note it under "Deviations"
in your `README.md` and append a dated bullet to `DESIGN.md` §12.
