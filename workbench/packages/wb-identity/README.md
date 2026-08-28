# wb-identity

Identity & RBAC plugin. Resolves session principals to structured `WbUser` objects and emits `wb/identity/resolved` events for downstream consumers (especially `wb-policy`).

## Service API

### `ctx.wbIdentity`

```ts
interface WbIdentityService {
  /** Pure synchronous cache read — no side effects, no resolution trigger. */
  current(sessionId: WbSessionId): WbUser | undefined
}
```

- **Eager resolution**: On `session/created`, the plugin looks up the session's principal via the configured `SessionPrincipalProvider`, then queries the `WbUserDirectoryProvider`. The result (or `undefined` for misses) is cached.
- **Idempotent**: A second `session/created` for the same session is a no-op — the cached value is returned.
- **Cache cleanup**: On `session/disposed`, the cache entry is evicted.

## Config

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `userDirectory` | `'file'` | `'file'` | Which user-directory provider to use (extensible for future kinds). |
| `userDirectoryPath` | `string` | `$DSH_HOME/workbench/users.yaml` | Path to the users YAML file. Supports `$DSH_HOME` expansion. |

Example `cordis.yml` snippet:

```yaml
plugins:
  - name: wb-identity
    config:
      userDirectoryPath: "$DSH_HOME/workbench/users.yaml"
```

## Events

### `wb/identity/resolved`

Emitted exactly once per session (on the first `session/created` that resolves successfully).

```ts
interface WbIdentityResolvedEvent {
  sessionId: WbSessionId
  user: WbUser
}
```

- **Model-visible**: Anything reaching a model request must be reconstructable from the session log. This event is the canonical record of identity resolution.
- **Payload**: Contains the branded `WbSessionId` and the fully resolved `WbUser` (with `id`, `displayName`, `department`, `role`, `clearance`, `allowedAgentPresets`, `allowedToolCategories`, `networkPermissions`).

## Extension Points

### `SessionPrincipalProvider`

```ts
interface SessionPrincipalProvider {
  getPrincipal(sessionId: WbSessionId): string | undefined
}
```

Implement this to map a session ID to a principal string (the key used to look up the user in the directory). The plugin ships `NullSessionPrincipalProvider` (always returns `undefined`) as the default — real deployments must provide a custom implementation.

### `WbUserDirectoryProvider`

```ts
interface WbUserDirectoryProvider {
  lookup(principal: string): WbUser | undefined
}
```

Implements user lookup by principal. The built-in `FileBackedUserDirectory` reads a YAML file with the following schema:

```yaml
- principal: "alice"
  id: "user-alice"
  displayName: "Alice Engineer"
  department: "Engineering"
  role: "engineer"
  clearance: "INTERNAL"              # PUBLIC | INTERNAL | CONFIDENTIAL | RESTRICTED
  allowedAgentPresets: ["document-analyst"]
  allowedToolCategories: ["local", "enterprise"]  # local | enterprise | external
  networkPermissions: []             # web_search | external_api
```

- Validates at construction time (fails loud on malformed YAML, missing required fields, invalid `clearance` values, or duplicate `principal` values).
- Caches the index in memory — lookup is O(1).

## Deviations from DESIGN.md

- **Principal provider is a genuine gap**: The harness has no authenticated identity concept (`ctx.identity` does not exist; `packages/identity/anonymous-user-id` is a random telemetry UUID only). `wb-identity` defines the `SessionPrincipalProvider` extension point so deployments can inject their own principal resolution logic, but there is no default implementation that extracts a principal from an authenticated context. This is tracked in `DESIGN.md §12` as an open question.
- **Eager resolution model**: `session/created` triggers resolution immediately, before any tool call. The `current()` method is a pure cache read. This matches the DESIGN.md contract but differs from a lazy on-demand model.
- **NullSessionPrincipalProvider as default**: Always returns `undefined`. Tests use inline object literals implementing `SessionPrincipalProvider` for deterministic scenarios.