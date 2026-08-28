import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Context } from '@deepseek-ai/cordis'
import { SessionId, type Session } from '@deepseek-ai/dsh-session'
import {
  asWbUserId,
  asWbSessionId,
  type WbUser,
  type WbClassification,
  type WbSessionId,
  type WbIdentityResolvedEvent,
} from '@mrpl/dsh-workbench-types'

import {
  WbIdentityServiceImpl,
  apply as wbIdentityApply,
  Config as WbIdentityConfig,
} from '../src/index.ts'
import {
  type SessionPrincipalProvider,
  NullSessionPrincipalProvider,
} from '../src/types.ts'
import { FileBackedUserDirectory } from '../src/user-directory.ts'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tmpDir(): string {
  return mkdirSync(join(tmpdir(), `wb-identity-test-${Date.now()}-${Math.random().toString(36).slice(2)}`), { recursive: true })!
}

function createMockSession(id: string = 'test-session'): Session {
  return { id: SessionId(id) } as unknown as Session
}

function writeUsersYaml(dir: string, entries: Record<string, unknown>[]): string {
  // Generate a proper YAML list (single document, array of objects)
  const yamlLines: string[] = []
  for (const entry of entries) {
    yamlLines.push('-')
    for (const [k, v] of Object.entries(entry)) {
      if (Array.isArray(v)) {
        yamlLines.push(`  ${k}: [${v.map(x => JSON.stringify(x)).join(', ')}]`)
      } else if (typeof v === 'string') {
        yamlLines.push(`  ${k}: "${v}"`)
      } else {
        yamlLines.push(`  ${k}: ${JSON.stringify(v)}`)
      }
    }
  }
  const filePath = join(dir, 'users.yaml')
  writeFileSync(filePath, yamlLines.join('\n') + '\n', 'utf8')
  return filePath
}

function fullUser(overrides: Partial<WbUser> & { principal?: string } = {}): Record<string, unknown> {
  return {
    principal: overrides.principal ?? 'alice',
    id: overrides.id ?? 'user-alice',
    displayName: overrides.displayName ?? 'Alice Engineer',
    department: overrides.department ?? 'Engineering',
    role: overrides.role ?? 'engineer',
    clearance: overrides.clearance ?? 'INTERNAL',
    allowedAgentPresets: overrides.allowedAgentPresets ?? ['document-analyst'],
    allowedToolCategories: overrides.allowedToolCategories ?? ['local', 'enterprise'],
    networkPermissions: overrides.networkPermissions ?? [],
  }
}

function expectedUser(overrides: Partial<WbUser> = {}): WbUser {
  return {
    id: asWbUserId(overrides.id ?? 'user-alice'),
    displayName: overrides.displayName ?? 'Alice Engineer',
    department: overrides.department ?? 'Engineering',
    role: overrides.role ?? 'engineer',
    clearance: (overrides.clearance ?? 'INTERNAL') as WbClassification,
    allowedAgentPresets: overrides.allowedAgentPresets ?? ['document-analyst'],
    allowedToolCategories: overrides.allowedToolCategories ?? ['local', 'enterprise'],
    networkPermissions: overrides.networkPermissions ?? [],
  }
}

// ---------------------------------------------------------------------------
// FileBackedUserDirectory — unit tests
// ---------------------------------------------------------------------------

