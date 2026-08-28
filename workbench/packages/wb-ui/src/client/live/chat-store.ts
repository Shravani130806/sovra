/**
 * The conversation: turns, streaming text, tool execution, and cancellation.
 *
 * Holds what the composer and message list render. Like the other stores here,
 * it is a plain observable the host bridge publishes into — `wb-ui` runs in the
 * browser and cannot reach `ctx`, so the transport owns the session stream and
 * this owns only what is on screen.
 * @module @mrpl/dsh-workbench-ui/client/live/chat-store
 */

import type { WbCitation, WbDecisionKind } from '@mrpl/dsh-workbench-types'

/** One tool call shown inline in an assistant turn. */
export interface ToolNode {
  callId: string
  name: string
  /** Arguments as the model produced them, for the collapsed preview. */
  args: Record<string, unknown>
  status: 'pending' | 'running' | 'done' | 'error' | 'denied'
  /** The policy verdict, once the gate has ruled on this call. */
  decision?: WbDecisionKind
  /** Why policy refused, shown on the card rather than only in the audit log. */
  decisionReason?: string
  /** Result text once settled; an error message when `status` is `error`. */
  result?: string
}

/** One conversation turn. */
export interface Turn {
  id: string
  role: 'user' | 'assistant'
  text: string
  /** Tool calls this assistant turn made, in call order. */
  tools: ToolNode[]
  /** Sources this turn's answer is grounded in. */
  citations: WbCitation[]
  /** True while the assistant turn is still streaming. */
  streaming: boolean
}

export interface ChatState {
  turns: Turn[]
  /** True from send until the assistant turn settles. */
  generating: boolean
  /** The preset answering, shown in the header. */
  preset: string
  /** Set while generating, so the composer can offer Stop. */
  abort: AbortController | undefined
}

export const INITIAL_CHAT: ChatState = {
  turns: [],
  generating: false,
  preset: 'document-analyst',
  abort: undefined,
}

let state: ChatState = INITIAL_CHAT
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
  for (const listener of listeners) listener()
}

/** Replace the last turn, which is the one being streamed into. */
function withLastTurn(update: (turn: Turn) => Turn): Turn[] {
  if (state.turns.length === 0) return state.turns
  const turns = state.turns.slice()
  turns[turns.length - 1] = update(turns[turns.length - 1]!)
  return turns
}

let counter = 0
const nextId = (): string => `t${++counter}`

/**
 * Append the user's message and open the assistant turn it will be answered in.
 *
 * Both turns are created together so the message list never shows a question
 * with no visible response forming — the empty assistant turn IS the pending
 * indicator, rather than a separate spinner that could desynchronise from it.
 * @param text - the user's message.
 * @param abort - the controller the transport will honour for Stop.
 * @returns the id of the assistant turn to stream into.
 */
export function startTurn(text: string, abort: AbortController): string {
  const assistantId = nextId()
  commit({
    ...state,
    generating: true,
    abort,
    turns: [
      ...state.turns,
      { id: nextId(), role: 'user', text, tools: [], citations: [], streaming: false },
      { id: assistantId, role: 'assistant', text: '', tools: [], citations: [], streaming: true },
    ],
  })
  return assistantId
}

/**
 * Append streamed text to the open assistant turn.
 * @param delta - the text fragment received.
 */
export function appendDelta(delta: string): void {
  commit({ ...state, turns: withLastTurn((turn) => ({ ...turn, text: turn.text + delta })) })
}

/** Attach the citations grounding the open turn. */
export function attachCitations(citations: readonly WbCitation[]): void {
  commit({ ...state, turns: withLastTurn((turn) => ({ ...turn, citations: [...citations] })) })
}

/**
 * Add or update a tool call on the open assistant turn.
 *
 * Keyed by `callId` so the pending card created when a call starts becomes the
 * settled card when it finishes, rather than a second card appearing beside it.
 * @param node - the tool call's current state; merged over any existing entry.
 */
export function upsertToolNode(node: Partial<ToolNode> & Pick<ToolNode, 'callId'>): void {
  commit({
    ...state,
    turns: withLastTurn((turn) => {
      const index = turn.tools.findIndex((t) => t.callId === node.callId)
      const base: ToolNode = index === -1
        ? { callId: node.callId, name: '', args: {}, status: 'pending' }
        : turn.tools[index]!
      const merged = { ...base, ...node }
      const tools = turn.tools.slice()
      if (index === -1) tools.push(merged)
      else tools[index] = merged
      return { ...turn, tools }
    }),
  })
}

/**
 * Close the open assistant turn.
 * @param error - a failure message, when the turn ended badly.
 */
export function finishTurn(error?: string): void {
  commit({
    ...state,
    generating: false,
    abort: undefined,
    turns: withLastTurn((turn) => ({
      ...turn,
      streaming: false,
      text: error ? `${turn.text}\n\n${error}`.trim() : turn.text,
    })),
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

/** Clear the conversation, for a session switch or a test. */
export function resetChat(): void {
  counter = 0
  commit(INITIAL_CHAT)
}
