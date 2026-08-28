import { describe, expect, it, beforeEach } from 'vitest'
import { asWbDocumentId } from '@mrpl/dsh-workbench-types'
import {
  abortTurn, appendDelta, attachCitations, finishTurn, getChatState,
  resetChat, setPreset, startTurn, upsertToolNode,
} from '../src/client/live/chat-store.ts'
import {
  classificationRank, completeUpload, failUpload, getDocumentsState,
  markUploading, queueUpload, resetDocuments, setDocuments,
  DEFAULT_CLASSIFICATION, type CorpusDocument,
} from '../src/client/live/documents-store.ts'
import {
  boxToPixels, completeAnalysis, failAnalysis, getVisionState,
  resetVision, setImage, setQuestion, startAnalysis,
} from '../src/client/live/vision-store.ts'
import {
  getNavigationState, navigate, openDocument, resetNavigation,
} from '../src/client/live/navigation-store.ts'

describe('chat store', () => {
  beforeEach(() => resetChat())

  it('a turn opens both the question and the answer it will stream into', () => {
    // The empty assistant turn IS the pending indicator; a separate spinner
    // could desynchronise from the turn it claims to describe.
    startTurn('what feeds P-101?', new AbortController())
    const { turns, generating } = getChatState()
    expect(turns.map((t) => t.role)).toEqual(['user', 'assistant'])
    expect(turns[1]!.streaming).toBe(true)
    expect(generating).toBe(true)
  })

  it('accumulates streamed deltas onto the open turn', () => {
    startTurn('q', new AbortController())
    appendDelta('P-101 ')
    appendDelta('discharges to V-200.')
    expect(getChatState().turns[1]!.text).toBe('P-101 discharges to V-200.')
  })

  it('finishing closes the turn and clears the generating state', () => {
    startTurn('q', new AbortController())
    finishTurn()
    expect(getChatState().turns[1]!.streaming).toBe(false)
    expect(getChatState().generating).toBe(false)
    expect(getChatState().abort).toBeUndefined()
  })

  describe('tool nodes', () => {
    it('a pending call becomes the settled card, not a second one', () => {
      startTurn('q', new AbortController())
      upsertToolNode({ callId: 'c1', name: 'wb_ocr_extract', status: 'running' })
      upsertToolNode({ callId: 'c1', status: 'done', result: 'PUMP P-101' })
      const tools = getChatState().turns[1]!.tools
      expect(tools).toHaveLength(1)
      expect(tools[0]).toMatchObject({ name: 'wb_ocr_extract', status: 'done', result: 'PUMP P-101' })
    })

    it('keeps distinct calls apart, in call order', () => {
      startTurn('q', new AbortController())
      upsertToolNode({ callId: 'c1', name: 'read' })
      upsertToolNode({ callId: 'c2', name: 'grep' })
      expect(getChatState().turns[1]!.tools.map((t) => t.name)).toEqual(['read', 'grep'])
    })

    it('carries the policy verdict and its reason onto the card', () => {
      // A denial the operator can only find in the audit log is not visible
      // governance; §6.12 wants it in the product.
      startTurn('q', new AbortController())
      upsertToolNode({
        callId: 'c1', name: 'web_search', status: 'denied',
        decision: 'DENY', decisionReason: 'CLEARANCE_INSUFFICIENT',
      })
      expect(getChatState().turns[1]!.tools[0]).toMatchObject({
        status: 'denied', decision: 'DENY', decisionReason: 'CLEARANCE_INSUFFICIENT',
      })
    })
  })

  it('attaches the citations grounding the open turn', () => {
    startTurn('q', new AbortController())
    attachCitations([{ documentId: asWbDocumentId('d1'), title: 'SOP 4.2', page: 4 }])
    expect(getChatState().turns[1]!.citations).toHaveLength(1)
  })

  describe('abort', () => {
    it('signals the controller and closes the turn immediately', () => {
      // A Stop that leaves the UI looking busy reads as a Stop that failed.
      const controller = new AbortController()
      startTurn('q', controller)
      expect(abortTurn()).toBe(true)
      expect(controller.signal.aborted).toBe(true)
      expect(getChatState().generating).toBe(false)
      expect(getChatState().turns[1]!.streaming).toBe(false)
    })

    it('says so in the transcript rather than truncating silently', () => {
      startTurn('q', new AbortController())
      appendDelta('partial answer')
      abortTurn()
      expect(getChatState().turns[1]!.text).toContain('stopped')
    })

    it('is a no-op when nothing is generating', () => {
      expect(abortTurn()).toBe(false)
    })
  })

  it('switching preset does not disturb the transcript', () => {
    startTurn('q', new AbortController())
    finishTurn()
    setPreset('engineering-vision')
    expect(getChatState().preset).toBe('engineering-vision')
    expect(getChatState().turns).toHaveLength(2)
  })
})

