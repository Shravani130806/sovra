/**
 * Live chat state behind the conversation pane.
 *
 * Owns the turn history, streaming buffer, session list, active preset and
 * tool-call cards. Emits notifications on each change so React views can
 * rerender via `useSyncExternalStore` technique.
 *
 * @module @mrpl/dsh-workbench-ui/client/live/chat-store
 */

import type { WbCitation } from '@mrpl/dsh-workbench-types'
import { getModelsState, selectModel, type ModelSelection } from './models-store.ts'
import { getDocumentsState } from './documents-store.ts'
import { buildTurnSystemPrompt } from './preset-prompts.ts'

export interface ToolNode {
  callId: string
  name: string
  args: Record<string, unknown>
  status: 'pending' | 'running' | 'done' | 'denied'
  result?: unknown
  decision?: string | undefined
  decisionReason?: string | undefined
}

export interface ChatTurn {
  id: string
  role: 'user' | 'assistant'
  text: string
  streaming?: boolean | undefined
  citations: readonly WbCitation[]
  tools: ToolNode[]
  attachments?: string[] | undefined
}

export interface ChatSession {
  id: string
  title: string
  turns: ChatTurn[]
  preset: string
  selectedModel?: ModelSelection | undefined
  updatedAt: string
}

export interface ChatState {
  activeSessionId: string
  sessions: ChatSession[]
  turns: ChatTurn[]
  generating: boolean
  preset: string
  abort?: AbortController | undefined
  systemPromptOverride?: string | undefined
}

const STORAGE_KEY = 'dsh:workbench:chat_sessions'

function loadSavedSessions(): { sessions: ChatSession[]; activeSessionId: string } {
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw) as { sessions?: ChatSession[]; activeSessionId?: string }
        if (parsed.sessions && parsed.sessions.length > 0) {
          const activeSessionId = parsed.activeSessionId ?? parsed.sessions[0]!.id
          return { sessions: parsed.sessions, activeSessionId }
        }
      }
    } catch {
      // Ignore parse failure, fall back to empty
    }
  }
  const defaultId = 'session-1'
  return {
    sessions: [
      {
        id: defaultId,
        title: 'New Session',
        turns: [],
        preset: 'document-analyst',
        updatedAt: new Date().toISOString(),
      },
    ],
    activeSessionId: defaultId,
  }
}

function saveSessions(sessions: ChatSession[], activeSessionId: string): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ sessions, activeSessionId }),
      )
    } catch {
      // Ignore storage errors
    }
  }
}

const initialData = loadSavedSessions()
const initialActiveSession = initialData.sessions.find((s) => s.id === initialData.activeSessionId) ?? initialData.sessions[0]!

export const INITIAL_CHAT_STATE: ChatState = {
  activeSessionId: initialData.activeSessionId,
  sessions: initialData.sessions,
  turns: initialActiveSession.turns,
  generating: false,
  preset: initialActiveSession.preset ?? 'document-analyst',
  abort: undefined,
}

let state: ChatState = INITIAL_CHAT_STATE
const listeners = new Set<() => void>()

