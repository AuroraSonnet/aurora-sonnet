/**
 * Extract text from PDF and create an editable Word (DOCX) document.
 * User can edit in Word, export to PDF, then Replace PDF in the template.
 */
import * as pdfjsLib from 'pdfjs-dist'
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
} from 'docx'

// pdfjs worker
let workerInit = false
function initPdfWorker() {
  if (workerInit || typeof window === 'undefined') return
  workerInit = true
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker
}

export async function pdfToDocx(pdfUrl: string, title = 'Document'): Promise<Blob> {
  initPdfWorker()
  const loadingTask = pdfjsLib.getDocument({ url: pdfUrl })
  const pdf = await loadingTask.promise
  const numPages = pdf.numPages
  const children: Paragraph[] = []

  for (let i = 1; i <= numPages; i++) {
    const page = await pdf.getPage(i)
    const textContent = await page.getTextContent()
    const pageText = textContent.items
      .map((item: unknown) => ('str' in (item as { str?: string }) ? (item as { str: string }).str : ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()

    if (pageText) {
      children.push(
        new Paragraph({
          text: `--- Page ${i} ---`,
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 200, after: 100 },
        }),
        new Paragraph({
          children: [new TextRun(pageText)],
          spacing: { after: 200 },
        })
      )
    }
  }

  if (children.length === 0) {
    children.push(
      new Paragraph({
        text: 'No text could be extracted from this PDF. It may be image-based or scanned.',
      })
    )
  }

  const doc = new Document({
    title,
    sections: [
      {
        properties: {},
        children: [
          new Paragraph({
            text: title,
            heading: HeadingLevel.TITLE,
            spacing: { after: 400 },
          }),
          ...children,
        ],
      },
    ],
  })

  return Packer.toBlob(doc)
}