describe('documents store', () => {
  beforeEach(() => resetDocuments())

  function doc(overrides: Partial<CorpusDocument> = {}): CorpusDocument {
    return {
      id: asWbDocumentId('d1'),
      title: 'SOP 4.2',
      classification: 'INTERNAL',
      declaredClassification: 'INTERNAL',
      chunks: 3,
      ingestedAt: '2026-08-28T10:00:00.000Z',
      ...overrides,
    }
  }

  it('defaults an upload to INTERNAL', () => {
    expect(DEFAULT_CLASSIFICATION).toBe('INTERNAL')
  })

  it('tracks an upload from queued to done and lands the document', () => {
    const id = queueUpload('sop.docx', 'INTERNAL')
    markUploading(id)
    expect(getDocumentsState().uploads[0]!.status).toBe('ingesting')
    completeUpload(id, doc())
    expect(getDocumentsState().uploads[0]).toMatchObject({ status: 'done', documentId: 'd1' })
    expect(getDocumentsState().documents).toHaveLength(1)
  })

  it('surfaces a raise so an auto-classification is visible, not silent', () => {
    const id = queueUpload('pid.pdf', 'INTERNAL')
    completeUpload(id, doc({ classification: 'CONFIDENTIAL', declaredClassification: 'INTERNAL' }))
    expect(getDocumentsState().uploads[0]!.raisedTo).toBe('CONFIDENTIAL')
  })

  it('REFUSES a stored band below what was declared', () => {
    // §9 invariant 6. Displaying the lower band would make the UI complicit
    // in a downgrade it is supposed to make impossible to miss.
    const id = queueUpload('secret.txt', 'RESTRICTED')
    completeUpload(id, doc({ classification: 'PUBLIC', declaredClassification: 'RESTRICTED' }))
    expect(getDocumentsState().uploads[0]!.status).toBe('failed')
    expect(getDocumentsState().uploads[0]!.error).toContain('downgraded')
    expect(getDocumentsState().documents, 'a downgraded document must not enter the list').toHaveLength(0)
  })

  it('records a failure with the reason the pipeline gave', () => {
    const id = queueUpload('broken.docx', 'INTERNAL')
    failUpload(id, 'not a readable OOXML archive')
    expect(getDocumentsState().uploads[0]).toMatchObject({ status: 'failed' })
    expect(getDocumentsState().uploads[0]!.error).toContain('OOXML')
  })

  it('re-ingesting a document replaces rather than duplicates it', () => {
    const first = queueUpload('a.txt', 'INTERNAL')
    completeUpload(first, doc({ chunks: 3 }))
    const second = queueUpload('a.txt', 'INTERNAL')
    completeUpload(second, doc({ chunks: 5 }))
    expect(getDocumentsState().documents).toHaveLength(1)
    expect(getDocumentsState().documents[0]!.chunks).toBe(5)
  })

  it('ranks bands least to most sensitive', () => {
    expect(classificationRank('PUBLIC')).toBeLessThan(classificationRank('RESTRICTED'))
  })

  it('setDocuments replaces the corpus listing', () => {
    setDocuments([doc(), doc({ id: asWbDocumentId('d2') })])
    expect(getDocumentsState().documents).toHaveLength(2)
  })
})

