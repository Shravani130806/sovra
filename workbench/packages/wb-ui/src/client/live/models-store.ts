/**
 * Sovereign AI Models store.
 *
 * Manages model discovery, selection, capability-based routing, and provider status
 * for Ollama and on-premise DeepSeek inference engines.
 *
 * @module @mrpl/dsh-workbench-ui/client/live/models-store
 */

export interface ReasoningEffort {
  id: string
  name: string
  description?: string | undefined
}

export interface ModelEntry {
  id: string
  name: string
  description?: string | undefined
  capabilities?: ('text' | 'image' | 'code' | 'reasoning' | 'embedding')[] | undefined
  contextLength?: number | undefined
  localOnly?: boolean | undefined
  reasoning?: {
    defaultEffort: 'low' | 'medium' | 'high'
    efforts: ReasoningEffort[]
  } | undefined
}

export interface ModelGroup {
  id: 'ollama' | 'deepseek' | string
  name: string
  description?: string | undefined
  isLocal: boolean
  models: ModelEntry[]
}

export interface ModelSelection {
  provider: string
  model: string
  reasoningEffort?: string | undefined
  contextLength?: number | undefined
}

export const CONTEXT_LENGTH_OPTIONS: readonly { value: number; label: string }[] = [
  { value: 2048, label: '2K (2,048 tokens)' },
  { value: 4096, label: '4K (4,096 tokens)' },
  { value: 8192, label: '8K (8,192 tokens)' },
  { value: 16384, label: '16K (16,384 tokens)' },
  { value: 32768, label: '32K (32,768 tokens)' },
  { value: 65536, label: '64K (65,536 tokens)' },
  { value: 131072, label: '128K (131,072 tokens)' },
] as const

export const DEFAULT_CONTEXT_LENGTH = 8192

export interface ModelFailure {
  id: string
  name: string
  message: string
}

export type ModelCapabilityRole =
  | 'main_chat'
  | 'coding'
  | 'embedding'
  | 'rerank'
  | 'ocr'
  | 'vision_reasoning'

export interface CapabilityRoleMeta {
  id: ModelCapabilityRole
  title: string
  description: string
  recommendedTag: string
  preferredCapability: 'text' | 'image' | 'code' | 'reasoning' | 'embedding'
}

export const CAPABILITY_ROLES: readonly CapabilityRoleMeta[] = [
  {
    id: 'main_chat',
    title: 'Main Chat & Reasoning',
    description: 'Primary sovereign conversational reasoning, general query answering, and document QA.',
    recommendedTag: 'qwen3.5:2b',
    preferredCapability: 'reasoning',
  },
  {
    id: 'coding',
    title: 'Coding & Sandboxing',
    description: 'Code synthesis, unit test generation, script verification, and automated diagnostics.',
    recommendedTag: 'qwen3.5:2b',
    preferredCapability: 'code',
  },
  {
    id: 'embedding',
    title: 'Vector Embedding',
    description: 'Document and query vectorization for semantic retrieval and knowledge indexing.',
    recommendedTag: 'nomic-embed-text',
    preferredCapability: 'embedding',
  },
  {
    id: 'rerank',
    title: 'Neural Reranker',
    description: 'Post-policy neural cross-encoder candidate chunk reranking for high-precision retrieval.',
    recommendedTag: 'bge-reranker-large',
    preferredCapability: 'text',
  },
  {
    id: 'ocr',
    title: 'Document OCR',
    description: 'Optical character recognition from scans, equipment tags, schematics, and PDF pages.',
    recommendedTag: 'glm-ocr:q8_0',
    preferredCapability: 'image',
  },
  {
    id: 'vision_reasoning',
    title: 'Vision & Diagram Inspection',
    description: 'Multimodal analysis of P&ID piping diagrams, electrical blueprints, and visual inspection.',
    recommendedTag: 'qwen3.5:2b',
    preferredCapability: 'image',
  },
] as const

export type CapabilityRoutingConfig = Record<ModelCapabilityRole, ModelSelection>

export const DEFAULT_CAPABILITY_ROUTING: CapabilityRoutingConfig = {
  main_chat: { provider: 'ollama', model: 'qwen3.5:2b', reasoningEffort: 'medium' },
  coding: { provider: 'ollama', model: 'qwen3.5:2b', reasoningEffort: 'medium' },
  embedding: { provider: 'ollama', model: 'nomic-embed-text' },
  rerank: { provider: 'ollama', model: 'bge-reranker-large' },
  ocr: { provider: 'ollama', model: 'glm-ocr:q8_0' },
  vision_reasoning: { provider: 'ollama', model: 'qwen3.5:2b' },
}

export interface ModelsState {
  groups: ModelGroup[]
  current: ModelSelection | null
  capabilityRouting: CapabilityRoutingConfig
  status: 'idle' | 'loading' | 'ready' | 'error'
  error: string | null
  strictLocalOnly: boolean
  ollamaEndpoint: string
  failures: ModelFailure[]
}

export const DEFAULT_OLLAMA_ENDPOINT = 'http://127.0.0.1:11434/v1'
const ROUTING_STORAGE_KEY = 'dsh:workbench:capability_routing'

