import { useSyncExternalStore } from 'react'

export type PageRoute = 
  | 'chat'
  | 'documents'
  | 'document_viewer'
  | 'vision'
  | 'activity'
  | 'security'
  | 'settings'
  | 'search'

let currentPage: PageRoute = 'chat'
const listeners = new Set<() => void>()

export const mockNavigationStore = {
  subscribe(listener: () => void) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
  getSnapshot() {
    return currentPage
  },
  navigate(page: PageRoute) {
    if (currentPage !== page) {
      currentPage = page
      listeners.forEach(l => l())
    }
  }
}

export function useNavigation() {
  const page = useSyncExternalStore(
    mockNavigationStore.subscribe,
    mockNavigationStore.getSnapshot
  )
  
  return {
    page,
    navigate: mockNavigationStore.navigate
  }
}
