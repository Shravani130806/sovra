/**
 * The conversation: turns, streaming text, tool execution, and cancellation.
 *
 * Holds what the composer and message list render. Like the other stores here,
 * it is a plain observable the host bridge publishes into — `wb-ui` runs in the
 * browser and directly streams turns via the configured sovereign model runtime
 * or transport bridge.
 * @module @mrpl/dsh-workbench-ui/client/live/chat-store
 */

import type { WbCitation, WbDecisionKind } from '@mrpl/dsh-workbench-types'
import { getModelsState, selectModel, type ModelSelection } from './models-store.ts'

const STORAGE_KEY = 'sovra_wb_chat_v1'

/** One tool call shown inline in an assistant turn. */
export interface ToolNode {
  callId: string
  name: string
  /** Arguments as the model produced them, for the collapsed preview. */
  args: Record<string, unknown>
  status: 'pending' | 'running' | 'done' | 'error' | 'denied'
  /** The policy verdict, once the gate has ruled on this call. */
  decision?: WbDecisionKind | undefined
  /** Why policy refused, shown on the card rather than only in the audit log. */
  decisionReason?: string | undefined
  /** Result text once settled; an error message when `status` is `error`. */
  result?: string | undefined
}

/** One conversation turn. */
export interface Turn {
  id: string
  role: 'user' | 'assistant'
  text: string
  /** Files attached to this turn, shown as badges above the text. */
  attachments?: string[] | undefined
  /** Tool calls this assistant turn made, in call order. */
  tools: ToolNode[]
  /** Sources this turn's answer is grounded in. */
  citations: WbCitation[]
  /** True while the assistant turn is still streaming. */
  streaming: boolean
  /** Model that served this turn */
  model?: string | undefined
}

/** A conversation session in chat history. */
export interface ChatSession {
  id: string
  title: string
  preset: string
  turns: Turn[]
  selectedModel?: ModelSelection | undefined
  createdAt: string
  updatedAt: string
}

export interface ChatState {
  activeSessionId: string
  sessions: ChatSession[]
  turns: Turn[]
  /** True from send until the assistant turn settles. */
  generating: boolean
  /** The preset answering, shown in the header. */
  preset: string
  /** Set while generating, so the composer can offer Stop. */
  abort: AbortController | undefined
}

export const INITIAL_CHAT: ChatState = {
  activeSessionId: 'sess-1',
  sessions: [],
  turns: [],
  generating: false,
  preset: 'document-analyst',
  abort: undefined,
}

function loadPersistedChat(): ChatState {
  if (typeof window === 'undefined' || !window.localStorage) return INITIAL_CHAT
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return INITIAL_CHAT
    const parsed = JSON.parse(raw) as Partial<ChatState>
    if (parsed && Array.isArray(parsed.sessions) && parsed.sessions.length > 0) {
      const active = parsed.sessions.find((s) => s.id === parsed.activeSessionId) ?? parsed.sessions[0]!
      return {
        ...INITIAL_CHAT,
        activeSessionId: active.id,
        sessions: parsed.sessions,
        turns: (active.turns ?? []).map((t) => ({ ...t, streaming: false })),
        preset: active.preset ?? 'document-analyst',
      }
    }
  } catch {
    // Storage unavailable or corrupted JSON
  }
  return INITIAL_CHAT
}

function savePersistedChat(next: ChatState): void {
  if (typeof window === 'undefined' || !window.localStorage) return
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        activeSessionId: next.activeSessionId,
        sessions: next.sessions,
      }),
    )
  } catch {
    // Ignore quota or private browsing errors
  }
}

let state: ChatState = loadPersistedChat()
const listeners = new Set<() => void>()

