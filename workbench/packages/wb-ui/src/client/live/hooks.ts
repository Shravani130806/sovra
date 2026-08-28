/**
 * React bindings for the live workbench panels.
 * @module @mrpl/dsh-workbench-ui/client/live/hooks
 */

import { useSyncExternalStore } from 'react'
import type { WbCitation, WbUser } from '@mrpl/dsh-workbench-types'
import {
  getWorkbenchState,
  subscribeWorkbench,
  type ActivityEntry,
  type ArtifactEntry,
  type ChatState,
} from './workbench-store.ts'
import { getChatState, subscribeChat } from './chat-store.ts'
import { getDocumentsState, subscribeDocuments } from './documents-store.ts'
import { getVisionState, subscribeVision } from './vision-store.ts'
import { getNavigationState, subscribeNavigation } from './navigation-store.ts'
import { getModelsState, subscribeModels } from './models-store.ts'
import { getUsersState, subscribeUser } from './user-store.ts'

function useWorkbench() {
  return useSyncExternalStore(subscribeWorkbench, getWorkbenchState, getWorkbenchState)
}

/** The session's activity timeline, newest first. */
export function useSovereignActivity(): { activityLog: ActivityEntry[]; isLoading: boolean } {
  const { activity } = useWorkbench()
  // No spinner state: the store is synchronous and starts empty, and an empty
  // timeline is a real answer ("nothing has happened yet"), not a pending one.
  return { activityLog: activity, isLoading: false }
}

/** Citations grounding the current answer. */
export function useSourceCitations(): WbCitation[] {
  return useWorkbench().citations
}

/** Artifacts this session has produced. */
export function useSessionArtifacts(): ArtifactEntry[] {
  return useWorkbench().artifacts
}

/** The composer's policy posture. */
export function useChatState(): ChatState {
  return useWorkbench().chat
}

/** The conversation: turns, streaming state, and the active preset. */
export function useChat() {
  return useSyncExternalStore(subscribeChat, getChatState, getChatState)
}

/** The corpus and the upload queue. */
export function useDocuments() {
  return useSyncExternalStore(subscribeDocuments, getDocumentsState, getDocumentsState)
}

/** The vision studio's image, question and findings. */
export function useVision() {
  return useSyncExternalStore(subscribeVision, getVisionState, getVisionState)
}

/** Which panel is showing, and what it is focused on. */
export function useNavigation() {
  return useSyncExternalStore(subscribeNavigation, getNavigationState, getNavigationState)
}

/** Available models, current selection, and Ollama configuration. */
export function useModels() {
  return useSyncExternalStore(subscribeModels, getModelsState, getModelsState)
}

/** Current user identity and RBAC clearance. */
export function useCurrentUser(): WbUser {
  const state = useSyncExternalStore(subscribeUser, getUsersState, getUsersState)
  return state.currentUser
}

/** All configured users for switching and management. */
export function useUsers(): { currentUser: WbUser; users: WbUser[] } {
  return useSyncExternalStore(subscribeUser, getUsersState, getUsersState)
}
