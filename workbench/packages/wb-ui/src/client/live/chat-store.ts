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
  addCorpusDocument,
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
  if (clearStorage && typeof window !== 'undefined' && window.localStorage) {
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

function withLastTurn(
  updater: (turn: ChatTurn) => ChatTurn,
): { turns: ChatTurn[]; sessions: ChatSession[] } {
  if (state.turns.length === 0) return { turns: state.turns, sessions: state.sessions }

  const lastIndex = state.turns.length - 1
  const updated = updater(state.turns[lastIndex]!)
  const turns = state.turns.map((t, idx) => (idx === lastIndex ? updated : t))

  const sessions = state.sessions.map((s) => {
    if (s.id === state.activeSessionId) {
      return { ...s, turns, updatedAt: new Date().toISOString() }
    }
    return s
  })

  return { turns, sessions }
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

export function appendDelta(delta: string): void {
  const { turns, sessions } = withLastTurn((turn) => ({
    ...turn,
    text: turn.text + delta,
  }))
  commit({ ...state, turns, sessions })
}

export function finishTurn(fallbackText?: string): void {
  const { turns, sessions } = withLastTurn((turn) => ({
    ...turn,
    streaming: false,
    text: turn.text || fallbackText || '(no response)',
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
  if (!state.abort || !state.generating) return false
  state.abort.abort()
  const { turns, sessions } = withLastTurn((turn) => ({
    ...turn,
    streaming: false,
    text: turn.text ? `${turn.text}\n\n*[Generation stopped by user]*` : '*[Generation stopped by user]*',
  }))
  commit({
    ...state,
    turns,
    sessions,
    generating: false,
    abort: undefined,
  })
  return true
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

const STOPWORDS = new Set([
  'a', 'about', 'above', 'after', 'again', 'against', 'all', 'am', 'an', 'and', 'any', 'are', 'aren',
  'as', 'at', 'be', 'because', 'been', 'before', 'being', 'below', 'between', 'both', 'but', 'by',
  'can', 'could', 'did', 'do', 'does', 'doing', 'down', 'during', 'each', 'few', 'for', 'from',
  'further', 'had', 'has', 'have', 'having', 'he', 'her', 'here', 'hers', 'herself', 'him',
  'himself', 'his', 'how', 'i', 'if', 'in', 'into', 'is', 'it', 'its', 'itself', 'just', 'me',
  'more', 'most', 'my', 'myself', 'no', 'nor', 'not', 'now', 'of', 'off', 'on', 'once', 'only',
  'or', 'other', 'our', 'ours', 'ourselves', 'out', 'over', 'own', 'same', 'she', 'should', 'so',
  'some', 'such', 'than', 'that', 'the', 'their', 'theirs', 'them', 'themselves', 'then', 'there',
  'these', 'they', 'this', 'those', 'through', 'to', 'too', 'under', 'until', 'up', 'very', 'was',
  'we', 'were', 'what', 'when', 'where', 'which', 'while', 'who', 'whom', 'why', 'with', 'would',
  'you', 'your', 'yours', 'yourself', 'yourselves', 'create', 'make', 'write', 'generate', 'doc',
  'docs', 'document', 'documents', 'file', 'files', 'tell', 'show', 'give', 'only', 'written',
  'please', 'help', 'want', 'need', 'like', 'hello', 'hi', 'hey', 'okay', 'thanks', 'thank',
  'prepare', 'sheet', 'sheets', 'excel', 'spreadsheet', 'spreadsheets', 'table', 'tables',
])

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9_-]+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t))
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

  if (allTokens.length === 0 && !targetPath) {
    return { matches: [], matchedDocs: [] }
  }

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
        titleScore += 3
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
          chunkScore += 1.5
        }
        if (chunkSection.includes(token)) {
          chunkScore += 2
        }
      }

      const totalScore = chunkScore + titleScore
      // Require meaningful score
      if (totalScore >= 3 || (targetPath && titleScore >= 5)) {
        docHasPositiveChunk = true
        allChunkMatches.push({
          doc,
          chunk,
          score: totalScore,
        })
      }
    }

    if (titleScore >= 3 && !docHasPositiveChunk && chunks.length > 0) {
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

function isDocCreationIntent(query: string, modelText = ''): boolean {
  const trimmed = query.trim().toLowerCase()
  const hasUserIntent =
    /\b(?:create|generate|write|make|save|export|build|prepare|draft|compile|produce|set\s*up|put\s+together)\s+(?:an?\s+)?(?:new\s+)?(?:excel|sheet|spreadsheet|workbook|table|csv|xlsx|xls|doc|docx|document|file|report|approval\s*note|note|presentation|pptx|slide)\b/i.test(trimmed) ||
    /\b(?:excel|spreadsheet|sheet|workbook|table|xlsx|docx?|document|report|approval\s*note)\s+(?:with|containing|for|of|having|listing)\b/i.test(trimmed) ||
    /\b(?:export|save)\s+(?:this|as|to)\s+(?:an?\s+)?(?:excel|spreadsheet|sheet|xlsx|csv|docx?|doc|file)\b/i.test(trimmed)

  const hasModelTable =
    /\|[\s\S]+?\|[\s\S]+?\|/m.test(modelText) &&
    /\b(?:excel|spreadsheet|sheet|table|csv|xlsx)\b/i.test(query)

  const hasModelDocDeclaration =
    /\*\*(?:File\s*Name|Filename|Document|Spreadsheet|Artifact):\*\*/i.test(modelText)

  return hasUserIntent || hasModelTable || hasModelDocDeclaration
}

function extractDocCreationDetails(
  query: string,
  modelText: string,
  toolArgs?: Record<string, unknown>,
): { title: string; content: string; classification: WbClassification; toolName: string } {
  let rawTool = (toolArgs?.tool ?? toolArgs?.action ?? 'create_document') as string
  let title = (toolArgs?.title ?? toolArgs?.path ?? toolArgs?.name ?? toolArgs?.filename) as string | undefined
  let content = (toolArgs?.content ?? toolArgs?.findings ?? toolArgs?.text ?? toolArgs?.body) as string | undefined
  const classification = ((toolArgs?.classification as string) ?? 'INTERNAL').toUpperCase() as WbClassification

  const wantsTxt = /\b(?:text\s+file|\.txt)\b/i.test(query)
  const wantsMd = /\b(?:markdown|\.md)\b/i.test(query)
  const wantsJson = /\b(?:json|\.json)\b/i.test(query)
  const wantsCsv = /\b(?:csv|\.csv)\b/i.test(query)
  const wantsXlsx =
    /\b(?:excel|spreadsheet|sheet|workbook|table|\.xlsx?)\b/i.test(query) ||
    rawTool === 'wb_generate_spreadsheet'

  const defaultExt = wantsTxt
    ? '.txt'
    : wantsMd
    ? '.md'
    : wantsJson
    ? '.json'
    : wantsCsv
    ? '.csv'
    : wantsXlsx
    ? '.xlsx'
    : '.docx'

  if (wantsXlsx && (rawTool === 'create_document' || rawTool === 'create_doc' || !rawTool)) {
    rawTool = 'wb_generate_spreadsheet'
  }

  if (!title) {
    const modelFileMatch = modelText.match(/\*\*(?:File\s*Name|Filename):\*\*\s*[`*"]?([a-zA-Z0-9_\-.]+\.[a-zA-Z0-9]+)[`*"]?/i)
    if (modelFileMatch && modelFileMatch[1]) {
      title = modelFileMatch[1]
    } else {
      const namedMatch = query.match(/(?:named|called|titled|filename)\s+["']?([^"'\s,]+)["']?/i)
      if (namedMatch && namedMatch[1]) {
        title = namedMatch[1]
      } else {
        const quoteMatch = query.match(/["']([^"']+)["']/)
        if (quoteMatch && quoteMatch[1] && quoteMatch[1].length < 30) {
          title = `${quoteMatch[1].replace(/\s+/g, '_')}${defaultExt}`
        } else {
          const subjectMatch = query.match(/(?:containing|for|of|with|about)\s+([a-zA-Z0-9_\s]{3,25})/i)
          if (subjectMatch && subjectMatch[1]) {
            title = `${subjectMatch[1].trim().replace(/\s+/g, '_')}${defaultExt}`
          } else {
            title = wantsXlsx ? 'Spreadsheet_Data.xlsx' : `Generated_Document${defaultExt}`
          }
        }
      }
    }
  }

  if (!title.includes('.')) {
    title = `${title}${defaultExt}`
  } else if (title.toLowerCase().endsWith('.doc')) {
    title = `${title}x`
  } else if (title.toLowerCase().endsWith('.xls')) {
    title = `${title}x`
  }

  if (!content) {
    if (wantsXlsx) {
      const lines = modelText.split('\n')
      const tableLines: string[] = []
      let insideTable = false
      for (const line of lines) {
        const trimmed = line.trim()
        if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
          insideTable = true
          tableLines.push(trimmed)
        } else if (insideTable) {
          if (!trimmed) {
            // allow blank line
          } else {
            break
          }
        }
      }
      if (tableLines.length >= 2) {
        content = tableLines.join('\n')
      }
    }

    if (!content) {
      const quoteMatch = query.match(/["']([^"']+)["']/)
      if (quoteMatch && quoteMatch[1]) {
        content = quoteMatch[1]
      } else {
        const cleanModelText = modelText
          .replace(/```(?:json)?\s*[\s\S]*?\s*```/g, '')
          .replace(/^📄.*$/gm, '')
          .replace(/^📊.*$/gm, '')
          .trim()
        content = cleanModelText || 'Data generated by Sovereign AI Workbench.'
      }
    }
  }

  return {
    title,
    content,
    classification,
    toolName: rawTool || (wantsXlsx ? 'wb_generate_spreadsheet' : 'create_document'),
  }
}

/**
 * Checks for tool calling intentions or RAG retrieval needs against the Sovereign Document Corpus
 * and executes them against the SOVRA policy engine with accurate citations and artifact generation.
 */
async function handleToolCallingAndPolicy(
  userQuery: string,
  accumulatedAssistantText: string,
  modelContext?: ModelTurnContext,
): Promise<boolean> {
  const docs = getDocumentsState().documents
  const currentUser = getCurrentUser()
  const userRank = CLASSIFICATION_RANK[currentUser.clearance] ?? 1
  const currentSessionId = asWbSessionId(state.activeSessionId)
  const currentUserId = currentUser.id
  const callId = `call-${Date.now()}`

  let parsedToolArgs: Record<string, unknown> | undefined
  let toolName = 'read'
  let targetFilename: string | undefined

  // 1. Check for JSON tool call in assistant text
  const jsonMatch = accumulatedAssistantText.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
  if (jsonMatch && jsonMatch[1]) {
    try {
      const parsed = JSON.parse(jsonMatch[1].trim()) as Record<string, unknown>
      parsedToolArgs = parsed
      toolName = (parsed.tool ?? parsed.actionType ?? parsed.action ?? 'read') as string
      const path = (parsed.path ?? parsed.file ?? parsed.filename ?? parsed.documentId ?? parsed.request ?? parsed.query ?? parsed.q) as string | undefined
      if (path) {
        targetFilename = path.replace(/^\/Documents\//i, '').replace(/^\.\//, '').replace(/^["']|["']$/g, '').trim()
      }
    } catch {
      // Non-JSON block
    }
  }

  // 2. Handle Document / Artifact Creation Tools & Creation Intent
  const isCreationTool = [
    'create_document',
    'create_doc',
    'write',
    'save_document',
    'wb_generate_report',
    'wb_generate_approval_note',
    'wb_generate_spreadsheet',
    'wb_generate_presentation',
  ].includes(toolName)

  const isCreationIntent = isCreationTool || isDocCreationIntent(userQuery, accumulatedAssistantText)

  if (isCreationIntent) {
    const { title: docTitle, content: docContent, classification: docClass, toolName: execTool } =
      extractDocCreationDetails(userQuery, accumulatedAssistantText, parsedToolArgs)

    const targetRank = CLASSIFICATION_RANK[docClass] ?? 1

    if (targetRank > userRank) {
      const reason = `Policy DENY: Cannot create document "${docTitle}" with classification ${docClass} exceeding clearance ${currentUser.clearance}.`

      upsertToolNode({
        callId,
        name: execTool,
        args: { title: docTitle, classification: docClass },
        status: 'denied',
        decision: 'DENY',
        decisionReason: reason,
      })

      publishPolicyDecision({
        user: currentUserId,
        sessionId: currentSessionId,
        agentPreset: state.preset,
        action: 'write_data',
        resource: docTitle,
        decision: 'DENY',
        reason,
        destination: 'local',
        classification: docClass,
      })

      publishAuditEntry({
        id: asWbAuditEntryId(`audit-${Date.now()}`),
        sessionId: currentSessionId,
        userId: currentUserId,
        at: new Date().toISOString(),
        kind: 'policy_decision',
        summary: `Policy DENY: Blocked creation of ${docClass} file "${docTitle}" for ${currentUser.displayName}`,
        payload: { decision: 'DENY', name: execTool, value: { title: docTitle, classification: docClass } },
      })

      publishChatDecision('DENY', reason)

      const denialText = `🛡️ **Policy Intercept (DENY)**: Creation of file \`${docTitle}\` (Classification: \`${docClass}\`) was **blocked** by the SOVRA Policy Engine.\n\n*Reason*: The target classification exceeds your clearance level (\`${currentUser.clearance}\`).`
      replaceLastAssistantText(denialText)
      return true
    }

    // Policy ALLOW - Store in Sovereign Document Corpus & Workbench Artifacts
    addCorpusDocument({
      title: docTitle,
      content: docContent,
      classification: docClass,
    })

    upsertToolNode({
      callId,
      name: execTool,
      args: { title: docTitle, classification: docClass },
      status: 'done',
      decision: 'ALLOW',
      result: `File "${docTitle}" generated and registered in corpus. (${docContent.length} bytes)`,
    })

    publishPolicyDecision({
      user: currentUserId,
      sessionId: currentSessionId,
      agentPreset: state.preset,
      action: 'write_data',
      resource: docTitle,
      decision: 'ALLOW',
      reason: `Policy ALLOW: Permitted file creation "${docTitle}" [${docClass}] for ${currentUser.displayName}.`,
      destination: 'local',
      classification: docClass,
    })

    publishAuditEntry({
      id: asWbAuditEntryId(`audit-${Date.now()}`),
      sessionId: currentSessionId,
      userId: currentUserId,
      at: new Date().toISOString(),
      kind: 'policy_decision',
      summary: `Policy ALLOW: Permitted creation of ${docClass} file "${docTitle}" for ${currentUser.displayName}`,
      payload: { decision: 'ALLOW', name: execTool, value: { title: docTitle, classification: docClass } },
    })

    publishAuditEntry({
      id: asWbAuditEntryId(`audit-${Date.now() + 1}`),
      sessionId: currentSessionId,
      userId: currentUserId,
      at: new Date().toISOString(),
      kind: 'tool_result',
      summary: `Tool ${execTool} created "${docTitle}"`,
      payload: {
        name: execTool,
        value: {
          path: docTitle,
          content: docContent,
          classification: docClass,
          size: docContent.length,
          citations: parsedToolArgs?.citations ?? [],
        },
      },
    })

    publishChatDecision('ALLOW', '')

    const isSpreadsheet = docTitle.toLowerCase().endsWith('.xlsx') || execTool === 'wb_generate_spreadsheet'
    const successMessage = isSpreadsheet
      ? `📊 **Spreadsheet Created & Registered in Artifacts**\n\n- **Filename:** \`${docTitle}\`\n- **Format:** \`Microsoft Excel OpenXML (.xlsx)\`\n- **Classification:** \`${docClass}\`\n- **Size:** ${docContent.length} bytes\n\n${docContent.startsWith('|') ? docContent : '```\n' + docContent + '\n```'}\n\n*The spreadsheet is available in the **Artifacts panel** on the right for instant binary download as a real `.xlsx` file.*`
      : `📄 **Document Created & Registered in Corpus**\n\n- **Filename:** \`${docTitle}\`\n- **Format:** \`Microsoft Word (.docx)\`\n- **Classification:** \`${docClass}\`\n- **Size:** ${docContent.length} bytes\n\n\`\`\`\n${docContent}\n\`\`\`\n\n*The document has been added to the Sovereign Document Corpus and Artifacts panel.*`

    replaceLastAssistantText(successMessage)
    return true
  }

  // 3. Handle Document Read / RAG Retrieval
  if (docs.length === 0) return false

  const { matches, matchedDocs } = searchCorpusChunks(userQuery, docs, targetFilename)

  // Only trigger RAG if an explicit tool call was emitted OR high-confidence matches found on an informational query
  if (matchedDocs.length === 0 && !targetFilename) {
    return false
  }

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
    const denialText = `${cleanText ? cleanText + '\n\n' : ''}🛡️ **Policy Intercept (DENY)**: Access to document \`${blockedDoc.title}\` (Classification: \`${blockedClass}\`) was evaluated and **blocked** by the SOVRA Policy Engine.\n\n*Reason*: The document's classification level (\`${blockedClass}\`) exceeds your current session clearance (\`${currentUser.clearance}\` for user **${currentUser.displayName}**). Switch to a user with \`${blockedClass}\` or \`RESTRICTED\` clearance to access this document.`
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
          return `${header}\n"""\n${m.chunk.text}\n"""`
        })
        .join('\n\n')
    } else {
      formattedContext = targetDocs
        .map((doc) => `[Document: "${doc.title}" (${doc.classification})]:\n"""\n${getDocumentFullText(doc)}\n"""`)
        .join('\n\n')
    }

    const priorTurns = modelContext.turnMessages.slice(0, -1)
    const followUpMessages = [
      { role: 'system', content: modelContext.systemPrompt },
      ...priorTurns,
      {
        role: 'user',
        content: `${userQuery}\n\n[Context from retrieved sovereign documents]:\n${formattedContext}\n\nPlease analyze, summarize, or answer based on the above retrieved document content according to my request. Cite sources using [1], [2] notation corresponding to retrieved documents. Do not dump the raw files verbatim; provide your interpretation and structured answer directly.`,
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
        `I have reviewed the relevant documents including **${firstDoc.title}** [${firstDoc.classification}].\n\n${firstContent.slice(0, 400)}${firstContent.length > 400 ? '...' : ''}`,
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
    const message = err instanceof Error ? err.message : String(err)
    // Attempt tool calling/creation even if streaming endpoint failed (e.g. mock/offline model)
    try {
      const handled = await handleToolCallingAndPolicy(text, '')
      if (handled) {
        finishTurn()
        return
      }
    } catch {
      // Ignore
    }
    finishTurn(`\n\n[Inference Error: ${message}. Verify local model endpoint is running on ${endpoint}]`)
  }
}
