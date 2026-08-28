import { describe, expect, it, beforeEach } from 'vitest'
import { render, screen, fireEvent } from './render.tsx'
import { ModelRoutingView } from '../src/client/models/ModelRoutingView.tsx'
import {
  getModelsState,
  resetModelsState,
  CAPABILITY_ROLES,
} from '../src/client/live/models-store.ts'

describe('ModelRoutingView', () => {
  beforeEach(() => {
    resetModelsState()
  })

  it('renders all 6 capability routing cards', () => {
    render(<ModelRoutingView />)
    expect(screen.getByText('Capability-Based Model Routing')).toBeDefined()

    for (const role of CAPABILITY_ROLES) {
      expect(screen.getByTestId(`capability-card-${role.id}`)).toBeDefined()
      expect(screen.getByText(role.title)).toBeDefined()
    }
  })

  it('switches assigned model for a specific capability', () => {
    const { container } = render(<ModelRoutingView />)
    const select = container.querySelector('#select-model-embedding') as HTMLSelectElement
    expect(select).toBeDefined()
    fireEvent.change(select, { target: { value: 'ollama/nomic-embed-text' } })

    const state = getModelsState()
    expect(state.capabilityRouting.embedding).toEqual({
      provider: 'ollama',
      model: 'nomic-embed-text',
    })
  })

  it('toggles strict air-gapped mode from the top bar', () => {
    render(<ModelRoutingView />)
    const toggle = screen.getByLabelText(/strict air-gapped/i) as HTMLInputElement
    expect(toggle.checked).toBe(true)

    fireEvent.click(toggle)
    expect(getModelsState().strictLocalOnly).toBe(false)
  })
})
