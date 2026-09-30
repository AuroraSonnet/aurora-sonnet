/** One-off: render each page of a PDF to PNG for review previews. */
import { readFileSync, writeFileSync } from 'node:fs'
import { createCanvas } from '@napi-rs/canvas'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'

const [inputPdf, outputPng] = process.argv.slice(2)
if (!inputPdf || !outputPng) {
  console.error('Usage: node scripts/pdf-to-png-preview.mjs input.pdf output.png')
  process.exit(1)
}

const data = new Uint8Array(readFileSync(inputPdf))
const doc = await getDocument({ data, useSystemFonts: true }).promise
const page = await doc.getPage(1)
const viewport = page.getViewport({ scale: 2 })
const canvas = createCanvas(viewport.width, viewport.height)
const ctx = canvas.getContext('2d')
await page.render({ canvasContext: ctx, viewport }).promise
writeFileSync(outputPng, canvas.toBuffer('image/png'))
console.log('Wrote', outputPng, `${viewport.width}x${viewport.height}`)
