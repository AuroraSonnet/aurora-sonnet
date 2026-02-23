/**
 * Renders the AS logo on a pure white (#ffffff) square canvas.
 * Builds a solid white base then composites the logo so the background is 100% white.
 * Usage: node scripts/icon-white-bg.mjs <input.png> [output.png]
 */
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = join(__dirname, '..')

async function main() {
  const sharp = (await import('sharp')).default
  const inputPath = process.argv[2] || join(projectRoot, 'assets', 'aurora-sonnet-icon-transparent.png')
  const outputPath = process.argv[3] || join(projectRoot, 'assets', 'aurora-sonnet-icon-white-bg.png')

  const input = sharp(readFileSync(inputPath))
  const { width: w, height: h } = await input.metadata()
  const size = Math.max(w, h)
  const left = Math.floor((size - w) / 2)
  const top = Math.floor((size - h) / 2)

  // Pure white canvas (every pixel 255,255,255)
  const whiteBuf = Buffer.alloc(size * size * 3, 255)
  const logoBuf = await input.ensureAlpha().raw().toBuffer({ resolveWithObject: true })

  await sharp(whiteBuf, { raw: { width: size, height: size, channels: 3 } })
    .composite([{ input: logoBuf.data, raw: { width: logoBuf.info.width, height: logoBuf.info.height, channels: 4 }, left, top }])
    .png()
    .toFile(outputPath)

  console.log('Written:', outputPath, `(${size}x${size} square, pure white background)`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
