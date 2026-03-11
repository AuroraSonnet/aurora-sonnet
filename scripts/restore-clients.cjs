#!/usr/bin/env node
/**
 * Restore all soft-deleted clients (and their projects) on the API.
 * Usage: node scripts/restore-clients.cjs https://aurora-sonnet-1.onrender.com
 *    or: APP_URL=https://your-app.onrender.com node scripts/restore-clients.cjs
 */
const base = process.argv[2] || process.env.APP_URL
if (!base || !base.startsWith('http')) {
  console.error('Usage: node scripts/restore-clients.cjs https://aurora-sonnet-1.onrender.com')
  process.exit(1)
}
const API = base.replace(/\/$/, '') + '/api'

async function main() {
  const res = await fetch(`${API}/clients/restore-all`, { method: 'POST' })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    console.error('Failed:', data.error || res.status)
    process.exit(1)
  }
  console.log('Restored', data.restored ?? 0, 'client(s). Now click Sync in the app to see them.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
