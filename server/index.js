import express from 'express'
import Stripe from 'stripe'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import nodemailer from 'nodemailer'
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import dotenv from 'dotenv'
import {
  getState,
  getClientByEmail,
  getClientById,
  createClient,
  updateClient,
  deleteClient,
  restoreClient,
  restoreProject,
  getDeletedClientIds,
  createInquiryInTransaction,
  createProject,
  updateProject,
  deleteProject,
  createProposal,
  updateProposal,
  deleteProposal,
  createContract,
  updateContract,
  deleteContract,
  createInvoice,
  updateInvoice,
  deleteInvoice,
  createExpense,
  updateExpense,
  deleteExpense,
  createCalendarReminder,
  updateCalendarReminder,
  deleteCalendarReminder,
  createContractTemplate,
  updateContractTemplate,
  deleteContractTemplate,
  createInvoiceTemplate,
  updateInvoiceTemplate,
  deleteInvoiceTemplate,
  createPipelineStage,
  updatePipelineStage,
  deletePipelineStage,
  createExperience,
  updateExperience,
  deleteExperience,
  createMusicSelection,
  updateMusicSelection,
  seedDb,
  getNextClientId,
  getNextProjectId,
} from './db.js'
import {
  seedClients,
  seedProjects,
  seedProposals,
  seedInvoices,
  seedContracts,
  seedExpenses,
} from './seedData.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: join(__dirname, '.env') })
if (process.env.DATA_DIR) {
  dotenv.config({ path: join(process.env.DATA_DIR, '.env') })
}
// Fallback: load .env from cwd/server (e.g. when server is run from project root)
try {
  const cwdServerEnv = join(process.cwd(), 'server', '.env')
  if (existsSync(cwdServerEnv)) {
    dotenv.config({ path: cwdServerEnv })
  }
} catch (_) {}

const app = express()
const PORT = process.env.PORT || 3001

let stripeSecret = process.env.STRIPE_SECRET_KEY
let stripe = stripeSecret ? new Stripe(stripeSecret) : null

// Calendar reminder email transport (Hostinger SMTP)
const SMTP_HOST = process.env.SMTP_HOST
const SMTP_PORT = Number(process.env.SMTP_PORT || 587)
const SMTP_USER = process.env.SMTP_USER
const SMTP_PASS = process.env.SMTP_PASS
const SMTP_FROM = process.env.SMTP_FROM || SMTP_USER
const REMINDER_EMAIL_TO = process.env.REMINDER_EMAIL_TO || SMTP_USER

let reminderTransporter = null
if (SMTP_HOST && SMTP_PORT && SMTP_USER && SMTP_PASS) {
  reminderTransporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    // Force IPv4 so Render can reach providers that only expose working IPv4 endpoints
    family: 4,
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS,
    },
  })
}

// Tagged logging so we can grep for [DB], [SMTP], [Stripe], [API]
function logError(tag, message, err) {
  const detail = err && (err.message || String(err))
  console.error(`[${tag}] ${message}${detail ? ': ' + detail : ''}`)
  if (err && err.stack) console.error(err.stack)
}

function logSmtpStatus() {
  if (reminderTransporter && (REMINDER_EMAIL_TO || SMTP_USER)) {
    console.log('[SMTP] configured — inquiry and reminder emails enabled')
  } else {
    const where = process.env.DATA_DIR
      ? `For the Mac app, put a .env file in: ${process.env.DATA_DIR}`
      : `Put SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS in server/.env`
    console.log('SMTP: not configured — inquiry and reminder emails disabled.', where)
  }
}

// Match db.js: Mac app uses DATA_DIR; Render uses /tmp; local dev uses server dir.
// Contract PDFs live only in CONTRACTS_DIR (contracts/{id}.pdf). Templates live in TEMPLATES_CONTRACTS_DIR.
// Existing contracts get their own PDF at creation (from template or generated); template edits do not change them.
const isRender = process.env.RENDER === 'true' || (process.env.RENDER_EXTERNAL_URL && String(process.env.RENDER_EXTERNAL_URL).includes('onrender.com'))
const dataDir = process.env.DATA_DIR || (isRender ? '/tmp/aurora-sonnet-data' : __dirname)
const PAYMENTS_FILE = join(dataDir, 'payments.json')
const TEMPLATES_CONTRACTS_DIR = join(dataDir, 'templates', 'contracts')
const TEMPLATES_INVOICES_DIR = join(dataDir, 'templates', 'invoices')
const CONTRACTS_DIR = join(dataDir, 'contracts')

function ensureTemplatesDirs() {
  if (!existsSync(TEMPLATES_CONTRACTS_DIR)) mkdirSync(TEMPLATES_CONTRACTS_DIR, { recursive: true })
  if (!existsSync(TEMPLATES_INVOICES_DIR)) mkdirSync(TEMPLATES_INVOICES_DIR, { recursive: true })
}
function ensureContractsDir() {
  if (!existsSync(CONTRACTS_DIR)) mkdirSync(CONTRACTS_DIR, { recursive: true })
}
ensureTemplatesDirs()
ensureContractsDir()

async function sendDueCalendarReminders() {
  if (!reminderTransporter || !REMINDER_EMAIL_TO) return { sent: 0, error: 'SMTP not configured. Set SMTP in Settings to send reminder emails.' }
  const state = getState()
  const nowIso = new Date().toISOString()
  const due = (state.calendarReminders || []).filter(
    (r) => r.reminderAt && !r.sentAt && r.reminderAt <= nowIso
  )
  if (!due.length) return { sent: 0 }

  let sentCount = 0
  for (const r of due) {
    const client = r.clientId ? state.clients.find((c) => c.id === r.clientId) : null
    const subject = `Reminder: ${r.title} (${r.date})`
    const lines = [
      `Reminder for ${r.date}`,
      '',
      r.title,
      '',
      r.notes || '',
      '',
    ]
    if (client) {
      lines.push(`Client: ${client.name}`)
      if (client.email) lines.push(`Client email: ${client.email}`)
    }
    const text = lines.filter(Boolean).join('\n')
    try {
      await reminderTransporter.sendMail({
        from: SMTP_FROM,
        to: REMINDER_EMAIL_TO,
        subject,
        text,
      })
      const sentAt = new Date().toISOString()
      updateCalendarReminder(r.id, { sentAt })
      sentCount += 1
    } catch (err) {
      logError('SMTP', 'Failed to send reminder email', err)
    }
  }
  return { sent: sentCount }
}

function readPayments() {
  if (!existsSync(PAYMENTS_FILE)) return {}
  try {
    return JSON.parse(readFileSync(PAYMENTS_FILE, 'utf8'))
  } catch {
    return {}
  }
}

function writePayment(invoiceId, paidAt) {
  const state = getState()
  const existingInvoice = state.invoices.find((i) => i.id === invoiceId)
  const wasAlreadyPaid = Boolean(existingInvoice?.paidAt || existingInvoice?.status === 'paid')
  const payments = readPayments()
  payments[invoiceId] = paidAt
  writeFileSync(PAYMENTS_FILE, JSON.stringify(payments, null, 2))
  try {
    updateInvoice(invoiceId, { status: 'paid', paidAt })
    ensureSecuredBookingCalendarDates()
    if (!wasAlreadyPaid) {
      sendInvoicePaidNotification(invoiceId, paidAt).catch((err) => {
        logError('SMTP', 'Failed to send invoice paid notification email', err)
      })
    }
  } catch (e) {
    logError('API', 'Failed to update invoice after payment', e)
  }
}

// Security headers (help prevent XSS, clickjacking, MIME sniffing)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'SAMEORIGIN') // SAMEORIGIN allows sign page to embed contract PDF iframe
  res.setHeader('X-XSS-Protection', '1; mode=block')
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  next()
})

// CORS: allow Vite dev, optional frontend origin, aurorasonnet.com (embed form), Render app URL, and public API endpoints from any HTTPS origin
const frontendOrigin = process.env.FRONTEND_ORIGIN
const renderExternalUrl = (process.env.RENDER_EXTERNAL_URL || '').trim().replace(/\/$/, '')
const allowedOrigins = [
  frontendOrigin,
  renderExternalUrl,
  'https://aurorasonnet.com',
  'https://www.aurorasonnet.com',
  'https://aurora-sonnet-1.onrender.com',
].filter(Boolean)
const publicEndpoints = ['/api/state', '/api/inquiry', '/api/music-selection']
const clientBulkEndpoints = ['/api/clients/delete-all', '/api/clients/restore-all']
const desktopSyncEndpoints = ['/api/proposals/sync-for-accept', '/api/proposals']
app.use((req, res, next) => {
  const origin = req.headers.origin
  const isStateGet = req.method === 'GET' && req.path === '/api/state'
  const isPublicEndpoint = publicEndpoints.some((p) => req.path === p || req.path.startsWith(p + '?'))
  const isClientBulk = req.method === 'POST' && clientBulkEndpoints.includes(req.path)
  const isDesktopSync = desktopSyncEndpoints.some((p) => req.path === p || req.path.startsWith(p + '/'))
  const allow =
    (origin && (origin.includes('localhost') || origin.includes('127.0.0.1'))) ||
    (origin && allowedOrigins.includes(origin)) ||
    // Allow any HTTPS origin for public endpoints so the form can live on any site
    (origin && origin.startsWith('https://') && (isStateGet || isPublicEndpoint))
  if (allow) {
    res.setHeader('Access-Control-Allow-Origin', origin)
  } else if ((isStateGet || isDesktopSync) && (!origin || origin === 'null' || origin === 'file://' || !origin.startsWith('https://'))) {
    res.setHeader('Access-Control-Allow-Origin', '*')
  } else if (isClientBulk && (!origin || origin === 'null' || origin === 'file://')) {
    res.setHeader('Access-Control-Allow-Origin', '*')
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept')
  if (req.method === 'OPTIONS') return res.sendStatus(200)
  next()
})

// Rate limiting: prevent abuse of public endpoints (inquiry form spam, /api/state scraping)
const rateLimitWindowMs = 60 * 1000
const rateLimitMaxInquiry = 15
const rateLimitMaxState = 60
const rateLimitInquiry = new Map()
const rateLimitState = new Map()
function getClientKey(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown'
}
function cleanupRateLimit(map, windowMs) {
  const now = Date.now()
  for (const [key, data] of map.entries()) {
    if (now - data.start > windowMs) map.delete(key)
  }
}
app.use('/api/inquiry', (req, res, next) => {
  cleanupRateLimit(rateLimitInquiry, rateLimitWindowMs)
  const key = getClientKey(req)
  const data = rateLimitInquiry.get(key) || { count: 0, start: Date.now() }
  data.count++
  rateLimitInquiry.set(key, data)
  if (data.count > rateLimitMaxInquiry) {
    return res.status(429).json({ error: 'Too many requests. Please try again later.' })
  }
  next()
})
app.use('/api/state', (req, res, next) => {
  cleanupRateLimit(rateLimitState, rateLimitWindowMs)
  const key = getClientKey(req)
  const data = rateLimitState.get(key) || { count: 0, start: Date.now() }
  data.count++
  rateLimitState.set(key, data)
  if (data.count > rateLimitMaxState) {
    return res.status(429).json({ error: 'Too many requests.' })
  }
  next()
})

// Webhook must get raw body for Stripe signature verification (register before express.json)
app.post(
  '/api/stripe-webhook',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    if (!stripe) return res.status(503).send('Stripe not configured')
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
    if (!webhookSecret) {
      return res.status(503).send('Webhook secret not configured')
    }
    const sig = req.headers['stripe-signature']
    let event
    try {
      event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret)
    } catch (err) {
      logError('Stripe', 'Webhook signature verification failed', err)
      return res.status(400).send(`Webhook signature verification failed: ${err.message}`)
    }
    try {
      if (event.type === 'checkout.session.completed') {
        const session = event.data.object
        const invoiceId = session.metadata?.invoiceId
        if (invoiceId) {
          const paidAt = new Date().toISOString().slice(0, 10)
          writePayment(invoiceId, paidAt)
        }
      }
      res.json({ received: true })
    } catch (err) {
      logError('Stripe', 'Webhook handler error', err)
      res.status(500).json({ error: err.message || 'Webhook processing failed' })
    }
  }
)

// Large limit so PDF template uploads (base64) don't get 413
app.use(express.json({ limit: '50mb' }))
app.use(express.urlencoded({ extended: true }))

// --- Inquiry (single handler: JSON for app, optional redirect when _next provided) ---
const PACKAGE_PRICES = {
  'signature-aria': 2750,
  'aria-plus': 3950,
  'grand-atelier': 5800,
  'signature-aria-duo': 4950,
  'aria-plus-duo': 6950,
  'grand-atelier-duo': 9950,
}

const PACKAGE_LABELS = {
  'signature-aria': 'Signature Aria',
  'aria-plus': 'Aria +',
  'grand-atelier': 'Grand Atelier',
  'signature-aria-duo': 'Signature Aria Duo',
  'aria-plus-duo': 'Aria + Duo',
  'grand-atelier-duo': 'Grand Atelier Duo',
}

function getPackageLabel(packageType) {
  return PACKAGE_LABELS[packageType] || packageType || ''
}

function getProposalPackageLabel(proposal, project) {
  return (
    String(proposal?.customPackageName || '').trim() ||
    getPackageLabel(project?.packageType) ||
    String(project?.title || proposal?.title || '').trim()
  )
}

function parseAcceptedEnhancements(raw) {
  if (!raw) return []
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((item) => ({
        label: String(item?.label || '').trim(),
        amount: Number(item?.amount) || 0,
      }))
      .filter((item) => item.label && item.amount > 0)
  } catch {
    return []
  }
}

function buildDepositInvoiceLineItems(proposal, project, finalValue) {
  const packageLabel = getProposalPackageLabel(proposal, project) || 'Performance package'
  const enhancements = parseAcceptedEnhancements(proposal?.acceptedEnhancements)
  const enhancementTotal = enhancements.reduce((sum, item) => sum + item.amount, 0)
  const baseTotal = Math.max(0, Number(finalValue) - enhancementTotal)
  const sourceItems = [
    { description: packageLabel, amount: baseTotal },
    ...enhancements.map((item) => ({ description: item.label, amount: item.amount })),
  ].filter((item) => item.amount > 0)
  if (sourceItems.length === 0) {
    sourceItems.push({ description: packageLabel, amount: Number(finalValue) || 0 })
  }

  const depositTarget = Math.round((Number(finalValue) || 0) * 0.5)
  const lineItems = sourceItems.map((item) => ({
    description: `Retainer (50%) — ${item.description}`,
    quantity: 1,
    unitPrice: Math.round(item.amount * 0.5),
  }))
  const currentTotal = lineItems.reduce((sum, item) => sum + item.unitPrice, 0)
  const diff = depositTarget - currentTotal
  if (diff !== 0 && lineItems.length > 0) {
    lineItems[0].unitPrice += diff
  }
  return lineItems
}

function buildBalanceInvoiceLineItems(proposal, project, finalValue, depositAmount) {
  const packageLabel = getProposalPackageLabel(proposal, project) || 'Performance package'
  const enhancements = parseAcceptedEnhancements(proposal?.acceptedEnhancements)
  const enhancementTotal = enhancements.reduce((sum, item) => sum + item.amount, 0)
  const baseTotal = Math.max(0, Number(finalValue) - enhancementTotal)
  const sourceItems = [
    { description: packageLabel, amount: baseTotal },
    ...enhancements.map((item) => ({ description: item.label, amount: item.amount })),
  ].filter((item) => item.amount > 0)
  if (sourceItems.length === 0) {
    sourceItems.push({ description: packageLabel, amount: Number(finalValue) || 0 })
  }

  const balanceTarget = Math.max(0, Math.round((Number(finalValue) || 0) - (Number(depositAmount) || 0)))
  const lineItems = sourceItems.map((item) => ({
    description: `Final balance — ${item.description}`,
    quantity: 1,
    unitPrice: Math.max(0, item.amount - Math.round(item.amount * 0.5)),
  }))
  const currentTotal = lineItems.reduce((sum, item) => sum + item.unitPrice, 0)
  const diff = balanceTarget - currentTotal
  if (diff !== 0 && lineItems.length > 0) {
    lineItems[0].unitPrice += diff
  }
  return lineItems
}

