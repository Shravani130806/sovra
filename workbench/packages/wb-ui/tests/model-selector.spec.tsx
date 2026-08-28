import { describe, expect, it, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, act } from './render.tsx'
import { ModelSelector } from '../src/client/conversation/ModelSelector.tsx'
import {
  getModelsState,
  resetModelsState,
  selectModel,
} from '../src/client/live/models-store.ts'

describe('ModelSelector', () => {
  beforeEach(() => {
    resetModelsState()
    vi.restoreAllMocks()
    vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: async () => ({ models: [] }),
      } as Response),
    )
  })

  it('renders trigger button showing active model name', () => {
    render(<ModelSelector />)
    const trigger = screen.getByRole('button', { name: /Current model/i })
    expect(trigger).toBeDefined()
    expect(trigger.textContent).toContain('Qwen 3.5')
    expect(trigger.textContent).toContain('Local')
  })

  it('opens menu on click and displays provider-grouped models', () => {
    render(<ModelSelector />)
    const trigger = screen.getByRole('button', { name: /Current model/i })
    fireEvent.click(trigger)

    expect(screen.getByRole('listbox', { name: 'Model Selection' })).toBeDefined()
    expect(screen.getByText('Ollama (Local Sovereign)')).toBeDefined()
    expect(screen.getByText('DeepSeek (Sovereign On-Prem)')).toBeDefined()
    expect(screen.getAllByText(/Qwen 3.5/i).length).toBeGreaterThan(0)
    expect(screen.getByText(/Gemma 4/i)).toBeDefined()
  })

  it('selects an Ollama model when clicked and closes dropdown', async () => {
    const onSelect = vi.fn()
    render(<ModelSelector onSelect={onSelect} />)

    const trigger = screen.getByRole('button', { name: /Current model/i })
    fireEvent.click(trigger)

    const gemmaOption = screen.getByText('Gemma 4 (e2b Local)')
    await act(async () => {
      fireEvent.click(gemmaOption)
    })

    expect(onSelect).toHaveBeenCalledWith({
      provider: 'ollama',
      model: 'gemma4:e2b',
      reasoningEffort: 'medium',
    })
    expect(getModelsState().current?.model).toBe('gemma4:e2b')
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('displays reasoning effort options for models with reasoning support', async () => {
    await selectModel({
      provider: 'ollama',
      model: 'qwen3.5:2b',
    })

    render(<ModelSelector />)
    const trigger = screen.getByRole('button', { name: /Current model/i })
    fireEvent.click(trigger)

    expect(screen.getByText('Reasoning Effort')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Low' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Medium' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'High' })).toBeDefined()

    const highEffortBtn = screen.getByRole('button', { name: 'High' })
    await act(async () => {
      fireEvent.click(highEffortBtn)
    })

    expect(getModelsState().current?.reasoningEffort).toBe('high')
  })

  it('closes dropdown when pressing Escape', () => {
    render(<ModelSelector />)
    const trigger = screen.getByRole('button', { name: /Current model/i })
    fireEvent.click(trigger)
    expect(screen.getByRole('listbox')).toBeDefined()

    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' })
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('displays retry button when an error occurs', async () => {
    vi.restoreAllMocks()
    vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
      Promise.reject(new Error('Connection timed out')),
    )

    render(<ModelSelector />)

    const trigger = screen.getByRole('button', { name: /Current model/i })
    fireEvent.click(trigger)

    const refreshBtn = screen.getByRole('button', { name: /Refresh/i })
    await act(async () => {
      fireEvent.click(refreshBtn)
    })

    expect(screen.getByRole('alert')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeDefined()
  })
})
