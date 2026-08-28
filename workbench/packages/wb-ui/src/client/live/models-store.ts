/**
 * Sovereign AI Models store.
 *
 * Manages model discovery, selection, capabilities, and provider status
 * for Ollama and on-premise DeepSeek inference engines.
 *
 * @module @mrpl/dsh-workbench-ui/client/live/models-store
 */

export interface ReasoningEffort {
  id: string
  name: string
  description?: string
}

export interface ModelEntry {
  id: string
  name: string
  description?: string
  capabilities?: ('text' | 'image' | 'code' | 'reasoning')[]
  contextLength?: number
  localOnly?: boolean
  reasoning?: {
    defaultEffort: 'low' | 'medium' | 'high'
    efforts: ReasoningEffort[]
  }
}

export interface ModelGroup {
  id: 'ollama' | 'deepseek' | string
  name: string
  description?: string
  isLocal: boolean
  models: ModelEntry[]
}

export interface ModelSelection {
  provider: string
  model: string
  reasoningEffort?: string | undefined
}

export interface ModelFailure {
  id: string
  name: string
  message: string
}

export interface ModelsState {
  groups: ModelGroup[]
  current: ModelSelection | null
  status: 'idle' | 'loading' | 'ready' | 'error'
  error: string | null
  strictLocalOnly: boolean
  ollamaEndpoint: string
  failures: ModelFailure[]
}

export const DEFAULT_OLLAMA_ENDPOINT = 'http://127.0.0.1:11434/v1'

const DEFAULT_GROUPS: ModelGroup[] = [
  {
    id: 'ollama',
    name: 'Ollama (Local Sovereign)',
    description: 'Local air-gapped models running on the workstation host',
    isLocal: true,
    models: [
      {
        id: 'qwen3.5:2b',
        name: 'Qwen 3.5 (2B Local)',
        description: 'Installed local vision, thinking & tool-calling model',
        capabilities: ['text', 'image', 'reasoning'],
        localOnly: true,
        reasoning: {
          defaultEffort: 'medium',
          efforts: [
            { id: 'low', name: 'Low', description: 'Faster responses with concise reasoning' },
            { id: 'medium', name: 'Medium', description: 'Balanced reasoning budget' },
            { id: 'high', name: 'High', description: 'Thorough, exhaustive step-by-step reasoning' },
          ],
        },
      },
      {
        id: 'gemma4:e2b',
        name: 'Gemma 4 (e2b Local)',
        description: 'Installed local thinking & tool-calling assistant',
        capabilities: ['text', 'reasoning'],
        localOnly: true,
        reasoning: {
          defaultEffort: 'medium',
          efforts: [
            { id: 'low', name: 'Low', description: 'Faster responses with concise reasoning' },
            { id: 'medium', name: 'Medium', description: 'Balanced reasoning budget' },
            { id: 'high', name: 'High', description: 'Thorough, exhaustive step-by-step reasoning' },
          ],
        },
      },
      {
        id: 'glm-ocr:q8_0',
        name: 'GLM OCR (1.1B Local)',
        description: 'Local vision & OCR inspection model',
        capabilities: ['text', 'image'],
        localOnly: true,
      },
    ],
  },
  {
    id: 'deepseek',
    name: 'DeepSeek (Sovereign On-Prem)',
    description: 'High-parameter sovereign cluster models behind private enterprise gateway',
    isLocal: true,
    models: [
      {
        id: 'deepseek-v4-flash',
        name: 'DeepSeek-V4-Flash',
        description: 'Low-latency sovereign model',
        capabilities: ['text'],
        localOnly: true,
      },
      {
        id: 'deepseek-v4-pro',
        name: 'DeepSeek-V4-Pro',
        description: 'Deep sovereign reasoning and analysis',
        capabilities: ['text', 'reasoning'],
        localOnly: true,
        reasoning: {
          defaultEffort: 'high',
          efforts: [
            { id: 'low', name: 'Low' },
            { id: 'medium', name: 'Medium' },
            { id: 'high', name: 'High' },
          ],
        },
      },
    ],
  },
]

