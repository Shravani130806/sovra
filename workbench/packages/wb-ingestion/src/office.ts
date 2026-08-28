/**
 * Text extraction from OOXML documents.
 *
 * `.docx`, `.xlsx` and `.pptx` are ZIP archives of XML parts. They were
 * previously read with `readFileSync(path, 'utf-8')`, which decodes compressed
 * binary as text and produces mojibake — the pipeline then chunked, embedded
 * and indexed that garbage, so a Word document entered the corpus as
 * unsearchable noise with no error anywhere.
 * @module @mrpl/dsh-workbench-ingestion/office
 */

import JSZip from 'jszip'

/** OOXML media types this module can extract text from. */
export const OOXML_MIME_TYPES: ReadonlySet<string> = new Set([
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
])

/**
 * Whether a media type is an OOXML container needing archive extraction.
 * @param mime - the detected media type.
 * @returns true when {@link extractOfficeText} handles it.
 */
export function isOfficeType(mime: string): boolean {
  return OOXML_MIME_TYPES.has(mime)
}

/**
 * Pull the text out of one OOXML text run element.
 *
 * Word uses `<w:t>`, PowerPoint uses `<a:t>`. Both may carry attributes such as
 * `xml:space="preserve"`, so the opening tag is matched loosely.
 */
function textRuns(xml: string, tag: 'w:t' | 'a:t'): string[] {
  const pattern = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'g')
  const out: string[] = []
  for (const match of xml.matchAll(pattern)) {
    out.push(decodeXmlEntities(match[1] ?? ''))
  }
  return out
}

/** Resolve the five XML predefined entities; OOXML uses no others in text runs. */
function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

/** Paragraph-aware extraction for Word: one line per `<w:p>`. */
function extractDocx(documentXml: string): string {
  const paragraphs = documentXml.split(/<w:p[\s>]/).slice(1)
  return paragraphs
    .map((paragraph) => textRuns(paragraph, 'w:t').join(''))
    .filter((line) => line.trim() !== '')
    .join('\n')
}

/**
 * Read an `.xlsx` workbook as tab-separated rows.
 *
 * Cell values live in `sharedStrings.xml` when they are strings, referenced by
 * index from the sheet; inline and numeric values sit in the sheet itself.
 */
function extractXlsx(sheets: string[], sharedStrings: string | undefined): string {
  const shared = sharedStrings
    ? [...sharedStrings.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
        textRuns(m[1] ?? '', 'w:t').join('') ||
        [...(m[1] ?? '').matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)]
          .map((t) => decodeXmlEntities(t[1] ?? ''))
          .join(''),
      )
    : []

  const lines: string[] = []
  for (const sheet of sheets) {
    for (const row of sheet.matchAll(/<row[\s\S]*?<\/row>/g)) {
      const cells: string[] = []
      for (const cell of (row[0] ?? '').matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
        const attrs = cell[1] ?? ''
        const body = cell[2] ?? ''
        const raw = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? ''
        if (/t="s"/.test(attrs)) {
          const index = Number(raw)
          cells.push(shared[index] ?? '')
        } else if (/t="inlineStr"/.test(attrs)) {
          cells.push(
            [...body.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)]
              .map((t) => decodeXmlEntities(t[1] ?? ''))
              .join(''),
          )
        } else {
          cells.push(decodeXmlEntities(raw))
        }
      }
      const line = cells.join('\t').trim()
      if (line !== '') lines.push(line)
    }
  }
  return lines.join('\n')
}

/** One line per PowerPoint text run, slides in file order. */
function extractPptx(slides: string[]): string {
  return slides
    .flatMap((slide) => textRuns(slide, 'a:t'))
    .filter((line) => line.trim() !== '')
    .join('\n')
}

/**
 * Extract readable text from an OOXML document.
 * @param bytes - the raw file contents.
 * @param mime - the detected media type; must satisfy {@link isOfficeType}.
 * @returns the document's text.
 * @throws when the archive cannot be opened, the expected part is missing, or
 *   the document carries no text — each surfaces as an ingestion failure
 *   rather than a silently empty document entering the corpus.
 */
export async function extractOfficeText(bytes: Buffer, mime: string): Promise<string> {
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(bytes)
  } catch (error) {
    throw new Error(
      `not a readable OOXML archive: ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  const read = async (name: string): Promise<string | undefined> =>
    zip.file(name)?.async('string')

  let text: string
  if (mime.endsWith('wordprocessingml.document')) {
    const documentXml = await read('word/document.xml')
    if (documentXml === undefined) throw new Error('docx archive has no word/document.xml')
    text = extractDocx(documentXml)
  } else if (mime.endsWith('spreadsheetml.sheet')) {
    const sheetFiles = Object.keys(zip.files)
      .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
      .sort()
    if (sheetFiles.length === 0) throw new Error('xlsx archive has no worksheets')
    const sheets = await Promise.all(sheetFiles.map(async (name) => (await read(name)) ?? ''))
    text = extractXlsx(sheets, await read('xl/sharedStrings.xml'))
  } else {
    const slideFiles = Object.keys(zip.files)
      .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
      .sort((a, b) => {
        const n = (s: string) => Number(/slide(\d+)\.xml$/.exec(s)?.[1] ?? 0)
        return n(a) - n(b)
      })
    if (slideFiles.length === 0) throw new Error('pptx archive has no slides')
    const slides = await Promise.all(slideFiles.map(async (name) => (await read(name)) ?? ''))
    text = extractPptx(slides)
  }

  if (text.trim() === '') {
    throw new Error('document contains no extractable text')
  }
  return text
}