function daysBetweenIso(a, b) {
  const aDate = new Date(a)
  const bDate = new Date(b)
  if (Number.isNaN(aDate.getTime()) || Number.isNaN(bDate.getTime())) return NaN
  return Math.round((bDate.getTime() - aDate.getTime()) / (24 * 60 * 60 * 1000))
}

function shiftIsoDate(dateStr, days) {
  const date = new Date(dateStr)
  if (Number.isNaN(date.getTime())) return ''
  date.setDate(date.getDate() + days)
  return date.toISOString().slice(0, 10)
}

function reminderAtForDate(dateStr) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateStr || ''))) return null
  return `${dateStr}T12:00:00.000Z`
}

function mergeContractTemplateHtml(html, data) {
  const replacements = {
    client_name: data.clientName,
    client_email: data.clientEmail || '',
    client_phone: data.clientPhone || '',
    wedding_date: data.weddingDate || '',
    venue: data.venue || '',
    package_type: data.packageType || '',
    performance_fee: `$${Number(data.value || 0).toLocaleString()}`,
    project_title: data.title || '',
    signature_client: 'Signature: _________________________',
    signature_vendor: 'Signature: _________________________',
  }
  let out = String(html || '')
  for (const [key, value] of Object.entries(replacements)) {
    out = out.split(`{{${key}}}`).join(value)
  }
  return out
}

function htmlToPlainText(html) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function wrapTextLines(text, maxChars = 90) {
  const out = []
  const paragraphs = String(text || '').split('\n')
  for (const paragraph of paragraphs) {
    const trimmed = paragraph.trim()
    if (!trimmed) {
      out.push('')
      continue
    }
    const words = trimmed.split(/\s+/)
    let line = ''
    for (const word of words) {
      const next = line ? `${line} ${word}` : word
      if (next.length > maxChars) {
        if (line) out.push(line)
        line = word
      } else {
        line = next
      }
    }
    if (line) out.push(line)
  }
  return out
}

async function createPdfFromEditorTemplate(contentHtml, mergeData) {
  const mergedHtml = mergeContractTemplateHtml(contentHtml, mergeData)
  const text = htmlToPlainText(mergedHtml)
  const pdf = await PDFDocument.create()
  const font = await pdf.embedStandardFont(StandardFonts.Helvetica)
  const fontSize = 11
  const lineHeight = 16
  const margin = 50
  const pageWidth = 595
  const pageHeight = 842
  let page = pdf.addPage([pageWidth, pageHeight])
  let y = pageHeight - margin
  const lines = wrapTextLines(text, 92)

  for (const line of lines) {
    if (y < margin) {
      page = pdf.addPage([pageWidth, pageHeight])
      y = pageHeight - margin
    }
    if (line) {
      page.drawText(line, {
        x: margin,
        y,
        size: fontSize,
        font,
        color: rgb(0, 0, 0),
        maxWidth: pageWidth - margin * 2,
      })
    }
    y -= lineHeight
  }

  return Buffer.from(await pdf.save())
}

async function createContractPdfFromTemplate(template, proposal, project, client) {
  if (!template) return null
  const mergeData = {
    clientName: client?.name || project?.clientName || proposal?.clientName || '',
    weddingDate: project?.weddingDate || '',
    venue: project?.venue || '',
    packageType: getProposalPackageLabel(proposal, project),
    value: project?.value || proposal?.value || 0,
    title: project?.title || proposal?.title || '',
    clientEmail: client?.email || '',
    clientPhone: client?.phone || '',
  }
  if (template.contentHtml) {
    return createPdfFromEditorTemplate(template.contentHtml, mergeData)
  }
  if (template.fileName) {
    const templatePath = join(TEMPLATES_CONTRACTS_DIR, template.fileName)
    if (existsSync(templatePath)) {
      return readFileSync(templatePath)
    }
  }
  return null
}

function ensureDueFinalInvoices() {
  let state = getState()
  const today = new Date().toISOString().slice(0, 10)
  let created = 0

  for (const project of state.projects || []) {
    if (project.archivedAt) continue
    if (project.stage !== 'booked') continue
    if (!project.weddingDate) continue
    const daysUntil = daysBetweenIso(today, project.weddingDate)
    if (!Number.isFinite(daysUntil) || daysUntil < 0 || daysUntil > 30) continue

    const hasFinalInvoice = (state.invoices || []).some((inv) => inv.projectId === project.id && inv.type === 'balance')
    if (hasFinalInvoice) continue

    const depositInvoice = (state.invoices || []).find((inv) => inv.projectId === project.id && inv.type === 'deposit')
    const contract = (state.contracts || []).find((c) => c.projectId === project.id)
    const hasPaidDeposit = Boolean(depositInvoice?.paidAt || depositInvoice?.status === 'paid')
    const hasSignedContract = contract?.status === 'signed'
    if (!hasPaidDeposit || !hasSignedContract) continue

    const proposal =
      (state.proposals || []).find((p) => p.projectId === project.id && p.status === 'accepted') ||
      (state.proposals || []).find((p) => p.projectId === project.id) ||
      null
    const client = (state.clients || []).find((c) => c.id === project.clientId)
    const totalValue = Number(project.value) || 0
    const depositAmount = depositInvoice ? Number(depositInvoice.amount) || 0 : Math.round(totalValue * 0.5)
    const balanceAmount = Math.max(0, totalValue - depositAmount)
    if (balanceAmount <= 0) continue

    createInvoice({
      id: nextId('i', state.invoices || []),
      projectId: project.id,
      clientName: project.clientName,
      clientEmail: client?.email || undefined,
      projectTitle: `${project.title} — Balance`,
      amount: balanceAmount,
      status: 'draft',
      dueDate: project.weddingDate,
      type: 'balance',
      lineItems: buildBalanceInvoiceLineItems(proposal, project, totalValue, depositAmount),
    })
    created += 1
    state = getState()
  }

  return { created }
}

function ensureSecuredBookingCalendarDates() {
  let state = getState()
  let created = 0

  for (const project of state.projects || []) {
    if (project.archivedAt) continue
    if (project.stage !== 'booked') continue
    if (!project.weddingDate) continue

    const contract = (state.contracts || []).find((c) => c.projectId === project.id)
    const depositInvoice = (state.invoices || []).find((inv) => inv.projectId === project.id && inv.type === 'deposit')
    const secured = contract?.status === 'signed' && (depositInvoice?.status === 'paid' || !!depositInvoice?.paidAt)
    if (!secured) continue

    const weddingDate = project.weddingDate
    const today = new Date().toISOString().slice(0, 10)
    const targetFinalInvoiceReminderDate = shiftIsoDate(weddingDate, -30)
    const finalInvoiceReminderDate =
      targetFinalInvoiceReminderDate && targetFinalInvoiceReminderDate < today
        ? today
        : (targetFinalInvoiceReminderDate || today)
    const existingByProject = (state.calendarReminders || []).filter((r) => r.projectId === project.id)
    const clientId = project.clientId || undefined

    const reminders = [
      {
        kind: 'wedding_day',
        date: weddingDate,
        title: `${project.title} — Wedding day`,
        notes: `${project.clientName}. Wedding date reminder.`,
        reminderAt: reminderAtForDate(weddingDate),
      },
      {
        kind: 'final_invoice',
        date: finalInvoiceReminderDate || today,
        title: `${project.title} — Send final invoice`,
        notes: 'Send the final invoice now. Final payment is due no later than 15 days before the wedding or the artist may not perform.',
        reminderAt: reminderAtForDate(finalInvoiceReminderDate || today),
      },
    ]

    for (const reminder of reminders) {
      const existing = existingByProject.find((r) =>
        reminder.kind === 'wedding_day'
          ? r.title.endsWith('— Wedding day')
          : r.title.endsWith('— Send final invoice')
      )
      if (existing) {
        if (
          existing.date !== reminder.date ||
          existing.title !== reminder.title ||
          (existing.notes || '') !== reminder.notes ||
          (existing.clientId || '') !== (clientId || '') ||
          (existing.reminderAt || '') !== (reminder.reminderAt || '')
        ) {
          updateCalendarReminder(existing.id, {
            date: reminder.date,
            title: reminder.title,
            notes: reminder.notes,
            clientId,
            reminderAt: reminder.reminderAt || undefined,
            sentAt: undefined,
          })
          state = getState()
        }
        continue
      }
      createCalendarReminder({
        id: nextId('cr', state.calendarReminders || []),
        date: reminder.date,
        title: reminder.title,
        notes: reminder.notes,
        clientId,
        projectId: project.id,
        reminderAt: reminder.reminderAt || undefined,
        createdAt: new Date().toISOString(),
      })
      created += 1
      state = getState()
    }
  }

  return { created }
}

function nextId(prefix, existing) {
  if (prefix === '') {
    const nums = existing.map((x) => parseInt(String(x.id).replace(/\D/g, ''), 10)).filter((n) => !isNaN(n))
    const max = nums.length ? Math.max(...nums, 0) : 0
    return String(max + 1)
  }
  const nums = existing.map((x) => parseInt(String(x.id).replace(/\D/g, ''), 10)).filter((n) => !isNaN(n))
  const max = nums.length ? Math.max(...nums, 0) : 0
  return `${prefix}${max + 1}`
}

// Allow redirect only to your site (prevents open-redirect attacks)
const ALLOWED_REDIRECT_ORIGINS = ['https://aurorasonnet.com', 'https://www.aurorasonnet.com']
function isAllowedRedirectUrl(url) {
  if (!url || typeof url !== 'string') return false
  try {
    const parsed = new URL(url.trim())
    return ALLOWED_REDIRECT_ORIGINS.some((origin) => parsed.origin === origin)
  } catch {
    return false
  }
}

const INQUIRY_NOTIFY_EMAIL = process.env.INQUIRY_NOTIFY_EMAIL || REMINDER_EMAIL_TO || SMTP_USER

async function sendContractSignedNotification(contractId, signedAt) {
  if (!reminderTransporter || !INQUIRY_NOTIFY_EMAIL) return
  const state = getState()
  const contract = state.contracts.find((c) => c.id === contractId)
  if (!contract) return
  const project = state.projects.find((p) => p.id === contract.projectId)
  const client = project ? state.clients.find((c) => c.id === project.clientId) : null
  const subject = `Contract signed: ${contract.title}`
  const lines = [
    'A client has signed their contract.',
    '',
    '— Contract —',
    `Event: ${contract.title}`,
    `Client: ${contract.clientName}`,
    ...(client?.email ? [`Client email: ${client.email}`] : []),
    ...(project?.weddingDate ? [`Wedding date: ${project.weddingDate}`] : []),
    ...(project?.venue ? [`Venue: ${project.venue}`] : []),
    ...(contract.packageType ? [`Package: ${contract.packageType}`] : []),
    `Signed on: ${signedAt}`,
  ]
  await reminderTransporter.sendMail({
    from: SMTP_FROM,
    to: INQUIRY_NOTIFY_EMAIL,
    subject,
    text: lines.join('\n'),
  })
}

async function sendInvoicePaidNotification(invoiceId, paidAt) {
  if (!reminderTransporter || !INQUIRY_NOTIFY_EMAIL) return
  const state = getState()
  const invoice = state.invoices.find((i) => i.id === invoiceId)
  if (!invoice) return
  const subject = `Invoice paid: ${invoice.projectTitle}`
  const lines = [
    'An invoice has been paid.',
    '',
    '— Invoice —',
    `Title: ${invoice.projectTitle}`,
    `Client: ${invoice.clientName}`,
    ...(invoice.clientEmail ? [`Client email: ${invoice.clientEmail}`] : []),
    `Amount: $${Number(invoice.amount || 0).toLocaleString()}`,
    ...(invoice.type ? [`Type: ${invoice.type}`] : []),
    ...(invoice.invoiceNumber ? [`Invoice number: ${invoice.invoiceNumber}`] : []),
    `Paid on: ${paidAt}`,
  ]
  await reminderTransporter.sendMail({
    from: SMTP_FROM,
    to: INQUIRY_NOTIFY_EMAIL,
    subject,
    text: lines.join('\n'),
  })
}

async function sendProposalAcceptedNotification(proposalId) {
  if (!reminderTransporter || !INQUIRY_NOTIFY_EMAIL) return
  const state = getState()
  const proposal = state.proposals.find((p) => p.id === proposalId)
  if (!proposal) return
  const project = state.projects.find((p) => p.id === proposal.projectId)
  const client = project ? state.clients.find((c) => c.id === project.clientId) : null
  const enhancements = proposal.acceptedEnhancements ? (() => { try { return JSON.parse(proposal.acceptedEnhancements) } catch { return [] } })() : []
  const subject = `Proposal accepted: ${proposal.title}`
  const lines = [
    'A client has accepted their proposal!',
    '',
    '— Proposal —',
    `Event: ${proposal.title}`,
    `Client: ${proposal.clientName}`,
    ...(client?.email ? [`Client email: ${client.email}`] : []),
    ...(project?.weddingDate ? [`Wedding date: ${project.weddingDate}`] : []),
    ...(project?.venue ? [`Venue: ${project.venue}`] : []),
    `Value: $${Number(proposal.value || 0).toLocaleString()}`,
    ...(enhancements.length > 0 ? ['', 'Enhancements:', ...enhancements.map((e) => `  • ${e.label} — $${Number(e.amount || 0).toLocaleString()}`)] : []),
    '',
    'Next steps: The contract and retainer invoice have been auto-created. The client will receive signing and payment links.',
  ]
  await reminderTransporter.sendMail({
    from: SMTP_FROM,
    to: INQUIRY_NOTIFY_EMAIL,
    subject,
    text: lines.join('\n'),
  })
  console.log('[SMTP] Proposal accepted notification sent for', proposalId)
}

async function sendInquiryNotification(payload) {
  if (!reminderTransporter || !INQUIRY_NOTIFY_EMAIL) {
    console.log('Inquiry notification skipped: SMTP not configured or no notify address')
    return
  }
  const {
    name,
    email,
    phone,
    title,
    isGeneral,
    weddingDate,
    venue,
    packageId,
    message,
    requestedArtist,
  } = payload
  const typeLabel = isGeneral ? 'General contact' : 'Artist / wedding inquiry'
  const subject = `New inquiry: ${name} — ${typeLabel}`
  const lines = [
    `You received a new ${typeLabel}.`,
    '',
    '— Contact —',
    `Name: ${name}`,
    `Email: ${email}`,
    ...(phone ? [`Phone: ${phone}`] : []),
    '',
    '— Details —',
    `Inquiry type: ${title}`,
    ...(weddingDate ? [`Wedding/event date: ${weddingDate}`] : []),
    ...(venue ? [`Venue: ${venue}`] : []),
    ...(packageId ? [`Package: ${packageId}`] : []),
    ...(requestedArtist ? [`Requested artist: ${requestedArtist}`] : []),
    ...(message ? ['', '— Message —', message] : []),
  ]
  const text = lines.join('\n')
  try {
    await reminderTransporter.sendMail({
      from: SMTP_FROM,
      to: INQUIRY_NOTIFY_EMAIL,
      subject,
      text,
    })
    console.log('Inquiry notification email sent to', INQUIRY_NOTIFY_EMAIL)
  } catch (err) {
    const msg = err.response ? `${err.message} ${err.response}` : (err.message || String(err))
    logError('SMTP', 'Failed to send inquiry notification email', err)
  }
}

