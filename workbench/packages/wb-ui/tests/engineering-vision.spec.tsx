import { describe, expect, it, beforeEach, vi } from 'vitest'
import { act, render, screen, fireEvent } from './render.tsx'
import { EngineeringVisionView } from '../src/client/vision/EngineeringVisionView.tsx'
import {
  completeAnalysis, failAnalysis, getVisionState, resetVision, setImage,
} from '../src/client/live/vision-store.ts'

// jsdom has no object-URL implementation; the component only needs a string.
beforeEach(() => {
  vi.stubGlobal('URL', { ...URL, createObjectURL: () => 'blob:test' })
})

const image = () => new File([new Uint8Array([1, 2, 3])], 'pid.png', { type: 'image/png' })

describe('EngineeringVisionView', () => {
  beforeEach(() => resetVision())

  it('invites a drawing before one is loaded', () => {
    render(<EngineeringVisionView />)
    expect(screen.getByText(/Drop a P&ID/)).toBeDefined()
  })

  it('loads a chosen drawing', () => {
    render(<EngineeringVisionView />)
    fireEvent.change(screen.getByLabelText('Load drawing'), { target: { files: [image()] } })
    expect(getVisionState().imageName).toBe('pid.png')
    expect(screen.getByAltText('pid.png')).toBeDefined()
  })

  it('cannot analyze without an image', () => {
    render(<EngineeringVisionView />)
    fireEvent.change(screen.getByLabelText('Question'), { target: { value: 'what feeds P-101?' } })
    expect((screen.getByText('Analyze') as HTMLButtonElement).disabled).toBe(true)
  })

  it('cannot analyze without a question', () => {
    act(() => setImage('blob:x', 'pid.png'))
    render(<EngineeringVisionView />)
    expect((screen.getByText('Analyze') as HTMLButtonElement).disabled).toBe(true)
  })

  it('analyzes with both, and reports the question asked', () => {
    const onAnalyze = vi.fn()
    act(() => setImage('blob:x', 'pid.png'))
    render(<EngineeringVisionView onAnalyze={onAnalyze} />)
    fireEvent.change(screen.getByLabelText('Question'), { target: { value: 'inspect V-204' } })
    fireEvent.click(screen.getByText('Analyze'))
    expect(onAnalyze).toHaveBeenCalledWith('inspect V-204')
    expect(getVisionState().analyzing).toBe(true)
  })

  it('Enter in the question box analyzes', () => {
    const onAnalyze = vi.fn()
    act(() => setImage('blob:x', 'pid.png'))
    render(<EngineeringVisionView onAnalyze={onAnalyze} />)
    fireEvent.change(screen.getByLabelText('Question'), { target: { value: 'q' } })
    fireEvent.keyDown(screen.getByLabelText('Question'), { key: 'Enter' })
    expect(onAnalyze).toHaveBeenCalled()
  })

  describe('findings overlay', () => {
    function analyzed() {
      act(() => setImage('blob:x', 'pid.png'))
      const view = render(<EngineeringVisionView />)
      act(() => completeAnalysis({
        answered: true,
        findings: [
          { summary: 'P-101 discharges to V-200', box: [0.1, 0.2, 0.3, 0.1], confidence: 0.81, tag: 'P-101' },
          { summary: 'V-204 is closed', box: [0.5, 0.5, 0.2, 0.2], confidence: 0.64 },
        ],
      }))
      return view
    }

    it('draws one box per finding, positioned from its fractional box', () => {
      const { container } = analyzed()
      const rects = container.querySelectorAll('svg rect')
      expect(rects).toHaveLength(2)
      // 0.1 * 720 = 72, 0.2 * 480 = 96
      expect(rects[0]!.getAttribute('x')).toBe('72')
      expect(rects[0]!.getAttribute('y')).toBe('96')
    })

    it('lists each finding with its confidence as a percentage', () => {
      analyzed()
      expect(screen.getByText('P-101 discharges to V-200')).toBeDefined()
      expect(screen.getByText('81%')).toBeDefined()
      expect(screen.getByText('64%')).toBeDefined()
    })

    it('shows a detection tag when the model supplied one', () => {
      analyzed()
      expect(screen.getByText('P-101')).toBeDefined()
    })

    it('hovering a finding card highlights it', () => {
      const { container } = analyzed()
      const card = screen.getByText('V-204 is closed').closest('li')!
      fireEvent.mouseEnter(card)
      expect(card.className).toMatch(/findingActive/)
      void container
    })

    it('hovering a box highlights it too, so the two views agree', () => {
      const { container } = analyzed()
      const rect = container.querySelectorAll('svg rect')[0]!
      fireEvent.mouseEnter(rect)
      expect(rect.getAttribute('class')).toMatch(/boxActive/)
    })
  })

  it('an unanswerable question reads as an honest answer, not an error', () => {
    // Showing a correct refusal as a failure trains an operator to distrust it.
    act(() => setImage('blob:x', 'pid.png'))
    render(<EngineeringVisionView />)
    act(() => completeAnalysis({ answered: false, reason: 'the valve is not visible in this crop' }))
    expect(screen.getByText(/not visible in this crop/)).toBeDefined()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('a malformed image is an error', () => {
    act(() => setImage('blob:x', 'pid.png'))
    render(<EngineeringVisionView />)
    act(() => failAnalysis('image is not valid base64'))
    expect(screen.getByRole('alert').textContent).toContain('base64')
  })

  it('loading a new drawing clears the previous findings', () => {
    act(() => setImage('blob:a', 'a.png'))
    const { container } = render(<EngineeringVisionView />)
    act(() => completeAnalysis({ answered: true, findings: [{ summary: 'x', box: [0, 0, 1, 1], confidence: 1 }] }))
    expect(container.querySelectorAll('svg rect')).toHaveLength(1)
    act(() => setImage('blob:b', 'b.png'))
    expect(container.querySelectorAll('svg rect')).toHaveLength(0)
  })
})
