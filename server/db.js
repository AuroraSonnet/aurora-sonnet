import Database from 'better-sqlite3'
import { existsSync, mkdirSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import {
  computePartnerReferralAmounts,
  normalizeExpenseLineItems,
  PARTNER_REFERRAL_COMMISSION_RATE,
  PARTNER_REFERRAL_MIN_PAYOUT_AMOUNT,
  PARTNER_REFERRAL_STATUS_KEYS,
  PARTNER_REFERRAL_STATUS_LABELS,
  referralStatusEligibleForBookingPayout,
  normalizeReferralStatusKey,
} from './partnerReferralPayout.js'

export {
  computePartnerReferralAmounts,
  PARTNER_REFERRAL_COMMISSION_RATE,
  PARTNER_REFERRAL_MIN_PAYOUT_AMOUNT,
  PARTNER_REFERRAL_STATUS_KEYS,
  PARTNER_REFERRAL_STATUS_LABELS,
  referralStatusEligibleForBookingPayout,
  normalizeReferralStatusKey,
}

const __dirname = dirname(fileURLToPath(import.meta.url))
// On Render the filesystem is read-only; use writable path so inquiry form works.
// Render sets RENDER=true and RENDER_EXTERNAL_URL; either indicates we should use /tmp.
const isRender = process.env.RENDER === 'true' || (process.env.RENDER_EXTERNAL_URL && process.env.RENDER_EXTERNAL_URL.includes('onrender.com'))
const dataDir = process.env.DATA_DIR || (isRender ? '/tmp/aurora-sonnet-data' : __dirname)
if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true })
const db = new Database(join(dataDir, 'aurora.db'))
db.pragma('journal_mode = WAL')

db.exec(`
  CREATE TABLE IF NOT EXISTS clients (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT,
    partnerName TEXT,
    createdAt TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    clientId TEXT NOT NULL,
    clientName TEXT NOT NULL,
    title TEXT NOT NULL,
    stage TEXT NOT NULL,
    value INTEGER NOT NULL,
    weddingDate TEXT NOT NULL,
    venue TEXT,
    packageType TEXT,
    dueDate TEXT NOT NULL,
    createdAt TEXT
  );
  CREATE TABLE IF NOT EXISTS proposals (
    id TEXT PRIMARY KEY,
    projectId TEXT NOT NULL,
    clientName TEXT NOT NULL,
    title TEXT NOT NULL,
    status TEXT NOT NULL,
    value INTEGER NOT NULL,
    sentAt TEXT
  );
  CREATE TABLE IF NOT EXISTS invoices (
    id TEXT PRIMARY KEY,
    projectId TEXT,
    clientName TEXT NOT NULL,
    clientEmail TEXT,
    projectTitle TEXT NOT NULL,
    amount INTEGER NOT NULL,
    status TEXT NOT NULL,
    dueDate TEXT NOT NULL,
    paidAt TEXT,
    type TEXT
  );
  CREATE TABLE IF NOT EXISTS contracts (
    id TEXT PRIMARY KEY,
    projectId TEXT NOT NULL,
    clientName TEXT NOT NULL,
    title TEXT NOT NULL,
    status TEXT NOT NULL,
    value INTEGER NOT NULL,
    weddingDate TEXT NOT NULL,
    venue TEXT,
    packageType TEXT,
    signedAt TEXT,
    createdAt TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS expenses (
    id TEXT PRIMARY KEY,
    date TEXT NOT NULL,
    description TEXT NOT NULL,
    amount INTEGER NOT NULL,
    category TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS contract_templates (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    fileName TEXT NOT NULL,
    createdAt TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS invoice_templates (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    fileName TEXT NOT NULL,
    createdAt TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS pipeline_stages (
    id TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    sortOrder INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS calendar_reminders (
    id TEXT PRIMARY KEY,
    date TEXT NOT NULL,
    title TEXT NOT NULL,
    notes TEXT,
    clientId TEXT,
    projectId TEXT,
    reminderAt TEXT,
    sentAt TEXT,
    createdAt TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS experiences (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    bullets TEXT NOT NULL,
    fromPrice INTEGER NOT NULL,
    imageUrl TEXT,
    sortOrder INTEGER NOT NULL DEFAULT 0,
    createdAt TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS music_selections (
    id TEXT PRIMARY KEY,
    clientId TEXT,
    submitterName TEXT NOT NULL,
    submitterEmail TEXT NOT NULL,
    label TEXT,
    songIds TEXT NOT NULL,
    songsText TEXT,
    createdAt TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS short_links (
    id TEXT PRIMARY KEY,
    proposalId TEXT NOT NULL,
    token TEXT NOT NULL,
    d TEXT NOT NULL,
    createdAt TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS partner_referrals (
    id TEXT PRIMARY KEY,
    partnerName TEXT NOT NULL,
    companyName TEXT,
    partnerEmail TEXT NOT NULL,
    clientName TEXT NOT NULL,
    clientEmail TEXT NOT NULL,
    clientPhone TEXT,
    eventDate TEXT,
    eventLocation TEXT,
    notes TEXT,
    referralStatus TEXT NOT NULL DEFAULT 'new',
    bookingAmount INTEGER NOT NULL DEFAULT 0,
    travelExpenseAmount INTEGER NOT NULL DEFAULT 0,
    hotelExpenseAmount INTEGER NOT NULL DEFAULT 0,
    commissionableAmount INTEGER NOT NULL DEFAULT 0,
    commissionableOverrideAmount INTEGER,
    payoutAmount INTEGER NOT NULL DEFAULT 0,
    payoutOverrideAmount INTEGER,
    payoutStatus TEXT NOT NULL DEFAULT 'none',
    submissionDate TEXT NOT NULL,
    linkedVendorId TEXT,
    linkedLeadId TEXT,
    updatedAt TEXT NOT NULL
  );
`)

// Optional templateId for "create from template" (migrate existing DBs)
try {
  db.exec('ALTER TABLE contracts ADD COLUMN templateId TEXT')
} catch (e) {
  if (!/duplicate column/i.test(e.message)) throw e
}
// signToken for client signing link, clientSignedAt when client signs
try {
  db.exec('ALTER TABLE contracts ADD COLUMN signToken TEXT')
} catch (e) {
  if (!/duplicate column/i.test(e.message)) throw e
}
try {
  db.exec('ALTER TABLE contracts ADD COLUMN clientSignedAt TEXT')
} catch (e) {
  if (!/duplicate column/i.test(e.message)) throw e
}
try {
  db.exec('ALTER TABLE contracts ADD COLUMN lastReminderSentAt TEXT')
} catch (e) {
  if (!/duplicate column/i.test(e.message)) throw e
}
try {
  db.exec('ALTER TABLE contracts ADD COLUMN deletedAt TEXT')
} catch (e) {
  if (!/duplicate column/i.test(e.message)) throw e
}
try {
  db.exec('ALTER TABLE contracts ADD COLUMN proposalId TEXT')
} catch (e) {
  if (!/duplicate column/i.test(e.message)) throw e
}
try {
  db.exec('ALTER TABLE invoices ADD COLUMN templateId TEXT')
} catch (e) {
  if (!/duplicate column/i.test(e.message)) throw e
}
try {
  db.exec('ALTER TABLE invoices ADD COLUMN invoiceNumber TEXT')
} catch (e) {
  if (!/duplicate column/i.test(e.message)) throw e
}
try {
  db.exec('ALTER TABLE invoices ADD COLUMN lineItems TEXT')
} catch (e) {
  if (!/duplicate column/i.test(e.message)) throw e
}
try {
  db.exec('ALTER TABLE invoices ADD COLUMN lastReminderSentAt TEXT')
} catch (e) {
  if (!/duplicate column/i.test(e.message)) throw e
}

