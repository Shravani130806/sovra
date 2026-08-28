/**
 * Which panel is showing, and what it is focused on.
 * @module @mrpl/dsh-workbench-ui/client/live/navigation-store
 */

import type { WbDocumentId } from '@mrpl/dsh-workbench-types'

/** The panels the sidebar switches between. */
export type Route = 'chat' | 'documents' | 'vision' | 'search' | 'security' | 'settings'

export interface NavigationState {
  route: Route
  /** The document the viewer is open on, when `route` is `documents`. */
  documentId: WbDocumentId | undefined
  /** A page or section to scroll to, set when arriving from a citation. */
  locator: { page?: number; section?: string } | undefined
}

export const INITIAL_NAVIGATION: NavigationState = {
  route: 'chat',
  documentId: undefined,
  locator: undefined,
}

let state: NavigationState = INITIAL_NAVIGATION
const listeners = new Set<() => void>()

export function subscribeNavigation(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getNavigationState(): NavigationState {
  return state
}

function commit(next: NavigationState): void {
  state = next
  for (const listener of listeners) listener()
}

/**
 * Switch panels.
 *
 * Clears the viewer target: leaving Documents and returning should not reopen
 * whatever was last cited, which would look like the app losing the user's place.
 */
export function navigate(route: Route): void {
  commit({ route, documentId: undefined, locator: undefined })
}

/**
 * Open a document, optionally at a cited location.
 *
 * The path from a citation in the Sources panel to the passage it refers to,
 * which is what makes a citation checkable rather than decorative.
 * @param documentId - the document to open.
 * @param locator - the page or section to focus.
 */
export function openDocument(
  documentId: WbDocumentId,
  locator?: { page?: number; section?: string },
): void {
  commit({ route: 'documents', documentId, ...(locator ? { locator } : { locator: undefined }) })
}

export function resetNavigation(): void {
  commit(INITIAL_NAVIGATION)
}
