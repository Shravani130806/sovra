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
  type WbCitation,
  type WbClassification,
} from '@mrpl/dsh-workbench-types'
import { getModelsState, selectModel, type ModelSelection } from './models-store.ts'
import {
  getDocumentsState,
  getDocumentFullText,
  createChunksFromText,
  getChatAttachmentContent,
  registerChatAttachmentContent,
  clearChatAttachmentContent,
  type CorpusDocument,
  type DocumentChunk,
} from './documents-store.ts'
import { getCurrentUser } from './user-store.ts'
import { buildTurnSystemPrompt } from './preset-prompts.ts'
import { publishAuditEntry, publishChatDecision, publishRetrievalCitations } from './workbench-store.ts'
import { publishPolicyDecision } from '../policy/policy-store.ts'

export { getChatAttachmentContent, registerChatAttachmentContent, clearChatAttachmentContent }

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
      turns: nextTurns,
      title: existing.turns.length === 0 ? title : existing.title,
      selectedModel: activeModel ?? existing.selectedModel,
      updatedAt: new Date().toISOString(),
    }
    sessions = state.sessions.map((s) => (s.id === state.activeSessionId ? updated : s))
  }

  commit({
    ...state,
    turns: nextTurns,
    sessions,
    generating: true,
    abort,
  })

  return assistantId
}

/**
 * Create a new chat session.
 */
export function newChat(): void {
  const newSessionId = `session-${Date.now()}`

  commit({
    ...state,
    activeSessionId: newSessionId,
    turns: [],
    generating: false,
    abort: undefined,
  })
}

/**
 * Switch to an existing session by ID.
 */
export function switchSession(sessionId: string): void {
  const target = state.sessions.find((s) => s.id === sessionId)
  if (!target) return

  commit({
    ...state,
    activeSessionId: target.id,
    turns: target.turns,
    preset: target.preset,
    generating: false,
    abort: undefined,
  })

  if (target.selectedModel) {
    void selectModel(target.selectedModel)
  }
}

/**
 * Delete a session by ID.
 */
export function deleteSession(sessionId: string): void {
  const remaining = state.sessions.filter((s) => s.id !== sessionId)
  const nextActive = remaining.length > 0 ? remaining[0]!.id : `session-${Date.now()}`
  const activeSession = remaining.find((s) => s.id === nextActive)

  commit({
    ...state,
    sessions: remaining,
    activeSessionId: nextActive,
    turns: activeSession ? activeSession.turns : [],
  })
}

export function setPreset(preset: string): void {
  commit({ ...state, preset })
}

export function setSystemPromptOverride(override?: string): void {
  commit({ ...state, systemPromptOverride: override })
}

export function resetChat(clearStorage = false): void {
  turnCounter = 0
  clearChatAttachmentContent()
  if (clearStorage && typeof window !== "undefined" && window.localStorage) {
    try {
      window.localStorage.removeItem(STORAGE_KEY)
    } catch {
      // ignore
    }
  }
  state = {
    activeSessionId: 'session-1',
    sessions: [],
    turns: [],
    generating: false,
    preset: 'document-analyst',
    abort: undefined,
  }
  for (const listener of listeners) listener()
}

/**
 * Upsert a tool call node into the open assistant turn.
 */
export function upsertToolNode(node: Partial<ToolNode> & { callId: string }): void {
  const { turns, sessions } = withLastTurn((turn) => {
    const existingIndex = turn.tools.findIndex((t) => t.callId === node.callId)
    let tools = turn.tools
    if (existingIndex >= 0) {
      const updated = { ...tools[existingIndex]!, ...node }
      tools = tools.map((t, idx) => (idx === existingIndex ? updated : t))
    } else {
      const newNode: ToolNode = {
        callId: node.callId,
        name: node.name ?? 'unknown_tool',
        args: node.args ?? {},
        status: node.status ?? 'pending',
        result: node.result,
        decision: node.decision,
        decisionReason: node.decisionReason,
      }
      tools = [...tools, newNode]
    }
    return { ...turn, tools }
  })
  commit({ ...state, turns, sessions })
}

/**
 * Attach grounding citations to the current assistant turn.
 */
export function attachCitations(citations: readonly WbCitation[]): void {
  const { turns, sessions } = withLastTurn((turn) => ({
    ...turn,
    citations: [...turn.citations, ...citations],
  }))
  commit({ ...state, turns, sessions })
}