export function subscribeChat(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getChatState(): ChatState {
  return state
}

function commit(next: ChatState): void {
  state = next
  saveSessions(next.sessions, next.activeSessionId)
  for (const listener of listeners) listener()
}

let turnCounter = 0
function nextTurnId(prefix = 'turn'): string {
  turnCounter += 1
  return `${prefix}-${Date.now()}-${turnCounter}`
}

/**
 * Start a user turn and an open assistant turn.
 * @returns the assistant turn ID so the caller can stream deltas into it.
 */
export function startTurn(
  text: string,
  abort: AbortController,
  attachments?: string[],
): string {
  const userTurn: ChatTurn = {
    id: nextTurnId('turn-user'),
    role: 'user',
    text,
    citations: [],
    tools: [],
    attachments: attachments && attachments.length > 0 ? attachments : undefined,
  }

  const assistantId = nextTurnId('turn-assistant')
  const assistantTurn: ChatTurn = {
    id: assistantId,
    role: 'assistant',
    text: '',
    streaming: true,
    citations: [],
    tools: [],
  }

  const nextTurns = [...state.turns, userTurn, assistantTurn]
  const activeModel = getModelsState().current

  // Auto-title session from first user turn
  let sessions = state.sessions
  const sessionIndex = state.sessions.findIndex((s) => s.id === state.activeSessionId)
  const title = text.slice(0, 30) + (text.length > 30 ? '...' : '')

  if (sessionIndex === -1) {
    const newSession: ChatSession = {
      id: state.activeSessionId,
      title,
      turns: nextTurns,
      preset: state.preset,
      selectedModel: activeModel ?? undefined,
      updatedAt: new Date().toISOString(),
    }
    sessions = [newSession, ...state.sessions]
  } else {
    const existing = state.sessions[sessionIndex]!
    const updated: ChatSession = {
      ...existing,
      title: existing.turns.length === 0 ? title : existing.title,
      turns: nextTurns,
      selectedModel: activeModel ?? existing.selectedModel,
      updatedAt: new Date().toISOString(),
    }
    sessions = state.sessions.slice()
    sessions[sessionIndex] = updated
  }

  commit({
    ...state,
    generating: true,
    abort,
    turns: nextTurns,
    sessions,
  })
  return assistantId
}

/**
 * Dispatch prompt to local Ollama inference API with streaming.
 */
export async function dispatchTurnToModel(text: string, abort: AbortController, attachments?: string[]): Promise<void> {
  startTurn(text, abort, attachments)

  const modelsState = getModelsState()
  const current = modelsState.current
  const endpoint = modelsState.ollamaEndpoint.replace(/\/+$/, '')
  const provider = current?.provider ?? 'ollama'
  const modelName = current?.model ?? 'qwen3.5:2b'
  const contextLength = current?.contextLength ?? 8192

  if (modelsState.strictLocalOnly) {
    const group = modelsState.groups.find((g) => g.id === provider)
    if (group && !group.isLocal) {
      finishTurn(`[Error: Strict local mode is enabled — non-local provider "${provider}" is rejected]`)
      return
    }
  }

  // If provider is not Ollama or custom, format completion via Ollama /v1 endpoint
  const url = endpoint.endsWith('/v1') ? `${endpoint}/chat/completions` : `${endpoint}/v1/chat/completions`

  try {
    const docsState = getDocumentsState()
    const systemPrompt = state.systemPromptOverride ?? buildTurnSystemPrompt(state.preset, docsState.documents, text)

    const turnMessages = state.turns
      .filter((t) => t.text.trim() !== '')
      .map((t) => ({
        role: t.role,
        content: t.text,
      }))

    const messages = [
      { role: 'system', content: systemPrompt },
      ...turnMessages,
    ]

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream, application/json',
      },
      body: JSON.stringify({
        model: modelName,
        messages,
        stream: true,
        options: {
          num_ctx: contextLength,
        },
      }),
      signal: abort.signal,
    })

    if (!res.ok) {
      throw new Error(`Model request failed with HTTP ${res.status}: ${res.statusText}`)
    }

    if (!res.body) {
      throw new Error('No response body returned from model endpoint')
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder('utf-8')
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || trimmed === 'data: [DONE]') continue
        if (trimmed.startsWith('data: ')) {
          try {
            const data = JSON.parse(trimmed.slice(6)) as {
              choices?: Array<{
                delta?: { content?: string; reasoning?: string }
                text?: string
              }>
            }
            const delta = data.choices?.[0]?.delta?.content ?? data.choices?.[0]?.text ?? ''
            if (delta) {
              appendDelta(delta)
            }
          } catch {
            // Ignore partial/unparseable SSE chunks
          }
        }
      }
    }

    finishTurn()
  } catch (err: unknown) {
    if (abort.signal.aborted) {
      return
    }
    const msg = err instanceof Error ? err.message : String(err)
    finishTurn(`[Error: Unable to complete turn with ${provider}/${modelName} — ${msg}]`)
  }
}

function withLastTurn(
  updater: (turn: ChatTurn) => ChatTurn,
): { turns: ChatTurn[]; sessions: ChatSession[] } {
  if (state.turns.length === 0) return { turns: [], sessions: state.sessions }
  const lastIndex = state.turns.length - 1
  const updatedTurn = updater(state.turns[lastIndex]!)
  const turns = state.turns.slice()
  turns[lastIndex] = updatedTurn

  const sessions = state.sessions.map((s) =>
    s.id === state.activeSessionId
      ? { ...s, turns, updatedAt: new Date().toISOString() }
      : s,
  )

  return { turns, sessions }
}