db.exec(`
  CREATE TABLE IF NOT EXISTS contract_pdf_blobs (
    id TEXT PRIMARY KEY,
    pdf BLOB NOT NULL,
    updatedAt TEXT NOT NULL
  )
`)

// Backfill invoiceNumber for existing rows that don't have one (INV-001, INV-002, ...)
try {
  const withNumber = db.prepare("SELECT MAX(CAST(SUBSTR(invoiceNumber, 5) AS INTEGER)) AS n FROM invoices WHERE invoiceNumber GLOB 'INV-[0-9]*'").get()
  let nextNum = (withNumber?.n != null && !Number.isNaN(Number(withNumber.n))) ? Number(withNumber.n) + 1 : 1
  const rows = db.prepare('SELECT id FROM invoices WHERE invoiceNumber IS NULL OR invoiceNumber = "" ORDER BY rowid ASC').all()
  rows.forEach((row) => {
    db.prepare('UPDATE invoices SET invoiceNumber = ? WHERE id = ?').run(`INV-${String(nextNum).padStart(3, '0')}`, row.id)
    nextNum += 1
  })
} catch (_) {}
try {
  db.exec('ALTER TABLE contract_templates ADD COLUMN contentHtml TEXT')
} catch (e) {
  if (!/duplicate column/i.test(e.message)) throw e
}
try {
  db.exec('ALTER TABLE projects ADD COLUMN notes TEXT')
} catch (e) {
  if (!/duplicate column/i.test(e.message)) throw e
}
try {
  db.exec('ALTER TABLE projects ADD COLUMN requestedArtist TEXT')
} catch (e) {
  if (!/duplicate column/i.test(e.message)) throw e
}
try {
  db.exec('ALTER TABLE projects ADD COLUMN performanceMoment TEXT')
} catch (e) {
  if (!/duplicate column/i.test(e.message)) throw e
}
try {
  db.exec('ALTER TABLE projects ADD COLUMN cloudProjectId TEXT')
} catch (e) {
  if (!/duplicate column/i.test(e.message)) throw e
}
try {
  db.exec('ALTER TABLE clients ADD COLUMN deletedAt TEXT')
} catch (e) {
  if (!/duplicate column/i.test(e.message)) throw e
}
try {
  db.exec('ALTER TABLE projects ADD COLUMN deletedAt TEXT')
} catch (e) {
  if (!/duplicate column/i.test(e.message)) throw e
}
try {
  db.exec('ALTER TABLE projects ADD COLUMN archivedAt TEXT')
} catch (e) {
  if (!/duplicate column/i.test(e.message)) throw e
}
try {
  db.exec('ALTER TABLE proposals ADD COLUMN emailBody TEXT')
} catch (e) {
  if (!/duplicate column/i.test(e.message)) throw e
}
for (const col of ['customPackageName', 'customPackageDetails', 'customPriceBreakdown']) {
  try {
    db.exec(`ALTER TABLE proposals ADD COLUMN ${col} TEXT`)
  } catch (e) {
    if (!/duplicate column/i.test(e.message)) throw e
  }
}
try {
  db.exec('ALTER TABLE proposals ADD COLUMN acceptToken TEXT')
} catch (e) {
  if (!/duplicate column/i.test(e.message)) throw e
}
try {
  db.exec('ALTER TABLE proposals ADD COLUMN acceptedEnhancements TEXT')
} catch (e) {
  if (!/duplicate column/i.test(e.message)) throw e
}
// sentAt for calendar reminders (whether email was sent)
try {
  db.exec('ALTER TABLE calendar_reminders ADD COLUMN sentAt TEXT')
} catch (e) {
  if (!/duplicate column/i.test(e.message)) throw e
}
try {
  db.exec('ALTER TABLE partner_referrals ADD COLUMN expense_line_items TEXT')
} catch (e) {
  if (!/duplicate column/i.test(e.message)) throw e
}
try {
  db.exec('ALTER TABLE partner_referrals ADD COLUMN referral_reference TEXT')
} catch (e) {
  if (!/duplicate column/i.test(e.message)) throw e
}

/** Assign REF-1001+ to rows missing a reference (stable display for legacy data). */
function backfillPartnerReferralReferences() {
  let maxNum = 1000
  const withRef = db
    .prepare(
      "SELECT referral_reference FROM partner_referrals WHERE referral_reference IS NOT NULL AND referral_reference != ''"
    )
    .all()
  for (const r of withRef) {
    const m = String(r.referral_reference).match(/^REF-(\d+)$/i)
    if (m) maxNum = Math.max(maxNum, parseInt(m[1], 10))
  }
  let nextNum = maxNum + 1
  const orphans = db
    .prepare(
      "SELECT id FROM partner_referrals WHERE referral_reference IS NULL OR referral_reference = '' ORDER BY submissionDate ASC, rowid ASC"
    )
    .all()
  const upd = db.prepare('UPDATE partner_referrals SET referral_reference = ? WHERE id = ?')
  for (const o of orphans) {
    upd.run(`REF-${nextNum}`, o.id)
    nextNum += 1
  }
}
backfillPartnerReferralReferences()

function getNextReferralReference() {
  let maxNum = 1000
  const rows = db
    .prepare(
      "SELECT referral_reference FROM partner_referrals WHERE referral_reference IS NOT NULL AND referral_reference != ''"
    )
    .all()
  for (const r of rows) {
    const m = String(r.referral_reference).match(/^REF-(\d+)$/i)
    if (m) maxNum = Math.max(maxNum, parseInt(m[1], 10))
  }
  return `REF-${maxNum + 1}`
}

// Ensure inquiry-related columns exist (handles old DBs on Render or restores)
function ensureInquiryColumns() {
  const projectCols = db.prepare("PRAGMA table_info(projects)").all().map((r) => r.name)
  for (const col of ['notes', 'requestedArtist', 'performanceMoment', 'cloudProjectId', 'deletedAt', 'archivedAt']) {
    if (!projectCols.includes(col)) {
      try {
        db.exec(`ALTER TABLE projects ADD COLUMN ${col} TEXT`)
      } catch (e) {
        if (!/duplicate column/i.test(e.message)) throw e
      }
    }
  }
  const clientCols = db.prepare("PRAGMA table_info(clients)").all().map((r) => r.name)
  if (!clientCols.includes('deletedAt')) {
    try {
      db.exec('ALTER TABLE clients ADD COLUMN deletedAt TEXT')
    } catch (e) {
      if (!/duplicate column/i.test(e.message)) throw e
    }
  }
}
ensureInquiryColumns()