/** Subscribe to conversation changes. */
export function subscribeChat(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Read the current conversation; identity is stable until it changes. */
export function getChatState(): ChatState {
  return state
}

function commit(next: ChatState): void {
  state = next
  savePersistedChat(next)
  for (const listener of listeners) listener()
}

/** Replace the last turn, which is the one being streamed into. */
function withLastTurn(update: (turn: Turn) => Turn): { turns: Turn[]; sessions: ChatSession[] } {
  if (state.turns.length === 0) return { turns: state.turns, sessions: state.sessions }
  const turns = state.turns.slice()
  turns[turns.length - 1] = update(turns[turns.length - 1]!)

  const sessions = syncSessionTurns(state.sessions, state.activeSessionId, turns)
  return { turns, sessions }
}

function syncSessionTurns(sessions: ChatSession[], sessionId: string, turns: Turn[]): ChatSession[] {
  const index = sessions.findIndex((s) => s.id === sessionId)
  if (index === -1) return sessions
  const updated: ChatSession = {
    ...sessions[index]!,
    turns,
    updatedAt: new Date().toISOString(),
  }
  const next = sessions.slice()
  next[index] = updated
  return next
}

let counter = 0
const nextId = (): string => `t${++counter}`
let sessionCounter = 1
const nextSessionId = (): string => `sess-${++sessionCounter}-${Date.now().toString(36)}`

/**
 * Append the user's message and open the assistant turn it will be answered in.
 *
 * Both turns are created together so the message list never shows a question
 * with no visible response forming.
 * @param text - the user's message.
 * @param abort - the controller the transport will honour for Stop.
 * @param attachments - optional list of attached file names.
 * @returns the id of the assistant turn to stream into.
 */
export function startTurn(text: string, abort: AbortController, attachments?: string[]): string {
  const assistantId = nextId()
  const activeModel = getModelsState().current
  const nextTurns: Turn[] = [
    ...state.turns,
    {
      id: nextId(),
      role: 'user',
      text,
      attachments: attachments && attachments.length > 0 ? [...attachments] : undefined,
      tools: [],
      citations: [],
      streaming: false,
    },
    {
      id: assistantId,
      role: 'assistant',
      text: '',
      tools: [],
      citations: [],
      streaming: true,
      model: activeModel ? `${activeModel.provider}/${activeModel.model}` : undefined,
    },
  ]

  // Update or register session in history
  const sessionIndex = state.sessions.findIndex((s) => s.id === state.activeSessionId)
  let sessions: ChatSession[]
  const title = (text.trim() || attachments?.[0] || 'New Chat').slice(0, 36)

  if (sessionIndex === -1) {
    const newSession: ChatSession = {
      id: state.activeSessionId,
      title,
      preset: state.preset,
      turns: nextTurns,
      selectedModel: activeModel ?? undefined,
      createdAt: new Date().toISOString(),
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

  // If provider is not Ollama or custom, format completion via Ollama /v1 endpoint
  const url = endpoint.endsWith('/v1') ? `${endpoint}/chat/completions` : `${endpoint}/v1/chat/completions`

  try {
    const messages = [
      ...state.turns
        .filter((t) => t.text.trim() !== '')
        .map((t) => ({
          role: t.role,
          content: t.text,
        })),
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

/**
 * Append streamed text to the open assistant turn.
 * @param delta - the text fragment received.
 */
export function appendDelta(delta: string): void {
  const { turns, sessions } = withLastTurn((turn) => ({ ...turn, text: turn.text + delta }))
  commit({ ...state, turns, sessions })
}

/** Attach the citations grounding the open turn. */
export function attachCitations(citations: readonly WbCitation[]): void {
  const { turns, sessions } = withLastTurn((turn) => ({ ...turn, citations: [...citations] }))
  commit({ ...state, turns, sessions })
}

/**
 * Add or update a tool call on the open assistant turn.
 *
 * Keyed by `callId` so the pending card created when a call starts becomes the
 * settled card when it finishes, rather than a second card appearing beside it.
 * @param node - the tool call's current state; merged over any existing entry.
 */
export function upsertToolNode(node: Partial<ToolNode> & Pick<ToolNode, 'callId'>): void {
  const { turns, sessions } = withLastTurn((turn) => {
    const index = turn.tools.findIndex((t) => t.callId === node.callId)
    const base: ToolNode = index === -1
      ? { callId: node.callId, name: '', args: {}, status: 'pending' }
      : turn.tools[index]!
    const merged = { ...base, ...node }
    const tools = turn.tools.slice()
    if (index === -1) tools.push(merged)
    else tools[index] = merged
    return { ...turn, tools }
  })
  commit({ ...state, turns, sessions })
}

/**
 * Close the open assistant turn.
 * @param error - a failure message, when the turn ended badly.
 */
export function finishTurn(error?: string): void {
  const { turns, sessions } = withLastTurn((turn) => ({
    ...turn,
    streaming: false,
    text: error ? `${turn.text}\n\n${error}`.trim() : turn.text,
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
 * Cancel the in-flight turn.
 *
 * Aborts the controller and closes the turn immediately rather than waiting
 * for the transport to acknowledge: a Stop button that leaves the UI looking
 * busy reads as a Stop that did not work.
 * @returns whether there was anything to cancel.
 */
export function abortTurn(): boolean {
  if (!state.generating) return false
  state.abort?.abort()
  finishTurn('_Generation stopped._')
  return true
}

/** Switch the answering preset. */
export function setPreset(preset: string): void {
  commit({ ...state, preset })
}

/**
 * Start a brand new conversation session.
 */
export function newChat(): void {
  commit({
    ...state,
    activeSessionId: nextSessionId(),
    turns: [],
    generating: false,
    abort: undefined,
  })
}

/**
 * Switch to an existing chat session from history.
 * @param sessionId - the ID of the session to switch to.
 */
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

/**
 * Delete a session from chat history.
 * @param sessionId - the ID of the session to remove.
 */
export function deleteSession(sessionId: string): void {
  const sessions = state.sessions.filter((s) => s.id !== sessionId)
  if (state.activeSessionId === sessionId) {
    commit({
      ...state,
      activeSessionId: nextSessionId(),
      sessions,
      turns: [],
      generating: false,
      abort: undefined,
    })
  } else {
    commit({ ...state, sessions })
  }
}

/** Clear the conversation and session history, for tests or workspace reset. */
export function resetChat(clearStorage = false): void {
  counter = 0
  sessionCounter = 1
  if (clearStorage && typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.removeItem(STORAGE_KEY)
    } catch {
      // ignore
    }
  }
  commit(INITIAL_CHAT)
}
