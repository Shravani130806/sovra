import { describe, expect, it, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from './render.tsx'
import { ConversationRoot } from '../src/client/conversation/ConversationRoot.tsx'
import { getChatState, resetChat, startTurn } from '../src/client/live/chat-store.ts'
import { getNavigationState, navigate, resetNavigation } from '../src/client/live/navigation-store.ts'
import { resetDocuments } from '../src/client/live/documents-store.ts'
import { resetVision } from '../src/client/live/vision-store.ts'
import { resetWorkbenchState } from '../src/client/live/workbench-store.ts'
import { resetModelsState } from '../src/client/live/models-store.ts'

describe('ConversationRoot', () => {
  beforeEach(() => {
    resetChat()
    resetNavigation()
    resetDocuments()
    resetVision()
    resetWorkbenchState()
    resetModelsState()
  })

  it('renders ChatHomeView when there are no turns', () => {
    render(<ConversationRoot />)
    expect(screen.getByText('Good morning.')).toBeDefined()
    expect(screen.getByRole('heading', { name: 'Document Analyst' })).toBeDefined()
  })

  it('renders MessageList when turns exist', () => {
    startTurn('What is the pressure limit?', new AbortController())
    render(<ConversationRoot />)
    expect(screen.queryByText('Good morning.')).toBeNull()
    expect(screen.getByText('What is the pressure limit?')).toBeDefined()
  })

  it('renders ModelSelector in the header', () => {
    render(<ConversationRoot />)
    expect(screen.getByRole('button', { name: /Current model/i })).toBeDefined()
  })

  it('reflects active preset in header and updates when preset changes', () => {
    render(<ConversationRoot />)
    expect(screen.getByRole('heading', { name: 'Document Analyst' })).toBeDefined()

    // Click Engineering Vision preset card
    const visionCard = screen.getByText('Engineering Vision')
    fireEvent.click(visionCard)
    expect(getChatState().preset).toBe('engineering-vision')
  })

  it('clicking a starter prompt opens a new turn', () => {
    render(<ConversationRoot />)
    const promptCard = screen.getByText('Analyze an inspection report')
    fireEvent.click(promptCard)
    expect(getChatState().turns).toHaveLength(2)
    expect(getChatState().turns[0]!.text).toBe('Analyze an inspection report')
  })

  it('switches views based on navigation route', () => {
    render(<ConversationRoot />)
    expect(screen.getByText('Good morning.')).toBeDefined()

    act(() => {
      navigate('documents')
    })
    expect(getNavigationState().route).toBe('documents')
    expect(screen.getByText('Upload documents')).toBeDefined()
  })
})
