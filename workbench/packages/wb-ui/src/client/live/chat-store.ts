/**
 * Live chat state behind the conversation pane.
 *
 * Owns the turn history, streaming buffer, session list, active preset and
 * tool-call cards. Emits notifications on each change so React views can
 * rerender via `useSyncExternalStore` technique.
 *
 * @module @mrpl/dsh-workbench-ui/client/live/chat-store
 */

import {
  asWbAuditEntryId,
  asWbSessionId,
  asWbUserId,
  type WbCitation,
  type WbClassification,
} from '@mrpl/dsh-workbench-types'
import { getModelsState, selectModel, type ModelSelection } from './models-store.ts'
import { getDocumentsState, getDocumentFullText } from './documents-store.ts'
import { buildTurnSystemPrompt } from './preset-prompts.ts'
import { publishAuditEntry, publishChatDecision, publishRetrievalCitations } from './workbench-store.ts'
import { publishPolicyDecision } from '../policy/policy-store.ts'

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

const chatAttachmentContentMap = new Map<string, string>()

/**
 * Register the text content of a file attached directly in the chat.
 * Direct chat attachments are readable by the model directly, unlike
 * corpus documents which require tool-based retrieval.
 */
export function registerChatAttachmentContent(filename: string, content: string): void {
  chatAttachmentContentMap.set(filename, content)
}

export function getChatAttachmentContent(filename: string): string | undefined {
  return chatAttachmentContentMap.get(filename)
}

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
    sessions: [],
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

export const INITIAL_CHAT_STATE: ChatState = {
  activeSessionId: initialData.activeSessionId,
  sessions: initialData.sessions,
  turns: [],
  generating: false,
  preset: 'document-analyst',
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
    sessions = [...state.sessions, newSession]
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

const CLASSIFICATION_RANK: Record<string, number> = {
  PUBLIC: 0,
  INTERNAL: 1,
  CONFIDENTIAL: 2,
  RESTRICTED: 3,
}

const DEFAULT_OPERATOR_CLEARANCE = 'INTERNAL'

async function streamCompletion(
  url: string,
  modelName: string,
  messages: Array<{ role: string; content: string }>,
  contextLength: number,
  signal: AbortSignal,
  onDelta: (delta: string) => void,
): Promise<string> {
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
    signal,
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
  let fullOutput = ''

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
            fullOutput += delta
            onDelta(delta)
          }
        } catch {
          // Ignore partial/unparseable SSE chunks
        }
      }
    }
  }

  return fullOutput
}

interface ModelTurnContext {
  url: string
  modelName: string
  contextLength: number
  systemPrompt: string
  turnMessages: Array<{ role: string; content: string }>
  signal: AbortSignal
}

/**
 * Checks for tool calling intentions (either JSON blocks in model output or direct document queries)
 * and executes them against the SOVRA policy engine.
 */