describe('FileBackedUserDirectory', () => {
  let dir: string

  beforeEach(() => { dir = tmpDir() })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  it('loads and looks up a valid user by principal', () => {
    const yamlPath = writeUsersYaml(dir, [fullUser()])
    const provider = new FileBackedUserDirectory(yamlPath)
    const user = provider.lookup('alice')
    expect(user).toBeDefined()
    expect(user!.id).toBe('user-alice')
    expect(user!.displayName).toBe('Alice Engineer')
    expect(user!.clearance).toBe('INTERNAL')
  })

  it('returns undefined for unknown principal', () => {
    const yamlPath = writeUsersYaml(dir, [fullUser()])
    const provider = new FileBackedUserDirectory(yamlPath)
    expect(provider.lookup('unknown')).toBeUndefined()
  })

  it('throws on malformed YAML', () => {
    const filePath = join(dir, 'users.yaml')
    writeFileSync(filePath, '{ invalid yaml: [', 'utf8')
    expect(() => new FileBackedUserDirectory(filePath)).toThrow()
  })

  it('throws on missing required field (no clearance)', () => {
    const entry = fullUser()
    delete entry.clearance
    const yamlPath = writeUsersYaml(dir, [entry])
    expect(() => new FileBackedUserDirectory(yamlPath)).toThrow(/failed to validate/)
  })

  it('throws on duplicate principal', () => {
    const yamlPath = writeUsersYaml(dir, [
      fullUser({ principal: 'alice' }),
      fullUser({ principal: 'alice', id: 'user-alice-2' }),
    ])
    expect(() => new FileBackedUserDirectory(yamlPath)).toThrow(/duplicate principal 'alice'/)
  })

  it('loads multiple distinct users', () => {
    const yamlPath = writeUsersYaml(dir, [
      fullUser({ principal: 'alice', id: 'u1' }),
      fullUser({ principal: 'bob', id: 'u2', displayName: 'Bob Manager' }),
    ])
    const provider = new FileBackedUserDirectory(yamlPath)
    expect(provider.lookup('alice')!.id).toBe('u1')
    expect(provider.lookup('bob')!.id).toBe('u2')
    expect(provider.lookup('carol')).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// NullSessionPrincipalProvider
// ---------------------------------------------------------------------------

describe('NullSessionPrincipalProvider', () => {
  it('always returns undefined', () => {
    const provider = new NullSessionPrincipalProvider()
    expect(provider.getPrincipal(asWbSessionId('s1'))).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// WbIdentityServiceImpl — integration tests via Cordis context
// ---------------------------------------------------------------------------

describe('WbIdentityServiceImpl', () => {
  let ctx: Context
  let dir: FileBackedUserDirectory
  let yamlPath: string
  let tmp: string

  beforeEach(() => {
    tmp = tmpDir()
    yamlPath = writeUsersYaml(tmp, [fullUser()])
    dir = new FileBackedUserDirectory(yamlPath)
    ctx = new Context()
  })

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  it('resolves a valid principal to a WbUser via current()', () => {
    const principalMap = new Map<WbSessionId, string>()
    principalMap.set(asWbSessionId('s1'), 'alice')

    const provider: SessionPrincipalProvider = {
      getPrincipal: (sid) => principalMap.get(sid),
    }

    const identity = new WbIdentityServiceImpl(ctx, dir, provider)

    // Simulate session creation
    ctx.emit('session/created', createMockSession('s1'))

    const user = identity.current(asWbSessionId('s1'))
    expect(user).toBeDefined()
    expect(user!.id).toBe('user-alice')
    expect(user!.displayName).toBe('Alice Engineer')
  })

  it('emits wb/identity/resolved exactly once per session', () => {
    const principalMap = new Map<WbSessionId, string>()
    principalMap.set(asWbSessionId('s1'), 'alice')

    const provider: SessionPrincipalProvider = {
      getPrincipal: (sid) => principalMap.get(sid),
    }

    const identity = new WbIdentityServiceImpl(ctx, dir, provider)

    const events: WbIdentityResolvedEvent[] = []
    ctx.on('wb/identity/resolved', (event: WbIdentityResolvedEvent) => { events.push(event) })

    // First creation fires event
    ctx.emit('session/created', createMockSession('s1'))
    expect(events).toHaveLength(1)
    expect(events[0]!.sessionId).toBe(asWbSessionId('s1'))
    expect(events[0]!.user.id).toBe('user-alice')

    // Second creation for same session does NOT fire again
    ctx.emit('session/created', createMockSession('s1'))
    expect(events).toHaveLength(1)
  })

  it('returns undefined for unresolvable principal (directory miss), no event', () => {
    const principalMap = new Map<WbSessionId, string>()
    principalMap.set(asWbSessionId('s1'), 'nobody') // not in YAML

    const provider: SessionPrincipalProvider = {
      getPrincipal: (sid) => principalMap.get(sid),
    }

    const identity = new WbIdentityServiceImpl(ctx, dir, provider)

    const events: WbIdentityResolvedEvent[] = []
    ctx.on('wb/identity/resolved', (event: WbIdentityResolvedEvent) => { events.push(event) })

    ctx.emit('session/created', createMockSession('s1'))

    expect(identity.current(asWbSessionId('s1'))).toBeUndefined()
    expect(events).toHaveLength(0)
  })

  it('returns undefined when provider gives no principal, no event', () => {
    const provider: SessionPrincipalProvider = {
      getPrincipal: () => undefined,
    }

    const identity = new WbIdentityServiceImpl(ctx, dir, provider)

    const events: WbIdentityResolvedEvent[] = []
    ctx.on('wb/identity/resolved', (event: WbIdentityResolvedEvent) => { events.push(event) })

    ctx.emit('session/created', createMockSession('s1'))

    expect(identity.current(asWbSessionId('s1'))).toBeUndefined()
    expect(events).toHaveLength(0)
  })

  it('caches undefined so provider is not re-invoked', () => {
    let callCount = 0
    const provider: SessionPrincipalProvider = {
      getPrincipal: () => { callCount++; return undefined },
    }

    const identity = new WbIdentityServiceImpl(ctx, dir, provider)

    ctx.emit('session/created', createMockSession('s1'))
    expect(callCount).toBe(1)

    // Read the cached miss — provider should NOT be called again
    identity.current(asWbSessionId('s1'))
    expect(callCount).toBe(1)
  })

  it('multiple sessions for the same user both resolve', () => {
    const principalMap = new Map<WbSessionId, string>()
    principalMap.set(asWbSessionId('s1'), 'alice')
    principalMap.set(asWbSessionId('s2'), 'alice')

    const provider: SessionPrincipalProvider = {
      getPrincipal: (sid) => principalMap.get(sid),
    }

    const identity = new WbIdentityServiceImpl(ctx, dir, provider)

    const events: WbIdentityResolvedEvent[] = []
    ctx.on('wb/identity/resolved', (event: WbIdentityResolvedEvent) => { events.push(event) })

    ctx.emit('session/created', createMockSession('s1'))
    ctx.emit('session/created', createMockSession('s2'))

    expect(identity.current(asWbSessionId('s1'))!.id).toBe('user-alice')
    expect(identity.current(asWbSessionId('s2'))!.id).toBe('user-alice')
    expect(events).toHaveLength(2)
  })

  it('session disposal cleans the cache', () => {
    const principalMap = new Map<WbSessionId, string>()
    principalMap.set(asWbSessionId('s1'), 'alice')

    const provider: SessionPrincipalProvider = {
      getPrincipal: (sid) => principalMap.get(sid),
    }

    const identity = new WbIdentityServiceImpl(ctx, dir, provider)

    ctx.emit('session/created', createMockSession('s1'))
    expect(identity.current(asWbSessionId('s1'))).toBeDefined()

    ctx.emit('session/disposed', createMockSession('s1'))
    expect(identity.current(asWbSessionId('s1'))).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// HMR-safety: dispose fiber, assert cleanup
// ---------------------------------------------------------------------------

describe('wb-identity HMR-safety', () => {
  it('disposal removes service and cleans up listeners', async () => {
    const tmp = tmpDir()
    const yamlPath = writeUsersYaml(tmp, [fullUser()])

    const ctx = new Context()

    // Mount the plugin through Cordis (integration-style)
    const fiber = await ctx.plugin({
      name: 'wb-identity-test',
      apply: wbIdentityApply,
      Config: WbIdentityConfig,
    }, {
      userDirectory: 'file',
      userDirectoryPath: yamlPath,
    })

    expect(ctx.wbIdentity).toBeDefined()
    expect(typeof ctx.wbIdentity.current).toBe('function')

    // Dispose the fiber
    await fiber.dispose()

    // Service should be gone
    expect((ctx as any).wbIdentity).toBeUndefined()

    rmSync(tmp, { recursive: true, force: true })
  })
})
