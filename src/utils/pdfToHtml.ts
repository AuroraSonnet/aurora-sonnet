/**
 * Extract text from PDF and convert to editable HTML for the contract editor.
 * Uses pdfjs for text PDFs; falls back to OCR (Tesseract) for scanned/image-based PDFs.
 */
import * as pdfjsLib from 'pdfjs-dist'
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import Tesseract from 'tesseract.js'

let workerInit = false
function initPdfWorker() {
  if (workerInit || typeof window === 'undefined') return
  workerInit = true
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function textToParagraphs(text: string): string[] {
  const trimmed = text.replace(/\s+/g, ' ').trim()
  if (!trimmed) return []
  const blocks = trimmed.split(/\s{2,}/).filter((b) => b.trim())
  return (blocks.length > 0 ? blocks : [trimmed]).map((block) => `<p>${escapeHtml(block)}</p>`)
}

async function extractWithPdfJs(pdf: pdfjsLib.PDFDocumentProxy): Promise<string[]> {
  const paragraphs: string[] = []
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const textContent = await page.getTextContent()
    const pageText = (textContent.items as Array<{ str?: string }>)
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ')
    paragraphs.push(...textToParagraphs(pageText))
  }
  return paragraphs
}

async function extractWithOcr(pdf: pdfjsLib.PDFDocumentProxy): Promise<string[]> {
  const paragraphs: string[] = []
  const scale = 2

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const viewport = page.getViewport({ scale })
    const canvas = document.createElement('canvas')
    canvas.width = viewport.width
    canvas.height = viewport.height
    const ctx = canvas.getContext('2d')
    if (!ctx) continue
    await page.render({ canvasContext: ctx, canvas, viewport, intent: 'display' }).promise

    const { data } = await Tesseract.recognize(canvas, 'eng', {
      logger: () => {},
    })
    paragraphs.push(...textToParagraphs(data.text))
  }
  return paragraphs
}

export async function pdfToHtml(pdfUrl: string): Promise<string> {
  initPdfWorker()
  const loadingTask = pdfjsLib.getDocument({ url: pdfUrl })
  const pdf = await loadingTask.promise

  let paragraphs = await extractWithPdfJs(pdf)

  if (paragraphs.length === 0) {
    paragraphs = await extractWithOcr(pdf)
  }

  if (paragraphs.length === 0) {
    return '<p>No text could be extracted from this PDF. It may be encrypted or corrupted. Try creating from editor and typing your content, or use a different PDF.</p>'
  }

  return paragraphs.join('\n')
}
