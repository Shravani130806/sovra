# `@mrpl/dsh-workbench-tool-gateway`

The **tool manifest directory** for the Sovereign AI Workbench. It answers one
question — *what kind of thing is this tool?* — so `wb-policy` evaluates
structured metadata instead of guessing from a tool's name string, and so
adding a thirteenth tool never requires editing `wb-policy`.

This is a **Directory, not an executor** (`docs/cookbook/adding-a-package.md`
draws that distinction). It makes no ALLOW/DENY decision, hooks no
`tools/pre-execute`, and never invents a manifest for a tool it has not been
told about.

## Service API

Provides `ctx.wbToolGateway`, implementing `WbToolGatewayService` from
`@mrpl/dsh-workbench-types` (DESIGN.md §7.3).

| Method | Behavior |
|---|---|
| `registerManifest(manifest: WbToolManifest): void` | Records a manifest for the lifetime of the calling plugin. Throws on an empty `toolId`, and on a conflicting re-registration. |
| `getManifest(toolId: string): WbToolManifest \| undefined` | Looks up a manifest by the tool's **registered name**. `undefined` for an unknown tool. |

### `undefined` is an answer, not a failure

`getManifest` returns `undefined` for a tool that was never registered and is
not in the static table. It does **not** synthesize a restrictive default.
Turning `undefined` into a decision belongs to `wb-policy`, which already does
it — `DENY` with `reason: "NO_MANIFEST"`. Adding a second default here would
put the same decision in two plugins that could then disagree.

(An earlier revision of `workbench/AGENTS.md` §4 attributed that default-deny
to this plugin. It has been corrected.)

## Configuration

| Field | Type | Default | Purpose |
|---|---|---|---|
| `includeHarnessDefaults` | `boolean` | `true` | Seed the directory with the harness-native table below. Set `false` for a deployment that wants every harness tool denied until explicitly manifested. |
| `staticManifests` | `WbToolManifest[]` | `[]` | Admin-authored manifests, applied over the defaults by `toolId`. |

Both are Schemastery-validated, so a malformed manifest in `cordis.yml` fails
at load rather than at the first tool call.

`staticManifests` is the only way to govern a tool whose registered name is
chosen at registration time from config — see Deviations.

## The static harness-native table

Harness-native tools never call `registerManifest` themselves, so this plugin
ships manifests for them. DESIGN.md §6.7 requires this.

**The table is keyed on each tool's registered name, never its package name.**
`tool-fs` / `dsh-tool-fs` is a *package*; `read`, `write`, `edit`, and
`read_image` are the tools it registers, and those are the strings that reach
`tools/pre-execute`. Getting this wrong does not fail open — `wb-policy` denies
every unmanifested tool — it denies *everything*, which presents as a policy
bug rather than a naming one. Names below were read from each package's
`defineTool` call, scoped to the `tool-*` rows
`packages/bundle/base/cordis.patch.yml` actually mounts.

| Tool | Risk | Ceiling | Network | Reasoning |
|---|---|---|---|---|
| `read` | `local` | `RESTRICTED` | `none` | Local reads may see the most sensitive on-premise material — that is the workbench's purpose. Per-user clearance is enforced by `wb-policy`, not capped here. |
| `write`, `edit`, `str_replace_editor` | `local` | `RESTRICTED` | `none` | Local mutation, no egress path. |
| `read_image` | `local` | `RESTRICTED` | `none` | Same risk as `read`, but carries a `vision.input` permission because the bytes leave the text pipeline for a vision model. |
| `glob`, `grep` | `local` | `RESTRICTED` | `none` | Discovery only; returns paths and matching lines. |
| `bash`, `pwsh` | `enterprise` | `CONFIDENTIAL` | `external` | A shell can run `curl`. Declaring `networkAccess: 'none'` would be a false statement regardless of how a deployment sandboxes it; a sandboxed deployment narrows this entry deliberately through config. |
| `web_search`, `web_fetch` | `external` | `PUBLIC` | `external` | The only default egress path. Capped at `PUBLIC` so no above-`PUBLIC` material can leave the premises through a web call — the sovereignty claim the product rests on. |
| `todo_write`, `skill` | `local` | `INTERNAL` | `none` | Session-local bookkeeping. |
| `job_list`, `job_output`, `job_kill` | `local` | `INTERNAL` | `none` | Control surface over work that was already policy-checked when it started. |
| `create_goal`, `get_goal`, `update_goal` | `local` | `INTERNAL` | `none` | Session-local goal state. |