app.post('/api/inquiry', async (req, res) => {
  try {
    const body = req.body || {}
    const name = String(body.name ?? '').trim()
    const email = String(body.email ?? '').trim()
    const rawNext = (body._next != null && body._next !== '') ? String(body._next).trim() : null
    const nextUrl = isAllowedRedirectUrl(rawNext) ? rawNext : null
    if (!name || !email) {
      if (nextUrl) {
        return res.redirect(303, nextUrl + (nextUrl.includes('?') ? '&' : '?') + 'error=missing')
      }
      return res.status(400).json({ error: 'Name and email required' })
    }
    const today = new Date().toISOString().slice(0, 10)
    const weddingDate = (body.weddingDate || '').trim() || today
    const venue = (body.venue || '').trim() || undefined
    const packageId = body.packageId || undefined
    const value = packageId && PACKAGE_PRICES[packageId] != null ? PACKAGE_PRICES[packageId] : 0
    const isGeneral = !venue && !packageId
    const title = isGeneral ? 'General inquiry' : (venue ? `${venue} Wedding` : 'Wedding inquiry')
    const inquiryMessage = (body.message || '').trim() || undefined
    const requestedArtist = (body.requestedArtist || '').trim() || undefined

    const { clientId, projectId } = createInquiryInTransaction({
      name,
      email,
      phone: (body.phone || '').trim() || undefined,
      today,
      weddingDate,
      venue: venue || undefined,
      packageType: packageId || undefined,
      value,
      title,
      clientName: name,
      dueDate: weddingDate,
      notes: inquiryMessage,
      requestedArtist: requestedArtist || undefined,
    })

    // Fire-and-forget email so the form response isn't blocked by slow SMTP
    sendInquiryNotification({
      name,
      email,
      phone: (body.phone || '').trim() || undefined,
      title,
      isGeneral,
      weddingDate,
      venue,
      packageId,
      message: inquiryMessage,
      requestedArtist,
    }).catch((err) => {
      logError('SMTP', 'Inquiry notification (non-blocking)', err)
    })

    if (nextUrl) {
      return res.redirect(303, nextUrl)
    }
    return res.status(201).json({ clientId, projectId })
  } catch (err) {
    const msg = err && typeof err.message === 'string' ? err.message : 'Failed to create inquiry'
    console.error('[DB] Inquiry failed:', msg)
    if (err && err.stack) console.error(err.stack)
    logError('DB', 'Failed to create inquiry', err)
    const body = req.body || {}
    const rawNext = (body._next != null && body._next !== '') ? String(body._next).trim() : null
    const nextUrl = isAllowedRedirectUrl(rawNext) ? rawNext : null
    if (nextUrl) {
      return res.redirect(303, nextUrl + (nextUrl.includes('?') ? '&' : '?') + 'error=server')
    }
    res.setHeader('Content-Type', 'application/json')
    return res.status(500).json({ error: 'Failed to create inquiry', detail: msg })
  }
})

// --- Music selection (from Hostinger embed) ---
app.post('/api/music-selection', (req, res) => {
  try {
    const body = req.body || {}
    const name = String(body.name ?? '').trim()
    const email = String(body.email ?? '').trim()
    const label = String(body.label ?? '').trim() || undefined
    let songIds = body.songIds
    if (!Array.isArray(songIds)) songIds = []
    const songsText = Array.isArray(body.songsText) ? body.songsText.join(', ') : (body.songsText && typeof body.songsText === 'string' ? body.songsText : undefined)

    if (!name || !email) {
      return res.status(400).json({ error: 'Name and email required' })
    }
    const state = getState()
    const emailLower = email.toLowerCase()
    const existingClient = state.clients.find((c) => (c.email || '').toLowerCase() === emailLower)
    let clientId = existingClient ? existingClient.id : null
    if (!existingClient) {
      clientId = getNextClientId()
      createClient({
        id: clientId,
        name,
        email,
        phone: undefined,
        partnerName: undefined,
        createdAt: new Date().toISOString().slice(0, 10),
      })
    }
    const id = `ms${Date.now()}`
    createMusicSelection({
      id,
      clientId,
      submitterName: name,
      submitterEmail: email,
      label,
      songIds,
      songsText,
      createdAt: new Date().toISOString(),
    })
    return res.status(201).json({ id, clientId })
  } catch (err) {
    logError('DB', 'Failed to create music selection', err)
    return res.status(500).json({ error: 'Failed to save selection' })
  }
})

app.patch('/api/music-selection/:id', (req, res) => {
  try {
    const id = req.params.id
    const body = req.body || {}
    const label = body.label !== undefined ? String(body.label).trim() || null : undefined
    if (label === undefined) return res.status(400).json({ error: 'No updates provided' })
    updateMusicSelection(id, { label })
    return res.status(200).json({ ok: true })
  } catch (err) {
    logError('DB', 'Failed to update music selection', err)
    return res.status(500).json({ error: 'Failed to update' })
  }
})

// --- SQLite API (full state + CRUD) ---
app.get('/api/state', (req, res) => {
  try {
    ensureDueFinalInvoices()
    ensureSecuredBookingCalendarDates()
    const state = getState()
    res.json({
      ...state,
      config: { publicAppUrl: process.env.APP_URL || '' },
    })
  } catch (err) {
    logError('DB', 'Failed to load state', err)
    res.status(500).json({ error: 'Failed to load state' })
  }
})

// Proxy remote /api/state so the desktop app can sync without CORS (fetch goes to local server, server fetches Render).
// Timeout 30s so Render cold start has time to wake.
const PROXY_STATE_TIMEOUT_MS = 90000
app.get('/api/proxy-remote-state', async (req, res) => {
  try {
    const base = (req.query.base || '').toString().trim().replace(/\/$/, '')
    if (!base || !base.startsWith('https://')) {
      return res.status(400).json({ error: 'Missing or invalid base URL (use ?base=https://...)' })
    }
    const url = `${base}/api/state`
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), PROXY_STATE_TIMEOUT_MS)
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    }).finally(() => clearTimeout(timeoutId))
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      return res.status(response.status).json(data && typeof data === 'object' ? data : { error: 'Remote server error' })
    }
    if (!Array.isArray(data.clients) || !Array.isArray(data.projects)) {
      return res.status(502).json({ error: 'Remote server did not return valid state (missing clients or projects). It may be starting up — try again in a minute.' })
    }
    res.json(data)
  } catch (err) {
    if (err.name === 'AbortError') {
      return res.status(504).json({ error: 'Request timed out. The remote server may be waking up — try again in 1–2 minutes.' })
    }
    logError('API', 'Proxy remote state failed', err)
    res.status(502).json({ error: err.message || 'Could not reach remote server' })
  }
})

app.post('/api/proxy-sync-proposal', async (req, res) => {
  try {
    const { base, payload } = req.body || {}
    const baseUrl = (base || '').toString().trim().replace(/\/$/, '')
    if (!baseUrl || !baseUrl.startsWith('https://')) {
      return res.status(400).json({ error: 'Missing or invalid base URL' })
    }
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), PROXY_STATE_TIMEOUT_MS)
    const response = await fetch(`${baseUrl}/api/proposals/sync-for-accept`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    }).finally(() => clearTimeout(timeoutId))
    const data = await response.json().catch(() => ({}))
    if (!response.ok) return res.status(response.status).json(data)
    res.json(data)
  } catch (err) {
    if (err.name === 'AbortError') return res.status(504).json({ error: 'Timeout reaching remote server' })
    logError('API', 'Proxy sync proposal failed', err)
    res.status(502).json({ error: err.message || 'Could not reach remote server' })
  }
})

app.post('/api/proposals/:id/push-to-render', async (req, res) => {
  try {
    const { id } = req.params
    const baseUrl = ((req.body && req.body.baseUrl) || '').toString().trim().replace(/\/$/, '')
    if (!baseUrl || !baseUrl.startsWith('http')) {
      return res.status(400).json({ error: 'Missing or invalid baseUrl' })
    }
    const state = getState()
    const proposal = state.proposals.find((p) => p.id === id)
    if (!proposal) return res.status(404).json({ error: 'Proposal not found locally' })
    if (!proposal.acceptToken) return res.status(400).json({ error: 'Proposal has no accept token' })
    const project = state.projects.find((p) => p.id === proposal.projectId)
    if (!project) return res.status(404).json({ error: 'Project not found locally' })
    const client = state.clients.find((c) => c.id === project.clientId)
    if (!client) return res.status(404).json({ error: 'Client not found locally' })
    const payload = {
      client: { id: client.id, name: client.name, email: client.email, phone: client.phone, partnerName: client.partnerName, createdAt: client.createdAt },
      project: { id: project.id, clientId: project.clientId, clientName: project.clientName, title: project.title, stage: project.stage, value: project.value, weddingDate: project.weddingDate, venue: project.venue, packageType: project.packageType, dueDate: project.dueDate, createdAt: project.createdAt, notes: project.notes, requestedArtist: project.requestedArtist, cloudProjectId: project.cloudProjectId },
      proposal: { id: proposal.id, projectId: proposal.projectId, clientName: proposal.clientName, title: proposal.title, status: proposal.status, value: proposal.value, sentAt: proposal.sentAt, acceptToken: proposal.acceptToken },
    }
    const syncUrl = `${baseUrl}/api/proposals/sync-for-accept`
    let lastErr = null
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), PROXY_STATE_TIMEOUT_MS)
        const response = await fetch(syncUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: controller.signal,
        }).finally(() => clearTimeout(timeoutId))
        const data = await response.json().catch(() => ({}))
        if (response.ok) return res.json({ ok: true })
        lastErr = `Render returned ${response.status}: ${JSON.stringify(data)}`
        console.error(`[Push] attempt ${attempt + 1}: ${lastErr}`)
      } catch (e) {
        lastErr = e.name === 'AbortError' ? 'Timeout' : (e.message || 'Unknown error')
        console.error(`[Push] attempt ${attempt + 1}: ${lastErr}`)
      }
      if (attempt < 2) await new Promise((r) => setTimeout(r, 5000))
    }
    res.status(502).json({ error: lastErr || 'Could not reach Render after 3 attempts' })
  } catch (err) {
    console.error('[Push] Failed to push proposal to Render:', err.message || err)
    res.status(502).json({ error: err.message || 'Could not reach Render' })
  }
})

app.post('/api/clients', (req, res) => {
  try {
    const { id: requestedId, name, phone, partnerName, createdAt } = req.body
    const email = (req.body.email != null && req.body.email !== '') ? String(req.body.email).trim() : ''
    if (!name || !createdAt) return res.status(400).json({ error: 'Missing fields (name, createdAt required)' })
    if (email) {
      const existing = getClientByEmail(email)
      if (existing) return res.status(409).json({ error: 'A contact with this email already exists.' })
    }
    const id = requestedId && !getClientById(String(requestedId)) ? String(requestedId) : getNextClientId()
    createClient({ id, name, email, phone, partnerName, createdAt })
    res.json({ id })
  } catch (err) {
    logError('DB', 'Failed to create client', err)
    res.status(500).json({ error: 'Failed to create client' })
  }
})

app.patch('/api/clients/:id', (req, res) => {
  try {
    const { email } = req.body
    if (email !== undefined && email !== null) {
      const existing = getClientByEmail(email)
      if (existing && existing.id !== req.params.id) return res.status(409).json({ error: 'A contact with this email already exists.' })
    }
    updateClient(req.params.id, req.body)
    res.json({ ok: true })
  } catch (err) {
    logError('DB', 'Failed to update client', err)
    res.status(500).json({ error: 'Failed to update client' })
  }
})

app.delete('/api/clients/:id', (req, res) => {
  try {
    const id = req.params.id
    const client = getClientById(id)
    if (!client) return res.status(404).json({ error: 'Client not found' })
    if (client.deletedAt) return res.status(400).json({ error: 'Client already deleted' })
    deleteClient(id)
    res.json({ ok: true })
  } catch (err) {
    logError('DB', 'Failed to delete client', err)
    res.status(500).json({ error: 'Failed to delete client' })
  }
})

app.post('/api/clients/:id/restore', (req, res) => {
  try {
    const id = req.params.id
    const client = getClientById(id)
    if (!client) return res.status(404).json({ error: 'Client not found' })
    if (!client.deletedAt) return res.status(400).json({ error: 'Client is not deleted' })
    restoreClient(id)
    res.json({ ok: true })
  } catch (err) {
    logError('DB', 'Failed to restore client', err)
    res.status(500).json({ error: 'Failed to restore client' })
  }
})

app.post('/api/clients/restore-all', (req, res) => {
  try {
    const ids = getDeletedClientIds()
    for (const id of ids) restoreClient(id)
    res.json({ ok: true, restored: ids.length })
  } catch (err) {
    logError('DB', 'Failed to restore clients', err)
    res.status(500).json({ error: 'Failed to restore clients' })
  }
})

app.post('/api/clients/delete-all', (req, res) => {
  try {
    const state = getState()
    const list = state.clients || []
    for (const c of list) deleteClient(c.id)
    res.json({ ok: true, deleted: list.length })
  } catch (err) {
    logError('DB', 'Failed to delete all clients', err)
    res.status(500).json({ error: 'Failed to delete all clients' })
  }
})

app.post('/api/projects', (req, res) => {
  try {
    const p = req.body
    if (!p.id || !p.clientId || !p.clientName || !p.title || !p.stage || p.value == null || !p.weddingDate || !p.dueDate)
      return res.status(400).json({ error: 'Missing fields' })
    createProject(p)
    res.json({ id: p.id })
  } catch (err) {
    logError('DB', 'Failed to create project', err)
    res.status(500).json({ error: 'Failed to create project' })
  }
})

app.patch('/api/projects/:id', (req, res) => {
  try {
    if (req.body.stage != null) {
      const validStageIds = new Set(getState().pipelineStages.map((s) => s.id))
      if (!validStageIds.has(req.body.stage)) {
        return res.status(400).json({ error: 'Invalid stage' })
      }
    }
    updateProject(req.params.id, req.body)
    res.json({ ok: true })
  } catch (err) {
    logError('DB', 'Failed to update project', err)
    res.status(500).json({ error: 'Failed to update project' })
  }
})

app.delete('/api/projects/:id', (req, res) => {
  try {
    deleteProject(req.params.id)
    res.json({ ok: true })
  } catch (err) {
    logError('DB', 'Failed to delete project', err)
    res.status(500).json({ error: 'Failed to delete project' })
  }
})

app.post('/api/proposals', (req, res) => {
  try {
    const p = req.body
    if (!p.id || !p.projectId || !p.clientName || !p.title || !p.status || p.value == null)
      return res.status(400).json({ error: 'Missing fields' })
    createProposal(p)
    res.json({ id: p.id })
  } catch (err) {
    logError('DB', 'Failed to create proposal', err)
    res.status(500).json({ error: 'Failed to create proposal' })
  }
})

app.patch('/api/proposals/:id', (req, res) => {
  try {
    updateProposal(req.params.id, req.body)
    res.json({ ok: true })
  } catch (err) {
    logError('DB', 'Failed to update proposal', err)
    res.status(500).json({ error: 'Failed to update proposal' })
  }
})

app.delete('/api/proposals/:id', (req, res) => {
  try {
    deleteProposal(req.params.id)
    res.json({ ok: true })
  } catch (err) {
    logError('DB', 'Failed to delete proposal', err)
    res.status(500).json({ error: 'Failed to delete proposal' })
  }
})

