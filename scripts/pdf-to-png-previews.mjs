/** Render PDF pages to PNG previews for legal review. */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join, basename } from 'node:path'
import { createCanvas } from '@napi-rs/canvas'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'

const files = process.argv.slice(2)
if (!files.length) {
  console.error('Usage: node scripts/pdf-to-png-previews.mjs file1.pdf [file2.pdf ...]')
  process.exit(1)
}

mkdirSync('docs/samples/previews', { recursive: true })

for (const inputPdf of files) {
  const data = new Uint8Array(readFileSync(inputPdf))
  const doc = await getDocument({ data, useSystemFonts: true }).promise
  const stem = basename(inputPdf, '.pdf')
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n)
    const viewport = page.getViewport({ scale: 1.75 })
    const canvas = createCanvas(viewport.width, viewport.height)
    const ctx = canvas.getContext('2d')
    await page.render({ canvasContext: ctx, viewport }).promise
    const out = join(dirname(inputPdf), 'previews', `${stem}-p${n}.png`)
    mkdirSync(dirname(out), { recursive: true })
    writeFileSync(out, canvas.toBuffer('image/png'))
    console.log('Wrote', out)
  }
}
