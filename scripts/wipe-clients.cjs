#!/usr/bin/env node
/**
 * Wipe all clients from the app's API (e.g. Render).
 * Usage: APP_URL=https://your-app.onrender.com node scripts/wipe-clients.cjs
 *    or: node scripts/wipe-clients.cjs https://your-app.onrender.com
 */
const base = process.argv[2] || process.env.APP_URL
if (!base || !base.startsWith('http')) {
  console.error('Usage: APP_URL=https://your-app.onrender.com node scripts/wipe-clients.cjs')
  console.error('   or: node scripts/wipe-clients.cjs https://your-app.onrender.com')
  process.exit(1)
}
const API = base.replace(/\/$/, '') + '/api'

async function main() {
  const res = await fetch(`${API}/state`)
  if (!res.ok) {
    console.error('Failed to fetch state:', res.status)
    process.exit(1)
  }
  const data = await res.json()
  const clients = data.clients || []
  if (clients.length === 0) {
    console.log('No clients to delete.')
    return
  }
  console.log(`Deleting ${clients.length} client(s)...`)
  for (const c of clients) {
    const del = await fetch(`${API}/clients/${c.id}`, { method: 'DELETE' })
    if (del.ok) console.log('  Deleted:', c.name || c.id)
    else console.warn('  Failed:', c.id, del.status)
  }
  console.log('Done.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
