/**
 * Static manifests for the harness-native tools that never call
 * {@link WbToolGatewayService.registerManifest} themselves.
 *
 * Keyed on the tool's **registered name** — the string that reaches
 * `tools/pre-execute` and that `wb-policy` looks up — never on the package
 * that registers it. `tool-fs` is a package; `read`, `write`, `edit`, and
 * `read_image` are its tools. Keying this table on package names does not
 * fail open: `wb-policy` denies any tool with no manifest, so the whole
 * harness toolset would be denied and read as a policy bug.
 *
 * Scope is the `tool-*` rows the base bundle mounts
 * (`packages/bundle/base/cordis.patch.yml`). Names were read from each
 * package's `defineTool` call, not inferred from its package name. Tools whose
 * names are chosen at registration time from config — the `subagent` and
 * `workflow` families — cannot appear here; an admin supplies those through
 * `Config.staticManifests`.
 * @module @mrpl/dsh-workbench-tool-gateway/manifests
 */

import type { WbToolManifest } from '@mrpl/dsh-workbench-types'

/**
 * Default manifest per harness-native tool name.
 *
 * `dataClassificationCeiling` is the highest classification the tool may
 * touch; `networkAccess` states what the tool can actually reach, not what a
 * given deployment wishes it would reach. A deployment tightens or loosens
 * any entry through `Config.staticManifests`.
 */
export const DEFAULT_HARNESS_MANIFESTS: Readonly<Record<string, WbToolManifest>> = Object.freeze({
  // fs/tool-fs — local filesystem. Sovereign deployment: local reads may see
  // the most sensitive on-premise material, which is the point of the
  // workbench; clearance is enforced per user by wb-policy, not capped here.
  read: {
    toolId: 'read',
    riskLevel: 'local',
    requiredPermissions: ['fs.read'],
    dataClassificationCeiling: 'RESTRICTED',
    networkAccess: 'none',
  },
  write: {
    toolId: 'write',
    riskLevel: 'local',
    requiredPermissions: ['fs.write'],
    dataClassificationCeiling: 'RESTRICTED',
    networkAccess: 'none',
  },
  edit: {
    toolId: 'edit',
    riskLevel: 'local',
    requiredPermissions: ['fs.write'],
    dataClassificationCeiling: 'RESTRICTED',
    networkAccess: 'none',
  },
  // Image bytes leave the text pipeline and reach a vision model, so this is
  // tracked as its own permission even though the risk level matches `read`.
  read_image: {
    toolId: 'read_image',
    riskLevel: 'local',
    requiredPermissions: ['fs.read', 'vision.input'],
    dataClassificationCeiling: 'RESTRICTED',
    networkAccess: 'none',
  },

  // fs/tool-fs-search — discovery only; returns paths and matching lines.
  glob: {
    toolId: 'glob',
    riskLevel: 'local',
    requiredPermissions: ['fs.read'],
    dataClassificationCeiling: 'RESTRICTED',
    networkAccess: 'none',
  },
  grep: {
    toolId: 'grep',
    riskLevel: 'local',
    requiredPermissions: ['fs.read'],
    dataClassificationCeiling: 'RESTRICTED',
    networkAccess: 'none',
  },

  // fs/tool-str-replace-editor — an edit path, same surface as `edit`.
  str_replace_editor: {
    toolId: 'str_replace_editor',
    riskLevel: 'local',
    requiredPermissions: ['fs.write'],
    dataClassificationCeiling: 'RESTRICTED',
    networkAccess: 'none',
  },

  // shell/tool-bash and shell/tool-bash-persistent both register `bash`; one
  // entry governs both. A shell can run curl, so `networkAccess: 'none'` would
  // be a false declaration regardless of how the deployment sandboxes it —
  // a sandboxed deployment narrows this entry deliberately through config.
  bash: {
    toolId: 'bash',
    riskLevel: 'enterprise',
    requiredPermissions: ['shell.execute'],
    dataClassificationCeiling: 'CONFIDENTIAL',
    networkAccess: 'external',
  },
  pwsh: {
    toolId: 'pwsh',
    riskLevel: 'enterprise',
    requiredPermissions: ['shell.execute'],
    dataClassificationCeiling: 'CONFIDENTIAL',
    networkAccess: 'external',
  },

  // web/tool-web — the only default egress path. Capped at PUBLIC so no
  // above-PUBLIC material can be carried off-premise through a web call,
  // which is the sovereignty claim the product rests on.
  web_search: {
    toolId: 'web_search',
    riskLevel: 'external',
    requiredPermissions: ['web.search'],
    dataClassificationCeiling: 'PUBLIC',
    networkAccess: 'external',
  },
  web_fetch: {
    toolId: 'web_fetch',
    riskLevel: 'external',
    requiredPermissions: ['web.fetch'],
    dataClassificationCeiling: 'PUBLIC',
    networkAccess: 'external',
  },

  // Session-local bookkeeping: no filesystem reach, no egress.
  todo_write: {
    toolId: 'todo_write',
    riskLevel: 'local',
    requiredPermissions: [],
    dataClassificationCeiling: 'INTERNAL',
    networkAccess: 'none',
  },
  skill: {
    toolId: 'skill',
    riskLevel: 'local',
    requiredPermissions: ['skill.load'],
    dataClassificationCeiling: 'INTERNAL',
    networkAccess: 'none',
  },

  // jobs/tool-jobs — control surface over already-governed work; the job
  // itself was policy-checked when it started.
  job_list: {
    toolId: 'job_list',
    riskLevel: 'local',
    requiredPermissions: [],
    dataClassificationCeiling: 'INTERNAL',
    networkAccess: 'none',
  },
  job_output: {
    toolId: 'job_output',
    riskLevel: 'local',
    requiredPermissions: [],
    dataClassificationCeiling: 'INTERNAL',
    networkAccess: 'none',
  },
  job_kill: {
    toolId: 'job_kill',
    riskLevel: 'local',
    requiredPermissions: [],
    dataClassificationCeiling: 'INTERNAL',
    networkAccess: 'none',
  },

  // goal/tool-goal — session-local goal state.
  create_goal: {
    toolId: 'create_goal',
    riskLevel: 'local',
    requiredPermissions: [],
    dataClassificationCeiling: 'INTERNAL',
    networkAccess: 'none',
  },
  get_goal: {
    toolId: 'get_goal',
    riskLevel: 'local',
    requiredPermissions: [],
    dataClassificationCeiling: 'INTERNAL',
    networkAccess: 'none',
  },
  update_goal: {
    toolId: 'update_goal',
    riskLevel: 'local',
    requiredPermissions: [],
    dataClassificationCeiling: 'INTERNAL',
    networkAccess: 'none',
  },
})