function randomAcceptToken() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`
}

app.post('/api/proposals/:id/ensure-accept-token', (req, res) => {
  try {
    const id = req.params.id
    const state = getState()
    const proposal = state.proposals.find((p) => p.id === id)
    if (!proposal) return res.status(404).json({ error: 'Proposal not found' })
    let token = proposal.acceptToken
    if (!token) {
      token = randomAcceptToken()
      updateProposal(id, { acceptToken: token })
    }
    res.json({ acceptToken: token })
  } catch (err) {
    logError('DB', 'Failed to ensure accept token', err)
    res.status(500).json({ error: 'Failed to ensure accept token' })
  }
})

// Sync proposal + project + client from Mac app so accept link works on Render (remote DB).
app.post('/api/proposals/sync-for-accept', (req, res) => {
  try {
    const { client, project, proposal } = req.body || {}
    if (!proposal || !proposal.id || !proposal.acceptToken || !project || !client) {
      return res.status(400).json({ error: 'Missing client, project, or proposal with id and acceptToken' })
    }
    const state = getState()
    const now = new Date().toISOString().slice(0, 10)
    if (!getClientById(client.id)) {
      createClient({
        id: client.id,
        name: String(client.name || '').trim() || 'Client',
        email: String(client.email || '').trim() || 'noreply@example.com',
        phone: client.phone ?? null,
        partnerName: client.partnerName ?? null,
        createdAt: client.createdAt || now,
      })
    } else {
      updateClient(client.id, {
        name: String(client.name || '').trim() || 'Client',
        email: String(client.email || '').trim() || 'noreply@example.com',
        phone: client.phone ?? null,
        partnerName: client.partnerName ?? null,
      })
    }
    if (!state.projects.find((p) => p.id === project.id)) {
      createProject({
        id: project.id,
        clientId: project.clientId,
        clientName: String(project.clientName || '').trim() || 'Project',
        title: String(project.title || '').trim() || 'Booking',
        stage: project.stage || 'proposal',
        value: Number(project.value) || 0,
        weddingDate: project.weddingDate || now,
        venue: project.venue ?? null,
        packageType: project.packageType ?? null,
        dueDate: project.dueDate || now,
        createdAt: project.createdAt ?? null,
        notes: project.notes ?? null,
        requestedArtist: project.requestedArtist ?? null,
        cloudProjectId: project.cloudProjectId ?? null,
      })
    }
    const existing = getState().proposals.find((p) => p.id === proposal.id)
    if (!existing) {
      createProposal({
        id: proposal.id,
        projectId: proposal.projectId,
        clientName: String(proposal.clientName || '').trim() || 'Client',
        title: String(proposal.title || '').trim() || 'Proposal',
        status: proposal.status || 'draft',
        value: Number(proposal.value) || 0,
        sentAt: proposal.sentAt ?? null,
        emailBody: proposal.emailBody ?? null,
        customPackageName: proposal.customPackageName ?? null,
        customPackageDetails: proposal.customPackageDetails ?? null,
        customPriceBreakdown: proposal.customPriceBreakdown ?? null,
        acceptToken: proposal.acceptToken,
      })
    } else {
      updateProposal(proposal.id, {
        acceptToken: proposal.acceptToken,
        title: String(proposal.title || '').trim() || existing.title,
        value: Number(proposal.value) || existing.value,
        status: proposal.status || existing.status,
        clientName: String(proposal.clientName || '').trim() || existing.clientName,
        emailBody: proposal.emailBody ?? existing.emailBody,
        customPackageName: proposal.customPackageName ?? existing.customPackageName,
        customPackageDetails: proposal.customPackageDetails ?? existing.customPackageDetails,
        customPriceBreakdown: proposal.customPriceBreakdown ?? existing.customPriceBreakdown,
      })
    }
    res.json({ ok: true })
  } catch (err) {
    logError('DB', 'Failed to sync proposal for accept', err)
    res.status(500).json({ error: err.message || 'Failed to sync' })
  }
})

app.get('/api/proposals/:id/accept-info', (req, res) => {
  try {
    const { token, d } = req.query
    const tokenStr = token ? String(token).trim() : null
    console.log(`[accept-info] id=${req.params.id} token=${tokenStr ? 'yes' : 'no'} d=${d ? `yes(${String(d).length}chars)` : 'no'}`)
    // When we have d + token, create or update proposal to match link (fixes stale/missing data)
    if (d && tokenStr) {
      try {
        const raw = JSON.parse(Buffer.from(String(d), 'base64').toString('utf-8'))
        const decoded = {
          title: raw.t || raw.title || 'Proposal',
          clientName: raw.n || raw.clientName || 'Client',
          value: Number(raw.v ?? raw.value) || 0,
          projectId: raw.p || raw.projectId,
          clientId: raw.ci || raw.clientId,
          clientEmail: raw.ce || raw.clientEmail,
          weddingDate: raw.w || raw.weddingDate,
          venue: raw.ve || raw.venue,
          projectTitle: raw.projectTitle,
          status: raw.status || 'sent',
          sentAt: raw.sentAt,
        }
        const proposalId = req.params.id
        if (decoded.projectId) {
          if (decoded.clientId) {
            const existingClient = getClientById(decoded.clientId)
            if (!existingClient) {
              try { createClient({ id: decoded.clientId, name: decoded.clientName, email: decoded.clientEmail || 'noreply@example.com', phone: null, partnerName: null, createdAt: new Date().toISOString().slice(0, 10) }) } catch (_) {}
            }
            try { restoreClient(decoded.clientId) } catch (_) {}
          }
          const projectExists = getState().projects.find((p) => p.id === decoded.projectId)
          if (!projectExists) {
            try {
              createProject({ id: decoded.projectId, clientId: decoded.clientId || 'unknown', clientName: decoded.clientName, title: decoded.projectTitle || decoded.title, stage: 'proposal', value: decoded.value, weddingDate: decoded.weddingDate || new Date().toISOString().slice(0, 10), venue: decoded.venue || null, packageType: null, dueDate: new Date().toISOString().slice(0, 10), createdAt: new Date().toISOString().slice(0, 10), notes: null, requestedArtist: null, cloudProjectId: null })
            } catch (_) {}
          }
          try {
            createProposal({ id: proposalId, projectId: decoded.projectId, clientName: decoded.clientName, title: decoded.title, status: decoded.status || 'sent', value: decoded.value, sentAt: decoded.sentAt || null, emailBody: null, customPackageName: null, customPackageDetails: null, customPriceBreakdown: null, acceptToken: tokenStr })
          } catch (_) {
            updateProposal(proposalId, { acceptToken: tokenStr, status: decoded.status || 'sent', value: decoded.value, clientName: decoded.clientName, title: decoded.title })
          }
        }
      } catch (err) { console.error('[accept-info] d param error:', err.message || err) }
    }
    const state = getState()
    let proposal = state.proposals.find((p) => p.id === req.params.id)
    if (!proposal) return res.status(404).json({ error: 'Proposal not found' })
    if (!tokenStr || proposal.acceptToken !== tokenStr) return res.status(403).json({ error: 'Invalid or expired link' })
    if (proposal.status === 'accepted') return res.json({ ...proposal, alreadyAccepted: true })
    res.json({
      id: proposal.id,
      title: proposal.title,
      clientName: proposal.clientName,
      value: proposal.value,
      alreadyAccepted: false,
    })
  } catch (err) {
    logError('API', 'Failed to get accept info', err)
    res.status(500).json({ error: 'Failed to load proposal' })
  }
})

app.post('/api/proposals/:id/accept', async (req, res) => {
  try {
    const id = req.params.id
    const { token, d, acceptedTotal: bodyAcceptedTotal, selectedEnhancements: bodySelectedEnhancements } = req.body || {}
    const state = getState()
    let proposal = state.proposals.find((p) => p.id === id)
    if (!proposal) return res.status(404).json({ error: 'Proposal not found' })
    // Fix token mismatch via d param (same as accept-info)
    if (token && proposal.acceptToken !== token && d) {
      try {
        const raw = JSON.parse(Buffer.from(String(d), 'base64').toString('utf-8'))
        if (raw && (raw.p || raw.projectId || raw.t)) {
          updateProposal(id, { acceptToken: String(token) })
          proposal = getState().proposals.find((p) => p.id === id)
        }
      } catch (_) {}
    }
    if (!token || proposal.acceptToken !== token) return res.status(403).json({ error: 'Invalid or expired link' })
    if (proposal.status === 'accepted') return res.status(400).json({ error: 'Proposal already accepted' })

    let project = state.projects.find((p) => p.id === proposal.projectId)
    if (!project) {
      try {
        restoreProject(proposal.projectId)
        project = getState().projects.find((p) => p.id === proposal.projectId)
      } catch (_) {}
      if (!project) return res.status(400).json({ error: 'Project not found' })
    }
    const client = state.clients.find((c) => c.id === project.clientId)
    const clientEmail = (client?.email || '').trim()
    const baseUrl = (req.body && req.body.baseUrl) || process.env.APP_URL || ''

    const finalValue = Number(bodyAcceptedTotal) > 0 ? Number(bodyAcceptedTotal) : proposal.value
    const acceptedEnhancementsJson = Array.isArray(bodySelectedEnhancements) && bodySelectedEnhancements.length > 0
      ? JSON.stringify(bodySelectedEnhancements)
      : null
    updateProposal(id, { status: 'accepted', value: finalValue, acceptedEnhancements: acceptedEnhancementsJson })
    updateProject(proposal.projectId, { value: finalValue })
    let s = getState()
    proposal = s.proposals.find((p) => p.id === id)
    project = s.projects.find((p) => p.id === proposal.projectId)

    let contract = s.contracts.find((c) => c.projectId === proposal.projectId)
    const packageLabel = getProposalPackageLabel(proposal, project)
    if (!contract) {
      const template = (s.contractTemplates || []).find((t) => /performance/i.test(t.name)) || (s.contractTemplates || [])[0]
      const contractId = nextId('c', s.contracts)
      const signToken = randomAcceptToken()
      createContract({
        id: contractId,
        projectId: project.id,
        clientName: project.clientName,
        title: project.title,
        status: 'sent',
        value: project.value,
        weddingDate: project.weddingDate || '',
        venue: project.venue,
        packageType: packageLabel || project.packageType,
        signedAt: null,
        createdAt: new Date().toISOString().slice(0, 10),
        templateId: template ? template.id : null,
        signToken,
        clientSignedAt: null,
        lastReminderSentAt: null,
      })
      const contractPdf = await createContractPdfFromTemplate(template, proposal, project, client)
      if (contractPdf) {
        ensureContractsDir()
        writeFileSync(join(CONTRACTS_DIR, `${contractId}.pdf`), contractPdf)
      }
      s = getState()
      contract = s.contracts.find((c) => c.id === contractId)
    } else if (contract.status !== 'sent' || !contract.signToken) {
      const signToken = randomAcceptToken()
      updateContract(contract.id, { status: 'sent', signToken })
      s = getState()
      contract = s.contracts.find((c) => c.id === contract.id)
    }
    if (contract && (contract.value !== finalValue || contract.packageType !== (packageLabel || project.packageType))) {
      updateContract(contract.id, { value: finalValue, packageType: packageLabel || project.packageType })
      s = getState()
      contract = s.contracts.find((c) => c.id === contract.id)
    }
    const signUrl = contract && contract.status === 'sent' && contract.signToken
      ? `${baseUrl.replace(/\/$/, '')}/sign/${contract.id}?token=${encodeURIComponent(contract.signToken)}`
      : ''

    let invoice = (s.invoices || []).find((inv) => inv.projectId === proposal.projectId && (inv.type === 'deposit' || inv.type === 'other'))
    const retainer = Math.round((proposal?.value ?? finalValue) * 0.5)
    const lineItems = buildDepositInvoiceLineItems(proposal, project, proposal?.value ?? finalValue)
    if (!invoice) {
      const invoiceId = nextId('i', s.invoices || [])
      createInvoice({
        id: invoiceId,
        projectId: project.id,
        clientName: project.clientName,
        clientEmail: clientEmail || undefined,
        projectTitle: `${project.title} — Retainer`,
        amount: retainer,
        status: 'sent',
        dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
        type: 'deposit',
        lineItems,
      })
      s = getState()
      invoice = s.invoices.find((i) => i.id === invoiceId)
    } else if (invoice.type === 'deposit' && !invoice.paidAt && invoice.status !== 'paid') {
      updateInvoice(invoice.id, {
        amount: retainer,
        clientEmail: clientEmail || undefined,
        projectTitle: `${project.title} — Retainer`,
        lineItems,
      })
      s = getState()
      invoice = s.invoices.find((i) => i.id === invoice.id)
    }
    const invoiceViewUrl = invoice && baseUrl
      ? `${baseUrl.replace(/\/$/, '')}/invoices/view/${invoice.id}`
      : ''

    sendProposalAcceptedNotification(id).catch((err) => {
      logError('SMTP', 'Failed to send proposal accepted notification', err)
    })

    res.json({
      ok: true,
      contractId: contract?.id,
      invoiceId: invoice?.id,
      signUrl: signUrl || null,
      invoiceViewUrl: invoiceViewUrl || null,
    })
  } catch (err) {
    logError('API', 'Failed to accept proposal', err)
    res.status(500).json({ error: err.message || 'Failed to accept proposal' })
  }
})

app.post('/api/contracts', (req, res) => {
  try {
    const c = req.body
    if (!c.id || !c.projectId || !c.clientName || !c.title || !c.status || c.value == null || !c.weddingDate || !c.createdAt)
      return res.status(400).json({ error: 'Missing fields' })
    createContract(c)
    res.json({ id: c.id })
  } catch (err) {
    logError('DB', 'Failed to create contract', err)
    res.status(500).json({ error: 'Failed to create contract' })
  }
})

app.patch('/api/contracts/:id', (req, res) => {
  try {
    updateContract(req.params.id, req.body)
    res.json({ ok: true })
  } catch (err) {
    logError('DB', 'Failed to update contract', err)
    res.status(500).json({ error: 'Failed to update contract' })
  }
})

/** Load contract PDF: prefer contract's own file in CONTRACTS_DIR; fallback to template only for legacy contracts that never had a copy. Pass state when caller already has it to avoid extra getState(). */
function loadContractPdfBuffer(contract, state) {
  const signedPath = join(CONTRACTS_DIR, `${contract.id}.pdf`)
  if (existsSync(signedPath)) return readFileSync(signedPath)
  const templateId = contract.templateId
  if (!templateId) return null
  const s = state || getState()
  const t = s.contractTemplates.find((x) => x.id === templateId)
  if (!t || !t.fileName) return null
  const templatePath = join(TEMPLATES_CONTRACTS_DIR, t.fileName)
  if (!existsSync(templatePath)) return null
  return readFileSync(templatePath)
}

async function stampSignature(pdfBuffer, signatureDataUrl, label, signedDate) {
  const pdf = await PDFDocument.load(pdfBuffer)
  const pages = pdf.getPages()
  if (pages.length === 0) return pdf.save()
  const page = pages[pages.length - 1]
  const { width } = page.getSize()
  const base64 = signatureDataUrl.replace(/^data:image\/png;base64,/, '')
  const imgBytes = Buffer.from(base64, 'base64')
  const img = await pdf.embedPng(imgBytes)
  const imgW = Math.min(120, img.width)
  const imgH = (img.height / img.width) * imgW
  const x = width - imgW - 40
  const y = 40
  page.drawImage(img, { x, y, width: imgW, height: imgH })
  const gray = { type: 'RGB', red: 0.4, green: 0.4, blue: 0.4 }
  page.drawText(label || '', { x, y: y - 14, size: 9, color: gray })
  if (signedDate) page.drawText(`Signed: ${signedDate}`, { x, y: y - 26, size: 8, color: gray })
  return pdf.save()
}

app.get('/api/contracts/:id/file', (req, res) => {
  try {
    const state = getState()
    const contract = state.contracts.find((c) => c.id === req.params.id)
    if (!contract) return res.status(404).json({ error: 'Contract not found' })
    const token = req.query.token
    if (token != null && token !== '') {
      if (contract.status !== 'sent' || !contract.signToken || contract.signToken !== token) {
        return res.status(403).json({ error: 'Invalid or expired link' })
      }
    }
    const buf = loadContractPdfBuffer(contract, state)
    if (!buf) return res.status(404).json({ error: 'Contract PDF not available' })
    res.setHeader('Content-Type', 'application/pdf')
    res.send(buf)
  } catch (err) {
    logError('API', 'Failed to read contract file', err)
    res.status(500).json({ error: err.message || 'Failed to read contract' })
  }
})

app.put('/api/contracts/:id/file', (req, res) => {
  try {
    const state = getState()
    const contract = state.contracts.find((c) => c.id === req.params.id)
    if (!contract) return res.status(404).json({ error: 'Contract not found' })
    const { fileBase64 } = req.body
    if (!fileBase64 || typeof fileBase64 !== 'string') return res.status(400).json({ error: 'fileBase64 required' })
    ensureContractsDir()
    const filePath = join(CONTRACTS_DIR, `${contract.id}.pdf`)
    const buf = Buffer.from(fileBase64, 'base64')
    writeFileSync(filePath, buf)
    res.json({ ok: true })
  } catch (err) {
    logError('API', 'Failed to save contract file', err)
    res.status(500).json({ error: err.message || 'Failed to save contract file' })
  }
})

app.post('/api/contracts/sync-for-sign', async (req, res) => {
  try {
    const { client, project, contract, template } = req.body || {}
    if (!contract || !contract.id) return res.status(400).json({ error: 'contract required' })
    const now = new Date().toISOString().slice(0, 10)
    const state = getState()

    if (client && client.id) {
      if (!getClientById(client.id)) {
        try { createClient({ id: client.id, name: client.name || 'Client', email: client.email || '', phone: client.phone ?? null, partnerName: client.partnerName ?? null, createdAt: client.createdAt || now }) } catch (_) {}
      }
      try { restoreClient(client.id) } catch (_) {}
    }
    if (project && project.id) {
      if (!getState().projects.find((p) => p.id === project.id)) {
        try { createProject({ id: project.id, clientId: project.clientId || client?.id || 'unknown', clientName: project.clientName || '', title: project.title || '', stage: project.stage || 'booked', value: Number(project.value) || 0, weddingDate: project.weddingDate || now, venue: project.venue ?? null, packageType: project.packageType ?? null, dueDate: project.dueDate || now, createdAt: project.createdAt || now, notes: project.notes ?? null, requestedArtist: project.requestedArtist ?? null, cloudProjectId: project.cloudProjectId ?? null }) } catch (_) {}
      }
      try { restoreProject(project.id) } catch (_) {}
    }

    if (template && template.id) {
      const existingT = getState().contractTemplates.find((t) => t.id === template.id)
      if (!existingT) {
        try { createContractTemplate({ id: template.id, name: template.name || 'Performance Agreement', fileName: template.fileName || '', createdAt: template.createdAt || now, contentHtml: template.contentHtml ?? null }) } catch (_) {}
      } else if (template.contentHtml && !existingT.contentHtml) {
        try { updateContractTemplate(template.id, { name: template.name || existingT.name, contentHtml: template.contentHtml }) } catch (_) {}
      }
    }

    const existing = getState().contracts.find((c) => c.id === contract.id)
    if (!existing) {
      createContract({
        id: contract.id, projectId: contract.projectId, clientName: contract.clientName || '', title: contract.title || '',
        status: contract.status || 'sent', value: Number(contract.value) || 0, weddingDate: contract.weddingDate || '',
        venue: contract.venue ?? null, packageType: contract.packageType ?? null, signedAt: contract.signedAt ?? null,
        createdAt: contract.createdAt || now, templateId: contract.templateId ?? template?.id ?? null,
        signToken: contract.signToken ?? null, clientSignedAt: contract.clientSignedAt ?? null, lastReminderSentAt: null,
      })
    } else {
      updateContract(contract.id, {
        signToken: contract.signToken || existing.signToken,
        status: contract.status || existing.status,
        value: Number(contract.value) || existing.value,
        clientName: contract.clientName || existing.clientName,
        title: contract.title || existing.title,
        templateId: contract.templateId ?? template?.id ?? existing.templateId,
        weddingDate: contract.weddingDate || existing.weddingDate,
        venue: contract.venue ?? existing.venue,
        packageType: contract.packageType ?? existing.packageType,
      })
    }

    if (template && template.contentHtml) {
      const c = getState().contracts.find((x) => x.id === contract.id)
      if (c) {
        const t = getState().contractTemplates.find((x) => x.id === c.templateId)
        if (t) {
          const proj = getState().projects.find((p) => p.id === c.projectId)
          const proposal = getState().proposals.find((p) => p.projectId === c.projectId)
          const cl = client?.id ? getClientById(client.id) : null
          const pdfBuf = await createContractPdfFromTemplate(t, proposal, proj, cl)
          if (pdfBuf) {
            ensureContractsDir()
            writeFileSync(join(CONTRACTS_DIR, `${c.id}.pdf`), pdfBuf)
          }
        }
      }
    }

    res.json({ ok: true })
  } catch (err) {
    logError('DB', 'Failed to sync contract for sign', err)
    res.status(500).json({ error: err.message || 'Failed to sync' })
  }
})

app.post('/api/contracts/:id/push-to-render', async (req, res) => {
  try {
    const { id } = req.params
    const baseUrl = ((req.body && req.body.baseUrl) || '').toString().trim().replace(/\/$/, '')
    if (!baseUrl || !baseUrl.startsWith('http')) return res.status(400).json({ error: 'Missing or invalid baseUrl' })
    const state = getState()
    const contract = state.contracts.find((c) => c.id === id)
    if (!contract) return res.status(404).json({ error: 'Contract not found locally' })
    const project = state.projects.find((p) => p.id === contract.projectId)
    const client = project ? state.clients.find((c) => c.id === project.clientId) : null
    const template = contract.templateId ? state.contractTemplates.find((t) => t.id === contract.templateId) : (state.contractTemplates || [])[0]
    const payload = {
      client: client ? { id: client.id, name: client.name, email: client.email, phone: client.phone, partnerName: client.partnerName, createdAt: client.createdAt } : undefined,
      project: project ? { id: project.id, clientId: project.clientId, clientName: project.clientName, title: project.title, stage: project.stage, value: project.value, weddingDate: project.weddingDate, venue: project.venue, packageType: project.packageType, dueDate: project.dueDate, createdAt: project.createdAt, notes: project.notes, requestedArtist: project.requestedArtist, cloudProjectId: project.cloudProjectId } : undefined,
      contract: { id: contract.id, projectId: contract.projectId, clientName: contract.clientName, title: contract.title, status: contract.status, value: contract.value, weddingDate: contract.weddingDate, venue: contract.venue, packageType: contract.packageType, signedAt: contract.signedAt, createdAt: contract.createdAt, templateId: contract.templateId, signToken: contract.signToken, clientSignedAt: contract.clientSignedAt },
      template: template ? { id: template.id, name: template.name, fileName: template.fileName, createdAt: template.createdAt, contentHtml: template.contentHtml } : undefined,
    }
    const syncUrl = `${baseUrl}/api/contracts/sync-for-sign`
    let lastErr = null
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), PROXY_STATE_TIMEOUT_MS)
        const response = await fetch(syncUrl, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload), signal: controller.signal,
        }).finally(() => clearTimeout(timeoutId))
        const data = await response.json().catch(() => ({}))
        if (response.ok) return res.json({ ok: true })
        lastErr = `Render returned ${response.status}: ${JSON.stringify(data)}`
        console.error(`[ContractPush] attempt ${attempt + 1}: ${lastErr}`)
      } catch (e) {
        lastErr = e.name === 'AbortError' ? 'Timeout' : (e.message || 'Unknown error')
        console.error(`[ContractPush] attempt ${attempt + 1}: ${lastErr}`)
      }
      if (attempt < 2) await new Promise((r) => setTimeout(r, 5000))
    }
    res.status(502).json({ error: lastErr || 'Could not reach Render after 3 attempts' })
  } catch (err) {
    console.error('[ContractPush] Failed:', err.message || err)
    res.status(502).json({ error: err.message || 'Could not reach Render' })
  }
})

app.post('/api/invoices/sync-for-view', (req, res) => {
  try {
    const { client, project, invoice } = req.body || {}
    if (!invoice || !invoice.id) return res.status(400).json({ error: 'invoice required' })
    const now = new Date().toISOString().slice(0, 10)
    const state = getState()
    if (client?.id) {
      if (!getClientById(client.id)) {
        try { createClient({ id: client.id, name: client.name || 'Client', email: client.email || '', phone: client.phone ?? null, partnerName: client.partnerName ?? null, createdAt: client.createdAt || now }) } catch (_) {}
      }
      try { restoreClient(client.id) } catch (_) {}
    }
    if (project?.id) {
      if (!getState().projects.find((p) => p.id === project.id)) {
        try { createProject({ id: project.id, clientId: project.clientId || client?.id || 'unknown', clientName: project.clientName || '', title: project.title || '', stage: project.stage || 'booked', value: Number(project.value) || 0, weddingDate: project.weddingDate || now, venue: project.venue ?? null, packageType: project.packageType ?? null, dueDate: project.dueDate || now, createdAt: project.createdAt || now, notes: null, requestedArtist: null, cloudProjectId: null }) } catch (_) {}
      }
      try { restoreProject(project.id) } catch (_) {}
    }
    const existing = getState().invoices.find((i) => i.id === invoice.id)
    if (!existing) {
      createInvoice({
        id: invoice.id, projectId: invoice.projectId || null, clientName: invoice.clientName || '', clientEmail: invoice.clientEmail || '', projectTitle: invoice.projectTitle || '',
        amount: Number(invoice.amount) || 0, status: invoice.status || 'sent', dueDate: invoice.dueDate || now, type: invoice.type || 'deposit',
        lineItems: invoice.lineItems || [{ description: 'Retainer', quantity: 1, unitPrice: Number(invoice.amount) || 0 }],
      })
    } else {
      updateInvoice(invoice.id, { amount: Number(invoice.amount) || existing.amount, clientEmail: invoice.clientEmail ?? existing.clientEmail, projectTitle: invoice.projectTitle ?? existing.projectTitle, lineItems: invoice.lineItems ?? existing.lineItems, status: invoice.status || existing.status })
    }
    res.json({ ok: true })
  } catch (err) {
    logError('DB', 'Failed to sync invoice for view', err)
    res.status(500).json({ error: err.message || 'Failed to sync' })
  }
})

app.post('/api/invoices/:id/push-to-render', async (req, res) => {
  try {
    const { id } = req.params
    const baseUrl = ((req.body && req.body.baseUrl) || '').toString().trim().replace(/\/$/, '')
    if (!baseUrl || !baseUrl.startsWith('http')) return res.status(400).json({ error: 'Missing or invalid baseUrl' })
    const state = getState()
    const invoice = state.invoices.find((i) => i.id === id)
    if (!invoice) return res.status(404).json({ error: 'Invoice not found locally' })
    const project = state.projects.find((p) => p.id === invoice.projectId)
    const client = project ? state.clients.find((c) => c.id === project.clientId) : null
    const payload = {
      client: client ? { id: client.id, name: client.name, email: client.email, phone: client.phone, partnerName: client.partnerName, createdAt: client.createdAt } : undefined,
      project: project ? { id: project.id, clientId: project.clientId, clientName: project.clientName, title: project.title, stage: project.stage, value: project.value, weddingDate: project.weddingDate, venue: project.venue, packageType: project.packageType, dueDate: project.dueDate, createdAt: project.createdAt, notes: project.notes, requestedArtist: project.requestedArtist, cloudProjectId: project.cloudProjectId } : undefined,
      invoice: { id: invoice.id, projectId: invoice.projectId, clientName: invoice.clientName, clientEmail: invoice.clientEmail, projectTitle: invoice.projectTitle, amount: invoice.amount, status: invoice.status, dueDate: invoice.dueDate, type: invoice.type, lineItems: invoice.lineItems },
    }
    const syncUrl = `${baseUrl}/api/invoices/sync-for-view`
    let lastErr = null
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), PROXY_STATE_TIMEOUT_MS)
        const response = await fetch(syncUrl, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload), signal: controller.signal,
        }).finally(() => clearTimeout(timeoutId))
        const data = await response.json().catch(() => ({}))
        if (response.ok) return res.json({ ok: true })
        lastErr = `Render returned ${response.status}: ${JSON.stringify(data)}`
        console.error(`[InvoicePush] attempt ${attempt + 1}: ${lastErr}`)
      } catch (e) {
        lastErr = e.name === 'AbortError' ? 'Timeout' : (e.message || 'Unknown error')
        console.error(`[InvoicePush] attempt ${attempt + 1}: ${lastErr}`)
      }
      if (attempt < 2) await new Promise((r) => setTimeout(r, 5000))
    }
    res.status(502).json({ error: lastErr || 'Could not reach Render after 3 attempts' })
  } catch (err) {
    console.error('[InvoicePush] Failed:', err.message || err)
    res.status(502).json({ error: err.message || 'Could not reach Render' })
  }
})

app.get('/api/contracts/:id/sign-info', async (req, res) => {
  try {
    const { token, d } = req.query
    let state = getState()
    let contract = state.contracts.find((c) => c.id === req.params.id)

    if ((!contract || contract.signToken !== String(token)) && d) {
      try {
        const raw = JSON.parse(Buffer.from(String(d), 'base64').toString('utf-8'))
        const decoded = {
          clientName: raw.n || raw.clientName || '',
          title: raw.ti || raw.title || '',
          projectId: raw.p || raw.projectId || '',
          value: Number(raw.v ?? raw.value) || 0,
          weddingDate: raw.w || raw.weddingDate || '',
          venue: raw.ve || raw.venue || '',
          packageType: raw.pk || raw.packageType || '',
          templateId: raw.tm || raw.templateId || null,
          templateHtml: raw.th || raw.templateHtml || null,
          templateName: raw.tn || raw.templateName || null,
          clientId: raw.ci || raw.clientId || null,
          clientEmail: raw.ce || raw.clientEmail || null,
        }
        const now = new Date().toISOString().slice(0, 10)
        const contractId = req.params.id
        const signToken = String(token)

        if (decoded.clientId) {
          if (!getClientById(decoded.clientId)) {
            try { createClient({ id: decoded.clientId, name: decoded.clientName, email: decoded.clientEmail || '', phone: null, partnerName: null, createdAt: now }) } catch (_) {}
          }
          try { restoreClient(decoded.clientId) } catch (_) {}
        }
        if (decoded.projectId) {
          if (!getState().projects.find((p) => p.id === decoded.projectId)) {
            try { createProject({ id: decoded.projectId, clientId: decoded.clientId || 'unknown', clientName: decoded.clientName, title: decoded.title, stage: 'booked', value: decoded.value, weddingDate: decoded.weddingDate || now, venue: decoded.venue || null, packageType: decoded.packageType || null, dueDate: now, createdAt: now, notes: null, requestedArtist: null, cloudProjectId: null }) } catch (_) {}
          }
          try { restoreProject(decoded.projectId) } catch (_) {}
        }
        if (decoded.templateId && decoded.templateHtml) {
          const existingT = getState().contractTemplates.find((t) => t.id === decoded.templateId)
          if (!existingT) {
            try { createContractTemplate({ id: decoded.templateId, name: decoded.templateName || 'Performance Agreement', fileName: '', createdAt: now, contentHtml: decoded.templateHtml }) } catch (_) {}
          }
        }

        if (!contract) {
          try {
            createContract({ id: contractId, projectId: decoded.projectId, clientName: decoded.clientName, title: decoded.title, status: 'sent', value: decoded.value, weddingDate: decoded.weddingDate, venue: decoded.venue || null, packageType: decoded.packageType || null, signedAt: null, createdAt: now, templateId: decoded.templateId, signToken, clientSignedAt: null, lastReminderSentAt: null })
          } catch (_) {
            updateContract(contractId, { signToken, status: 'sent', templateId: decoded.templateId || undefined, clientSignedAt: null, clientName: decoded.clientName, title: decoded.title })
          }
        } else {
          updateContract(contractId, { signToken, status: 'sent', templateId: decoded.templateId || contract.templateId, clientSignedAt: null, clientName: decoded.clientName || contract.clientName, title: decoded.title || contract.title })
        }

        state = getState()
        contract = state.contracts.find((c) => c.id === contractId)

        // Regenerate PDF with correct client name (from d) when we have template
        if (contract) {
          const t = state.contractTemplates.find((x) => x.id === contract.templateId)
          if (t && (t.contentHtml || t.fileName)) {
            const proj = state.projects.find((p) => p.id === contract.projectId)
            const proposal = state.proposals.find((p) => p.projectId === contract.projectId)
            const cl = decoded.clientId ? getClientById(decoded.clientId) : null
            const pdfBuf = await createContractPdfFromTemplate(t, proposal, proj, cl)
            if (pdfBuf) {
              ensureContractsDir()
              writeFileSync(join(CONTRACTS_DIR, `${contract.id}.pdf`), pdfBuf)
            }
          }
        }
      } catch (err) { console.error('[sign-info] d param error:', err.message || err) }
    }

    // When d is present and contract has clientSignedAt, clear it so client can sign (fixes stale Render state)
    if (d && contract && contract.clientSignedAt) {
      updateContract(req.params.id, { clientSignedAt: null })
      contract = getState().contracts.find((c) => c.id === req.params.id)
    }

    if (!contract) return res.status(404).json({ error: 'Contract not found' })
    if (contract.status !== 'sent' || !contract.signToken || contract.signToken !== String(token)) {
      return res.status(403).json({ error: 'Invalid or expired signing link' })
    }
    if (contract.clientSignedAt) {
      return res.json({ ...contract, awaiting: 'vendor', message: 'Client has signed. Awaiting vendor signature.' })
    }
    let pdfBuf = loadContractPdfBuffer(contract, state)
    if (!pdfBuf) {
      try {
        const proj = state.projects.find((p) => p.id === contract.projectId)
        const basicHtml = `<h1>Performance Agreement</h1><p>Client: ${contract.clientName}</p><p>Event: ${contract.title}</p><p>Date: ${contract.weddingDate || 'TBD'}</p><p>Venue: ${contract.venue || 'TBD'}</p><p>Investment: $${(contract.value || 0).toLocaleString()}</p><p>Package: ${contract.packageType || proj?.packageType || 'Standard'}</p>`
        pdfBuf = await createPdfFromEditorTemplate(basicHtml, { clientName: contract.clientName, weddingDate: contract.weddingDate, venue: contract.venue, packageType: contract.packageType, value: contract.value, title: contract.title })
        if (pdfBuf) { ensureContractsDir(); writeFileSync(join(CONTRACTS_DIR, `${contract.id}.pdf`), pdfBuf) }
      } catch (_) {}
    }
    if (!pdfBuf) {
      return res.status(400).json({ error: 'Contract PDF not available. Please ask the sender to generate the contract first.' })
    }
    res.json({ ...contract, awaiting: 'client', message: 'Please sign below.' })
  } catch (err) {
    logError('DB', 'Failed to load signing info', err)
    res.status(500).json({ error: err.message || 'Failed to load signing info' })
  }
})

app.post('/api/contracts/:id/sign-client', async (req, res) => {
  try {
    const { token, signatureDataUrl } = req.body
    if (!token || !signatureDataUrl) return res.status(400).json({ error: 'token and signatureDataUrl required' })
    const state = getState()
    const contract = state.contracts.find((c) => c.id === req.params.id)
    if (!contract) return res.status(404).json({ error: 'Contract not found' })
    if (contract.status !== 'sent' || contract.signToken !== token) {
      return res.status(403).json({ error: 'Invalid or expired signing link' })
    }
    if (contract.clientSignedAt) return res.status(400).json({ error: 'Client has already signed' })
    const buf = loadContractPdfBuffer(contract, state)
    if (!buf) return res.status(400).json({ error: 'Contract PDF not available' })
    ensureContractsDir()
    const clientSignedAt = new Date().toISOString().slice(0, 10)
    const signedPdf = await stampSignature(buf, signatureDataUrl, `${contract.clientName} (Client)`, clientSignedAt)
    writeFileSync(join(CONTRACTS_DIR, `${contract.id}.pdf`), signedPdf)
    updateContract(contract.id, { clientSignedAt })
    sendContractSignedNotification(contract.id, clientSignedAt).catch((err) => {
      logError('SMTP', 'Failed to send contract signed notification email', err)
    })
    res.json({ ok: true, clientSignedAt })
  } catch (err) {
    logError('API', 'Failed to sign (client)', err)
    res.status(500).json({ error: err.message || 'Failed to sign' })
  }
})

app.post('/api/contracts/:id/sign-vendor', async (req, res) => {
  try {
    const { signatureDataUrl } = req.body
    if (!signatureDataUrl) return res.status(400).json({ error: 'signatureDataUrl required' })
    const state = getState()
    const contract = state.contracts.find((c) => c.id === req.params.id)
    if (!contract) return res.status(404).json({ error: 'Contract not found' })
    if (!contract.clientSignedAt) return res.status(400).json({ error: 'Client must sign first' })
    const buf = loadContractPdfBuffer(contract, state)
    if (!buf) return res.status(400).json({ error: 'Contract PDF not available' })
    ensureContractsDir()
    const signedAt = new Date().toISOString().slice(0, 10)
    const signedPdf = await stampSignature(buf, signatureDataUrl, 'Aurora Sonnet (Vendor)', signedAt)
    writeFileSync(join(CONTRACTS_DIR, `${contract.id}.pdf`), signedPdf)
    updateContract(contract.id, { status: 'signed', signedAt })
    ensureSecuredBookingCalendarDates()
    res.json({ ok: true, signedAt })
  } catch (err) {
    logError('API', 'Failed to sign (vendor)', err)
    res.status(500).json({ error: err.message || 'Failed to sign' })
  }
})

const CONTRACT_REMINDER_THROTTLE_DAYS = 3
async function sendContractReminderEmail(contractId, baseUrl = '') {
  if (!reminderTransporter) return { sent: false, error: 'SMTP not configured' }
  const state = getState()
  const contract = state.contracts.find((c) => c.id === contractId)
  if (!contract) return { sent: false, error: 'Contract not found' }
  if (contract.status !== 'sent' || contract.clientSignedAt) return { sent: false, error: 'Contract not awaiting client signature' }
  let project = state.projects.find((p) => p.id === contract.projectId)
  if (!project) project = state.projects.find((p) => p.cloudProjectId === contract.projectId)
  if (!project) project = state.projects.find((p) => p.clientName === contract.clientName && p.title === contract.title)
  if (!project) {
    const clientByContract = state.clients.find((c) => c.name === contract.clientName || (contract.clientName && contract.clientName.includes(c.name)))
    if (clientByContract) project = state.projects.find((p) => p.clientId === clientByContract.id && (p.title === contract.title || p.clientName === contract.clientName))
  }
  const client = project ? state.clients.find((c) => c.id === project.clientId) : null
  const toEmail = (client?.email || '').trim()
  if (!toEmail) return { sent: false, error: 'No client email for this contract. Add the client email in their contact details.' }
  const lastSent = contract.lastReminderSentAt || ''
  if (lastSent) {
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - CONTRACT_REMINDER_THROTTLE_DAYS)
    if (lastSent.slice(0, 10) >= cutoff.toISOString().slice(0, 10)) return { sent: false, error: 'Reminder already sent recently. Wait a few days before sending again.' }
  }
  const signUrl = baseUrl ? `${baseUrl.replace(/\/$/, '')}/sign/${contract.id}?token=${encodeURIComponent(contract.signToken || '')}` : ''
  const firstName = (contract.clientName || '').split(/\s+/)[0] || 'there'
  const subject = `Please sign your contract: ${contract.title}`
  const text =
    `Hi ${firstName},\n\nThis is a friendly reminder to sign your contract for ${contract.title}.\n\n` +
    (signUrl ? `Sign here: ${signUrl}\n\n` : '') +
    `Thank you!\n\nBest,\nAurora Sonnet`
  await reminderTransporter.sendMail({
    from: SMTP_FROM,
    to: toEmail,
    subject,
    text,
  })
  const sentAt = new Date().toISOString()
  updateContract(contractId, { lastReminderSentAt: sentAt })
  return { sent: true, sentAt }
}

app.post('/api/contracts/:id/send-reminder', async (req, res) => {
  try {
    const { id } = req.params
    const baseUrl = (req.body && req.body.baseUrl) || process.env.APP_URL || ''
    const result = await sendContractReminderEmail(id, baseUrl)
    if (!result.sent) {
      const status = result.error === 'SMTP not configured' ? 503 : 400
      return res.status(status).json({ ok: false, error: result.error })
    }
    res.json({ ok: true, sentAt: result.sentAt })
  } catch (err) {
    logError('SMTP', 'Failed to send contract reminder', err)
    res.status(500).json({ error: 'Failed to send reminder email' })
  }
})

app.delete('/api/contracts/:id', (req, res) => {
  try {
    const id = req.params.id
    const filePath = join(CONTRACTS_DIR, `${id}.pdf`)
    if (existsSync(filePath)) unlinkSync(filePath)
    deleteContract(id)
    res.json({ ok: true })
  } catch (err) {
    logError('DB', 'Failed to delete contract', err)
    res.status(500).json({ error: 'Failed to delete contract' })
  }
})

app.get('/api/invoices/:id', (req, res) => {
  try {
    const inv = getState().invoices.find((i) => i.id === req.params.id)
    if (!inv) return res.status(404).json({ error: 'Invoice not found' })
    res.json(inv)
  } catch (err) {
    logError('API', 'Failed to get invoice', err)
    res.status(500).json({ error: err.message || 'Failed to get invoice' })
  }
})

app.post('/api/invoices', (req, res) => {
  try {
    const i = req.body
    if (!i.id || !i.clientName || !i.projectTitle || i.amount == null || !i.status || !i.dueDate)
      return res.status(400).json({ error: 'Missing fields' })
    const amount = Number(i.amount)
    if (Number.isNaN(amount) || amount < 0)
      return res.status(400).json({ error: 'Amount must be a non-negative number' })
    if (Array.isArray(i.lineItems) && i.lineItems.length > 0) {
      for (let idx = 0; idx < i.lineItems.length; idx++) {
        const li = i.lineItems[idx]
        if (!li || typeof li.description !== 'string' || String(li.description).trim() === '')
          return res.status(400).json({ error: `Line item ${idx + 1}: description required` })
        const qty = Number(li.quantity)
        const price = Number(li.unitPrice)
        if (Number.isNaN(qty) || qty < 0 || Number.isNaN(price) || price < 0)
          return res.status(400).json({ error: `Line item ${idx + 1}: quantity and unit price must be non-negative numbers` })
      }
    }
    const result = createInvoice({ ...i, amount })
    res.json({ id: result.id, invoiceNumber: result.invoiceNumber })
  } catch (err) {
    logError('DB', 'Failed to create invoice', err)
    res.status(500).json({ error: 'Failed to create invoice' })
  }
})

app.patch('/api/invoices/:id', (req, res) => {
  try {
    const previousInvoice = getState().invoices.find((i) => i.id === req.params.id)
    const updates = { ...req.body }
    if (updates.amount != null) {
      const amount = Number(updates.amount)
      if (Number.isNaN(amount) || amount < 0)
        return res.status(400).json({ error: 'Amount must be a non-negative number' })
      updates.amount = amount
    }
    if (Array.isArray(updates.lineItems) && updates.lineItems.length > 0) {
      for (let idx = 0; idx < updates.lineItems.length; idx++) {
        const li = updates.lineItems[idx]
        if (!li || typeof li.description !== 'string' || String(li.description).trim() === '')
          return res.status(400).json({ error: `Line item ${idx + 1}: description required` })
        const qty = Number(li.quantity)
        const price = Number(li.unitPrice)
        if (Number.isNaN(qty) || qty < 0 || Number.isNaN(price) || price < 0)
          return res.status(400).json({ error: `Line item ${idx + 1}: quantity and unit price must be non-negative numbers` })
      }
    }
    updateInvoice(req.params.id, updates)
    if (updates.status === 'paid' || updates.paidAt) {
      ensureSecuredBookingCalendarDates()
      const wasAlreadyPaid = Boolean(previousInvoice?.paidAt || previousInvoice?.status === 'paid')
      if (!wasAlreadyPaid) {
        const paidAt = typeof updates.paidAt === 'string' && updates.paidAt ? updates.paidAt : new Date().toISOString().slice(0, 10)
        sendInvoicePaidNotification(req.params.id, paidAt).catch((err) => {
          logError('SMTP', 'Failed to send invoice paid notification email', err)
        })
      }
    }
    res.json({ ok: true })
  } catch (err) {
    logError('DB', 'Failed to update invoice', err)
    res.status(500).json({ error: 'Failed to update invoice' })
  }
})

app.delete('/api/invoices/:id', (req, res) => {
  try {
    deleteInvoice(req.params.id)
    res.json({ ok: true })
  } catch (err) {
    logError('DB', 'Failed to delete invoice', err)
    res.status(500).json({ error: 'Failed to delete invoice' })
  }
})

// Send overdue "please pay" reminder email to client (uses SMTP)
const REMINDER_THROTTLE_DAYS = 5
function isOverdue(inv) {
  if (!inv || inv.status === 'paid') return false
  if (inv.status !== 'sent') return false
  const today = new Date().toISOString().slice(0, 10)
  return inv.dueDate && inv.dueDate < today
}
async function sendInvoiceReminderEmail(invoiceId, baseUrl = '') {
  if (!reminderTransporter) return { sent: false, error: 'SMTP not configured' }
  const state = getState()
  const inv = state.invoices.find((i) => i.id === invoiceId)
  if (!inv) return { sent: false, error: 'Invoice not found' }
  if (inv.status === 'paid') return { sent: false, error: 'Invoice already paid' }
  const toEmail = (inv.clientEmail || '').trim()
  if (!toEmail) return { sent: false, error: 'No client email on invoice' }
  const viewUrl = baseUrl ? `${baseUrl.replace(/\/$/, '')}/invoices/view/${inv.id}` : ''
  const firstName = (inv.clientName || '').split(/\s+/)[0] || 'there'
  const subject = `Friendly reminder: Invoice for ${inv.projectTitle} is past due`
  const text =
    `Hi ${firstName},\n\nThis is a friendly reminder that the following invoice is past due:\n\n` +
    `Invoice: ${inv.projectTitle}\nAmount: $${Number(inv.amount).toLocaleString()}\nDue date: ${inv.dueDate}\n\n` +
    (viewUrl ? `Pay with card (view invoice and pay securely): ${viewUrl}\n\n` : '') +
    `If you've already paid, please disregard this message. Thank you!\n\nBest,\nAurora Sonnet`
  await reminderTransporter.sendMail({
    from: SMTP_FROM,
    to: toEmail,
    subject,
    text,
  })
  const sentAt = new Date().toISOString()
  updateInvoice(invoiceId, { lastReminderSentAt: sentAt })
  return { sent: true, sentAt }
}

