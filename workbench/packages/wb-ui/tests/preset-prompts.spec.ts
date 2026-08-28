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

  it('builds system prompt with persona and sovereign corpus documents metadata without leaking raw content', () => {
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
    // Corpus document contents must NOT be leaked into prompt; access requires tool invocation
    expect(prompt).not.toContain('Critical sovereign protocol specification')
    expect(prompt).toContain('MUST use policy-governed tools')
  })

  it('includes direct chat attachments content directly in prompt', () => {
    const directAttachments = [
      {
        name: 'notes.txt',
        content: 'Direct meeting notes from chat attachment',
      },
    ]

    const prompt = buildTurnSystemPrompt('document-analyst', [], 'Look at my notes', directAttachments)
    expect(prompt).toContain('[DIRECT CHAT ATTACHMENTS]')
    expect(prompt).toContain('notes.txt')
    expect(prompt).toContain('Direct meeting notes from chat attachment')
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