const CLASSIFICATION_RANK: Record<string, number> = {
  PUBLIC: 0,
  INTERNAL: 1,
  CONFIDENTIAL: 2,
  RESTRICTED: 3,
}

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

interface RetrievedChunkMatch {
  doc: CorpusDocument
  chunk: DocumentChunk
  score: number
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9_-]+/)
    .filter((t) => t.length > 1)
}

function deduplicateCitations(citations: WbCitation[]): WbCitation[] {
  const seen = new Set<string>()
  const result: WbCitation[] = []
  for (const cite of citations) {
    const key = `${cite.documentId}:${cite.page ?? 0}:${cite.section ?? ''}`
    if (!seen.has(key)) {
      seen.add(key)
      result.push(cite)
    }
  }
  return result
}

function searchCorpusChunks(
  query: string,
  docs: CorpusDocument[],
  targetPath?: string,
): { matches: RetrievedChunkMatch[]; matchedDocs: CorpusDocument[] } {
  if (docs.length === 0) return { matches: [], matchedDocs: [] }

  const queryTokens = tokenize(query)
  const targetTokens = targetPath ? tokenize(targetPath) : []
  const allTokens = Array.from(new Set([...queryTokens, ...targetTokens]))

  const allChunkMatches: RetrievedChunkMatch[] = []
  const matchedDocSet = new Map<string, CorpusDocument>()

  for (const doc of docs) {
    const docFullText = getDocumentFullText(doc)
    const docTitle = doc.title.toLowerCase()

    // Title score
    let titleScore = 0
    if (targetPath) {
      const lowerTarget = targetPath.toLowerCase()
      if (docTitle === lowerTarget || docTitle.endsWith(lowerTarget) || lowerTarget.endsWith(docTitle)) {
        titleScore += 10
      } else if (docTitle.includes(lowerTarget) || lowerTarget.includes(docTitle)) {
        titleScore += 5
      }
    }
    for (const t of allTokens) {
      if (docTitle.includes(t)) {
        titleScore += 2
      }
    }

    // Get chunks
    let chunks = doc.chunksData
    if (!chunks || chunks.length === 0) {
      chunks = createChunksFromText(docFullText)
    }
    if (chunks.length === 0 && docFullText.trim()) {
      chunks = [{ id: 'c1', text: docFullText.trim(), page: 1, section: 'Full Document' }]
    }

    let docHasPositiveChunk = false

    for (const chunk of chunks) {
      const chunkText = chunk.text.toLowerCase()
      const chunkSection = (chunk.section ?? '').toLowerCase()
      let chunkScore = 0

      for (const token of allTokens) {
        if (chunkText.includes(token)) {
          chunkScore += 1
        }
        if (chunkSection.includes(token)) {
          chunkScore += 1.5
        }
      }

      const totalScore = chunkScore + titleScore
      if (totalScore > 0) {
        docHasPositiveChunk = true
        allChunkMatches.push({
          doc,
          chunk,
          score: totalScore,
        })
      }
    }

    if (titleScore > 0 && !docHasPositiveChunk && chunks.length > 0) {
      for (const chunk of chunks) {
        allChunkMatches.push({
          doc,
          chunk,
          score: titleScore,
        })
      }
      matchedDocSet.set(doc.id, doc)
    } else if (docHasPositiveChunk) {
      matchedDocSet.set(doc.id, doc)
    }
  }

  allChunkMatches.sort((a, b) => b.score - a.score)
  const topMatches = allChunkMatches.slice(0, 8)
  const finalDocs = Array.from(new Set(topMatches.map((m) => m.doc)))

  return { matches: topMatches, matchedDocs: finalDocs }
}