// Indexes for soft-delete: keep getState() fast when filtering active clients/projects
db.exec('CREATE INDEX IF NOT EXISTS idx_clients_active ON clients(id) WHERE deletedAt IS NULL')
db.exec('CREATE INDEX IF NOT EXISTS idx_projects_active ON projects(clientId) WHERE deletedAt IS NULL')

// Seed default pipeline stages if none exist
const defaultPipelineStages = [
  { id: 'inquiry', label: 'Inquiry', sortOrder: 1 },
  { id: 'proposal', label: 'Proposal', sortOrder: 2 },
  { id: 'booked', label: 'Booked', sortOrder: 3 },
  { id: 'completed', label: 'Completed', sortOrder: 4 },
  { id: 'lost', label: 'Lost', sortOrder: 5 },
]
const stageCount = db.prepare('SELECT COUNT(*) as c FROM pipeline_stages').get()
if (stageCount.c === 0) {
  const insert = db.prepare('INSERT INTO pipeline_stages (id, label, sortOrder) VALUES (?, ?, ?)')
  for (const s of defaultPipelineStages) {
    insert.run(s.id, s.label, s.sortOrder)
  }
}

function rowToClient(r) {
  return {
    id: r.id,
    name: r.name,
    email: r.email,
    phone: r.phone || undefined,
    partnerName: r.partnerName || undefined,
    createdAt: r.createdAt,
  }
}

function rowToProject(r) {
  return {
    id: r.id,
    clientId: r.clientId,
    clientName: r.clientName,
    title: r.title,
    stage: r.stage,
    value: r.value,
    weddingDate: r.weddingDate,
    venue: r.venue || undefined,
    packageType: r.packageType || undefined,
    dueDate: r.dueDate,
    createdAt: r.createdAt || undefined,
    notes: r.notes || undefined,
    requestedArtist: r.requestedArtist || undefined,
    performanceMoment: r.performanceMoment || undefined,
    cloudProjectId: r.cloudProjectId || undefined,
    archivedAt: r.archivedAt || undefined,
  }
}

function rowToProposal(r) {
  return {
    id: r.id,
    projectId: r.projectId,
    clientName: r.clientName,
    title: r.title,
    status: r.status,
    value: r.value,
    sentAt: r.sentAt || undefined,
    emailBody: r.emailBody || undefined,
    customPackageName: r.customPackageName || undefined,
    customPackageDetails: r.customPackageDetails || undefined,
    customPriceBreakdown: r.customPriceBreakdown || undefined,
    acceptToken: r.acceptToken || undefined,
    acceptedEnhancements: r.acceptedEnhancements || undefined,
  }
}

function parseLineItems(val) {
  if (val == null || val === '') return []
  try {
    const a = JSON.parse(val)
    if (!Array.isArray(a)) return []
    return a
      .filter((x) => x && x != null && typeof x.description === 'string')
      .map((x) => ({
        description: String(x.description).trim(),
        quantity: Number(x.quantity) || 0,
        unitPrice: Number(x.unitPrice) || 0,
      }))
  } catch {
    return []
  }
}

function rowToInvoice(r) {
  return {
    id: r.id,
    projectId: r.projectId || undefined,
    clientName: r.clientName,
    clientEmail: r.clientEmail || undefined,
    projectTitle: r.projectTitle,
    amount: r.amount,
    status: r.status,
    dueDate: r.dueDate,
    paidAt: r.paidAt || undefined,
    type: r.type || undefined,
    templateId: r.templateId || undefined,
    invoiceNumber: r.invoiceNumber || undefined,
    lineItems: parseLineItems(r.lineItems),
    lastReminderSentAt: r.lastReminderSentAt || undefined,
  }
}

function rowToContract(r) {
  return {
    id: r.id,
    projectId: r.projectId,
    clientName: r.clientName,
    title: r.title,
    status: r.status,
    value: r.value,
    weddingDate: r.weddingDate,
    venue: r.venue || undefined,
    packageType: r.packageType || undefined,
    signedAt: r.signedAt || undefined,
    createdAt: r.createdAt,
    templateId: r.templateId || undefined,
    signToken: r.signToken || undefined,
    clientSignedAt: r.clientSignedAt || undefined,
    lastReminderSentAt: r.lastReminderSentAt || undefined,
    deletedAt: r.deletedAt || undefined,
    proposalId: r.proposalId || undefined,
  }
}

function rowToExpense(r) {
  return {
    id: r.id,
    date: r.date,
    description: r.description,
    amount: r.amount,
    category: r.category,
  }
}

function rowToPipelineStage(r) {
  return { id: r.id, label: r.label, sortOrder: r.sortOrder }
}

function rowToCalendarReminder(r) {
  return {
    id: r.id,
    date: r.date,
    title: r.title,
    notes: r.notes || undefined,
    clientId: r.clientId || undefined,
    projectId: r.projectId || undefined,
    reminderAt: r.reminderAt || undefined,
    sentAt: r.sentAt || undefined,
    createdAt: r.createdAt,
  }
}

function rowToExperience(row) {
  let bullets = []
  try {
    bullets = row.bullets ? JSON.parse(row.bullets) : []
  } catch (_) {}
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    bullets: Array.isArray(bullets) ? bullets : [],
    fromPrice: row.fromPrice ?? 0,
    imageUrl: row.imageUrl || null,
    sortOrder: row.sortOrder ?? 0,
    createdAt: row.createdAt,
  }
}

function rowToMusicSelection(r) {
  let songIds = []
  try {
    if (r.songIds) songIds = JSON.parse(r.songIds)
    if (!Array.isArray(songIds)) songIds = []
  } catch (_) {}
  return {
    id: r.id,
    clientId: r.clientId || undefined,
    submitterName: r.submitterName,
    submitterEmail: r.submitterEmail,
    label: r.label || undefined,
    songIds,
    songsText: r.songsText || undefined,
    createdAt: r.createdAt,
  }
}

function randomShortId() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let id = ''
  for (let i = 0; i < 6; i++) id += chars[Math.floor(Math.random() * chars.length)]
  return id
}

export function createShortLink(proposalId, token, d) {
  let id = randomShortId()
  const existing = db.prepare('SELECT id FROM short_links WHERE id = ?').get(id)
  if (existing) id = randomShortId()
  db.prepare('INSERT INTO short_links (id, proposalId, token, d, createdAt) VALUES (?, ?, ?, ?, ?)').run(
    id,
    proposalId,
    token,
    d,
    new Date().toISOString()
  )
  return id
}

export function getShortLink(shortId) {
  return db.prepare('SELECT * FROM short_links WHERE id = ?').get(shortId)
}

