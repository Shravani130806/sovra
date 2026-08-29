import { describe, expect, it, beforeEach, vi } from 'vitest'
import {
  getModelsState,
  selectModel,
  setCapabilityModel,
  setOllamaEndpoint,
  setStrictLocalOnly,
  fetchOllamaModels,
  resetModelsState,
  DEFAULT_OLLAMA_ENDPOINT,
  DEFAULT_CAPABILITY_ROUTING,
} from '../src/client/live/models-store.ts'

describe('models-store', () => {
  beforeEach(() => {
    resetModelsState()
    vi.restoreAllMocks()
  })

  it('initializes with default Ollama and DeepSeek groups', () => {
    const state = getModelsState()
    expect(state.groups).toHaveLength(2)
    expect(state.groups[0]!.id).toBe('ollama')
    expect(state.groups[1]!.id).toBe('deepseek')
    expect(state.current).toEqual({
      provider: 'ollama',
      model: 'qwen3.5:2b',
      reasoningEffort: 'medium',
    })
    expect(state.strictLocalOnly).toBe(true)
    expect(state.ollamaEndpoint).toBe(DEFAULT_OLLAMA_ENDPOINT)
    expect(state.capabilityRouting).toEqual(DEFAULT_CAPABILITY_ROUTING)
  })

  it('selects an available model successfully and updates main_chat routing', async () => {
    const result = await selectModel({
      provider: 'ollama',
      model: 'gemma4:e2b',
    })
    expect(result).toBe(true)
    const state = getModelsState()
    expect(state.current?.model).toBe('gemma4:e2b')
    expect(state.current?.reasoningEffort).toBe('medium')
    expect(state.capabilityRouting.main_chat.model).toBe('gemma4:e2b')
    expect(state.error).toBeNull()
  })

  it('configures capability-specific models across all roles', () => {
    setCapabilityModel('embedding', { provider: 'ollama', model: 'nomic-embed-text' })
    setCapabilityModel('rerank', { provider: 'ollama', model: 'bge-reranker-large' })
    setCapabilityModel('ocr', { provider: 'ollama', model: 'glm-ocr:q8_0' })
    setCapabilityModel('coding', { provider: 'deepseek', model: 'deepseek-v4-flash' })
    setCapabilityModel('vision_reasoning', { provider: 'ollama', model: 'qwen3.5:2b' })

    const state = getModelsState()
    expect(state.capabilityRouting.embedding.model).toBe('nomic-embed-text')
    expect(state.capabilityRouting.rerank.model).toBe('bge-reranker-large')
    expect(state.capabilityRouting.ocr.model).toBe('glm-ocr:q8_0')
    expect(state.capabilityRouting.coding.model).toBe('deepseek-v4-flash')
    expect(state.capabilityRouting.vision_reasoning.model).toBe('qwen3.5:2b')
  })

  it('allows customizing reasoning effort when selecting reasoning model', async () => {
    const result = await selectModel({
      provider: 'ollama',
      model: 'gemma4:e2b',
      reasoningEffort: 'high',
    })
    expect(result).toBe(true)
    const state = getModelsState()
    expect(state.current?.reasoningEffort).toBe('high')
  })

  it('rejects unknown provider', async () => {
    const result = await selectModel({
      provider: 'unknown-provider',
      model: 'any-model',
    })
    expect(result).toBe(false)
    const state = getModelsState()
    expect(state.error).toContain('Unknown provider')
  })

  it('rejects unknown model on a valid provider', async () => {
    const result = await selectModel({
      provider: 'ollama',
      model: 'non-existent-model',
    })
    expect(result).toBe(false)
    const state = getModelsState()
    expect(state.error).toContain('Unknown model')
  })

  it('updates Ollama endpoint and strict local mode', () => {
    setOllamaEndpoint('http://192.168.1.100:11434/v1')
    expect(getModelsState().ollamaEndpoint).toBe('http://192.168.1.100:11434/v1')

    setStrictLocalOnly(false)
    expect(getModelsState().strictLocalOnly).toBe(false)
  })

  it('discovers models from Ollama /api/tags or /v1/models endpoint', async () => {
    const mockModels = {
      models: [
        { name: 'qwen3.5:2b', details: { parameter_size: '2.3B' }, capabilities: ['completion', 'thinking', 'vision'] },
        { name: 'nomic-embed-text', details: { parameter_size: '137M' }, capabilities: ['embedding'] },
      ],
    }

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => mockModels,
    } as Response)

    await fetchOllamaModels('http://127.0.0.1:11434/v1')
    const state = getModelsState()
    expect(state.status).toBe('ready')
    const ollamaGroup = state.groups.find((g) => g.id === 'ollama')
    expect(ollamaGroup?.models).toHaveLength(2)
    expect(ollamaGroup?.models[0]!.id).toBe('qwen3.5:2b')
    expect(ollamaGroup?.models[0]!.capabilities).toContain('reasoning')
    expect(ollamaGroup?.models[0]!.capabilities).toContain('image')
    expect(ollamaGroup?.models[1]!.capabilities).toContain('embedding')
  })

  it('handles Ollama connection failure cleanly', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Connection refused'))

    await fetchOllamaModels('http://127.0.0.1:11434/v1')
    const state = getModelsState()
    expect(state.status).toBe('error')
    expect(state.error).toContain('Could not connect to Ollama')
    expect(state.failures).toHaveLength(1)
    expect(state.failures[0]!.id).toBe('ollama')
  })
})
