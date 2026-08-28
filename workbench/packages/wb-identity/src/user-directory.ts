/**
 * User directory provider — maps raw principals to structured {@link WbUser}
 * records. The file-backed implementation reads `$DSH_HOME/workbench/users.yaml`
 * and validates every entry against the {@link WbUser} shape at load time.
 *
 * @module
 */

import * as fs from 'node:fs'
import * as yaml from 'js-yaml'
import Schema from '@deepseek-ai/schemastery'
import {
  type WbUser,
  type WbClassification,
  asWbUserId,
} from '@mrpl/dsh-workbench-types'

// ---------------------------------------------------------------------------
// Provider interface
// ---------------------------------------------------------------------------

/**
 * Maps a raw principal string (from the deployment's transport) to a
 * structured {@link WbUser} record. Implementations are loaded from a
 * directory file or an external provider (LDAP, etc.).
 */
export interface WbUserDirectoryProvider {
  /** Return the user matching `principal`, or `undefined` if not found. */
  lookup(principal: string): WbUser | undefined
}

// ---------------------------------------------------------------------------
// Schemastery schema for validating a single user entry in users.yaml
// ---------------------------------------------------------------------------

const UserEntrySchema = Schema.object({
  principal: Schema.string().required(),
  id: Schema.string().required(),
  displayName: Schema.string().required(),
  department: Schema.string().required(),
  role: Schema.string().required(),
  clearance: Schema.union([
    Schema.const('PUBLIC'),
    Schema.const('INTERNAL'),
    Schema.const('CONFIDENTIAL'),
    Schema.const('RESTRICTED'),
  ]).required(),
  allowedAgentPresets: Schema.array(Schema.string()),
  allowedToolCategories: Schema.array(Schema.union([
    Schema.const('local'),
    Schema.const('enterprise'),
    Schema.const('external'),
  ])),
  networkPermissions: Schema.array(Schema.union([
    Schema.const('web_search'),
    Schema.const('external_api'),
  ])),
})

const UsersFileSchema = Schema.array(UserEntrySchema)

/** Validated shape of one entry in users.yaml (mirrors WbUser + principal). */
interface UserEntry {
  principal: string
  id: string
  displayName: string
  department: string
  role: string
  clearance: 'PUBLIC' | 'INTERNAL' | 'CONFIDENTIAL' | 'RESTRICTED'
  allowedAgentPresets: string[]
  allowedToolCategories: Array<'local' | 'enterprise' | 'external'>
  networkPermissions: Array<'web_search' | 'external_api'>
}

// ---------------------------------------------------------------------------
// File-backed implementation
// ---------------------------------------------------------------------------

/**
 * Reads and validates a YAML user directory file, indexing entries by
 * `principal`. Fails loud at construction time on:
 * - File not found or unreadable
 * - Invalid YAML syntax
 * - Any entry missing a required field or having an invalid `clearance` value
 * - Duplicate `principal` values across entries
 */
export class FileBackedUserDirectory implements WbUserDirectoryProvider {
  private readonly byPrincipal: Map<string, WbUser>

  constructor(filePath: string) {
    const content = fs.readFileSync(filePath, 'utf8')
    const raw = yaml.load(content)

    let entries: UserEntry[]
    try {
      // Schemastery validates at runtime; cast the unknown yaml output
      entries = UsersFileSchema(raw as Record<string, unknown>[]) as UserEntry[]
    } catch (error) {
      throw new Error(
        `wb-identity: failed to validate ${filePath}: ${String(error)}`,
      )
    }

    const map = new Map<string, WbUser>()
    for (const entry of entries) {
      if (map.has(entry.principal)) {
        throw new Error(
          `wb-identity: duplicate principal '${entry.principal}' in ${filePath}`,
        )
      }
      map.set(entry.principal, toWbUser(entry))
    }

    if (map.size !== entries.length) {
      throw new Error(
        `wb-identity: principal count mismatch in ${filePath}: ${map.size} unique principals vs ${entries.length} entries`,
      )
    }

    this.byPrincipal = map
  }

  lookup(principal: string): WbUser | undefined {
    return this.byPrincipal.get(principal)
  }
}

/** Convert a validated YAML entry into a {@link WbUser}. */
function toWbUser(entry: UserEntry): WbUser {
  return {
    id: asWbUserId(entry.id),
    displayName: entry.displayName,
    department: entry.department,
    role: entry.role,
    clearance: entry.clearance as WbClassification,
    allowedAgentPresets: entry.allowedAgentPresets,
    allowedToolCategories: entry.allowedToolCategories,
    networkPermissions: entry.networkPermissions,
  }
}
