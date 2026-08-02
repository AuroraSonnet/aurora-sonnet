#!/usr/bin/env node
/**
 * READ-ONLY report: legacy referralStatus × payoutStatus combinations.
 * Does not modify the database. Point at a copy or local DB only — never production live.
 *
 * Usage:
 *   DATA_DIR=/path/to/data node scripts/report-partner-referral-status.mjs
 *   node scripts/report-partner-referral-status.mjs /path/to/aurora.db
 */
import Database from 'better-sqlite3'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const dbPathArg = process.argv[2]
const dataDir = process.env.DATA_DIR
const dbPath = dbPathArg || (dataDir ? join(dataDir, 'aurora.db') : join(process.cwd(), 'server', 'aurora.db'))

if (!existsSync(dbPath)) {
  console.error(`Database not found: ${dbPath}`)
  console.error('Set DATA_DIR or pass a path to a SQLite file (use a copy, not production).')
  process.exit(1)
}

const db = new Database(dbPath, { readonly: true })

function norm(s) {
  return String(s ?? '')
    .toLowerCase()
    .trim()
    .replace(/[\s-]+/g, '_')
}

const rows = db
  .prepare(
    `SELECT referralStatus, payoutStatus, COUNT(*) AS n
     FROM partner_referrals
     GROUP BY referralStatus, payoutStatus
     ORDER BY n DESC, referralStatus, payoutStatus`
  )
  .all()

const paidStatusRows = db
  .prepare(`SELECT COUNT(*) AS n FROM partner_referrals WHERE lower(replace(referralStatus,' ','_')) = 'paid'`)
  .get()

console.log('# Partner referral status report (read-only)')
console.log(`Database: ${dbPath}`)
console.log(`Generated: ${new Date().toISOString()}`)
console.log('')
console.log('## referralStatus × payoutStatus counts')
console.log('')
console.log('| referralStatus | payoutStatus | count |')
console.log('|----------------|--------------|-------|')
for (const r of rows) {
  console.log(`| ${r.referralStatus || '(empty)'} | ${r.payoutStatus || '(empty)'} | ${r.n} |`)
}
console.log('')
console.log(`Rows with legacy referralStatus "paid": ${paidStatusRows?.n ?? 0}`)
console.log('')
console.log('Review this table before any status migration. Do not migrate until approved.')