async function handleToolCallingAndPolicy(
  userQuery: string,
  accumulatedAssistantText: string,
  modelContext?: ModelTurnContext,
): Promise<boolean> {
  const docs = getDocumentsState().documents
  if (docs.length === 0) return false

  let targetFilename: string | undefined
  let toolName = 'read'

  // 1. Check for JSON tool call in assistant text
  const jsonMatch = accumulatedAssistantText.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
  if (jsonMatch && jsonMatch[1]) {
    try {
      const parsed = JSON.parse(jsonMatch[1].trim()) as Record<string, unknown>
      const path = (parsed.path ?? parsed.file ?? parsed.filename ?? parsed.documentId ?? parsed.request) as string | undefined
      if (path) {
        targetFilename = path.replace(/^\/Documents\//i, '').replace(/^\.\//, '').replace(/^["']|["']$/g, '').trim()
        toolName = (parsed.tool ?? parsed.actionType ?? parsed.action ?? 'read') as string
      }
    } catch {
      // Non-JSON block
    }
  }

  // 2. Fallback: Check if user query explicitly asked to read/access a corpus document
  if (!targetFilename) {
    const lowerUserQuery = userQuery.toLowerCase()
    for (const doc of docs) {
      const lowerTitle = doc.title.toLowerCase()
      const baseTitle = lowerTitle.includes('.') ? lowerTitle.split('.')[0]! : lowerTitle
      if (
        lowerUserQuery.includes(lowerTitle) ||
        (baseTitle.length > 2 && lowerUserQuery.includes(baseTitle)) ||
        (lowerTitle.includes('air-gapped') && lowerUserQuery.includes('air-gapped'))
      ) {
        targetFilename = doc.title
        break
      }
    }
  }

  if (!targetFilename) return false

  // Find document in corpus
  const matchedDoc = docs.find((d) => {
    const dTitle = d.title.toLowerCase()
    const tFile = targetFilename!.toLowerCase()
    return dTitle === tFile || dTitle.includes(tFile) || tFile.includes(dTitle)
  })

  if (!matchedDoc) return false

  const docClassification = (matchedDoc.classification ?? 'INTERNAL').toUpperCase() as WbClassification
  const docRank = CLASSIFICATION_RANK[docClassification] ?? 1
  const userRank = CLASSIFICATION_RANK[DEFAULT_OPERATOR_CLEARANCE] ?? 1

  const callId = `call-${Date.now()}`
  const docContent = getDocumentFullText(matchedDoc)
  const currentSessionId = asWbSessionId(state.activeSessionId)
  const currentUserId = asWbUserId('user-operator')

  if (docRank > userRank) {
    // Policy DENY
    const reason = `Policy DENY: Document "${matchedDoc.title}" classification (${docClassification}) exceeds operator clearance (${DEFAULT_OPERATOR_CLEARANCE}).`

    upsertToolNode({
      callId,
      name: toolName,
      args: { path: matchedDoc.title, classification: docClassification },
      status: 'denied',
      decision: 'DENY',
      decisionReason: reason,
    })

    publishPolicyDecision({
      user: currentUserId,
      sessionId: currentSessionId,
      agentPreset: state.preset,
      action: 'read_data',
      resource: matchedDoc.id,
      decision: 'DENY',
      reason,
      destination: 'local',
      classification: docClassification,
    })

    publishAuditEntry({
      id: asWbAuditEntryId(`audit-${Date.now()}`),
      sessionId: currentSessionId,
      userId: currentUserId,
      at: new Date().toISOString(),
      kind: 'policy_decision',
      summary: `Policy DENY: Blocked read of ${docClassification} file "${matchedDoc.title}"`,
      payload: { decision: 'DENY', name: toolName, value: { path: matchedDoc.title, classification: docClassification } },
    })

    publishChatDecision('DENY', reason)

    // Remove raw JSON snippet and append clean policy intercept notice
    const cleanText = accumulatedAssistantText.replace(/```(?:json)?\s*[\s\S]*?\s*```/g, '').trim()
    const denialText = `${cleanText ? cleanText + '\n\n' : ''}🛡️ **Policy Intercept (DENY)**: Access to document \`${matchedDoc.title}\` (Classification: \`${docClassification}\`) was evaluated and **blocked** by the SOVRA Policy Engine.\n\n*Reason*: The document's classification level (\`${docClassification}\`) exceeds your current session clearance (\`${DEFAULT_OPERATOR_CLEARANCE}\`). Tool execution was terminated and no unredacted contents were provided.`
    replaceLastAssistantText(denialText)
    return true
  } else {
    // Policy ALLOW
    const reason = `Policy ALLOW: Operator clearance (${DEFAULT_OPERATOR_CLEARANCE}) satisfies classification (${docClassification}) for tool "${toolName}".`

    upsertToolNode({
      callId,
      name: toolName,
      args: { path: matchedDoc.title, classification: docClassification },
      status: 'done',
      decision: 'ALLOW',
      result: docContent || '(Document is empty)',
    })

    publishPolicyDecision({
      user: currentUserId,
      sessionId: currentSessionId,
      agentPreset: state.preset,
      action: 'read_data',
      resource: matchedDoc.id,
      decision: 'ALLOW',
      reason,
      destination: 'local',
      classification: docClassification,
    })

    publishAuditEntry({
      id: asWbAuditEntryId(`audit-${Date.now()}`),
      sessionId: currentSessionId,
      userId: currentUserId,
      at: new Date().toISOString(),
      kind: 'policy_decision',
      summary: `Policy ALLOW: Permitted read of ${docClassification} file "${matchedDoc.title}"`,
      payload: { decision: 'ALLOW', name: toolName, value: { path: matchedDoc.title, classification: docClassification } },
    })

    publishAuditEntry({
      id: asWbAuditEntryId(`audit-${Date.now() + 1}`),
      sessionId: currentSessionId,
      userId: currentUserId,
      at: new Date().toISOString(),
      kind: 'tool_result',
      summary: `Tool ${toolName} completed for "${matchedDoc.title}"`,
      payload: { name: toolName, value: { path: matchedDoc.title, size: docContent.length } },
    })

    publishChatDecision('ALLOW', '')

    const citations: WbCitation[] = [
      {
        documentId: matchedDoc.id,
        title: matchedDoc.title,
        page: 1,
        section: 'Full Document',
      },
    ]
    attachCitations(citations)
    publishRetrievalCitations(citations)

    // Clear previous assistant text (e.g. raw JSON tool request) to stream model interpretation
    replaceLastAssistantText('')

    if (modelContext) {
      const priorTurns = modelContext.turnMessages.slice(0, -1)
      const followUpMessages = [
        { role: 'system', content: modelContext.systemPrompt },
        ...priorTurns,
        {
          role: 'user',
          content: `${userQuery}\n\n[Context from retrieved document "${matchedDoc.title}" (${docClassification})]:\n\"\"\"\n${docContent}\n\"\"\"\n\nPlease analyze, summarize, or answer based on the above retrieved document content according to my request. Do not dump the entire raw file verbatim; provide your interpretation and structured answer directly.`,
        },
      ]

      const followUpOutput = await streamCompletion(
        modelContext.url,
        modelContext.modelName,
        followUpMessages,
        modelContext.contextLength,
        modelContext.signal,
        (delta) => appendDelta(delta),
      )

      if (!followUpOutput || followUpOutput.trim() === '') {
        replaceLastAssistantText(
          `I have reviewed **${matchedDoc.title}** [${docClassification}].\n\n${docContent.slice(0, 400)}${docContent.length > 400 ? '...' : ''}`,
        )
      }
    }

    return true
  }
}

function replaceLastAssistantText(newText: string): void {
  const { turns, sessions } = withLastTurn((turn) => ({
    ...turn,
    text: newText,
  }))
  commit({ ...state, turns, sessions })
}

/**
 * Dispatch prompt to local Ollama inference API with streaming and tool execution.
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
    const directAttachments = (attachments ?? []).map((name) => ({
      name,
      content: getChatAttachmentContent(name),
    }))
    const systemPrompt =
      state.systemPromptOverride ??
      buildTurnSystemPrompt(state.preset, docsState.documents, text, directAttachments)

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

    const firstPassOutput = await streamCompletion(
      url,
      modelName,
      messages,
      contextLength,
      abort.signal,
      (delta) => appendDelta(delta),
    )

    // After model generation first pass, evaluate if tool calling occurred
    await handleToolCallingAndPolicy(text, firstPassOutput, {
      url,
      modelName,
      contextLength,
      systemPrompt,
      turnMessages,
      signal: abort.signal,
    })

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
    s.id === state.activeSessionId
      ? { ...s, preset, updatedAt: new Date().toISOString() }
      : s,
  )
  commit({ ...state, preset, sessions: updatedSessions })
}

export function switchSession(id: string): void {
  const session = state.sessions.find((s) => s.id === id)
  if (!session) return
  commit({
    ...state,
    activeSessionId: id,
    turns: session.turns,
    preset: session.preset,
    generating: false,
    abort: undefined,
  })
  if (session.selectedModel) {
    void selectModel(session.selectedModel)
  }
}

export const selectChatSession = switchSession

export function newChat(preset = state.preset): string {
  const id = `session-${Date.now()}`
  commit({
    ...state,
    activeSessionId: id,
    turns: [],
    preset,
    generating: false,
    abort: undefined,
  })
  return id
}

export const createNewSession = newChat

export function deleteSession(id: string): void {
  const sessions = state.sessions.filter((s) => s.id !== id)
  let activeSessionId = state.activeSessionId
  let turns = state.turns
  let preset = state.preset
  if (activeSessionId === id) {
    if (sessions.length > 0) {
      const next = sessions[0]!
      activeSessionId = next.id
      turns = next.turns
      preset = next.preset
    } else {
      activeSessionId = `session-${Date.now()}`
      turns = []
    }
  }
  commit({ ...state, sessions, activeSessionId, turns, preset })
}

export function setSystemPromptOverride(prompt?: string): void {
  commit({ ...state, systemPromptOverride: prompt })
}

export function resetChat(): void {
  state.abort?.abort()
  chatAttachmentContentMap.clear()
  const defaultId = 'session-1'
  commit({
    activeSessionId: defaultId,
    sessions: [],
    turns: [],
    generating: false,
    preset: 'document-analyst',
    abort: undefined,
    systemPromptOverride: undefined,
  })
}