async function sendOverdueInvoiceReminders() {
  if (!reminderTransporter) return { sent: 0 }
  const baseUrl = process.env.APP_URL || ''
  const state = getState()
  const today = new Date().toISOString().slice(0, 10)
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - REMINDER_THROTTLE_DAYS)
  const cutoffIso = cutoff.toISOString().slice(0, 10)
  const overdue = (state.invoices || []).filter((inv) => {
    if (!isOverdue(inv)) return false
    if (!(inv.clientEmail || '').trim()) return false
    const last = inv.lastReminderSentAt || ''
    return !last || last.slice(0, 10) < cutoffIso
  })
  let sent = 0
  for (const inv of overdue) {
    const result = await sendInvoiceReminderEmail(inv.id, baseUrl)
    if (result.sent) sent += 1
  }
  return { sent }
}

app.post('/api/invoices/:id/send-reminder', async (req, res) => {
  try {
    const { id } = req.params
    const baseUrl = (req.body && req.body.baseUrl) || process.env.APP_URL || ''
    const result = await sendInvoiceReminderEmail(id, baseUrl)
    if (!result.sent) {
      const status = result.error === 'SMTP not configured' ? 503 : 400
      return res.status(status).json({ ok: false, error: result.error })
    }
    res.json({ ok: true, sentAt: result.sentAt })
  } catch (err) {
    logError('SMTP', 'Failed to send invoice reminder', err)
    res.status(500).json({ error: 'Failed to send reminder email' })
  }
})

