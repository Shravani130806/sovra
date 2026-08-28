import { describe, expect, it } from 'vitest'
import {
  PRESET_PROMPTS,
  DEFAULT_SOVEREIGN_SYSTEM_PROMPT,
  buildTurnSystemPrompt,
} from '../src/client/live/preset-prompts.ts'
import {
  setContextLength,
  getModelsState,
  resetModelsState,
} from '../src/client/live/models-store.ts'

describe('preset prompts and context injection', () => {
  it('contains the 5 standard sovereign persona system prompts', () => {
    expect(PRESET_PROMPTS['document-analyst']).toContain('document analyst for the Sovereign AI Workbench')
    expect(PRESET_PROMPTS['engineering-vision']).toContain('engineering vision analyst for the Sovereign AI Workbench')
    expect(PRESET_PROMPTS['code-analysis']).toContain('code analysis agent for the Sovereign AI Workbench')
    expect(PRESET_PROMPTS['research']).toContain('research agent for the Sovereign AI Workbench')
    expect(PRESET_PROMPTS['artifact']).toContain('artifact generation agent for the Sovereign AI Workbench')
  })

  it('builds system prompt with persona and sovereign corpus documents', () => {
    const docs = [
      {
        title: 'a.txt',
        classification: 'RESTRICTED',
        content: 'Critical sovereign protocol specification',
        chunks: 3,
      },
    ]

    const prompt = buildTurnSystemPrompt('document-analyst', docs, 'Please review a.txt')
    expect(prompt).toContain('document analyst')
    expect(prompt).toContain('[SOVEREIGN DOCUMENT CORPUS]')
    expect(prompt).toContain('a.txt')
    expect(prompt).toContain('RESTRICTED')
    expect(prompt).toContain('Critical sovereign protocol specification')
  })

  it('falls back to default sovereign prompt when preset is unknown', () => {
    const prompt = buildTurnSystemPrompt('custom-persona', [])
    expect(prompt).toContain(DEFAULT_SOVEREIGN_SYSTEM_PROMPT)
  })

  it('updates model context length dynamically', () => {
    resetModelsState()
    setContextLength(16384)
    expect(getModelsState().current?.contextLength).toBe(16384)
    expect(getModelsState().capabilityRouting.main_chat.contextLength).toBe(16384)
  })
})