function loadSavedRouting(): CapabilityRoutingConfig {
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const raw = window.localStorage.getItem(ROUTING_STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<CapabilityRoutingConfig>
        return { ...DEFAULT_CAPABILITY_ROUTING, ...parsed }
      }
    } catch {
      // ignore parse failure
    }
  }
  return DEFAULT_CAPABILITY_ROUTING
}

function saveRouting(routing: CapabilityRoutingConfig): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.setItem(ROUTING_STORAGE_KEY, JSON.stringify(routing))
    } catch {
      // ignore storage failure
    }
  }
}

const DEFAULT_GROUPS: ModelGroup[] = [
  {
    id: 'ollama',
    name: 'Ollama (Local Sovereign)',
    description: 'Direct local hardware inference via Ollama server',
    isLocal: true,
    models: [
      {
        id: 'qwen3.5:2b',
        name: 'Qwen 3.5 2B',
        description: 'Ultra-fast sovereign local reasoning & multimodal instruction model',
        capabilities: ['text', 'code', 'reasoning', 'image'],
        localOnly: true,
        contextLength: 32768,
        reasoning: {
          defaultEffort: 'medium',
          efforts: [
            { id: 'low', name: 'Low', description: 'Fast responses with basic chain of thought' },
            { id: 'medium', name: 'Medium', description: 'Balanced reasoning effort' },
            { id: 'high', name: 'High', description: 'Deep reasoning analysis' },
          ],
        },
      },
      {
        id: 'gemma4:e2b',
        name: 'Gemma 4 (e2b Local)',
        description: 'Lightweight local model with thinking capabilities',
        capabilities: ['text', 'reasoning'],
        localOnly: true,
        contextLength: 8192,
        reasoning: {
          defaultEffort: 'medium',
          efforts: [
            { id: 'low', name: 'Low', description: 'Fast responses' },
            { id: 'medium', name: 'Medium', description: 'Balanced reasoning' },
            { id: 'high', name: 'High', description: 'Deep analysis' },
          ],
        },
      },
      {
        id: 'nomic-embed-text',
        name: 'Nomic Embed Text',
        description: 'Sovereign high-dimensional embedding model for local RAG vectorization',
        capabilities: ['embedding'],
        localOnly: true,
        contextLength: 8192,
      },
    ],
  },
  {
    id: 'deepseek',
    name: 'DeepSeek (Sovereign On-Prem)',
    description: 'On-premise enterprise DeepSeek cluster',
    isLocal: true,
    models: [
      {
        id: 'deepseek-v4-flash',
        name: 'DeepSeek V4 Flash (Local)',
        description: 'High-speed reasoning model running on on-premise GPU nodes',
        capabilities: ['text', 'code', 'reasoning'],
        localOnly: true,
        contextLength: 65536,
      },
      {
        id: 'deepseek-v4-pro',
        name: 'DeepSeek V4 Pro (Local)',
        description: 'Full-capability sovereign engineering and synthesis engine',
        capabilities: ['text', 'code', 'image', 'reasoning'],
        localOnly: true,
        contextLength: 131072,
      },
    ],
  },
]

const initialRouting = loadSavedRouting()

export const INITIAL_MODELS_STATE: ModelsState = {
  groups: DEFAULT_GROUPS,
  current: initialRouting.main_chat ?? {
    provider: 'ollama',
    model: 'qwen3.5:2b',
    reasoningEffort: 'medium',
  },
  capabilityRouting: initialRouting,
  status: 'idle',
  error: null,
  strictLocalOnly: true,
  ollamaEndpoint: DEFAULT_OLLAMA_ENDPOINT,
  failures: [],
}

let state: ModelsState = INITIAL_MODELS_STATE
const listeners = new Set<() => void>()