app.post('/api/expenses', (req, res) => {
  try {
    const e = req.body
    if (!e.id || !e.date || !e.description || e.amount == null || !e.category)
      return res.status(400).json({ error: 'Missing fields' })
    createExpense(e)
    res.json({ id: e.id })
  } catch (err) {
    logError('DB', 'Failed to create expense', err)
    res.status(500).json({ error: 'Failed to create expense' })
  }
})

app.patch('/api/expenses/:id', (req, res) => {
  try {
    const { date, description, amount, category } = req.body || {}
    if (date !== undefined && typeof date !== 'string') return res.status(400).json({ error: 'Invalid date' })
    if (description !== undefined && typeof description !== 'string') return res.status(400).json({ error: 'Invalid description' })
    if (amount !== undefined && (typeof amount !== 'number' || isNaN(amount) || amount <= 0)) return res.status(400).json({ error: 'Invalid amount' })
    if (category !== undefined && typeof category !== 'string') return res.status(400).json({ error: 'Invalid category' })
    const updated = updateExpense(req.params.id, { date, description, amount, category })
    if (!updated) return res.status(404).json({ error: 'Expense not found' })
    res.json({ ok: true })
  } catch (err) {
    logError('DB', 'Failed to update expense', err)
    res.status(500).json({ error: 'Failed to update expense' })
  }
})

