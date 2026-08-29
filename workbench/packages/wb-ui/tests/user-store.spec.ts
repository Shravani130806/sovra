import { beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_USERS,
  getCurrentUser,
  getUsersList,
  resetUserStore,
  switchUser,
} from '../src/client/live/user-store.ts'

describe('user store & clearance switching', () => {
  beforeEach(() => {
    resetUserStore()
  })

  it('initializes with default operator (Sakshi) with INTERNAL clearance', () => {
    const current = getCurrentUser()
    expect(current.id).toBe('user-operator')
    expect(current.displayName).toBe('Sakshi')
    expect(current.clearance).toBe('INTERNAL')
  })

  it('provides a list of all configured users', () => {
    const list = getUsersList()
    expect(list.length).toBeGreaterThanOrEqual(4)

    const vikram = list.find((u) => u.displayName === 'Vikram')
    expect(vikram).toBeDefined()
    expect(vikram?.clearance).toBe('RESTRICTED')

    const priya = list.find((u) => u.displayName === 'Priya')
    expect(priya).toBeDefined()
    expect(priya?.clearance).toBe('CONFIDENTIAL')

    const sakshi = list.find((u) => u.displayName === 'Sakshi')
    expect(sakshi).toBeDefined()
    expect(sakshi?.clearance).toBe('INTERNAL')
  })

  it('switches to privileged user (Vikram) with RESTRICTED clearance', () => {
    const switched = switchUser('user-restricted')
    expect(switched).toBe(true)

    const current = getCurrentUser()
    expect(current.id).toBe('user-restricted')
    expect(current.displayName).toBe('Vikram')
    expect(current.clearance).toBe('RESTRICTED')
    expect(current.department).toBe('Defense & Nuclear Safety')
  })

  it('allows switching by user display name or username', () => {
    switchUser('Vikram')
    expect(getCurrentUser().clearance).toBe('RESTRICTED')

    switchUser('priya-research')
    expect(getCurrentUser().clearance).toBe('CONFIDENTIAL')

    switchUser('Sakshi')
    expect(getCurrentUser().clearance).toBe('INTERNAL')
  })

  it('falls back gracefully on unknown user ID', () => {
    const switched = switchUser('non-existent-user-xyz')
    expect(switched).toBe(false)
    expect(getCurrentUser().displayName).toBe('Sakshi')
  })
})