export function getState() {
  const pipelineStages = db.prepare('SELECT * FROM pipeline_stages ORDER BY sortOrder ASC').all().map(rowToPipelineStage)
  return {
    clients: db.prepare('SELECT * FROM clients WHERE deletedAt IS NULL').all().map(rowToClient),
    projects: db.prepare('SELECT * FROM projects WHERE deletedAt IS NULL').all().map(rowToProject),
    proposals: db.prepare('SELECT * FROM proposals').all().map(rowToProposal),
    invoices: db.prepare('SELECT * FROM invoices').all().map(rowToInvoice),
    contracts: db.prepare('SELECT * FROM contracts WHERE deletedAt IS NULL').all().map(rowToContract),
    expenses: db.prepare('SELECT * FROM expenses').all().map(rowToExpense),
    contractTemplates: db.prepare('SELECT * FROM contract_templates ORDER BY createdAt DESC').all(),
    invoiceTemplates: db.prepare('SELECT * FROM invoice_templates ORDER BY createdAt DESC').all(),
    pipelineStages: pipelineStages.length ? pipelineStages : defaultPipelineStages.map((s) => ({ id: s.id, label: s.label, sortOrder: s.sortOrder })),
    calendarReminders: db.prepare('SELECT * FROM calendar_reminders ORDER BY date ASC, createdAt ASC').all().map(rowToCalendarReminder),
    experiences: db.prepare('SELECT * FROM experiences ORDER BY sortOrder ASC, createdAt ASC').all().map(rowToExperience),
    musicSelections: db.prepare('SELECT * FROM music_selections ORDER BY createdAt DESC').all().map(rowToMusicSelection),
    partnerReferrals: db.prepare('SELECT * FROM partner_referrals ORDER BY submissionDate DESC, updatedAt DESC').all().map(rowToPartnerReferral),
  }
}

function nextExperienceId() {
  const rows = db.prepare("SELECT id FROM experiences WHERE id LIKE 'exp-%'").all()
  const max = rows.reduce((m, r) => {
    const n = parseInt(r.id.replace(/^exp-/, ''), 10)
    return isNaN(n) ? m : Math.max(m, n)
  }, 0)
  return `exp-${max + 1}`
}

export function createExperience(experience) {
  const id = experience.id || nextExperienceId()
  const bullets = JSON.stringify(experience.bullets && Array.isArray(experience.bullets) ? experience.bullets : [])
  db.prepare(
    'INSERT INTO experiences (id, name, description, bullets, fromPrice, imageUrl, sortOrder, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(
    id,
    experience.name,
    experience.description,
    bullets,
    experience.fromPrice ?? 0,
    experience.imageUrl ?? null,
    experience.sortOrder ?? 0,
    experience.createdAt || new Date().toISOString()
  )
  return id
}

export function updateExperience(id, updates) {
  const row = db.prepare('SELECT * FROM experiences WHERE id = ?').get(id)
  if (!row) return
  const bullets = updates.bullets !== undefined
    ? JSON.stringify(Array.isArray(updates.bullets) ? updates.bullets : [])
    : row.bullets
  db.prepare(
    'UPDATE experiences SET name=?, description=?, bullets=?, fromPrice=?, imageUrl=?, sortOrder=? WHERE id=?'
  ).run(
    updates.name ?? row.name,
    updates.description ?? row.description,
    bullets,
    updates.fromPrice !== undefined ? updates.fromPrice : row.fromPrice,
    updates.imageUrl !== undefined ? updates.imageUrl : row.imageUrl,
    updates.sortOrder !== undefined ? updates.sortOrder : row.sortOrder,
    id
  )
}

export function deleteExperience(id) {
  db.prepare('DELETE FROM experiences WHERE id = ?').run(id)
}

export function createMusicSelection(ms) {
  const songIds = JSON.stringify(Array.isArray(ms.songIds) ? ms.songIds : [])
  db.prepare(
    'INSERT INTO music_selections (id, clientId, submitterName, submitterEmail, label, songIds, songsText, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(
    ms.id,
    ms.clientId ?? null,
    ms.submitterName,
    ms.submitterEmail,
    ms.label ?? null,
    songIds,
    ms.songsText ?? null,
    ms.createdAt
  )
  return ms.id
}

export function updateMusicSelection(id, updates) {
  if (!id || typeof id !== 'string') return
  const allowed = ['label']
  const setClauses = []
  const values = []
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(updates, key)) {
      setClauses.push(`${key} = ?`)
      values.push(updates[key] ?? null)
    }
  }
  if (setClauses.length === 0) return
  values.push(id)
  db.prepare(`UPDATE music_selections SET ${setClauses.join(', ')} WHERE id = ?`).run(...values)
}

function rowToPartnerReferral(row) {
  const expenseLineItems = normalizeExpenseLineItems(row.expense_line_items)
  const totalExpenseAmount =
    expenseLineItems.length > 0
      ? expenseLineItems.reduce((s, l) => s + l.amount, 0)
      : (row.travelExpenseAmount ?? 0) + (row.hotelExpenseAmount ?? 0)
  return {
    id: row.id,
    referralReference: row.referral_reference || undefined,
    partnerName: row.partnerName,
    companyName: row.companyName || undefined,
    partnerEmail: row.partnerEmail,
    clientName: row.clientName,
    clientEmail: row.clientEmail,
    clientPhone: row.clientPhone || undefined,
    eventDate: row.eventDate || undefined,
    eventLocation: row.eventLocation || undefined,
    notes: row.notes || undefined,
    referralStatus: row.referralStatus,
    bookingAmount: row.bookingAmount ?? 0,
    travelExpenseAmount: row.travelExpenseAmount ?? 0,
    hotelExpenseAmount: row.hotelExpenseAmount ?? 0,
    expenseLineItems,
    totalExpenseAmount,
    commissionableAmount: row.commissionableAmount ?? 0,
    commissionableOverrideAmount:
      row.commissionableOverrideAmount != null ? row.commissionableOverrideAmount : undefined,
    payoutAmount: row.payoutAmount ?? 0,
    payoutOverrideAmount: row.payoutOverrideAmount != null ? row.payoutOverrideAmount : undefined,
    payoutStatus: row.payoutStatus,
    submissionDate: row.submissionDate,
    linkedVendorId: row.linkedVendorId || undefined,
    linkedLeadId: row.linkedLeadId || undefined,
    updatedAt: row.updatedAt,
  }
}

export function getNextPartnerReferralId() {
  const rows = db.prepare("SELECT id FROM partner_referrals WHERE id LIKE 'pref-%'").all()
  const max = rows.reduce((m, r) => {
    const n = parseInt(String(r.id).replace(/^pref-/, ''), 10)
    return Number.isNaN(n) ? m : Math.max(m, n)
  }, 0)
  return `pref-${max + 1}`
}

