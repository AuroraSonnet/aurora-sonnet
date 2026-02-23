/**
 * Strips background from a PNG so it saves as fully transparent.
 * Makes any light/white/near-transparent pixels 100% transparent.
 * Usage: node scripts/make-transparent-bg.mjs <input.png> [output.png]
 */
import { readFileSync, writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = join(__dirname, '..')

// Parse PNG manually to set alpha to 0 for background pixels (no sharp dependency)
function parsePNG(buffer) {
  if (buffer.toString('ascii', 0, 8) !== '\x89PNG\r\n\x1a\n') throw new Error('Not a PNG')
  const chunks = []
  let offset = 8
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString('ascii', offset + 4, offset + 8)
    chunks.push({ type, start: offset + 8, length, total: 12 + length })
    offset += 12 + length
  }
  return chunks
}

function findChunk(chunks, type) {
  return chunks.find((c) => c.type === type)
}

// Decompress IDAT and get raw RGBA rows
async function getRGBA(buffer, chunks) {
  const ihdr = findChunk(chunks, 'IHDR')
  if (!ihdr) throw new Error('No IHDR')
  const width = buffer.readUInt32BE(ihdr.start)
  const height = buffer.readUInt32BE(ihdr.start + 4)
  const depth = buffer.readUInt8(ihdr.start + 8)
  const colorType = buffer.readUInt8(ihdr.start + 9)
  if (depth !== 8 || colorType !== 6) {
    throw new Error('Only 8-bit RGBA PNG supported. Use sharp or convert to RGBA first.')
  }
  const idatChunks = chunks.filter((c) => c.type === 'IDAT')
  const idat = Buffer.concat(idatChunks.map((c) => buffer.subarray(c.start, c.start + c.length)))
  const { inflateSync } = await import('zlib')
  const raw = inflateSync(idat)
  const bytesPerRow = 1 + width * 4
  const rows = []
  for (let y = 0; y < height; y++) {
    const rowStart = y * bytesPerRow
    const filter = raw[rowStart]
    const row = []
    for (let x = 0; x < width; x++) {
      const i = rowStart + 1 + x * 4
      let r = raw[i]
      let g = raw[i + 1]
      let b = raw[i + 2]
      let a = raw[i + 3]
      if (filter === 1 && x > 0) {
        r = (r + row[(x - 1) * 4]) % 256
        g = (g + row[(x - 1) * 4 + 1]) % 256
        b = (b + row[(x - 1) * 4 + 2]) % 256
        a = (a + row[(x - 1) * 4 + 3]) % 256
      } else if (filter === 0) {
        // none
      }
      row.push(r, g, b, a)
    }
    rows.push(row)
  }
  return { width, height, rows }
}

// Simple approach: use sharp if available for reliable RGBA + alpha strip
async function main() {
  const inputPath = process.argv[2] || join(projectRoot, 'assets', 'Icon_Aurora_Sonnet-3aa179d3-d22d-4de2-8e63-c04320d08712.png')
  const outputPath = process.argv[3] || join(projectRoot, 'assets', 'aurora-sonnet-icon-transparent.png')

  let sharp
  try {
    sharp = (await import('sharp')).default
  } catch {
    console.log('Installing sharp for image processing...')
    const { execSync } = await import('child_process')
    execSync('npm install sharp --no-save', { cwd: projectRoot, stdio: 'inherit' })
    sharp = (await import('sharp')).default
  }

  const inputBuf = readFileSync(inputPath)
  const image = sharp(inputBuf)
  const meta = await image.metadata()
  const { data, info } = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true })

  const w = info.width
  const h = info.height
  const channels = info.channels
  const out = Buffer.from(data)

  const LIGHT_THRESHOLD = 245
  const ALPHA_THRESHOLD = 250

  for (let i = 0; i < data.length; i += channels) {
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]
    const a = data[i + 3] ?? 255
    const isBackground =
      (r >= LIGHT_THRESHOLD && g >= LIGHT_THRESHOLD && b >= LIGHT_THRESHOLD) || a <= 15
    if (isBackground) {
      out[i + 3] = 0
    }
  }

  await sharp(out, { raw: { width: w, height: h, channels: 4 } })
    .png()
    .toFile(outputPath)

  console.log('Written:', outputPath)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