app.delete('/api/expenses/:id', (req, res) => {
  try {
    deleteExpense(req.params.id)
    res.json({ ok: true })
  } catch (err) {
    logError('DB', 'Failed to delete expense', err)
    res.status(500).json({ error: 'Failed to delete expense' })
  }
})

app.post('/api/calendar-reminders', (req, res) => {
  try {
    const r = req.body
    if (!r.id || !r.date || !r.title || !r.createdAt) {
      return res.status(400).json({ error: 'Missing id, date, title, or createdAt' })
    }
    createCalendarReminder({
      id: r.id,
      date: r.date,
      title: r.title,
      notes: r.notes ?? null,
      clientId: r.clientId ?? null,
      projectId: r.projectId ?? null,
      reminderAt: r.reminderAt ?? null,
      createdAt: r.createdAt,
    })
    res.status(201).json(getState().calendarReminders.find((x) => x.id === r.id))
  } catch (err) {
    logError('DB', 'Failed to create calendar reminder', err)
    res.status(500).json({ error: 'Failed to create calendar reminder' })
  }
})

app.patch('/api/calendar-reminders/:id', (req, res) => {
  try {
    updateCalendarReminder(req.params.id, req.body)
    const updated = getState().calendarReminders.find((r) => r.id === req.params.id)
    if (updated) res.json(updated)
    else res.status(404).json({ error: 'Calendar reminder not found' })
  } catch (err) {
    logError('DB', 'Failed to update calendar reminder', err)
    res.status(500).json({ error: 'Failed to update calendar reminder' })
  }
})

app.delete('/api/calendar-reminders/:id', (req, res) => {
  try {
    deleteCalendarReminder(req.params.id)
    res.json({ ok: true })
  } catch (err) {
    logError('DB', 'Failed to delete calendar reminder', err)
    res.status(500).json({ error: 'Failed to delete calendar reminder' })
  }
})

app.post('/api/experiences', (req, res) => {
  try {
    const r = req.body
    if (!r.name || typeof r.name !== 'string' || !r.name.trim()) {
      return res.status(400).json({ error: 'Name is required' })
    }
    const id = createExperience({
      name: String(r.name).trim(),
      description: r.description != null ? String(r.description).trim() : '',
      bullets: Array.isArray(r.bullets) ? r.bullets : [],
      fromPrice: typeof r.fromPrice === 'number' ? r.fromPrice : parseInt(r.fromPrice, 10) || 0,
      imageUrl: r.imageUrl != null ? String(r.imageUrl).trim() || null : null,
      sortOrder: typeof r.sortOrder === 'number' ? r.sortOrder : parseInt(r.sortOrder, 10) || 0,
    })
    const created = getState().experiences.find((e) => e.id === id)
    res.status(201).json(created)
  } catch (err) {
    logError('DB', 'Failed to create experience', err)
    res.status(500).json({ error: 'Failed to create experience' })
  }
})

app.patch('/api/experiences/:id', (req, res) => {
  try {
    const r = req.body
    const updates = {}
    if (r.name !== undefined) updates.name = String(r.name).trim()
    if (r.description !== undefined) updates.description = String(r.description).trim()
    if (r.bullets !== undefined) updates.bullets = Array.isArray(r.bullets) ? r.bullets : []
    if (r.fromPrice !== undefined) updates.fromPrice = typeof r.fromPrice === 'number' ? r.fromPrice : parseInt(r.fromPrice, 10) || 0
    if (r.imageUrl !== undefined) updates.imageUrl = r.imageUrl == null || r.imageUrl === '' ? null : String(r.imageUrl).trim()
    if (r.sortOrder !== undefined) updates.sortOrder = typeof r.sortOrder === 'number' ? r.sortOrder : parseInt(r.sortOrder, 10) || 0
    updateExperience(req.params.id, updates)
    const updated = getState().experiences.find((e) => e.id === req.params.id)
    if (updated) res.json(updated)
    else res.status(404).json({ error: 'Experience not found' })
  } catch (err) {
    logError('DB', 'Failed to update experience', err)
    res.status(500).json({ error: 'Failed to update experience' })
  }
})

app.delete('/api/experiences/:id', (req, res) => {
  try {
    deleteExperience(req.params.id)
    res.json({ ok: true })
  } catch (err) {
    logError('DB', 'Failed to delete experience', err)
    res.status(500).json({ error: 'Failed to delete experience' })
  }
})

// Send due calendar reminders (reminderAt <= now, sentAt not set). Safe for cron: each reminder gets sentAt only after successful send, so no double-send.
app.post('/api/calendar-reminders/send-due', async (req, res) => {
  try {
    const result = await sendDueCalendarReminders()
    if (result.error && result.sent === 0) {
      return res.status(503).json({ sent: 0, error: result.error })
    }
    res.json(result)
  } catch (err) {
    logError('SMTP', 'Failed to send due calendar reminders', err)
    res.status(500).json({ error: 'Failed to send due calendar reminders' })
  }
})

// Test SMTP — always return HTML so browser shows something; API clients can use Accept: application/json
function htmlPage(title, body) {
  const safe = (s) => String(s).replace(/</g, '&lt;').replace(/&/g, '&amp;')
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${safe(title)}</title></head><body style="font-family:system-ui,sans-serif;max-width:32em;margin:2rem auto;padding:0 1rem;"><h1>${safe(title)}</h1><p>${safe(body)}</p></body></html>`
}
app.get('/api/test-email', async (req, res) => {
  const wantsJson = req && req.get && /application\/json/i.test(req.get('Accept'))
  const to = REMINDER_EMAIL_TO || INQUIRY_NOTIFY_EMAIL || SMTP_USER
  if (!reminderTransporter || !to) {
    const body = 'SMTP not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS (and REMINDER_EMAIL_TO or SMTP_USER) on Render.'
    if (wantsJson) return res.status(503).json({ ok: false, error: body })
    return res.status(503).set('Content-Type', 'text/html; charset=utf-8').send(htmlPage('SMTP not configured', body))
  }
  try {
    await reminderTransporter.sendMail({
      from: SMTP_FROM,
      to,
      subject: 'Aurora Sonnet — test email',
      text: 'If you got this, inquiry notification emails are working.',
    })
    const message = 'Test email sent to ' + to
    if (wantsJson) return res.json({ ok: true, message })
    return res.set('Content-Type', 'text/html; charset=utf-8').send(htmlPage('Test email sent', message))
  } catch (err) {
    logError('SMTP', 'Test email failed', err)
    const msg = err.response ? `${err.message} ${err.response}` : (err.message || String(err))
    if (wantsJson) return res.status(500).json({ ok: false, error: msg })
    return res.status(500).set('Content-Type', 'text/html; charset=utf-8').send(htmlPage('SMTP error', msg))
  }
})

app.post('/api/seed', (req, res) => {
  try {
    const state = getState()
    const empty =
      state.clients.length === 0 &&
      state.projects.length === 0 &&
      state.proposals.length === 0 &&
      state.invoices.length === 0 &&
      state.contracts.length === 0 &&
      state.expenses.length === 0
    if (!empty) return res.status(400).json({ error: 'Database already has data. Seed only runs on empty DB.' })
    seedDb({
      clients: seedClients,
      projects: seedProjects,
      proposals: seedProposals,
      invoices: seedInvoices,
      contracts: seedContracts,
      expenses: seedExpenses,
    })
    res.json(getState())
  } catch (err) {
    logError('DB', 'Failed to seed', err)
    res.status(500).json({ error: 'Failed to seed' })
  }
})

// --- Stripe ---
app.get('/api/payment-status', (req, res) => {
  try {
    const payments = readPayments()
    res.json(payments)
  } catch (err) {
    logError('API', 'Failed to read payment status', err)
    res.status(500).json({ error: 'Failed to read payment status' })
  }
})

app.get('/api/settings/stripe', (req, res) => {
  res.json({ configured: !!process.env.STRIPE_SECRET_KEY })
})

app.post('/api/settings/stripe', (req, res) => {
  try {
    const { stripeSecretKey, stripeWebhookSecret } = req.body
    if (!stripeSecretKey || typeof stripeSecretKey !== 'string') {
      return res.status(400).json({ error: 'Stripe Secret Key is required' })
    }
    const key = stripeSecretKey.trim()
    if (key.startsWith('pk_')) {
      return res.status(400).json({
        error: 'That looks like a Publishable key (pk_...). Use your Secret key (sk_...) instead. Find it at dashboard.stripe.com/apikeys',
      })
    }
    if (!key.startsWith('sk_')) {
      return res.status(400).json({
        error: 'Stripe Secret Key should start with sk_ (e.g. sk_test_... or sk_live_...). Check dashboard.stripe.com/apikeys',
      })
    }
    const envPath = join(dataDir, '.env')
    const existing = readEnvLines()
    const stripeLines = [
      `STRIPE_SECRET_KEY=${stripeSecretKey.trim()}`,
      stripeWebhookSecret && typeof stripeWebhookSecret === 'string'
        ? `STRIPE_WEBHOOK_SECRET=${stripeWebhookSecret.trim()}`
        : '',
    ].filter(Boolean)
    const other = existing.filter((line) => !line.startsWith('STRIPE_SECRET_KEY=') && !line.startsWith('STRIPE_WEBHOOK_SECRET='))
    writeFileSync(envPath, [...other, ...stripeLines].join('\n') + '\n')
    stripeSecret = key
    stripe = new Stripe(stripeSecret)
    res.json({ ok: true })
  } catch (err) {
    logError('API', 'Failed to save Stripe settings', err)
    res.status(500).json({ error: err.message || 'Failed to save Stripe settings' })
  }
})

function readEnvLines() {
  const envPath = join(dataDir, '.env')
  if (!existsSync(envPath)) return []
  return readFileSync(envPath, 'utf8').split(/\r?\n/).filter(Boolean)
}
function writeEnvWithAppUrl(publicAppUrl) {
  const envPath = join(dataDir, '.env')
  const lines = readEnvLines()
  const key = 'APP_URL'
  const newLine = `${key}=${String(publicAppUrl).trim()}`
  const rest = lines.filter((line) => !line.startsWith(key + '='))
  const out = [...rest, newLine].join('\n') + '\n'
  writeFileSync(envPath, out)
  process.env.APP_URL = String(publicAppUrl).trim()
}

app.get('/api/settings/public-url', (req, res) => {
  res.json({ publicAppUrl: process.env.APP_URL || '' })
})

app.post('/api/settings/public-url', (req, res) => {
  try {
    const { publicAppUrl } = req.body
    const url = typeof publicAppUrl === 'string' ? publicAppUrl.trim() : ''
    writeEnvWithAppUrl(url)
    res.json({ ok: true, publicAppUrl: url })
  } catch (err) {
    logError('API', 'Failed to save public URL', err)
    res.status(500).json({ error: err.message || 'Failed to save' })
  }
})

app.post('/api/confirm-payment', async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'Stripe not configured' })
  const { sessionId } = req.body
  if (!sessionId) return res.status(400).json({ error: 'sessionId required' })
  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId)
    if (session.payment_status === 'paid' && session.metadata?.invoiceId) {
      const paidAt = new Date().toISOString().slice(0, 10)
      writePayment(session.metadata.invoiceId, paidAt)
    }
    res.json({ ok: true })
  } catch (err) {
    logError('Stripe', 'Failed to confirm payment', err)
    res.status(500).json({ error: err.message || 'Failed to confirm payment' })
  }
})

// --- Document templates (contract & invoice PDFs) ---
function nextTemplateId(prefix, existing) {
  const nums = existing.map((x) => parseInt(x.id.replace(/\D/g, ''), 10)).filter((n) => !isNaN(n))
  const max = nums.length ? Math.max(...nums, 0) : 0
  return `${prefix}${max + 1}`
}

app.post('/api/templates/contracts', (req, res) => {
  try {
    const state = getState()
    const id = nextTemplateId('ct', state.contractTemplates)
    const { name, fileBase64, contentHtml } = req.body
    if (!name || typeof name !== 'string') {
      return res.status(400).json({ error: 'name required' })
    }
    const isEditorTemplate = contentHtml != null && typeof contentHtml === 'string'
    if (!isEditorTemplate && (!fileBase64 || typeof fileBase64 !== 'string')) {
      return res.status(400).json({ error: 'fileBase64 (PDF) or contentHtml required' })
    }
    if (isEditorTemplate) {
      createContractTemplate({
        id,
        name: name.trim(),
        fileName: '',
        createdAt: new Date().toISOString(),
        contentHtml: contentHtml || null,
      })
    } else {
      ensureTemplatesDirs()
      const fileName = `${id}.pdf`
      const filePath = join(TEMPLATES_CONTRACTS_DIR, fileName)
      const buf = Buffer.from(fileBase64, 'base64')
      writeFileSync(filePath, buf)
      createContractTemplate({
        id,
        name: name.trim(),
        fileName,
        createdAt: new Date().toISOString(),
      })
    }
    res.json({ id })
  } catch (err) {
    logError('API', 'Failed to save contract template', err)
    res.status(500).json({ error: err.message || 'Failed to save template' })
  }
})

app.get('/api/templates/contracts/:id/file', (req, res) => {
  try {
    const state = getState()
    const t = state.contractTemplates.find((x) => x.id === req.params.id)
    if (!t) return res.status(404).json({ error: 'Template not found' })
    if (!t.fileName) return res.status(404).json({ error: 'Editor template has no PDF file' })
    const filePath = join(TEMPLATES_CONTRACTS_DIR, t.fileName)
    if (!existsSync(filePath)) return res.status(404).json({ error: 'File not found' })
    res.setHeader('Content-Type', 'application/pdf')
    res.send(readFileSync(filePath))
  } catch (err) {
    logError('API', 'Failed to read contract template file', err)
    res.status(500).json({ error: 'Failed to read file' })
  }
})

app.patch('/api/templates/contracts/:id', (req, res) => {
  try {
    const { name, contentHtml } = req.body
    if (name !== undefined && typeof name !== 'string') return res.status(400).json({ error: 'Invalid name' })
    if (contentHtml !== undefined && typeof contentHtml !== 'string') return res.status(400).json({ error: 'Invalid contentHtml' })
    updateContractTemplate(req.params.id, { name, contentHtml })
    res.json({ ok: true })
  } catch (err) {
    logError('DB', 'Failed to update contract template', err)
    res.status(500).json({ error: err.message || 'Failed to update' })
  }
})

app.put('/api/templates/contracts/:id/file', (req, res) => {
  try {
    const state = getState()
    const t = state.contractTemplates.find((x) => x.id === req.params.id)
    if (!t) return res.status(404).json({ error: 'Template not found' })
    const { fileBase64 } = req.body
    if (!fileBase64 || typeof fileBase64 !== 'string') return res.status(400).json({ error: 'fileBase64 required' })
    ensureTemplatesDirs()
    const filePath = join(TEMPLATES_CONTRACTS_DIR, t.fileName)
    const buf = Buffer.from(fileBase64, 'base64')
    writeFileSync(filePath, buf)
    res.json({ ok: true })
  } catch (err) {
    logError('API', 'Failed to replace contract template file', err)
    res.status(500).json({ error: err.message || 'Failed to replace file' })
  }
})

app.delete('/api/templates/contracts/:id', (req, res) => {
  try {
    const state = getState()
    const t = state.contractTemplates.find((x) => x.id === req.params.id)
    if (t) {
      const filePath = join(TEMPLATES_CONTRACTS_DIR, t.fileName)
      if (existsSync(filePath)) unlinkSync(filePath)
    }
    deleteContractTemplate(req.params.id)
    res.json({ ok: true })
  } catch (err) {
    logError('API', 'Failed to delete contract template', err)
    res.status(500).json({ error: err.message || 'Failed to delete' })
  }
})

app.post('/api/templates/invoices', (req, res) => {
  try {
    const state = getState()
    const id = nextTemplateId('it', state.invoiceTemplates)
    const { name, fileBase64 } = req.body
    if (!name || typeof name !== 'string' || !fileBase64 || typeof fileBase64 !== 'string') {
      return res.status(400).json({ error: 'name and fileBase64 (PDF) required' })
    }
    ensureTemplatesDirs()
    const fileName = `${id}.pdf`
    const filePath = join(TEMPLATES_INVOICES_DIR, fileName)
    const buf = Buffer.from(fileBase64, 'base64')
    writeFileSync(filePath, buf)
    createInvoiceTemplate({
      id,
      name: name.trim(),
      fileName,
      createdAt: new Date().toISOString(),
    })
    res.json({ id })
  } catch (err) {
    logError('API', 'Failed to save invoice template', err)
    res.status(500).json({ error: err.message || 'Failed to save template' })
  }
})

app.get('/api/templates/invoices/:id/file', (req, res) => {
  try {
    const state = getState()
    const t = state.invoiceTemplates.find((x) => x.id === req.params.id)
    if (!t) return res.status(404).json({ error: 'Template not found' })
    const filePath = join(TEMPLATES_INVOICES_DIR, t.fileName)
    if (!existsSync(filePath)) return res.status(404).json({ error: 'File not found' })
    res.setHeader('Content-Type', 'application/pdf')
    res.send(readFileSync(filePath))
  } catch (err) {
    logError('API', 'Failed to read invoice template file', err)
    res.status(500).json({ error: 'Failed to read file' })
  }
})

app.patch('/api/templates/invoices/:id', (req, res) => {
  try {
    const { name } = req.body
    if (name !== undefined && typeof name !== 'string') return res.status(400).json({ error: 'Invalid name' })
    if (name !== undefined && !String(name).trim()) return res.status(400).json({ error: 'Template name cannot be empty' })
    updateInvoiceTemplate(req.params.id, { name })
    res.json({ ok: true })
  } catch (err) {
    logError('DB', 'Failed to update invoice template', err)
    res.status(500).json({ error: err.message || 'Failed to update' })
  }
})

app.put('/api/templates/invoices/:id/file', (req, res) => {
  try {
    const state = getState()
    const t = state.invoiceTemplates.find((x) => x.id === req.params.id)
    if (!t) return res.status(404).json({ error: 'Template not found' })
    const { fileBase64 } = req.body
    if (!fileBase64 || typeof fileBase64 !== 'string') return res.status(400).json({ error: 'fileBase64 required' })
    ensureTemplatesDirs()
    const filePath = join(TEMPLATES_INVOICES_DIR, t.fileName)
    const buf = Buffer.from(fileBase64, 'base64')
    writeFileSync(filePath, buf)
    res.json({ ok: true })
  } catch (err) {
    logError('API', 'Failed to replace invoice template file', err)
    res.status(500).json({ error: err.message || 'Failed to replace file' })
  }
})

app.delete('/api/templates/invoices/:id', (req, res) => {
  try {
    const state = getState()
    const t = state.invoiceTemplates.find((x) => x.id === req.params.id)
    if (t) {
      const filePath = join(TEMPLATES_INVOICES_DIR, t.fileName)
      if (existsSync(filePath)) unlinkSync(filePath)
    }
    deleteInvoiceTemplate(req.params.id)
    res.json({ ok: true })
  } catch (err) {
    logError('API', 'Failed to delete invoice template', err)
    res.status(500).json({ error: err.message || 'Failed to delete' })
  }
})

// Pipeline stages (customizable booking pipeline columns)
app.post('/api/pipeline-stages', (req, res) => {
  try {
    const { label } = req.body
    if (!label || typeof label !== 'string' || !label.trim()) {
      return res.status(400).json({ error: 'label is required' })
    }
    const state = getState()
    const maxOrder = state.pipelineStages.length
      ? Math.max(...state.pipelineStages.map((s) => s.sortOrder), 0)
      : 0
    const id = `stage_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
    createPipelineStage({ id, label: label.trim(), sortOrder: maxOrder + 1 })
    res.status(201).json(getState().pipelineStages.find((s) => s.id === id))
  } catch (err) {
    logError('DB', 'Failed to create pipeline stage', err)
    res.status(500).json({ error: err.message || 'Failed to create pipeline stage' })
  }
})

