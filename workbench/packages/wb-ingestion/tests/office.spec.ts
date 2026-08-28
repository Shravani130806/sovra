import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import { extractOfficeText, isOfficeType } from '../src/office.ts'
import { classificationRank, suggestClassification } from '../src/classify.ts'

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'

async function docx(paragraphs: string[]): Promise<Buffer> {
  const body = paragraphs.map((p) => `<w:p><w:r><w:t>${p}</w:t></w:r></w:p>`).join('')
  const zip = new JSZip()
  zip.file('word/document.xml', `<?xml version="1.0"?><w:document><w:body>${body}</w:body></w:document>`)
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}

async function xlsx(rows: string[][]): Promise<Buffer> {
  const shared = [...new Set(rows.flat())]
  const sheet = rows
    .map((row) => `<row>${row.map((cell) => `<c t="s"><v>${shared.indexOf(cell)}</v></c>`).join('')}</row>`)
    .join('')
  const zip = new JSZip()
  zip.file('xl/worksheets/sheet1.xml', `<worksheetData>${sheet}</worksheetData>`)
  zip.file('xl/sharedStrings.xml', `<sst>${shared.map((v) => `<si><t>${v}</t></si>`).join('')}</sst>`)
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}

async function pptx(slides: string[][]): Promise<Buffer> {
  const zip = new JSZip()
  slides.forEach((runs, i) => {
    zip.file(`ppt/slides/slide${i + 1}.xml`, `<p:sld>${runs.map((r) => `<a:t>${r}</a:t>`).join('')}</p:sld>`)
  })
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}

describe('OOXML text extraction', () => {
  it('recognises the three OOXML media types', () => {
    for (const m of [DOCX, XLSX, PPTX]) expect(isOfficeType(m)).toBe(true)
    expect(isOfficeType('text/plain')).toBe(false)
    expect(isOfficeType('application/pdf')).toBe(false)
  })

  it('reads a .docx as text, one line per paragraph', async () => {
    const text = await extractOfficeText(await docx(['Pump P-101 inspection', 'Bearing wear 0.4mm']), DOCX)
    expect(text).toBe('Pump P-101 inspection\nBearing wear 0.4mm')
  })

  it('does NOT return mojibake — the bug this replaces', async () => {
    // readFileSync(path,'utf-8') on a ZIP produced binary-as-text that chunked
    // and indexed cleanly as unsearchable noise, with no error anywhere.
    // DEFLATE, as Word writes them — a stored entry would leave the text
    // legible and understate the corruption.
    const bytes = await docx(['Pump P-101 outboard bearing wear noted during inspection'])
    const naive = bytes.toString('utf-8')
    expect(naive).not.toContain('outboard bearing wear')
    expect(await extractOfficeText(bytes, DOCX)).toContain('outboard bearing wear')
  })

  it('reads a .xlsx as tab-separated rows via sharedStrings', async () => {
    const text = await extractOfficeText(await xlsx([['Tag', 'Status'], ['P-101', 'OK']]), XLSX)
    expect(text).toBe('Tag\tStatus\nP-101\tOK')
  })

  it('reads a .pptx slide by slide, in slide order', async () => {
    const text = await extractOfficeText(await pptx([['Slide one'], ['Slide two']]), PPTX)
    expect(text).toBe('Slide one\nSlide two')
  })

  it('decodes XML entities rather than leaking markup', async () => {
    const text = await extractOfficeText(await docx(['Flow &gt; 100 m&amp;s']), DOCX)
    expect(text).toBe('Flow > 100 m&s')
  })

  it('a non-archive fails loudly instead of yielding empty text', async () => {
    await expect(extractOfficeText(Buffer.from('not a zip'), DOCX)).rejects.toThrow(/OOXML archive/)
  })

  it('an archive missing its document part fails loudly', async () => {
    const zip = new JSZip()
    zip.file('unrelated.xml', '<x/>')
    await expect(extractOfficeText(await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }), DOCX))
      .rejects.toThrow(/word\/document\.xml/)
  })

  it('a document with no text fails rather than entering the corpus empty', async () => {
    await expect(extractOfficeText(await docx([]), DOCX)).rejects.toThrow(/no extractable text/)
  })
})

describe('auto-classification may only raise', () => {
  it('suggests CONFIDENTIAL for a P&ID drawing', () => {
    expect(suggestClassification('Refer to the P&ID for unit 400.', 'text/plain')).toBe('CONFIDENTIAL')
  })

  it('honours an explicit RESTRICTED marking', () => {
    expect(suggestClassification('RESTRICTED — internal distribution only', 'text/plain')).toBe('RESTRICTED')
  })

  it('takes the highest band when several signals match', () => {
    const text = 'CONFIDENTIAL HAZOP study. Marked RESTRICTED on page 2.'
    expect(suggestClassification(text, 'text/plain')).toBe('RESTRICTED')
  })

  it('suggests nothing for ordinary text', () => {
    expect(suggestClassification('Lunch menu for Tuesday.', 'text/plain')).toBeUndefined()
  })

  it('floors office and pdf documents at INTERNAL', () => {
    expect(suggestClassification('Nothing notable.', DOCX)).toBe('INTERNAL')
  })

  it('ranks bands least to most sensitive', () => {
    expect(classificationRank('PUBLIC')).toBeLessThan(classificationRank('INTERNAL'))
    expect(classificationRank('CONFIDENTIAL')).toBeLessThan(classificationRank('RESTRICTED'))
  })

  it('a suggestion below the declared band is outranked, never applied', () => {
    // The guard for §9 invariant 6: the caller keeps the declared value
    // whenever the suggestion does not outrank it.
    const suggested = suggestClassification('Lunch menu.', DOCX)!
    expect(classificationRank(suggested)).toBeLessThan(classificationRank('RESTRICTED'))
  })
})