const INITIAL_STATE: ModelsState = {
  groups: DEFAULT_GROUPS,
  current: {
    provider: 'ollama',
    model: 'qwen3.5:2b',
    reasoningEffort: 'medium',
  },
  status: 'idle',
  error: null,
  strictLocalOnly: true,
  ollamaEndpoint: DEFAULT_OLLAMA_ENDPOINT,
  failures: [],
}

let state: ModelsState = { ...INITIAL_STATE }
const listeners = new Set<() => void>()

function commit(next: ModelsState): void {
  state = next
  for (const listener of listeners) {
    listener()
  }
}

export function getModelsState(): ModelsState {
  return state
}

export function subscribeModels(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function resetModelsState(): void {
  commit({
    ...INITIAL_STATE,
    groups: DEFAULT_GROUPS,
    current: {
      provider: 'ollama',
      model: 'qwen3.5:2b',
      reasoningEffort: 'medium',
    },
    failures: [],
  })
}

export function setOllamaEndpoint(url: string): void {
  commit({
    ...state,
    ollamaEndpoint: url,
  })
}

export function setStrictLocalOnly(enabled: boolean): void {
  commit({
    ...state,
    strictLocalOnly: enabled,
  })
}

export async function selectModel(selection: ModelSelection): Promise<boolean> {
  const group = state.groups.find((g) => g.id === selection.provider)
  if (!group) {
    commit({
      ...state,
      error: `Unknown provider: ${selection.provider}`,
    })
    return false
  }

  const model = group.models.find((m) => m.id === selection.model)
  if (!model) {
    commit({
      ...state,
      error: `Unknown model "${selection.model}" under provider ${group.name}`,
    })
    return false
  }

  commit({
    ...state,
    current: {
      provider: selection.provider,
      model: selection.model,
      reasoningEffort:
        selection.reasoningEffort ??
        model.reasoning?.defaultEffort ??
        state.current?.reasoningEffort,
    },
    error: null,
  })
  return true
}

export async function fetchOllamaModels(endpoint?: string): Promise<void> {
  const rawTarget = (endpoint ?? state.ollamaEndpoint).replace(/\/+$/, '')
  const baseHost = rawTarget.replace(/\/v1$/, '')
  commit({ ...state, status: 'loading', error: null })

  try {
    let discoveredModels: ModelEntry[] = []

    // 1. Attempt native Ollama /api/tags endpoint for rich capabilities
    try {
      const tagsRes = await fetch(`${baseHost}/api/tags`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      })
      if (tagsRes.ok) {
        const tagsData = (await tagsRes.json()) as {
          models?: Array<{
            name: string
            model: string
            details?: {
              parameter_size?: string
              family?: string
            }
            capabilities?: string[]
          }>
        }
        if (tagsData && Array.isArray(tagsData.models) && tagsData.models.length > 0) {
          discoveredModels = tagsData.models
            // Filter out pure embedding models from chat list
            .filter((item) => {
              const caps = item.capabilities ?? []
              return !caps.includes('embedding') || caps.includes('completion')
            })
            .map((item) => {
              const caps = item.capabilities ?? []
              const hasVision = caps.includes('vision') || item.name.includes('vision') || item.name.includes('ocr')
              const hasThinking = caps.includes('thinking') || caps.includes('reasoning') || item.name.includes('r1')
              const hasCode = item.name.includes('coder') || item.name.includes('code')

              const capabilities: ('text' | 'image' | 'code' | 'reasoning')[] = ['text']
              if (hasVision) capabilities.push('image')
              if (hasCode) capabilities.push('code')
              if (hasThinking) capabilities.push('reasoning')

              const paramSize = item.details?.parameter_size ? ` (${item.details.parameter_size})` : ''
              return {
                id: item.name,
                name: `${item.name}${paramSize}`,
                description: `Local Ollama model [${capabilities.join(', ')}]`,
                capabilities,
                localOnly: true,
                ...(hasThinking
                  ? {
                      reasoning: {
                        defaultEffort: 'medium',
                        efforts: [
                          { id: 'low', name: 'Low', description: 'Faster responses with concise reasoning' },
                          { id: 'medium', name: 'Medium', description: 'Balanced reasoning budget' },
                          { id: 'high', name: 'High', description: 'Thorough, exhaustive step-by-step reasoning' },
                        ],
                      },
                    }
                  : {}),
              }
            })
        }
      }
    } catch {
      // Fall through to /v1/models
    }

    // 2. Fallback to OpenAI-compatible /v1/models endpoint
    if (discoveredModels.length === 0) {
      const v1Url = rawTarget.endsWith('/v1') ? `${rawTarget}/models` : `${rawTarget}/v1/models`
      const res = await fetch(v1Url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      })

      if (!res.ok) {
        throw new Error(`Ollama responded with HTTP ${res.status}: ${res.statusText}`)
      }

      const data = (await res.json()) as { data?: Array<{ id: string; object?: string }> }
      if (!data || !Array.isArray(data.data)) {
        throw new Error('Invalid models response received from Ollama')
      }

      discoveredModels = data.data
        .filter((item) => !item.id.includes('embed'))
        .map((item) => {
          const isVision = item.id.toLowerCase().includes('vision') || item.id.toLowerCase().includes('ocr')
          const isReasoning = item.id.toLowerCase().includes('r1') || item.id.toLowerCase().includes('thinking') || item.id.toLowerCase().includes('qwen3') || item.id.toLowerCase().includes('gemma')
          const isCode = item.id.toLowerCase().includes('coder') || item.id.toLowerCase().includes('code')

          const capabilities: ('text' | 'image' | 'code' | 'reasoning')[] = ['text']
          if (isVision) capabilities.push('image')
          if (isCode) capabilities.push('code')
          if (isReasoning) capabilities.push('reasoning')

          return {
            id: item.id,
            name: item.id,
            description: `Discovered from local Ollama (${capabilities.join(', ')})`,
            capabilities,
            localOnly: true,
            ...(isReasoning
              ? {
                  reasoning: {
                    defaultEffort: 'medium',
                    efforts: [
                      { id: 'low', name: 'Low' },
                      { id: 'medium', name: 'Medium' },
                      { id: 'high', name: 'High' },
                    ],
                  },
                }
              : {}),
          }
        })
    }

    if (discoveredModels.length === 0) {
      throw new Error('No compatible chat/vision models found in Ollama.')
    }

    const updatedGroups = state.groups.map((g) => {
      if (g.id === 'ollama') {
        return {
          ...g,
          models: discoveredModels,
        }
      }
      return g
    })

    // If current model is not in discovered models, select the first available
    let nextCurrent = state.current
    if (state.current?.provider === 'ollama') {
      const exists = discoveredModels.some((m) => m.id === state.current?.model)
      if (!exists && discoveredModels[0]) {
        nextCurrent = {
          provider: 'ollama',
          model: discoveredModels[0].id,
          ...(discoveredModels[0].reasoning?.defaultEffort
            ? { reasoningEffort: discoveredModels[0].reasoning.defaultEffort }
            : {}),
        }
      }
    }

    commit({
      ...state,
      groups: updatedGroups,
      current: nextCurrent,
      status: 'ready',
      error: null,
      failures: state.failures.filter((f) => f.id !== 'ollama'),
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    const failures: ModelFailure[] = [
      ...state.failures.filter((f) => f.id !== 'ollama'),
      { id: 'ollama', name: 'Ollama', message },
    ]
    commit({
      ...state,
      status: 'error',
      error: `Could not connect to Ollama at ${rawTarget}: ${message}`,
      failures,
    })
  }
}
