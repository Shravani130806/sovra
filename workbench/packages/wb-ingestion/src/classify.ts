/**
 * Content-based classification suggestion.
 *
 * §6.8 allows auto-classification to RAISE a document's band for human
 * confirmation and never to lower it. This module only ever proposes; the
 * caller discards any suggestion at or below the uploader's declared value, so
 * the §9 invariant 6 guarantee holds structurally rather than by convention.
 * @module @mrpl/dsh-workbench-ingestion/classify
 */

import type { WbClassification } from '@mrpl/dsh-workbench-types'

/** Bands ordered least to most sensitive. */
const ORDER: readonly WbClassification[] = ['PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'RESTRICTED']

/**
 * Position of a band in the sensitivity order.
 * @param band - the classification to rank.
 * @returns its index; -1 for an unrecognised band, which never outranks anything.
 */
export function classificationRank(band: WbClassification): number {
  return ORDER.indexOf(band)
}

/**
 * Signals that a document belongs in a band above the routine.
 *
 * Deliberately conservative and explainable: an operator reviewing a raised
 * classification must be able to see which phrase caused it. A model-based
 * classifier would be more sensitive but could not be audited this way, and
 * would put a model in the ingest path for every upload.
 */
const SIGNALS: ReadonlyArray<{ band: WbClassification; pattern: RegExp; reason: string }> = [
  // Explicit markings win: a document that says what it is should be believed.
  { band: 'RESTRICTED', pattern: /\brestricted\b/i, reason: 'marked RESTRICTED' },
  { band: 'CONFIDENTIAL', pattern: /\bconfidential\b/i, reason: 'marked CONFIDENTIAL' },
  { band: 'INTERNAL', pattern: /\binternal use only\b/i, reason: 'marked internal use only' },

  // Refinery engineering material MRPL treats as sensitive by default.
  { band: 'CONFIDENTIAL', pattern: /\bP&ID\b|\bpiping and instrumentation\b/i, reason: 'P&ID drawing' },
  { band: 'CONFIDENTIAL', pattern: /\bHAZOP\b|\bhazard and operability\b/i, reason: 'HAZOP study' },
  { band: 'CONFIDENTIAL', pattern: /\bsafety instrumented system\b|\bSIL \d\b/i, reason: 'safety instrumented system' },
  { band: 'CONFIDENTIAL', pattern: /\bemergency shutdown\b|\bESD procedure\b/i, reason: 'emergency shutdown procedure' },
  { band: 'INTERNAL', pattern: /\bstandard operating procedure\b|\bSOP \d/i, reason: 'standard operating procedure' },
]

/** An OOXML drawing or spreadsheet is rarely public-facing material. */
const ENGINEERING_MIME_FLOOR: WbClassification = 'INTERNAL'

/**
 * Propose a classification from a document's content.
 * @param text - the extracted document text.
 * @param mime - the detected media type.
 * @returns the highest band any signal suggests, or undefined when nothing
 *   matched. The caller decides whether it outranks the declared value.
 */
export function suggestClassification(text: string, mime: string): WbClassification | undefined {
  // Only the opening of a document is scanned for markings: a stamp appears in
  // a header or cover page, and scanning a whole corpus-sized file for every
  // pattern would dominate ingest time for no accuracy gain.
  const head = text.slice(0, 8000)

  let best: WbClassification | undefined
  for (const signal of SIGNALS) {
    if (!signal.pattern.test(head)) continue
    if (!best || classificationRank(signal.band) > classificationRank(best)) {
      best = signal.band
    }
  }

  if (!best && (mime.includes('officedocument') || mime === 'application/pdf')) {
    best = ENGINEERING_MIME_FLOOR
  }
  return best
}

/**
 * Explain why a band was suggested, for the confirmation surface.
 * @param text - the extracted document text.
 * @returns the matching signal reasons, most sensitive first.
 */
export function classificationReasons(text: string): string[] {
  const head = text.slice(0, 8000)
  return SIGNALS.filter((s) => s.pattern.test(head))
    .sort((a, b) => classificationRank(b.band) - classificationRank(a.band))
    .map((s) => s.reason)
}