export function createPartnerReferral(data) {
  const id = data.id && String(data.id).trim() ? String(data.id).trim() : getNextPartnerReferralId()
  const referralReference = getNextReferralReference()
  const now = new Date().toISOString()
  const submissionDate = data.submissionDate || now.slice(0, 10)
  const referralStatus = data.referralStatus != null ? String(data.referralStatus) : 'new'
  const payoutStatus = data.payoutStatus != null ? String(data.payoutStatus) : 'none'

  const amounts = computePartnerReferralAmounts({
    bookingAmount: data.bookingAmount,
    travelExpenseAmount: data.travelExpenseAmount,
    hotelExpenseAmount: data.hotelExpenseAmount,
    expenseLineItems: data.expenseLineItems,
    referralStatus,
    commissionableOverrideAmount: data.commissionableOverrideAmount,
    payoutOverrideAmount: data.payoutOverrideAmount,
  })

  db.prepare(
    `INSERT INTO partner_referrals (
      id, referral_reference, partnerName, companyName, partnerEmail, clientName, clientEmail, clientPhone,
      eventDate, eventLocation, notes, referralStatus,
      bookingAmount, travelExpenseAmount, hotelExpenseAmount, expense_line_items,
      commissionableAmount, commissionableOverrideAmount, payoutAmount, payoutOverrideAmount,
      payoutStatus, submissionDate, linkedVendorId, linkedLeadId, updatedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    referralReference,
    data.partnerName,
    data.companyName ?? null,
    data.partnerEmail,
    data.clientName,
    data.clientEmail,
    data.clientPhone ?? null,
    data.eventDate ?? null,
    data.eventLocation ?? null,
    data.notes ?? null,
    referralStatus,
    amounts.bookingAmount,
    amounts.travelExpenseAmount,
    amounts.hotelExpenseAmount,
    JSON.stringify(amounts.expenseLineItems ?? []),
    amounts.commissionableAmount,
    amounts.commissionableOverrideAmount,
    amounts.payoutAmount,
    amounts.payoutOverrideAmount,
    payoutStatus,
    submissionDate,
    data.linkedVendorId ?? null,
    data.linkedLeadId ?? null,
    now
  )
  return { id, referralReference }
}

export function updatePartnerReferral(id, updates) {
  const row = db.prepare('SELECT * FROM partner_referrals WHERE id = ?').get(id)
  if (!row) return null

  const expenseLineItemsForCompute = Object.prototype.hasOwnProperty.call(updates, 'expenseLineItems')
    ? updates.expenseLineItems
    : normalizeExpenseLineItems(row.expense_line_items)

  const merged = {
    bookingAmount: updates.bookingAmount !== undefined ? updates.bookingAmount : row.bookingAmount,
    travelExpenseAmount: updates.travelExpenseAmount !== undefined ? updates.travelExpenseAmount : row.travelExpenseAmount,
    hotelExpenseAmount: updates.hotelExpenseAmount !== undefined ? updates.hotelExpenseAmount : row.hotelExpenseAmount,
    referralStatus: updates.referralStatus !== undefined ? updates.referralStatus : row.referralStatus,
    commissionableOverrideAmount: Object.prototype.hasOwnProperty.call(updates, 'commissionableOverrideAmount')
      ? updates.commissionableOverrideAmount
      : row.commissionableOverrideAmount,
    payoutOverrideAmount: Object.prototype.hasOwnProperty.call(updates, 'payoutOverrideAmount')
      ? updates.payoutOverrideAmount
      : row.payoutOverrideAmount,
  }

  const amounts = computePartnerReferralAmounts({
    bookingAmount: merged.bookingAmount,
    travelExpenseAmount: merged.travelExpenseAmount,
    hotelExpenseAmount: merged.hotelExpenseAmount,
    expenseLineItems: expenseLineItemsForCompute,
    referralStatus: merged.referralStatus,
    commissionableOverrideAmount: merged.commissionableOverrideAmount,
    payoutOverrideAmount: merged.payoutOverrideAmount,
  })

  const partnerName = updates.partnerName !== undefined ? updates.partnerName : row.partnerName
  const companyName = updates.companyName !== undefined ? updates.companyName : row.companyName
  const partnerEmail = updates.partnerEmail !== undefined ? updates.partnerEmail : row.partnerEmail
  const clientName = updates.clientName !== undefined ? updates.clientName : row.clientName
  const clientEmail = updates.clientEmail !== undefined ? updates.clientEmail : row.clientEmail
  const clientPhone = updates.clientPhone !== undefined ? updates.clientPhone : row.clientPhone
  const eventDate = updates.eventDate !== undefined ? updates.eventDate : row.eventDate
  const eventLocation = updates.eventLocation !== undefined ? updates.eventLocation : row.eventLocation
  const notes = updates.notes !== undefined ? updates.notes : row.notes
  const payoutStatus = updates.payoutStatus !== undefined ? updates.payoutStatus : row.payoutStatus
  const submissionDate = updates.submissionDate !== undefined ? updates.submissionDate : row.submissionDate
  const linkedVendorId = updates.linkedVendorId !== undefined ? updates.linkedVendorId : row.linkedVendorId
  const linkedLeadId = updates.linkedLeadId !== undefined ? updates.linkedLeadId : row.linkedLeadId
  const now = new Date().toISOString()

  db.prepare(
    `UPDATE partner_referrals SET
      referral_reference=?,
      partnerName=?, companyName=?, partnerEmail=?, clientName=?, clientEmail=?, clientPhone=?,
      eventDate=?, eventLocation=?, notes=?, referralStatus=?,
      bookingAmount=?, travelExpenseAmount=?, hotelExpenseAmount=?, expense_line_items=?,
      commissionableAmount=?, commissionableOverrideAmount=?, payoutAmount=?, payoutOverrideAmount=?,
      payoutStatus=?, submissionDate=?, linkedVendorId=?, linkedLeadId=?, updatedAt=?
    WHERE id=?`
  ).run(
    row.referral_reference,
    partnerName,
    companyName ?? null,
    partnerEmail,
    clientName,
    clientEmail,
    clientPhone ?? null,
    eventDate ?? null,
    eventLocation ?? null,
    notes ?? null,
    merged.referralStatus,
    amounts.bookingAmount,
    amounts.travelExpenseAmount,
    amounts.hotelExpenseAmount,
    JSON.stringify(amounts.expenseLineItems ?? []),
    amounts.commissionableAmount,
    amounts.commissionableOverrideAmount,
    amounts.payoutAmount,
    amounts.payoutOverrideAmount,
    payoutStatus,
    submissionDate,
    linkedVendorId ?? null,
    linkedLeadId ?? null,
    now,
    id
  )
  return rowToPartnerReferral(db.prepare('SELECT * FROM partner_referrals WHERE id = ?').get(id))
}

export function deletePartnerReferral(id) {
  const r = db.prepare('DELETE FROM partner_referrals WHERE id = ?').run(id)
  return r.changes > 0
}

export function getPartnerReferral(id) {
  const row = db.prepare('SELECT * FROM partner_referrals WHERE id = ?').get(id)
  return row ? rowToPartnerReferral(row) : null
}

/** Find active client by email (case-insensitive). Returns client or null. */
export function getClientByEmail(email) {
  if (!email || typeof email !== 'string') return null
  const e = String(email).trim().toLowerCase()
  if (!e) return null
  const row = db.prepare('SELECT * FROM clients WHERE deletedAt IS NULL AND LOWER(TRIM(email)) = ?').get(e)
  return row ? rowToClient(row) : null
}

export function createClient(client) {
  db.prepare(
    'INSERT INTO clients (id, name, email, phone, partnerName, createdAt) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(
    client.id,
    client.name,
    client.email,
    client.phone ?? null,
    client.partnerName ?? null,
    client.createdAt
  )
  return client.id
}

export function updateClient(id, updates) {
  const row = db.prepare('SELECT * FROM clients WHERE id = ?').get(id)
  if (!row) return
  const c = { ...rowToClient(row), ...updates }
  db.prepare(
    'UPDATE clients SET name=?, email=?, phone=?, partnerName=?, createdAt=? WHERE id=?'
  ).run(c.name, c.email, c.phone ?? null, c.partnerName ?? null, c.createdAt, id)
}

/** Generate a new client id that never reuses ids of soft-deleted clients. */
export function getNextClientId() {
  const row = db.prepare("SELECT MAX(CAST(SUBSTR(id, 2) AS INTEGER)) AS maxId FROM clients").get()
  const max = typeof row?.maxId === 'number' ? row.maxId : 0
  return `c${max + 1}`
}

/** Next project id from all rows (including soft-deleted) so new inquiries work after a full wipe. */
export function getNextProjectId() {
  const row = db.prepare("SELECT MAX(CAST(SUBSTR(id, 2) AS INTEGER)) AS maxId FROM projects").get()
  const max = typeof row?.maxId === 'number' ? row.maxId : 0
  return `p${max + 1}`
}

/** Create client (if new) and project in one transaction to avoid duplicate-id races. Returns { clientId, projectId }. */
export const createInquiryInTransaction = db.transaction((data) => {
  const emailNorm = String(data.email ?? '').trim().toLowerCase()
  const existing = db.prepare('SELECT id FROM clients WHERE deletedAt IS NULL AND LOWER(TRIM(email)) = ?').get(emailNorm)
  let clientId
  if (existing) {
    clientId = existing.id
  } else {
    const cRow = db.prepare("SELECT MAX(CAST(SUBSTR(id, 2) AS INTEGER)) AS maxId FROM clients").get()
    const cMax = typeof cRow?.maxId === 'number' ? cRow.maxId : 0
    clientId = `c${cMax + 1}`
    db.prepare(
      'INSERT INTO clients (id, name, email, phone, partnerName, createdAt) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(clientId, data.name, data.email, data.phone ?? null, null, data.today)
  }
  const pRow = db.prepare("SELECT MAX(CAST(SUBSTR(id, 2) AS INTEGER)) AS maxId FROM projects").get()
  const pMax = typeof pRow?.maxId === 'number' ? pRow.maxId : 0
  const projectId = `p${pMax + 1}`
  const value = typeof data.value === 'number' && !isNaN(data.value) ? data.value : 0
  const perfMoment = Array.isArray(data.performanceMoment) && data.performanceMoment.length > 0
    ? data.performanceMoment.join(', ')
    : null
  db.prepare(
    'INSERT INTO projects (id, clientId, clientName, title, stage, value, weddingDate, venue, packageType, dueDate, createdAt, notes, requestedArtist, performanceMoment, cloudProjectId) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(
    projectId,
    clientId,
    data.clientName,
    data.title,
    'inquiry',
    value,
    data.weddingDate,
    data.venue ?? null,
    data.packageType ?? null,
    data.dueDate,
    data.today,
    data.notes ?? null,
    data.requestedArtist ?? null,
    perfMoment,
    null
  )
  return { clientId, projectId }
})

/** Get client by id (including soft-deleted). Returns client + deletedAt, or null. */
export function getClientById(id) {
  const row = db.prepare('SELECT * FROM clients WHERE id = ?').get(id)
  return row ? { ...rowToClient(row), deletedAt: row.deletedAt ?? null } : null
}

const _softDeleteClient = db.transaction((id) => {
  const ts = new Date().toISOString()
  db.prepare('UPDATE projects SET deletedAt = ? WHERE clientId = ?').run(ts, id)
  db.prepare('UPDATE clients SET deletedAt = ? WHERE id = ?').run(ts, id)
})

/** Soft-delete client and all their projects (can be restored with restoreClient). Runs in a single transaction. */
export function deleteClient(id) {
  _softDeleteClient(id)
}

/** Return ids of all soft-deleted clients. */
export function getDeletedClientIds() {
  const rows = db.prepare('SELECT id FROM clients WHERE deletedAt IS NOT NULL').all()
  return rows.map((r) => r.id)
}

const _restoreClient = db.transaction((id) => {
  db.prepare('UPDATE clients SET deletedAt = NULL WHERE id = ?').run(id)
  db.prepare('UPDATE projects SET deletedAt = NULL WHERE clientId = ?').run(id)
})

/** Restore a soft-deleted client and all their projects. Runs in a single transaction. */
export function restoreClient(id) {
  _restoreClient(id)
}

export function restoreProject(id) {
  db.prepare('UPDATE projects SET deletedAt = NULL WHERE id = ?').run(id)
}

export function createProject(project) {
  const perfMoment = Array.isArray(project.performanceMoment)
    ? (project.performanceMoment.length > 0 ? project.performanceMoment.join(', ') : null)
    : (project.performanceMoment || null)
  db.prepare(
    'INSERT INTO projects (id, clientId, clientName, title, stage, value, weddingDate, venue, packageType, dueDate, createdAt, notes, requestedArtist, performanceMoment, cloudProjectId) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(
    project.id,
    project.clientId,
    project.clientName,
    project.title,
    project.stage,
    project.value,
    project.weddingDate,
    project.venue ?? null,
    project.packageType ?? null,
    project.dueDate,
    project.createdAt ?? null,
    project.notes ?? null,
    project.requestedArtist ?? null,
    perfMoment,
    project.cloudProjectId ?? null
  )
  return project.id
}

export function updateProject(id, updates) {
  const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(id)
  if (!row) return
  const p = { ...rowToProject(row), ...updates }
  db.prepare(
    'UPDATE projects SET clientId=?, clientName=?, title=?, stage=?, value=?, weddingDate=?, venue=?, packageType=?, dueDate=?, createdAt=?, notes=?, requestedArtist=?, performanceMoment=?, cloudProjectId=?, archivedAt=? WHERE id=?'
  ).run(
    p.clientId,
    p.clientName,
    p.title,
    p.stage,
    p.value,
    p.weddingDate,
    p.venue ?? null,
    p.packageType ?? null,
    p.dueDate,
    p.createdAt ?? null,
    p.notes ?? null,
    p.requestedArtist ?? null,
    (typeof p.performanceMoment === 'string' ? p.performanceMoment : (Array.isArray(p.performanceMoment) && p.performanceMoment.length > 0 ? p.performanceMoment.join(', ') : null)) ?? null,
    p.cloudProjectId ?? null,
    p.archivedAt ?? null,
    id
  )
}

export function deleteProject(id) {
  db.prepare('DELETE FROM projects WHERE id = ?').run(id)
}

export function createProposal(proposal) {
  db.prepare(
    'INSERT INTO proposals (id, projectId, clientName, title, status, value, sentAt, emailBody, customPackageName, customPackageDetails, customPriceBreakdown, acceptToken) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(
    proposal.id,
    proposal.projectId,
    proposal.clientName,
    proposal.title,
    proposal.status,
    proposal.value,
    proposal.sentAt ?? null,
    proposal.emailBody ?? null,
    proposal.customPackageName ?? null,
    proposal.customPackageDetails ?? null,
    proposal.customPriceBreakdown ?? null,
    proposal.acceptToken ?? null
  )
  return proposal.id
}

export function updateProposal(id, updates) {
  const row = db.prepare('SELECT * FROM proposals WHERE id = ?').get(id)
  if (!row) return
  const p = { ...rowToProposal(row), ...updates }
  db.prepare(
    'UPDATE proposals SET projectId=?, clientName=?, title=?, status=?, value=?, sentAt=?, emailBody=?, customPackageName=?, customPackageDetails=?, customPriceBreakdown=?, acceptToken=?, acceptedEnhancements=? WHERE id=?'
  ).run(
    p.projectId,
    p.clientName,
    p.title,
    p.status,
    p.value,
    p.sentAt ?? null,
    p.emailBody ?? null,
    p.customPackageName ?? null,
    p.customPackageDetails ?? null,
    p.customPriceBreakdown ?? null,
    p.acceptToken ?? null,
    p.acceptedEnhancements ?? null,
    id
  )
}

export function deleteProposal(id) {
  db.prepare('DELETE FROM proposals WHERE id = ?').run(id)
}

/** Next id `cN` (N integer); ignores ids like `c-timestamp-xyz` so they do not affect N. */
export function nextContractId() {
  const rows = db.prepare('SELECT id FROM contracts').all()
  let max = 0
  for (const r of rows) {
    const m = /^c(\d+)$/.exec(r.id)
    if (m) max = Math.max(max, parseInt(m[1], 10))
  }
  return `c${max + 1}`
}

export function createContract(contract) {
  db.prepare(
    'INSERT INTO contracts (id, projectId, clientName, title, status, value, weddingDate, venue, packageType, signedAt, createdAt, templateId, signToken, clientSignedAt, lastReminderSentAt, deletedAt, proposalId) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(
    contract.id,
    contract.projectId,
    contract.clientName,
    contract.title,
    contract.status,
    contract.value,
    contract.weddingDate,
    contract.venue ?? null,
    contract.packageType ?? null,
    contract.signedAt ?? null,
    contract.createdAt,
    contract.templateId ?? null,
    contract.signToken ?? null,
    contract.clientSignedAt ?? null,
    contract.lastReminderSentAt ?? null,
    contract.deletedAt ?? null,
    contract.proposalId ?? null
  )
  return contract.id
}

export function updateContract(id, updates) {
  const row = db.prepare('SELECT * FROM contracts WHERE id = ?').get(id)
  if (!row) return
  const c = { ...rowToContract(row), ...updates }
  db.prepare(
    'UPDATE contracts SET projectId=?, clientName=?, title=?, status=?, value=?, weddingDate=?, venue=?, packageType=?, signedAt=?, createdAt=?, templateId=?, signToken=?, clientSignedAt=?, lastReminderSentAt=?, deletedAt=?, proposalId=? WHERE id=?'
  ).run(
    c.projectId,
    c.clientName,
    c.title,
    c.status,
    c.value,
    c.weddingDate,
    c.venue ?? null,
    c.packageType ?? null,
    c.signedAt ?? null,
    c.createdAt,
    c.templateId ?? null,
    c.signToken ?? null,
    c.clientSignedAt ?? null,
    c.lastReminderSentAt ?? null,
    c.deletedAt ?? null,
    c.proposalId ?? null,
    id
  )
}

/** Soft-delete; keeps row and PDF files on disk for undo / new contract on same booking. */
export function deleteContract(id) {
  const ts = new Date().toISOString()
  db.prepare('UPDATE contracts SET deletedAt = ? WHERE id = ? AND deletedAt IS NULL').run(ts, id)
}

export function restoreContract(id) {
  db.prepare('UPDATE contracts SET deletedAt = NULL WHERE id = ?').run(id)
}

/** Next human-readable invoice number (INV-001, INV-002, ...). */
function getNextInvoiceNumber() {
  const row = db.prepare(
    "SELECT MAX(CAST(SUBSTR(invoiceNumber, 5) AS INTEGER)) AS n FROM invoices WHERE invoiceNumber GLOB 'INV-[0-9]*'"
  ).get()
  const n = (row?.n != null && !Number.isNaN(Number(row.n))) ? Number(row.n) + 1 : 1
  return `INV-${String(n).padStart(3, '0')}`
}

function lineItemsTotal(lineItems) {
  if (!Array.isArray(lineItems) || lineItems.length === 0) return null
  return lineItems.reduce((s, li) => s + (Number(li.quantity) || 0) * (Number(li.unitPrice) || 0), 0)
}

export function createInvoice(invoice) {
  const invoiceNumber = invoice.invoiceNumber ?? getNextInvoiceNumber()
  const lineItems = Array.isArray(invoice.lineItems) ? invoice.lineItems : []
  const amount = lineItems.length > 0 ? Math.round(lineItemsTotal(lineItems)) : Number(invoice.amount)
  const lineItemsJson = lineItems.length > 0 ? JSON.stringify(lineItems) : null
  db.prepare(
    'INSERT INTO invoices (id, projectId, clientName, clientEmail, projectTitle, amount, status, dueDate, paidAt, type, templateId, invoiceNumber, lineItems) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(
    invoice.id,
    invoice.projectId ?? null,
    invoice.clientName,
    invoice.clientEmail ?? null,
    invoice.projectTitle,
    amount,
    invoice.status,
    invoice.dueDate,
    invoice.paidAt ?? null,
    invoice.type ?? null,
    invoice.templateId ?? null,
    invoiceNumber,
    lineItemsJson
  )
  return { id: invoice.id, invoiceNumber }
}

export function updateInvoice(id, updates) {
  const row = db.prepare('SELECT * FROM invoices WHERE id = ?').get(id)
  if (!row) return
  const i = { ...rowToInvoice(row), ...updates }
  const lineItems = Array.isArray(i.lineItems) ? i.lineItems : []
  const amount = lineItems.length > 0 ? Math.round(lineItemsTotal(lineItems)) : Number(i.amount)
  const lineItemsJson = JSON.stringify(lineItems)
  db.prepare(
    'UPDATE invoices SET projectId=?, clientName=?, clientEmail=?, projectTitle=?, amount=?, status=?, dueDate=?, paidAt=?, type=?, templateId=?, invoiceNumber=?, lineItems=?, lastReminderSentAt=? WHERE id=?'
  ).run(
    i.projectId ?? null,
    i.clientName,
    i.clientEmail ?? null,
    i.projectTitle,
    amount,
    i.status,
    i.dueDate,
    i.paidAt ?? null,
    i.type ?? null,
    i.templateId ?? null,
    i.invoiceNumber ?? null,
    lineItemsJson,
    i.lastReminderSentAt ?? null,
    id
  )
}

export function deleteInvoice(id) {
  db.prepare('DELETE FROM invoices WHERE id = ?').run(id)
}

export function createExpense(expense) {
  db.prepare(
    'INSERT INTO expenses (id, date, description, amount, category) VALUES (?, ?, ?, ?, ?)'
  ).run(expense.id, expense.date, expense.description, expense.amount, expense.category)
  return expense.id
}

export function updateExpense(id, updates) {
  const { date, description, amount, category } = updates
  if (date == null && description == null && amount == null && category == null) return false
  const row = db.prepare('SELECT * FROM expenses WHERE id = ?').get(id)
  if (!row) return false
  const d = date !== undefined ? date : row.date
  const desc = description !== undefined ? description : row.description
  const amt = amount !== undefined ? amount : row.amount
  const cat = category !== undefined ? category : row.category
  db.prepare('UPDATE expenses SET date = ?, description = ?, amount = ?, category = ? WHERE id = ?').run(d, desc, amt, cat, id)
  return true
}

export function deleteExpense(id) {
  db.prepare('DELETE FROM expenses WHERE id = ?').run(id)
}

// Calendar reminders
export function createCalendarReminder(reminder) {
  db.prepare(
    'INSERT INTO calendar_reminders (id, date, title, notes, clientId, projectId, reminderAt, sentAt, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(
    reminder.id,
    reminder.date,
    reminder.title,
    reminder.notes ?? null,
    reminder.clientId ?? null,
    reminder.projectId ?? null,
    reminder.reminderAt ?? null,
    reminder.sentAt ?? null,
    reminder.createdAt
  )
  return reminder.id
}

export function updateCalendarReminder(id, updates) {
  const row = db.prepare('SELECT * FROM calendar_reminders WHERE id = ?').get(id)
  if (!row) return
  const r = { ...rowToCalendarReminder(row), ...updates }
  db.prepare(
    'UPDATE calendar_reminders SET date=?, title=?, notes=?, clientId=?, projectId=?, reminderAt=?, sentAt=?, createdAt=? WHERE id=?'
  ).run(
    r.date,
    r.title,
    r.notes ?? null,
    r.clientId ?? null,
    r.projectId ?? null,
    r.reminderAt ?? null,
    r.sentAt ?? null,
    r.createdAt,
    id
  )
}

export function deleteCalendarReminder(id) {
  db.prepare('DELETE FROM calendar_reminders WHERE id = ?').run(id)
}

// Contract templates (fileName may be '' for editor-only templates)
export function createContractTemplate(template) {
  const fileName = template.fileName ?? ''
  const contentHtml = template.contentHtml ?? null
  db.prepare(
    'INSERT INTO contract_templates (id, name, fileName, createdAt, contentHtml) VALUES (?, ?, ?, ?, ?)'
  ).run(template.id, template.name, fileName, template.createdAt, contentHtml)
  return template.id
}

export function updateContractTemplate(id, updates) {
  const row = db.prepare('SELECT * FROM contract_templates WHERE id = ?').get(id)
  if (!row) return
  const name = updates.name !== undefined ? updates.name : row.name
  const contentHtml = updates.contentHtml !== undefined ? updates.contentHtml : row.contentHtml
  db.prepare('UPDATE contract_templates SET name = ?, contentHtml = ? WHERE id = ?').run(name, contentHtml, id)
}

export function deleteContractTemplate(id) {
  db.prepare('DELETE FROM contract_templates WHERE id = ?').run(id)
}

// Invoice templates
export function createInvoiceTemplate(template) {
  db.prepare(
    'INSERT INTO invoice_templates (id, name, fileName, createdAt) VALUES (?, ?, ?, ?)'
  ).run(template.id, template.name, template.fileName, template.createdAt)
  return template.id
}

export function updateInvoiceTemplate(id, updates) {
  const row = db.prepare('SELECT * FROM invoice_templates WHERE id = ?').get(id)
  if (!row) return
  const name = updates.name !== undefined ? updates.name : row.name
  db.prepare('UPDATE invoice_templates SET name = ? WHERE id = ?').run(name, id)
}

export function deleteInvoiceTemplate(id) {
  db.prepare('DELETE FROM invoice_templates WHERE id = ?').run(id)
}

export function createPipelineStage(stage) {
  db.prepare('INSERT INTO pipeline_stages (id, label, sortOrder) VALUES (?, ?, ?)').run(stage.id, stage.label, stage.sortOrder)
  return stage.id
}

export function updatePipelineStage(id, updates) {
  const row = db.prepare('SELECT * FROM pipeline_stages WHERE id = ?').get(id)
  if (!row) return
  const label = updates.label !== undefined ? updates.label : row.label
  const sortOrder = updates.sortOrder !== undefined ? updates.sortOrder : row.sortOrder
  db.prepare('UPDATE pipeline_stages SET label = ?, sortOrder = ? WHERE id = ?').run(label, sortOrder, id)
}

export function deletePipelineStage(id) {
  const stages = db.prepare('SELECT id FROM pipeline_stages ORDER BY sortOrder ASC').all()
  if (stages.length <= 1) return // keep at least one
  const fallback = stages.find((s) => s.id !== id)
  if (!fallback) return
  db.prepare('UPDATE projects SET stage = ? WHERE stage = ?').run(fallback.id, id)
  db.prepare('DELETE FROM pipeline_stages WHERE id = ?').run(id)
}

/** Persist contract PDF bytes so downloads still work if contracts/{id}.pdf is missing (e.g. ephemeral disk) while aurora.db remains. */
export function upsertContractPdfBlob(contractId, buffer) {
  if (!contractId || !buffer || !Buffer.isBuffer(buffer) || buffer.length === 0) return
  const updatedAt = new Date().toISOString()
  db.prepare(
    `INSERT INTO contract_pdf_blobs (id, pdf, updatedAt) VALUES (?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET pdf = excluded.pdf, updatedAt = excluded.updatedAt`
  ).run(contractId, buffer, updatedAt)
}

export function getContractPdfBlob(contractId) {
  if (!contractId) return null
  const row = db.prepare('SELECT pdf FROM contract_pdf_blobs WHERE id = ?').get(contractId)
  if (!row || row.pdf == null) return null
  return Buffer.isBuffer(row.pdf) ? row.pdf : Buffer.from(row.pdf)
}

export function seedDb(seed) {
  for (const c of seed.clients) createClient(c)
  for (const p of seed.projects) createProject(p)
  for (const pr of seed.proposals) createProposal(pr)
  for (const i of seed.invoices) createInvoice(i)
  for (const c of seed.contracts) createContract(c)
  for (const e of seed.expenses) createExpense(e)
}

export default db
