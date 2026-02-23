#!/usr/bin/env node
/**
 * Rebuilds better-sqlite3 for the bundled Node.js so the server can load it
 * when run from the packaged app. Run after download-node.cjs.
 */
const path = require('path')
const { execSync } = require('child_process')
const fs = require('fs')

const projectRoot = path.join(__dirname, '..')
const runtime = path.join(projectRoot, 'resources', 'node', 'runtime')
const npm = path.join(runtime, 'bin', 'npm')

if (!fs.existsSync(npm)) {
  console.error('Bundled Node not found. Run scripts/download-node.cjs first.')
  process.exit(1)
}

console.log('Rebuilding better-sqlite3 for bundled Node...')
execSync(`"${npm}" rebuild better-sqlite3`, {
  cwd: projectRoot,
  stdio: 'inherit',
  env: { ...process.env, PATH: path.join(runtime, 'bin') + path.delimiter + process.env.PATH },
})
console.log('Done.')
