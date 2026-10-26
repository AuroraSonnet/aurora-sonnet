/**
 * Shared files every signed partner can download.
 * Only files already stored in this project. No generated artwork.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ASSETS = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets')

const FILES = [
  {
    id: 'wedding-performance',
    file: 'partner-media-kit/Aurora-Sonnet-wedding-performance.png',
    downloadName: 'Aurora-Sonnet-wedding-performance.png',
    label: 'Wedding performance photo',
    contentType: 'image/png',
  },
  {
    id: 'as-monogram',
    file: 'partner-media-kit/Aurora-Sonnet-monogram.png',
    downloadName: 'Aurora-Sonnet-monogram.png',
    label: 'AS monogram',
    contentType: 'image/png',
  },
  {
    id: 'wordmark',
    file: 'partner-media-kit/Aurora-Sonnet-wordmark.png',
    downloadName: 'Aurora-Sonnet-wordmark.png',
    label: 'Aurora Sonnet wordmark',
    contentType: 'image/png',
  },
]

const loaded = FILES.map((item) => ({
  ...item,
  bytes: readFileSync(join(ASSETS, item.file)),
}))

export function listPartnerMediaKitFiles() {
  return loaded.map(({ id, label, downloadName }) => ({ id, label, downloadName }))
}

export function partnerMediaKitFile(id) {
  return loaded.find((item) => item.id === id) || null
}