app.patch('/api/pipeline-stages/:id', (req, res) => {
  try {
    const state = getState()
    const stage = state.pipelineStages.find((s) => s.id === req.params.id)
    if (!stage) return res.status(404).json({ error: 'Pipeline stage not found' })
    const { label, sortOrder } = req.body
    const updates = {}
    if (typeof label === 'string' && label.trim()) updates.label = label.trim()
    if (typeof sortOrder === 'number') updates.sortOrder = sortOrder
    if (Object.keys(updates).length) updatePipelineStage(req.params.id, updates)
    const updated = getState().pipelineStages.find((s) => s.id === req.params.id)
    res.json(updated)
  } catch (err) {
    logError('DB', 'Failed to update pipeline stage', err)
    res.status(500).json({ error: err.message || 'Failed to update pipeline stage' })
  }
})

app.delete('/api/pipeline-stages/:id', (req, res) => {
  try {
    const state = getState()
    const stage = state.pipelineStages.find((s) => s.id === req.params.id)
    if (!stage) return res.status(404).json({ error: 'Pipeline stage not found' })
    if (state.pipelineStages.length <= 1) {
      return res.status(400).json({ error: 'Cannot delete the last pipeline stage' })
    }
    deletePipelineStage(req.params.id)
    res.json({ ok: true })
  } catch (err) {
    logError('DB', 'Failed to delete pipeline stage', err)
    res.status(500).json({ error: err.message || 'Failed to delete pipeline stage' })
  }
})

app.post('/api/create-checkout-session', async (req, res) => {
  if (!stripe) {
    return res.status(503).json({
      error: 'Stripe is not configured. Go to Settings to add your Stripe keys.',
    })
  }
  if (stripeSecret && stripeSecret.startsWith('pk_')) {
    return res.status(503).json({
      error: 'Wrong key type: the app is using a Publishable key (pk_...). In Settings → Stripe, paste your Secret key (sk_...) from dashboard.stripe.com/apikeys',
    })
  }
  const { invoiceId, amount, clientEmail, description } = req.body
  if (!invoiceId || amount == null || amount < 0) {
    return res.status(400).json({ error: 'invoiceId and amount (in dollars) are required' })
  }
  const amountCents = Math.round(Number(amount) * 100)
  if (amountCents < 50) {
    return res.status(400).json({ error: 'Amount must be at least $0.50' })
  }
  const origin = req.headers.origin || `http://localhost:${PORT}`
  const successUrl = `${origin}/invoices?payment_success=1&invoice_id=${encodeURIComponent(invoiceId)}&session_id={CHECKOUT_SESSION_ID}`
  const cancelUrl = `${origin}/invoices?payment_cancelled=1`

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: description || 'Invoice payment',
              description: `Invoice ${invoiceId}`,
            },
            unit_amount: amountCents,
          },
          quantity: 1,
        },
      ],
      metadata: { invoiceId },
      success_url: successUrl,
      cancel_url: cancelUrl,
      ...(clientEmail && { customer_email: clientEmail }),
    })
    res.json({ url: session.url })
  } catch (err) {
    logError('Stripe', 'Failed to create checkout session', err)
    res.status(500).json({ error: err.message || 'Failed to create checkout session' })
  }
})

// Serve built frontend in production (after all API routes). SPA fallback: non-API GET gets index.html.
const distPath = join(__dirname, '..', 'dist')
if (existsSync(distPath)) {
  app.use(express.static(distPath, {
    maxAge: 0,
    etag: true,
    lastModified: true,
  }))
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next()
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate')
    res.setHeader('Pragma', 'no-cache')
    res.sendFile(join(distPath, 'index.html'), (err) => {
      if (err) next(err)
    })
  })
}

/** Poll Render for proposal status changes (e.g. client accepted) and update local DB.
 *  Only runs on non-Render instances (Mac app / local dev) so it doesn't poll itself. */
async function pollRemoteProposalStatuses() {
  if (isRender) return { updated: 0 }
  const remoteBase = (process.env.APP_URL || 'https://aurora-sonnet-1.onrender.com').replace(/\/$/, '')
  if (!remoteBase || remoteBase.startsWith('http://localhost')) return { updated: 0 }
  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 15000)
    const res = await fetch(`${remoteBase}/api/state`, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    }).finally(() => clearTimeout(timeoutId))
    if (!res.ok) return { updated: 0 }
    const remote = await res.json()
    const remoteProposals = remote.proposals || []
    const local = getState()
    let updated = 0
    for (const rp of remoteProposals) {
      const lp = (local.proposals || []).find((p) => p.id === rp.id)
      if (!lp) continue
      if (lp.status !== 'accepted' && rp.status === 'accepted') {
        updateProposal(lp.id, {
          status: 'accepted',
          value: rp.value ?? lp.value,
          acceptedEnhancements: rp.acceptedEnhancements ?? lp.acceptedEnhancements,
        })
        if (lp.projectId) {
          updateProject(lp.projectId, { value: rp.value ?? lp.value })
        }
        updated++
        console.log(`[Sync] Proposal ${lp.id} marked as accepted (from remote)`)
      }
    }
    return { updated }
  } catch {
    return { updated: 0 }
  }
}

/** One-time migration: remove static "Date: ____" lines from contract template HTML (signature date is captured at sign time). */
function stripDateLinesFromContractTemplates() {
  const state = getState()
  for (const t of state.contractTemplates || []) {
    const html = t.contentHtml
    if (!html || typeof html !== 'string') continue
    const cleaned = html.replace(/<p>Date:\s*[_.\s\-]+<\/p>/gi, '').replace(/(<p>\s*<\/p>){2,}/g, '<p></p>').trim()
    if (cleaned !== html) {
      updateContractTemplate(t.id, { contentHtml: cleaned })
    }
  }
}

app.listen(PORT, () => {
  console.log(`Aurora Sonnet API running on http://localhost:${PORT}`)
  if (existsSync(distPath)) console.log('Serving frontend from /dist')
  if (!stripeSecret) console.log('Warning: STRIPE_SECRET_KEY not set. Payment endpoints will return 503.')
  logSmtpStatus()
  stripDateLinesFromContractTemplates()
  const initialFinalInvoices = ensureDueFinalInvoices()
  if (initialFinalInvoices.created > 0) {
    console.log(`Created ${initialFinalInvoices.created} final invoice(s) due within 30 days`)
  }
  const initialCalendarDates = ensureSecuredBookingCalendarDates()
  if (initialCalendarDates.created > 0) {
    console.log(`Created ${initialCalendarDates.created} secured-booking calendar reminder(s)`)
  }
  const FINAL_INVOICE_INTERVAL_MS = 24 * 60 * 60 * 1000
  setInterval(() => {
    const { created } = ensureDueFinalInvoices()
    if (created > 0) console.log(`Created ${created} final invoice(s) due within 30 days`)
  }, FINAL_INVOICE_INTERVAL_MS)
  console.log('Final invoice automation: will check every 24 hours')
  setInterval(() => {
    const { created } = ensureSecuredBookingCalendarDates()
    if (created > 0) console.log(`Created ${created} secured-booking calendar reminder(s)`)
  }, FINAL_INVOICE_INTERVAL_MS)
  console.log('Secured booking calendar automation: will check every 24 hours')
  // Poll Render for accepted proposals every 60 seconds (Mac app only)
  if (!isRender) {
    const PROPOSAL_POLL_MS = 60 * 1000
    pollRemoteProposalStatuses().then(({ updated }) => {
      if (updated > 0) console.log(`[Sync] Updated ${updated} proposal(s) from remote on startup`)
    }).catch(() => {})
    setInterval(() => {
      pollRemoteProposalStatuses().catch(() => {})
    }, PROPOSAL_POLL_MS)
    console.log('Proposal status sync: polling remote every 60 seconds')
  }
  // Send due calendar reminder emails every 15 minutes when SMTP is configured
  if (reminderTransporter) {
    const REMINDER_INTERVAL_MS = 15 * 60 * 1000
    setInterval(() => {
      sendDueCalendarReminders().then(({ sent }) => {
        if (sent > 0) console.log(`Sent ${sent} calendar reminder email(s)`)
      })
    }, REMINDER_INTERVAL_MS)
    console.log('Calendar reminder emails: will check every 15 minutes')
    // Automated overdue invoice "please pay" reminders once per day (throttled: max once per 5 days per invoice)
    const OVERDUE_INTERVAL_MS = 24 * 60 * 60 * 1000
    setInterval(() => {
      sendOverdueInvoiceReminders().then(({ sent }) => {
        if (sent > 0) console.log(`Sent ${sent} overdue invoice reminder(s)`)
      })
    }, OVERDUE_INTERVAL_MS)
    console.log('Overdue invoice reminders: will check every 24 hours')
  }
})
