#!/usr/bin/env node
/**
 * Downloads Node.js binary for the current platform so the packaged app
 * can run the server without requiring Node to be installed.
 * Run before electron-builder (e.g. in build:mac / build:win).
 */
const https = require('https')
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

const NODE_VERSION = 'v20.18.0'
const DIST = 'https://nodejs.org/dist'
const OUT_DIR = path.join(__dirname, '..', 'resources', 'node')

function getTarballName() {
  const plat = process.platform
  const arch = process.arch
  if (plat === 'darwin') {
    const suffix = arch === 'arm64' ? 'darwin-arm64' : 'darwin-x64'
    return `node-${NODE_VERSION}-${suffix}.tar.gz`
  }
  if (plat === 'win32') {
    const suffix = arch === 'arm64' ? 'win-arm64' : 'win-x64'
    return `node-${NODE_VERSION}-${suffix}.zip`
  }
  console.error('Unsupported platform for bundling Node:', plat, arch)
  process.exit(1)
}

function download(url) {
  return new Promise((resolve, reject) => {
    const file = path.join(OUT_DIR, path.basename(url))
    const stream = fs.createWriteStream(file)
    https.get(url, { redirect: true }, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}: ${url}`))
        return
      }
      res.pipe(stream)
      stream.on('finish', () => {
        stream.close()
        resolve(file)
      })
    }).on('error', reject)
  })
}

function main() {
  const tarball = getTarballName()
  const url = `${DIST}/${NODE_VERSION}/${tarball}`
  const extractDir = path.join(OUT_DIR, 'extract')

  console.log('Downloading Node.js for packaged app:', tarball)
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true })

  download(url)
    .then((file) => {
      console.log('Extracting...')
      if (fs.existsSync(extractDir)) {
        fs.rmSync(extractDir, { recursive: true })
      }
      fs.mkdirSync(extractDir, { recursive: true })
      if (tarball.endsWith('.tar.gz')) {
        execSync(`tar -xzf "${file}" -C "${extractDir}"`, { stdio: 'inherit' })
      } else {
        execSync(`unzip -o -q "${file}" -d "${extractDir}"`, { stdio: 'inherit' })
      }
      const extracted = fs.readdirSync(extractDir)
      const nodeDir = extracted.find((n) => n.startsWith('node-'))
      if (!nodeDir) throw new Error('Unexpected archive layout')
      const src = path.join(extractDir, nodeDir)
      const dest = path.join(OUT_DIR, 'runtime')
      if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true })
      fs.renameSync(src, dest)
      fs.rmSync(extractDir, { recursive: true })
      fs.unlinkSync(file)
      console.log('Node.js ready at', path.join(OUT_DIR, 'runtime'))
    })
    .catch((err) => {
      console.error(err)
      process.exit(1)
    })
}

main()
