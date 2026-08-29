/**
 * User identity and RBAC store for Sovereign AI Workbench client.
 *
 * Manages active user identity, security clearance, and user switching.
 * @module @mrpl/dsh-workbench-ui/client/live/user-store
 */

import { asWbUserId, type WbUser } from '@mrpl/dsh-workbench-types'

const STORAGE_KEY = 'sovra_wb_active_user_v1'

export interface WbClientUser extends WbUser {
  username?: string
}

export const DEFAULT_USERS: WbClientUser[] = [
  {
    id: asWbUserId('user-operator'),
    username: 'doc-analyst',
    displayName: 'Sakshi',
    department: 'Engineering',
    role: 'Engineering / Analyst',
    clearance: 'INTERNAL',
    allowedAgentPresets: ['document-analyst', 'research'],
    allowedToolCategories: ['local', 'enterprise'],
    networkPermissions: [],
  },
  {
    id: asWbUserId('user-restricted'),
    username: 'restricted-analyst',
    displayName: 'Vikram',
    department: 'Defense & Nuclear Safety',
    role: 'Lead Security Officer',
    clearance: 'RESTRICTED',
    allowedAgentPresets: ['document-analyst', 'research', 'engineering-vision', 'code-analysis', 'artifact'],
    allowedToolCategories: ['local', 'enterprise'],
    networkPermissions: [],
  },
  {
    id: asWbUserId('user-priya'),
    username: 'priya-research',
    displayName: 'Priya',
    department: 'Research & Development',
    role: 'Senior Research Lead',
    clearance: 'CONFIDENTIAL',
    allowedAgentPresets: ['document-analyst', 'research'],
    allowedToolCategories: ['local', 'enterprise'],
    networkPermissions: [],
  },
  {
    id: asWbUserId('user-guest'),
    username: 'public-operator',
    displayName: 'Guest Operator',
    department: 'Operations',
    role: 'Public Operator',
    clearance: 'PUBLIC',
    allowedAgentPresets: ['document-analyst'],
    allowedToolCategories: ['local'],
    networkPermissions: [],
  },
]

export interface UsersState {
  currentUser: WbClientUser
  users: WbClientUser[]
}

function loadPersistedUser(): WbClientUser {
  if (typeof window === 'undefined' || !window.localStorage) return DEFAULT_USERS[0]!
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_USERS[0]!
    const found = DEFAULT_USERS.find(
      (u) =>
        u.id === raw ||
        u.username === raw ||
        u.displayName.toLowerCase() === raw.toLowerCase(),
    )
    if (found) return found
  } catch {
    // Ignore storage parse errors
  }
  return DEFAULT_USERS[0]!
}

function savePersistedUser(user: WbClientUser): void {
  if (typeof window === 'undefined' || !window.localStorage) return
  try {
    window.localStorage.setItem(STORAGE_KEY, user.id)
  } catch {
    // Ignore quota errors
  }
}

export const INITIAL_USERS_STATE: UsersState = {
  currentUser: loadPersistedUser(),
  users: DEFAULT_USERS,
}

let state: UsersState = { ...INITIAL_USERS_STATE }
const listeners = new Set<() => void>()

export function subscribeUser(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getUsersState(): UsersState {
  return state
}

export function getCurrentUser(): WbClientUser {
  return state.currentUser
}

export function getUsersList(): WbClientUser[] {
  return state.users
}

function commit(next: UsersState): void {
  state = next
  savePersistedUser(next.currentUser)
  for (const listener of listeners) listener()
}

/**
 * Switch the active user by ID, username, or display name.
 */
export function switchUser(userIdOrName: string): boolean {
  const normalized = userIdOrName.trim().toLowerCase()
  const target = state.users.find(
    (u) =>
      u.id === userIdOrName ||
      u.id.toLowerCase() === normalized ||
      u.username?.toLowerCase() === normalized ||
      u.displayName.toLowerCase() === normalized,
  )
  if (!target) return false
  commit({
    ...state,
    currentUser: target,
  })
  return true
}

/**
 * Reset user state for tests.
 */
export function resetUserStore(clearStorage = false): void {
  if (clearStorage && typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.removeItem(STORAGE_KEY)
    } catch {
      // ignore
    }
  }
  state = {
    currentUser: DEFAULT_USERS[0]!,
    users: DEFAULT_USERS,
  }
  for (const listener of listeners) listener()
}
