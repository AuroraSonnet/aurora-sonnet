#!/usr/bin/env node
/**
 * Copies server/.env to the Mac app's Application Support folder
 * so the packaged Aurora Sonnet app can send inquiry and reminder emails.
 * Run: node scripts/copy-env-to-app-support.cjs
 */
const fs = require('fs')
const path = require('path')

const appName = 'Aurora Sonnet'
const home = process.env.HOME || process.env.USERPROFILE
if (!home) {
  console.error('Could not find home directory (HOME or USERPROFILE).')
  process.exit(1)
}

const destDir = path.join(home, 'Library', 'Application Support', appName)
const srcPath = path.join(__dirname, '..', 'server', '.env')
const destPath = path.join(destDir, '.env')

if (!fs.existsSync(srcPath)) {
  console.error('Source not found:', srcPath)
  console.error('Create server/.env with your SMTP settings first.')
  process.exit(1)
}

try {
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true })
  }
  fs.copyFileSync(srcPath, destPath)
  console.log('Copied server/.env to:', destPath)
  console.log('Restart the Aurora Sonnet app for inquiry/reminder emails to work.')
} catch (err) {
  console.error('Failed to copy:', err.message)
  process.exit(1)
}