describe('vision store', () => {
  beforeEach(() => resetVision())

  it('loading a new image clears the previous findings', () => {
    // Boxes are fractions of AN image; keeping them would draw the last
    // image's answers over this one.
    setImage('blob:a', 'pid-a.png')
    completeAnalysis({ answered: true, findings: [{ summary: 'P-101', box: [0, 0, 1, 1], confidence: 0.9 }] })
    setImage('blob:b', 'pid-b.png')
    expect(getVisionState().findings).toEqual([])
    expect(getVisionState().imageName).toBe('pid-b.png')
  })

  it('keeps the question across an image change', () => {
    setQuestion('what feeds P-101?')
    setImage('blob:a', 'a.png')
    expect(getVisionState().question).toBe('what feeds P-101?')
  })

  it('records findings with ids for the overlay to key on', () => {
    startAnalysis()
    completeAnalysis({
      answered: true,
      findings: [
        { summary: 'P-101 feeds V-200', box: [0.1, 0.2, 0.3, 0.1], confidence: 0.81, tag: 'P-101' },
      ],
    })
    const [finding] = getVisionState().findings
    expect(finding).toMatchObject({ id: 'f0', tag: 'P-101', confidence: 0.81 })
    expect(getVisionState().analyzing).toBe(false)
  })

  it('an unanswerable question is a reason, not an error', () => {
    // The tool is specified to say so rather than guess; showing it as a
    // failure would train an operator to distrust a correct refusal.
    startAnalysis()
    completeAnalysis({ answered: false, reason: 'the valve is not visible in this crop' })
    expect(getVisionState().findings).toEqual([])
    expect(getVisionState().noFindingReason).toContain('not visible')
    expect(getVisionState().error).toBeUndefined()
  })

  it('a malformed image is an error', () => {
    startAnalysis()
    failAnalysis('image is not valid base64')
    expect(getVisionState().error).toContain('base64')
    expect(getVisionState().analyzing).toBe(false)
  })

  describe('box geometry', () => {
    it('scales fractions to the rendered size', () => {
      expect(boxToPixels([0.5, 0.25, 0.25, 0.5], 800, 400))
        .toEqual({ x: 400, y: 100, width: 200, height: 200 })
    })

    it('clamps a box that runs past the edge', () => {
      // A model may return an over-wide box; an overlay drawn outside the
      // image reads as a rendering bug rather than a weak detection.
      const box = boxToPixels([0.9, 0.9, 0.5, 0.5], 100, 100)
      expect(box.x + box.width).toBeLessThanOrEqual(100)
      expect(box.y + box.height).toBeLessThanOrEqual(100)
    })

    it('treats a missing or short box as zero-sized rather than NaN', () => {
      expect(boxToPixels([], 100, 100)).toEqual({ x: 0, y: 0, width: 0, height: 0 })
    })
  })
})

describe('navigation store', () => {
  beforeEach(() => resetNavigation())

  it('starts on chat', () => {
    expect(getNavigationState().route).toBe('chat')
  })

  it('opening a document from a citation carries the locator', () => {
    // This is the path that makes a citation checkable rather than decorative.
    openDocument(asWbDocumentId('d1'), { page: 12 })
    expect(getNavigationState()).toMatchObject({
      route: 'documents', documentId: 'd1', locator: { page: 12 },
    })
  })

  it('supports a section locator as well as a page', () => {
    openDocument(asWbDocumentId('d1'), { section: '4.2' })
    expect(getNavigationState().locator).toEqual({ section: '4.2' })
  })

  it('navigating away clears the viewer target', () => {
    // Returning to Documents should not reopen whatever was last cited,
    // which would look like the app losing the user's place.
    openDocument(asWbDocumentId('d1'), { page: 12 })
    navigate('chat')
    navigate('documents')
    expect(getNavigationState().documentId).toBeUndefined()
    expect(getNavigationState().locator).toBeUndefined()
  })
})