/**
 * Append streamed text to the open assistant turn.
 * @param delta - the text fragment received.
 */
export function appendDelta(delta: string): void {
  const { turns, sessions } = withLastTurn((turn) => ({
    ...turn,
    text: turn.text + delta,
  }))
  commit({ ...state, turns, sessions })
}

/**
 * Finish streaming the current turn.
 * @param failureReason - optional error message to write to the turn.
 */
export function finishTurn(failureReason?: string): void {
  const { turns, sessions } = withLastTurn((turn) => ({
    ...turn,
    text: failureReason ? `${turn.text}${turn.text ? '\n' : ''}${failureReason}` : turn.text,
    streaming: false,
  }))
  commit({
    ...state,
    generating: false,
    abort: undefined,
    turns,
    sessions,
  })
}

/**
 * Abort active generation.
 */
export function abortTurn(): boolean {
  if (!state.generating) return false
  state.abort?.abort()
  const { turns, sessions } = withLastTurn((turn) => ({
    ...turn,
    text: `${turn.text}${turn.text ? '\n' : ''}[Generation stopped by user]`,
    streaming: false,
  }))
  commit({
    ...state,
    generating: false,
    abort: undefined,
    turns,
    sessions,
  })
  return true
}

export function upsertToolNode(node: Partial<ToolNode> & { callId: string }): void {
  const { turns, sessions } = withLastTurn((turn) => {
    const existingIndex = turn.tools.findIndex((t) => t.callId === node.callId)
    if (existingIndex !== -1) {
      const updated = { ...turn.tools[existingIndex]!, ...node }
      const tools = turn.tools.slice()
      tools[existingIndex] = updated
      return { ...turn, tools }
    }
    const newNode: ToolNode = {
      callId: node.callId,
      name: node.name ?? '',
      args: node.args ?? {},
      status: node.status ?? 'pending',
      result: node.result,
      decision: node.decision,
      decisionReason: node.decisionReason,
    }
    return { ...turn, tools: [...turn.tools, newNode] }
  })
  commit({ ...state, turns, sessions })
}

export function appendToolNode(node: ToolNode): void {
  upsertToolNode(node)
}

export function updateToolNode(callId: string, patch: Partial<ToolNode>): void {
  upsertToolNode({ callId, ...patch })
}

export function attachCitations(citations: readonly WbCitation[]): void {
  const { turns, sessions } = withLastTurn((turn) => ({
    ...turn,
    citations: [...turn.citations, ...citations],
  }))
  commit({ ...state, turns, sessions })
}

export function appendCitation(citation: WbCitation): void {
  attachCitations([citation])
}

export function setPreset(preset: string): void {
  const updatedSessions = state.sessions.map((s) =>
    s.id === state.activeSessionId ? { ...s, preset, updatedAt: new Date().toISOString() } : s,
  )
  commit({
    ...state,
    preset,
    sessions: updatedSessions,
  })
}

export function createSession(preset = 'document-analyst'): string {
  const id = `session-${Date.now()}`
  const nonEmptySessions = state.sessions.filter((s) => s.turns.length > 0)

  commit({
    ...state,
    activeSessionId: id,
    sessions: nonEmptySessions,
    turns: [],
    preset,
    generating: false,
    abort: undefined,
  })
  return id
}

export const newChat = createSession

export function switchSession(sessionId: string): void {
  const target = state.sessions.find((s) => s.id === sessionId)
  if (!target) return

  if (target.selectedModel) {
    void selectModel(target.selectedModel)
  }

  commit({
    ...state,
    activeSessionId: target.id,
    turns: target.turns,
    preset: target.preset,
    generating: false,
    abort: undefined,
  })
}

export function deleteSession(sessionId: string): void {
  const filtered = state.sessions.filter((s) => s.id !== sessionId)
  commit({
    ...state,
    sessions: filtered,
    activeSessionId: filtered.length > 0 ? filtered[0]!.id : '',
    turns: filtered.length > 0 ? filtered[0]!.turns : [],
    preset: filtered.length > 0 ? filtered[0]!.preset : 'document-analyst',
    generating: false,
    abort: undefined,
  })
}

export function resetChat(): void {
  const defaultId = 'session-1'
  state = {
    activeSessionId: defaultId,
    sessions: [],
    turns: [],
    generating: false,
    preset: 'document-analyst',
    abort: undefined,
  }
  commit(state)
}