/**
 * Checks for tool calling intentions or RAG retrieval needs against the Sovereign Document Corpus
 * and executes them against the SOVRA policy engine with accurate citations.
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
      const path = (parsed.path ?? parsed.file ?? parsed.filename ?? parsed.documentId ?? parsed.request ?? parsed.query ?? parsed.q) as string | undefined
      if (path) {
        targetFilename = path.replace(/^\/Documents\//i, '').replace(/^\.\//, '').replace(/^["']|["']$/g, '').trim()
        toolName = (parsed.tool ?? parsed.actionType ?? parsed.action ?? 'read') as string
      }
    } catch {
      // Non-JSON block
    }
  }

  // Perform corpus chunk retrieval
  const { matches, matchedDocs } = searchCorpusChunks(userQuery, docs, targetFilename)

  if (matchedDocs.length === 0 && !targetFilename) {
    return false
  }

  // If specific targetFilename was given but not in top matchedDocs, attempt fallback direct match
  let targetDocs = matchedDocs
  if (targetFilename && targetDocs.length === 0) {
    const direct = docs.find((d) => {
      const dTitle = d.title.toLowerCase()
      const tFile = targetFilename!.toLowerCase()
      return dTitle === tFile || dTitle.includes(tFile) || tFile.includes(dTitle)
    })
    if (direct) {
      targetDocs = [direct]
    }
  }

  if (targetDocs.length === 0) {
    return false
  }

  const currentUser = getCurrentUser()
  const userRank = CLASSIFICATION_RANK[currentUser.clearance] ?? 1
  const currentSessionId = asWbSessionId(state.activeSessionId)
  const currentUserId = currentUser.id
  const callId = `call-${Date.now()}`

  // Evaluate policy on all matched documents
  const deniedDocs = targetDocs.filter((d) => {
    const rank = CLASSIFICATION_RANK[(d.classification ?? 'INTERNAL').toUpperCase()] ?? 1
    return rank > userRank
  })

  if (deniedDocs.length > 0) {
    const blockedDoc = deniedDocs[0]!
    const blockedClass = (blockedDoc.classification ?? 'INTERNAL').toUpperCase() as WbClassification
    const reason = `Policy DENY: Document "${blockedDoc.title}" classification (${blockedClass}) exceeds ${currentUser.displayName}'s clearance (${currentUser.clearance}).`

    upsertToolNode({
      callId,
      name: toolName,
      args: { path: blockedDoc.title, classification: blockedClass },
      status: 'denied',
      decision: 'DENY',
      decisionReason: reason,
    })

    publishPolicyDecision({
      user: currentUserId,
      sessionId: currentSessionId,
      agentPreset: state.preset,
      action: 'read_data',
      resource: blockedDoc.id,
      decision: 'DENY',
      reason,
      destination: 'local',
      classification: blockedClass,
    })

    publishAuditEntry({
      id: asWbAuditEntryId(`audit-${Date.now()}`),
      sessionId: currentSessionId,
      userId: currentUserId,
      at: new Date().toISOString(),
      kind: 'policy_decision',
      summary: `Policy DENY: Blocked read of ${blockedClass} file "${blockedDoc.title}" for ${currentUser.displayName}`,
      payload: { decision: 'DENY', name: toolName, value: { path: blockedDoc.title, classification: blockedClass } },
    })

    publishChatDecision('DENY', reason)

    const cleanText = accumulatedAssistantText.replace(/```(?:json)?\s*[\s\S]*?\s*```/g, '').trim()
    const denialText = `${cleanText ? cleanText + '\n\n' : ''}🛡️ **Policy Intercept (DENY)**: Access to document \`${blockedDoc.title}\` (Classification: \`${blockedClass}\`) was evaluated and **blocked** by the SOVRA Policy Engine.

*Reason*: The document's classification level (\`${blockedClass}\`) exceeds your current session clearance (\`${currentUser.clearance}\` for user **${currentUser.displayName}**). Switch to a user with \`${blockedClass}\` or \`RESTRICTED\` clearance to access this document.`
    replaceLastAssistantText(denialText)
    return true
  }

  // Policy ALLOW for all retrieved documents
  const allowedMatches = matches.filter((m) => targetDocs.some((d) => d.id === m.doc.id))

  // Generate citations accurately from matching chunks and documents
  let rawCitations: WbCitation[] = []
  if (allowedMatches.length > 0) {
    rawCitations = allowedMatches.map((m) => ({
      documentId: m.doc.id,
      title: m.doc.title,
      ...(m.chunk.page !== undefined ? { page: m.chunk.page } : {}),
      ...(m.chunk.section !== undefined ? { section: m.chunk.section } : {}),
    }))
  } else {
    rawCitations = targetDocs.map((doc) => ({
      documentId: doc.id,
      title: doc.title,
      page: 1,
      section: 'Full Document',
    }))
  }

  const citations = deduplicateCitations(rawCitations)
  attachCitations(citations)
  publishRetrievalCitations(citations)

  for (const doc of targetDocs) {
    const docClassification = (doc.classification ?? 'INTERNAL').toUpperCase() as WbClassification
    const docContent = getDocumentFullText(doc)
    const reason = `Policy ALLOW: User ${currentUser.displayName} clearance (${currentUser.clearance}) satisfies classification (${docClassification}) for tool "${toolName}".`

    upsertToolNode({
      callId: `${callId}-${doc.id}`,
      name: toolName,
      args: { path: doc.title, classification: docClassification },
      status: 'done',
      decision: 'ALLOW',
      result: docContent || '(Document is empty)',
    })

    publishPolicyDecision({
      user: currentUserId,
      sessionId: currentSessionId,
      agentPreset: state.preset,
      action: 'read_data',
      resource: doc.id,
      decision: 'ALLOW',
      reason,
      destination: 'local',
      classification: docClassification,
    })

    publishAuditEntry({
      id: asWbAuditEntryId(`audit-${Date.now()}-${doc.id}`),
      sessionId: currentSessionId,
      userId: currentUserId,
      at: new Date().toISOString(),
      kind: 'policy_decision',
      summary: `Policy ALLOW: Permitted read of ${docClassification} file "${doc.title}" for ${currentUser.displayName}`,
      payload: { decision: 'ALLOW', name: toolName, value: { path: doc.title, classification: docClassification } },
    })

    publishAuditEntry({
      id: asWbAuditEntryId(`audit-${Date.now() + 1}-${doc.id}`),
      sessionId: currentSessionId,
      userId: currentUserId,
      at: new Date().toISOString(),
      kind: 'tool_result',
      summary: `Tool ${toolName} completed for "${doc.title}"`,
      payload: { name: toolName, value: { path: doc.title, size: docContent.length } },
    })
  }

  publishChatDecision('ALLOW', '')

  // Clear raw JSON tool request to stream grounded model interpretation
  replaceLastAssistantText('')

  if (modelContext) {
    let formattedContext = ''
    if (allowedMatches.length > 0) {
      formattedContext = allowedMatches
        .map((m) => {
          const loc = m.chunk.page ? `Page ${m.chunk.page}` : m.chunk.section ? `Section ${m.chunk.section}` : ''
          const header = `[Document: "${m.doc.title}" (${m.doc.classification}${loc ? `, ${loc}` : ''})]`
          return `${header}
"""\n${m.chunk.text}\n"""`
        })
        .join('\n\n')
    } else {
      formattedContext = targetDocs
        .map((doc) => `[Document: "${doc.title}" (${doc.classification})]:
"""
${getDocumentFullText(doc)}
"""`)
        .join('\n\n')
    }

    const priorTurns = modelContext.turnMessages.slice(0, -1)
    const followUpMessages = [
      { role: 'system', content: modelContext.systemPrompt },
      ...priorTurns,
      {
        role: 'user',
        content: `${userQuery}

[Context from retrieved sovereign documents]:
${formattedContext}

Please analyze, summarize, or answer based on the above retrieved document content according to my request. Cite sources using [1], [2] notation corresponding to retrieved documents. Do not dump the raw files verbatim; provide your interpretation and structured answer directly.`,
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
      const firstDoc = targetDocs[0]!
      const firstContent = getDocumentFullText(firstDoc)
      replaceLastAssistantText(
        `I have reviewed the relevant documents including **${firstDoc.title}** [${firstDoc.classification}].

${firstContent.slice(0, 400)}${firstContent.length > 400 ? '...' : ''}`,
      )
    }
  }

  return true
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
  const turns = state.turns.map((t, idx) => (idx === lastIndex ? updatedTurn : t))
  const sessions = state.sessions.map((s) =>
    s.id === state.activeSessionId ? { ...s, turns, updatedAt: new Date().toISOString() } : s,
  )
  return { turns, sessions }
}

export function appendDelta(delta: string): void {
  const { turns, sessions } = withLastTurn((turn) => ({
    ...turn,
    text: turn.text + delta,
  }))
  commit({ ...state, turns, sessions })
}

export function finishTurn(errorText?: string): void {
  const { turns, sessions } = withLastTurn((turn) => ({
    ...turn,
    text: errorText ? `${turn.text}${turn.text ? '\n\n' : ''}${errorText}` : turn.text,
    streaming: false,
  }))
  commit({
    ...state,
    turns,
    sessions,
    generating: false,
    abort: undefined,
  })
}

export function abortTurn(): boolean {
  if (!state.generating || !state.abort) {
    return false
  }
  state.abort.abort()
  finishTurn('[Generation stopped by user]')
  return true
}