export function subscribeModels(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getModelsState(): ModelsState {
  return state
}

function commit(next: ModelsState): void {
  state = next
  saveRouting(next.capabilityRouting)
  for (const listener of listeners) listener()
}

export async function selectModel(selection: ModelSelection): Promise<boolean> {
  const group = state.groups.find((g) => g.id === selection.provider)
  if (!group) {
    commit({
      ...state,
      error: `Unknown provider "${selection.provider}".`,
    })
    return false
  }

  const model = group.models.find((m) => m.id === selection.model)
  if (!model) {
    commit({
      ...state,
      error: `Unknown model "${selection.model}" on provider "${group.name}".`,
    })
    return false
  }

  const resolvedSelection: ModelSelection = {
    ...selection,
    ...(selection.reasoningEffort ? { reasoningEffort: selection.reasoningEffort } : model.reasoning?.defaultEffort ? { reasoningEffort: model.reasoning.defaultEffort } : {}),
    ...(selection.contextLength !== undefined ? { contextLength: selection.contextLength } : state.current?.contextLength !== undefined ? { contextLength: state.current.contextLength } : {}),
  }

  const updatedRouting = {
    ...state.capabilityRouting,
    main_chat: resolvedSelection,
  }

  commit({
    ...state,
    current: resolvedSelection,
    capabilityRouting: updatedRouting,
    error: null,
  })
  return true
}

export function setContextLength(contextLength: number): void {
  if (!state.current) return
  const nextSelection: ModelSelection = {
    ...state.current,
    contextLength,
  }
  commit({
    ...state,
    current: nextSelection,
    capabilityRouting: {
      ...state.capabilityRouting,
      main_chat: nextSelection,
    },
  })
}

export function setCapabilityModel(
  role: ModelCapabilityRole,
  selection: ModelSelection,
): void {
  const nextRouting: CapabilityRoutingConfig = {
    ...state.capabilityRouting,
    [role]: selection,
  }

  commit({
    ...state,
    capabilityRouting: nextRouting,
    ...(role === 'main_chat' ? { current: selection } : {}),
  })
}

export function setOllamaEndpoint(endpoint: string): void {
  commit({
    ...state,
    ollamaEndpoint: endpoint.trim() || DEFAULT_OLLAMA_ENDPOINT,
  })
}

export function setStrictLocalOnly(enabled: boolean): void {
  commit({
    ...state,
    strictLocalOnly: enabled,
  })
}

export async function fetchOllamaModels(endpointUrl?: string): Promise<void> {
  const base = (endpointUrl || state.ollamaEndpoint).replace(/\/+$/, '')
  commit({ ...state, status: 'loading', error: null })

  try {
    const tagsUrl = base.endsWith('/v1')
      ? `${base.replace(/\/v1$/, '')}/api/tags`
      : `${base}/api/tags`

    let discoveredModels: ModelEntry[] = []

    try {
      const res = await fetch(tagsUrl)
      if (res.ok) {
        const data = (await res.json()) as {
          models?: Array<{
            name: string
            details?: { parameter_size?: string; family?: string }
            capabilities?: string[]
          }>
        }
        if (data.models && Array.isArray(data.models)) {
          discoveredModels = data.models.map((m) => {
            const caps: ('text' | 'image' | 'code' | 'reasoning' | 'embedding')[] = ['text']
            const rawCaps = (m.capabilities || []).map((c) => c.toLowerCase())
            const nameLower = m.name.toLowerCase()

            if (rawCaps.includes('vision') || rawCaps.includes('image') || nameLower.includes('vl') || nameLower.includes('vision')) {
              caps.push('image')
            }
            if (rawCaps.includes('thinking') || rawCaps.includes('reasoning') || nameLower.includes('qwen3') || nameLower.includes('deepseek-r1') || nameLower.includes('gemma4')) {
              caps.push('reasoning')
            }
            if (nameLower.includes('coder') || nameLower.includes('code') || rawCaps.includes('code')) {
              caps.push('code')
            }
            if (nameLower.includes('embed') || rawCaps.includes('embedding')) {
              caps.push('embedding')
            }

            const hasReasoning = caps.includes('reasoning')

            return {
              id: m.name,
              name: m.name,
              description: `Ollama Local (${m.details?.parameter_size ?? 'Local weights'})`,
              capabilities: caps,
              localOnly: true,
              contextLength: 32768,
              ...(hasReasoning
                ? {
                    reasoning: {
                      defaultEffort: 'medium',
                      efforts: [
                        { id: 'low', name: 'Low', description: 'Fast reasoning' },
                        { id: 'medium', name: 'Medium', description: 'Standard analysis' },
                        { id: 'high', name: 'High', description: 'Deep reasoning' },
                      ],
                    },
                  }
                : {}),
            }
          })
        }
      }
    } catch {
      // Fall back to /v1/models if /api/tags fails
      const v1Url = base.endsWith('/v1') ? `${base}/models` : `${base}/v1/models`
      const res = await fetch(v1Url)
      if (res.ok) {
        const data = (await res.json()) as { data?: Array<{ id: string }> }
        if (data.data && Array.isArray(data.data)) {
          discoveredModels = data.data.map((m) => ({
            id: m.id,
            name: m.id,
            description: 'Discovered from local Ollama OpenAI endpoint',
            capabilities: ['text'],
            localOnly: true,
            contextLength: 8192,
          }))
        }
      }
    }

    if (discoveredModels.length > 0) {
      const updatedGroups = state.groups.map((g) =>
        g.id === 'ollama'
          ? {
              ...g,
              models: discoveredModels,
            }
          : g,
      )

      commit({
        ...state,
        groups: updatedGroups,
        status: 'ready',
        error: null,
      })
    } else {
      commit({
        ...state,
        status: 'ready',
        error: null,
      })
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    commit({
      ...state,
      status: 'error',
      error: `Could not connect to Ollama endpoint at ${base} (${message})`,
      failures: [
        {
          id: 'ollama',
          name: 'Ollama Discovery',
          message,
        },
      ],
    })
  }
}

export function resetModelsState(): void {
  state = {
    ...INITIAL_MODELS_STATE,
    capabilityRouting: DEFAULT_CAPABILITY_ROUTING,
    current: {
      provider: 'ollama',
      model: 'qwen3.5:2b',
      reasoningEffort: 'medium',
    },
  }
  commit(state)
}