`bash` is registered by **both** `shell/tool-bash` and
`shell/tool-bash-persistent`. The table is keyed by tool name, so one entry
governs both packages — this is not a duplicate registration.

## Duplicate registration: conflicting registration throws

- **Identical re-registration is a no-op.** A double mount, or a remount after
  HMR, is not an error.
- **A different manifest for a `toolId` that already has one throws**, and the
  standing manifest is left untouched.

Last-write-wins was rejected: it would let a later-mounted plugin silently
raise another tool's classification ceiling, which is exactly the silent
downgrade DESIGN.md §9 invariant 6 forbids. Failing loud at mount is the
harness's own convention for this class of misconfiguration.

The same rule covers a `registerManifest` call for a `toolId` the static table
already carries — the admin-configured entry stands and the registration
throws. A `toolId` freed by its contributing plugin disposing can be
registered again with different content.

## Registration is not cross-validated against the live tool registry

A manifest whose `toolId` matches no tool the harness has registered is stored
as given. This plugin is a directory; it may legitimately be told about a tool
before that tool mounts, or about a tool from a bundle it cannot see.
Cross-validating against `ctx.tools` was considered and rejected: it would
make correct registration order-dependent, and `wb-policy` already catches the
case that actually matters (a call arriving for a tool with no manifest).

## Disposal

Manifests contributed through `registerManifest` are scoped to the calling
plugin's fiber via `ctx.effect()` and disappear when that plugin unmounts.

Static-table entries are **not** fiber-scoped — they come from config, not
from a fiber, so no plugin unmounting can ungovern the harness-native tools.

## Events

None. This plugin emits and consumes no events; it is read synchronously by
`wb-policy` inside that plugin's `tools/pre-execute` listener.

## Deviations

1. **`subagent` and `workflow` tools cannot appear in the static defaults.**
   `subagent/tool-subagent` and `workflow/tool-workflow` take their registered
   tool names from config at registration time (`name: toolName`), so no
   static table can name them ahead of time — unlike every other base-bundle
   tool, whose name is a literal in its `defineTool` call. They are therefore
   unmanifested by default, which means `wb-policy` denies them. A deployment
   that mounts them must add manifests through `Config.staticManifests`. This
   is the honest outcome rather than a guess, but it is a real gap between
   "the base bundle mounts these" and "the workbench governs these out of the
   box", and a human integrator should decide whether the demo profile needs
   those entries pre-supplied.

2. **Tool names were confirmed from source, with one exception in scope.**
   Every name in the table above was read from its package's `defineTool`
   call. The `tool-result-pruner` and `tool-ralph` rows in the base bundle
   were left out: `ralph` is a workflow-family tool covered by the deviation
   above, and `tool-result-pruner` registers no model-facing tool name.

## Known Limitations and Deferred Work

- No `listManifests()` read API. `wb-admin-console` will likely want one to
  render a governed-tool inventory; it is not in the frozen §7.3 interface, so
  adding it is a DESIGN.md §12 contract change rather than a local decision.
- `requiredPermissions` strings are free-form. Nothing yet validates them
  against a permission vocabulary, because no plugin consumes them yet —
  `wb-policy` currently evaluates `riskLevel`, `dataClassificationCeiling`,
  and `networkAccess` only.
