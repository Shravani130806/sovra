import { describe, expect, it, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from './render.tsx'
import { ChatComposer } from '../src/client/conversation/ChatComposer.tsx'
import { resetChat, startTurn } from '../src/client/live/chat-store.ts'
import { publishChatDecision, resetWorkbenchState } from '../src/client/live/workbench-store.ts'

const box = () => screen.getByLabelText('Message') as HTMLTextAreaElement
const file = (name: string) => new File(['dummy content'], name, { type: 'text/plain' })

describe('ChatComposer', () => {
  beforeEach(() => {
    resetChat()
    resetWorkbenchState()
  })

  it('is a controlled input', () => {
    render(<ChatComposer />)
    fireEvent.change(box(), { target: { value: 'what feeds P-101?' } })
    expect(box().value).toBe('what feeds P-101?')
  })

  it('Enter sends and clears the draft', () => {
    const onSend = vi.fn()
    render(<ChatComposer onSend={onSend} />)
    fireEvent.change(box(), { target: { value: 'inspect P-101' } })
    fireEvent.keyDown(box(), { key: 'Enter' })
    expect(onSend).toHaveBeenCalledWith('inspect P-101')
    expect(box().value).toBe('')
  })

  it('Shift+Enter does not send', () => {
    const onSend = vi.fn()
    render(<ChatComposer onSend={onSend} />)
    fireEvent.change(box(), { target: { value: 'line one' } })
    fireEvent.keyDown(box(), { key: 'Enter', shiftKey: true })
    expect(onSend).not.toHaveBeenCalled()
    expect(box().value).toBe('line one')
  })

  it('Enter during IME composition does not send', () => {
    // A Japanese or Devanagari input method fires Enter to commit a candidate;
    // treating that as submit truncates the word being typed.
    const onSend = vi.fn()
    render(<ChatComposer onSend={onSend} />)
    fireEvent.change(box(), { target: { value: 'पंप' } })
    fireEvent.keyDown(box(), { key: 'Enter', isComposing: true })
    expect(onSend).not.toHaveBeenCalled()
  })

  it('a whitespace-only draft without attachments cannot be sent', () => {
    // Sending one would open a turn the model has nothing to answer.
    const onSend = vi.fn()
    render(<ChatComposer onSend={onSend} />)
    fireEvent.change(box(), { target: { value: '   ' } })
    fireEvent.keyDown(box(), { key: 'Enter' })
    expect(onSend).not.toHaveBeenCalled()
    expect((screen.getByLabelText('Send Message') as HTMLButtonElement).disabled).toBe(true)
  })

  it('trims the sent text', () => {
    const onSend = vi.fn()
    render(<ChatComposer onSend={onSend} />)
    fireEvent.change(box(), { target: { value: '  P-101  ' } })
    fireEvent.click(screen.getByLabelText('Send Message'))
    expect(onSend).toHaveBeenCalledWith('P-101')
  })

  describe('attachments', () => {
    it('clicking the clip icon opens the file picker and attaches files', () => {
      render(<ChatComposer />)
      const input = screen.getByLabelText('Attach files')
      fireEvent.change(input, { target: { files: [file('schematic.pdf')] } })
      expect(screen.getByText('📎 schematic.pdf')).toBeDefined()
    })

    it('can remove an attached file before sending', () => {
      render(<ChatComposer />)
      const input = screen.getByLabelText('Attach files')
      fireEvent.change(input, { target: { files: [file('schematic.pdf')] } })
      expect(screen.getByText('📎 schematic.pdf')).toBeDefined()

      fireEvent.click(screen.getByLabelText('Remove schematic.pdf'))
      expect(screen.queryByText('📎 schematic.pdf')).toBeNull()
    })

    it('sending with attachment dispatches message and clears attachments', () => {
      const onSend = vi.fn()
      render(<ChatComposer onSend={onSend} />)
      const input = screen.getByLabelText('Attach files')
      fireEvent.change(input, { target: { files: [file('report.docx')] } })

      fireEvent.click(screen.getByLabelText('Send Message'))
      expect(onSend).toHaveBeenCalledWith('', ['report.docx'])
      expect(screen.queryByText('📎 report.docx')).toBeNull()
    })
  })

  describe('while generating', () => {
    it('offers Stop instead of Send, and disables the input', () => {
      startTurn('q', new AbortController())
      render(<ChatComposer />)
      expect(screen.getByLabelText('Stop generating')).toBeDefined()
      expect(screen.queryByLabelText('Send Message')).toBeNull()
      expect(box().disabled).toBe(true)
    })

    it('Stop aborts the controller the turn was started with', () => {
      const controller = new AbortController()
      startTurn('q', controller)
      render(<ChatComposer />)
      fireEvent.click(screen.getByLabelText('Stop generating'))
      expect(controller.signal.aborted).toBe(true)
    })

    it('Enter does not queue a second turn mid-generation', () => {
      const onSend = vi.fn()
      startTurn('q', new AbortController())
      render(<ChatComposer onSend={onSend} />)
      fireEvent.keyDown(box(), { key: 'Enter' })
      expect(onSend).not.toHaveBeenCalled()
    })
  })

  describe('policy banner', () => {
    it('shows nothing when the last decision allowed', () => {
      publishChatDecision('ALLOW', 'within clearance')
      render(<ChatComposer />)
      expect(screen.queryByRole('status')).toBeNull()
    })

    it('shows a block with its reason on DENY', () => {
      publishChatDecision('DENY', 'CLEARANCE_INSUFFICIENT')
      render(<ChatComposer />)
      const banner = screen.getByRole('status')
      expect(banner.textContent).toContain('Blocked by policy')
      expect(banner.textContent).toContain('CLEARANCE_INSUFFICIENT')
    })

    it('distinguishes approval-required from blocked', () => {
      publishChatDecision('REQUIRE_APPROVAL', 'needs sign-off')
      render(<ChatComposer />)
      expect(screen.getByRole('status').textContent).toContain('Approval required')
    })
  })
})
