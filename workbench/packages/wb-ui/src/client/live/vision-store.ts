/**
 * The vision studio: the image under inspection and what was found in it.
 * @module @mrpl/dsh-workbench-ui/client/live/vision-store
 */

/** One finding, with the region of the image it was read from. */
export interface VisionFinding {
  id: string
  summary: string
  /** `[x, y, width, height]` as fractions of the image, origin top-left. */
  box: number[]
  confidence: number
  /** Optional detection label, e.g. an equipment tag. */
  tag?: string
}

export interface VisionState {
  /** Object URL or data URI of the image being inspected. */
  imageUrl: string | undefined
  imageName: string | undefined
  question: string
  findings: VisionFinding[]
  analyzing: boolean
  /** Set when the model could not answer from the image. */
  noFindingReason: string | undefined
  error: string | undefined
}

export const INITIAL_VISION: VisionState = {
  imageUrl: undefined,
  imageName: undefined,
  question: '',
  findings: [],
  analyzing: false,
  noFindingReason: undefined,
  error: undefined,
}

let state: VisionState = INITIAL_VISION
const listeners = new Set<() => void>()

export function subscribeVision(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getVisionState(): VisionState {
  return state
}

function commit(next: VisionState): void {
  state = next
  for (const listener of listeners) listener()
}

/**
 * Load an image for inspection.
 *
 * Clears any previous findings: boxes are fractions of *an* image, so carrying
 * them onto a new one would draw last image's answers over this one.
 */
export function setImage(imageUrl: string, imageName: string): void {
  commit({ ...INITIAL_VISION, imageUrl, imageName, question: state.question })
}

export function setQuestion(question: string): void {
  commit({ ...state, question })
}

/** Mark an analysis as in flight. */
export function startAnalysis(): void {
  commit({ ...state, analyzing: true, findings: [], noFindingReason: undefined, error: undefined })
}

/**
 * Record the result of `wb_vision_analyze`.
 *
 * An unanswerable question is a successful call carrying a reason, not an
 * error — the tool is specified to say so rather than guess, and showing it as
 * a failure would train an operator to distrust a correct refusal.
 * @param result - the tool's structured output.
 */
export function completeAnalysis(result: {
  answered: boolean
  findings?: Array<{ summary: string; box: number[]; confidence: number; tag?: string }>
  reason?: string
}): void {
  commit({
    ...state,
    analyzing: false,
    findings: result.answered
      ? (result.findings ?? []).map((f, i) => ({ id: `f${i}`, ...f }))
      : [],
    noFindingReason: result.answered ? undefined : (result.reason || 'No finding in this image.'),
    error: undefined,
  })
}

/** Record a failed analysis — a malformed image or an unreachable model. */
export function failAnalysis(error: string): void {
  commit({ ...state, analyzing: false, error })
}

/**
 * Convert a fractional box to pixel coordinates for an SVG overlay.
 *
 * Boxes are fractions so they survive the image being displayed at any size;
 * this is the one place that assumption is turned into geometry. Values are
 * clamped because a model may return a box that runs past the edge, and an
 * overlay drawn outside the image reads as a rendering bug rather than a
 * low-confidence detection.
 * @param box - `[x, y, width, height]` as fractions.
 * @param width - the rendered image width in pixels.
 * @param height - the rendered image height in pixels.
 * @returns pixel geometry clamped to the image.
 */
export function boxToPixels(
  box: number[],
  width: number,
  height: number,
): { x: number; y: number; width: number; height: number } {
  const [fx = 0, fy = 0, fw = 0, fh = 0] = box
  const x = Math.max(0, Math.min(fx, 1)) * width
  const y = Math.max(0, Math.min(fy, 1)) * height
  return {
    x,
    y,
    width: Math.max(0, Math.min(fw, 1 - Math.max(0, Math.min(fx, 1)))) * width,
    height: Math.max(0, Math.min(fh, 1 - Math.max(0, Math.min(fy, 1)))) * height,
  }
}

export function resetVision(): void {
  commit(INITIAL_VISION)
}
