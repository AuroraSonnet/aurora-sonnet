import Database from 'better-sqlite3'
import { existsSync, mkdirSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
// On Render the filesystem is read-only; use writable path so inquiry form works
const dataDir = process.env.DATA_DIR || (process.env.RENDER ? '/tmp/aurora-sonnet-data' : __dirname)
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
  db.exec('ALTER TABLE invoices ADD COLUMN templateId TEXT')
} catch (e) {
  if (!/duplicate column/i.test(e.message)) throw e
}
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
  db.exec('ALTER TABLE clients ADD COLUMN deletedAt TEXT')
} catch (e) {
  if (!/duplicate column/i.test(e.message)) throw e
}
try {
  db.exec('ALTER TABLE projects ADD COLUMN deletedAt TEXT')
} catch (e) {
  if (!/duplicate column/i.test(e.message)) throw e
}

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

export function getState() {
  const pipelineStages = db.prepare('SELECT * FROM pipeline_stages ORDER BY sortOrder ASC').all().map(rowToPipelineStage)
  return {
    clients: db.prepare('SELECT * FROM clients WHERE deletedAt IS NULL').all().map(rowToClient),
    projects: db.prepare('SELECT * FROM projects WHERE deletedAt IS NULL').all().map(rowToProject),
    proposals: db.prepare('SELECT * FROM proposals').all().map(rowToProposal),
    invoices: db.prepare('SELECT * FROM invoices').all().map(rowToInvoice),
    contracts: db.prepare('SELECT * FROM contracts').all().map(rowToContract),
    expenses: db.prepare('SELECT * FROM expenses').all().map(rowToExpense),
    contractTemplates: db.prepare('SELECT * FROM contract_templates ORDER BY createdAt DESC').all(),
    invoiceTemplates: db.prepare('SELECT * FROM invoice_templates ORDER BY createdAt DESC').all(),
    pipelineStages: pipelineStages.length ? pipelineStages : defaultPipelineStages.map((s) => ({ id: s.id, label: s.label, sortOrder: s.sortOrder })),
  }
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

const _softDeleteClient = db.transaction((id) => {
  const ts = new Date().toISOString()
  db.prepare('UPDATE projects SET deletedAt = ? WHERE clientId = ?').run(ts, id)
  db.prepare('UPDATE clients SET deletedAt = ? WHERE id = ?').run(ts, id)
})

/** Soft-delete client and all their projects (can be restored with restoreClient). Runs in a single transaction. */
export function deleteClient(id) {
  _softDeleteClient(id)
}

const _restoreClient = db.transaction((id) => {
  db.prepare('UPDATE clients SET deletedAt = NULL WHERE id = ?').run(id)
  db.prepare('UPDATE projects SET deletedAt = NULL WHERE clientId = ?').run(id)
})

/** Restore a soft-deleted client and all their projects. Runs in a single transaction. */
export function restoreClient(id) {
  _restoreClient(id)
}

export function createProject(project) {
  db.prepare(
    'INSERT INTO projects (id, clientId, clientName, title, stage, value, weddingDate, venue, packageType, dueDate, createdAt, notes, requestedArtist) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
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
    project.requestedArtist ?? null
  )
  return project.id
}

export function updateProject(id, updates) {
  const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(id)
  if (!row) return
  const p = { ...rowToProject(row), ...updates }
  db.prepare(
    'UPDATE projects SET clientId=?, clientName=?, title=?, stage=?, value=?, weddingDate=?, venue=?, packageType=?, dueDate=?, createdAt=?, notes=?, requestedArtist=? WHERE id=?'
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
    id
  )
}

export function deleteProject(id) {
  db.prepare('DELETE FROM projects WHERE id = ?').run(id)
}

export function createProposal(proposal) {
  db.prepare(
    'INSERT INTO proposals (id, projectId, clientName, title, status, value, sentAt) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(
    proposal.id,
    proposal.projectId,
    proposal.clientName,
    proposal.title,
    proposal.status,
    proposal.value,
    proposal.sentAt ?? null
  )
  return proposal.id
}

export function deleteProposal(id) {
  db.prepare('DELETE FROM proposals WHERE id = ?').run(id)
}

export function createContract(contract) {
  db.prepare(
    'INSERT INTO contracts (id, projectId, clientName, title, status, value, weddingDate, venue, packageType, signedAt, createdAt, templateId, signToken, clientSignedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
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
    contract.clientSignedAt ?? null
  )
  return contract.id
}

export function updateContract(id, updates) {
  const row = db.prepare('SELECT * FROM contracts WHERE id = ?').get(id)
  if (!row) return
  const c = { ...rowToContract(row), ...updates }
  db.prepare(
    'UPDATE contracts SET projectId=?, clientName=?, title=?, status=?, value=?, weddingDate=?, venue=?, packageType=?, signedAt=?, createdAt=?, templateId=?, signToken=?, clientSignedAt=? WHERE id=?'
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
    id
  )
}

export function deleteContract(id) {
  db.prepare('DELETE FROM contracts WHERE id = ?').run(id)
}

export function createInvoice(invoice) {
  db.prepare(
    'INSERT INTO invoices (id, projectId, clientName, clientEmail, projectTitle, amount, status, dueDate, paidAt, type, templateId) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(
    invoice.id,
    invoice.projectId ?? null,
    invoice.clientName,
    invoice.clientEmail ?? null,
    invoice.projectTitle,
    invoice.amount,
    invoice.status,
    invoice.dueDate,
    invoice.paidAt ?? null,
    invoice.type ?? null,
    invoice.templateId ?? null
  )
  return invoice.id
}

export function updateInvoice(id, updates) {
  const row = db.prepare('SELECT * FROM invoices WHERE id = ?').get(id)
  if (!row) return
  const i = { ...rowToInvoice(row), ...updates }
  db.prepare(
    'UPDATE invoices SET projectId=?, clientName=?, clientEmail=?, projectTitle=?, amount=?, status=?, dueDate=?, paidAt=?, type=?, templateId=? WHERE id=?'
  ).run(
    i.projectId ?? null,
    i.clientName,
    i.clientEmail ?? null,
    i.projectTitle,
    i.amount,
    i.status,
    i.dueDate,
    i.paidAt ?? null,
    i.type ?? null,
    i.templateId ?? null,
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

export function deleteExpense(id) {
  db.prepare('DELETE FROM expenses WHERE id = ?').run(id)
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

export function seedDb(seed) {
  for (const c of seed.clients) createClient(c)
  for (const p of seed.projects) createProject(p)
  for (const pr of seed.proposals) createProposal(pr)
  for (const i of seed.invoices) createInvoice(i)
  for (const c of seed.contracts) createContract(c)
  for (const e of seed.expenses) createExpense(e)
}

export default db
