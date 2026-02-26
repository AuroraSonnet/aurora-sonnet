import express from 'express'
import Stripe from 'stripe'
import { PDFDocument } from 'pdf-lib'
import nodemailer from 'nodemailer'
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import dotenv from 'dotenv'
import {
  getState,
  createClient,
  updateClient,
  deleteClient,
  restoreClient,
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
  seedDb,
  getNextClientId,
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

function logSmtpStatus() {
  if (reminderTransporter && (REMINDER_EMAIL_TO || SMTP_USER)) {
    console.log('SMTP: configured — inquiry and reminder emails enabled')
  } else {
    const where = process.env.DATA_DIR
      ? `For the Mac app, put a .env file in: ${process.env.DATA_DIR}`
      : `Put SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS in server/.env`
    console.log('SMTP: not configured — inquiry and reminder emails disabled.', where)
  }
}

const dataDir = process.env.DATA_DIR || __dirname
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
  if (!reminderTransporter || !REMINDER_EMAIL_TO) return { sent: 0 }
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
      console.error('Failed to send reminder email', err)
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
  const payments = readPayments()
  payments[invoiceId] = paidAt
  writeFileSync(PAYMENTS_FILE, JSON.stringify(payments, null, 2))
}

// Security headers (help prevent XSS, clickjacking, MIME sniffing)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('X-XSS-Protection', '1; mode=block')
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  next()
})

// CORS: allow Vite dev, optional frontend origin, aurorasonnet.com (embed form), and public API endpoints (/api/state, /api/inquiry) from any HTTPS origin
const frontendOrigin = process.env.FRONTEND_ORIGIN
const allowedOrigins = [
  frontendOrigin,
  'https://aurorasonnet.com',
  'https://www.aurorasonnet.com',
].filter(Boolean)
app.use((req, res, next) => {
  const origin = req.headers.origin
  const isStateGet = req.method === 'GET' && req.path === '/api/state'
  const isInquiry = req.path === '/api/inquiry'
  const allow =
    (origin && (origin.includes('localhost') || origin.includes('127.0.0.1'))) ||
    (origin && allowedOrigins.includes(origin)) ||
    // Allow any HTTPS origin for public endpoints so the form can live on any site
    (origin && origin.startsWith('https://') && (isStateGet || isInquiry))
  if (allow) res.setHeader('Access-Control-Allow-Origin', origin)
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
      return res.status(400).send(`Webhook signature verification failed: ${err.message}`)
    }
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object
      const invoiceId = session.metadata?.invoiceId
      if (invoiceId) {
        const paidAt = new Date().toISOString().slice(0, 10)
        writePayment(invoiceId, paidAt)
      }
    }
    res.json({ received: true })
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
    console.error('Failed to send inquiry notification email:', msg)
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
    const state = getState()
    const emailLower = email.toLowerCase()
    const existingClient = state.clients.find((c) => (c.email || '').toLowerCase() === emailLower)
    // Use DB-based id generator so we never reuse ids of soft-deleted clients
    const clientId = existingClient ? existingClient.id : getNextClientId()
    const projectId = nextId('p', state.projects)
    const today = new Date().toISOString().slice(0, 10)
    const weddingDate = (body.weddingDate || '').trim() || today
    const venue = (body.venue || '').trim() || undefined
    const packageId = body.packageId || undefined
    const value = packageId && PACKAGE_PRICES[packageId] != null ? PACKAGE_PRICES[packageId] : 0
    const isGeneral = !venue && !packageId
    const title = isGeneral ? 'General inquiry' : (venue ? `${venue} Wedding` : 'Wedding inquiry')

    // Only create a new contact when this email is not already on the Contacts page
    if (!existingClient) {
      createClient({
        id: clientId,
        name,
        email,
        phone: (body.phone || '').trim() || undefined,
        partnerName: undefined,
        createdAt: today,
      })
    }
    const inquiryMessage = (body.message || '').trim() || undefined
    const requestedArtist = (body.requestedArtist || '').trim() || undefined
    createProject({
      id: projectId,
      clientId,
      clientName: name,
      title,
      stage: 'inquiry',
      value,
      weddingDate,
      venue: venue || undefined,
      packageType: packageId || undefined,
      dueDate: weddingDate,
      createdAt: today,
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
      console.error('Inquiry notification error (non-blocking):', err?.message || String(err))
    })

    if (nextUrl) {
      return res.redirect(303, nextUrl)
    }
    return res.status(201).json({ clientId, projectId })
  } catch (err) {
    console.error(err)
    const body = req.body || {}
    const rawNext = (body._next != null && body._next !== '') ? String(body._next).trim() : null
    const nextUrl = isAllowedRedirectUrl(rawNext) ? rawNext : null
    if (nextUrl) {
      return res.redirect(303, nextUrl + (nextUrl.includes('?') ? '&' : '?') + 'error=server')
    }
    return res.status(500).json({ error: 'Failed to create inquiry' })
  }
})

// --- SQLite API (full state + CRUD) ---
app.get('/api/state', (req, res) => {
  try {
    res.json(getState())
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to load state' })
  }
})

app.post('/api/clients', (req, res) => {
  try {
    const { id, name, email, phone, partnerName, createdAt } = req.body
    if (!id || !name || !email || !createdAt) return res.status(400).json({ error: 'Missing fields' })
    createClient({ id, name, email, phone, partnerName, createdAt })
    res.json({ id })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to create client' })
  }
})

app.patch('/api/clients/:id', (req, res) => {
  try {
    updateClient(req.params.id, req.body)
    res.json({ ok: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to update client' })
  }
})

app.delete('/api/clients/:id', (req, res) => {
  try {
    deleteClient(req.params.id)
    res.json({ ok: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to delete client' })
  }
})

app.post('/api/clients/:id/restore', (req, res) => {
  try {
    restoreClient(req.params.id)
    res.json({ ok: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to restore client' })
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
    console.error(err)
    res.status(500).json({ error: 'Failed to create project' })
  }
})

app.patch('/api/projects/:id', (req, res) => {
  try {
    updateProject(req.params.id, req.body)
    res.json({ ok: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to update project' })
  }
})

app.delete('/api/projects/:id', (req, res) => {
  try {
    deleteProject(req.params.id)
    res.json({ ok: true })
  } catch (err) {
    console.error(err)
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
    console.error(err)
    res.status(500).json({ error: 'Failed to create proposal' })
  }
})

app.patch('/api/proposals/:id', (req, res) => {
  try {
    updateProposal(req.params.id, req.body)
    res.json({ ok: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to update proposal' })
  }
})

app.delete('/api/proposals/:id', (req, res) => {
  try {
    deleteProposal(req.params.id)
    res.json({ ok: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to delete proposal' })
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
    console.error(err)
    res.status(500).json({ error: 'Failed to create contract' })
  }
})

app.patch('/api/contracts/:id', (req, res) => {
  try {
    updateContract(req.params.id, req.body)
    res.json({ ok: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to update contract' })
  }
})

function loadContractPdfBuffer(contract) {
  const signedPath = join(CONTRACTS_DIR, `${contract.id}.pdf`)
  if (existsSync(signedPath)) return readFileSync(signedPath)
  const templateId = contract.templateId
  if (!templateId) return null
  const state = getState()
  const t = state.contractTemplates.find((x) => x.id === templateId)
  if (!t) return null
  const templatePath = join(TEMPLATES_CONTRACTS_DIR, t.fileName)
  if (!existsSync(templatePath)) return null
  return readFileSync(templatePath)
}

async function stampSignature(pdfBuffer, signatureDataUrl, label) {
  const pdf = await PDFDocument.load(pdfBuffer)
  const pages = pdf.getPages()
  if (pages.length === 0) return pdf.save()
  const page = pages[pages.length - 1]
  const { width, height } = page.getSize()
  const base64 = signatureDataUrl.replace(/^data:image\/png;base64,/, '')
  const imgBytes = Buffer.from(base64, 'base64')
  const img = await pdf.embedPng(imgBytes)
  const imgW = Math.min(120, img.width)
  const imgH = (img.height / img.width) * imgW
  const x = width - imgW - 40
  const y = 40
  page.drawImage(img, { x, y, width: imgW, height: imgH })
  page.drawText(label || '', { x, y: y - 14, size: 9, color: { type: 'RGB', red: 0.4, green: 0.4, blue: 0.4 } })
  return pdf.save()
}

app.get('/api/contracts/:id/file', (req, res) => {
  try {
    const state = getState()
    const contract = state.contracts.find((c) => c.id === req.params.id)
    if (!contract) return res.status(404).json({ error: 'Contract not found' })
    const buf = loadContractPdfBuffer(contract)
    if (!buf) return res.status(404).json({ error: 'Contract PDF not available' })
    res.setHeader('Content-Type', 'application/pdf')
    res.send(buf)
  } catch (err) {
    console.error(err)
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
    console.error(err)
    res.status(500).json({ error: err.message || 'Failed to save contract file' })
  }
})

app.get('/api/contracts/:id/sign-info', (req, res) => {
  try {
    const { token } = req.query
    const state = getState()
    const contract = state.contracts.find((c) => c.id === req.params.id)
    if (!contract) return res.status(404).json({ error: 'Contract not found' })
    if (contract.status !== 'sent' || !contract.signToken || contract.signToken !== token) {
      return res.status(403).json({ error: 'Invalid or expired signing link' })
    }
    if (contract.clientSignedAt) {
      return res.json({ ...contract, awaiting: 'vendor', message: 'Client has signed. Awaiting vendor signature.' })
    }
    res.json({ ...contract, awaiting: 'client', message: 'Please sign below.' })
  } catch (err) {
    console.error(err)
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
    const buf = loadContractPdfBuffer(contract)
    if (!buf) return res.status(400).json({ error: 'Contract PDF not available' })
    ensureContractsDir()
    const signedPdf = await stampSignature(buf, signatureDataUrl, `${contract.clientName} (Client)`)
    writeFileSync(join(CONTRACTS_DIR, `${contract.id}.pdf`), signedPdf)
    const clientSignedAt = new Date().toISOString().slice(0, 10)
    updateContract(contract.id, { clientSignedAt })
    res.json({ ok: true, clientSignedAt })
  } catch (err) {
    console.error(err)
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
    const buf = loadContractPdfBuffer(contract)
    if (!buf) return res.status(400).json({ error: 'Contract PDF not available' })
    ensureContractsDir()
    const signedPdf = await stampSignature(buf, signatureDataUrl, 'Aurora Sonnet (Vendor)')
    writeFileSync(join(CONTRACTS_DIR, `${contract.id}.pdf`), signedPdf)
    const signedAt = new Date().toISOString().slice(0, 10)
    updateContract(contract.id, { status: 'signed', signedAt })
    res.json({ ok: true, signedAt })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: err.message || 'Failed to sign' })
  }
})

app.delete('/api/contracts/:id', (req, res) => {
  try {
    deleteContract(req.params.id)
    res.json({ ok: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to delete contract' })
  }
})

app.post('/api/invoices', (req, res) => {
  try {
    const i = req.body
    if (!i.id || !i.clientName || !i.projectTitle || i.amount == null || !i.status || !i.dueDate)
      return res.status(400).json({ error: 'Missing fields' })
    createInvoice(i)
    res.json({ id: i.id })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to create invoice' })
  }
})

app.patch('/api/invoices/:id', (req, res) => {
  try {
    updateInvoice(req.params.id, req.body)
    res.json({ ok: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to update invoice' })
  }
})

app.delete('/api/invoices/:id', (req, res) => {
  try {
    deleteInvoice(req.params.id)
    res.json({ ok: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to delete invoice' })
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
    console.error(err)
    res.status(500).json({ error: 'Failed to create expense' })
  }
})

app.delete('/api/expenses/:id', (req, res) => {
  try {
    deleteExpense(req.params.id)
    res.json({ ok: true })
  } catch (err) {
    console.error(err)
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
    console.error(err)
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
    console.error(err)
    res.status(500).json({ error: 'Failed to update calendar reminder' })
  }
})

app.delete('/api/calendar-reminders/:id', (req, res) => {
  try {
    deleteCalendarReminder(req.params.id)
    res.json({ ok: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to delete calendar reminder' })
  }
})

app.post('/api/calendar-reminders/send-due', async (req, res) => {
  try {
    const result = await sendDueCalendarReminders()
    res.json(result)
  } catch (err) {
    console.error(err)
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
    console.error(err)
    res.status(500).json({ error: 'Failed to seed' })
  }
})

// --- Stripe ---
app.get('/api/payment-status', (req, res) => {
  try {
    const payments = readPayments()
    res.json(payments)
  } catch (err) {
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
    const envPath = join(dataDir, '.env')
    const lines = [
      `STRIPE_SECRET_KEY=${stripeSecretKey.trim()}`,
      stripeWebhookSecret && typeof stripeWebhookSecret === 'string'
        ? `STRIPE_WEBHOOK_SECRET=${stripeWebhookSecret.trim()}`
        : '',
    ].filter(Boolean)
    writeFileSync(envPath, lines.join('\n') + '\n')
    stripeSecret = stripeSecretKey.trim()
    stripe = new Stripe(stripeSecret)
    res.json({ ok: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: err.message || 'Failed to save Stripe settings' })
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
    console.error(err)
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
    console.error(err)
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
    console.error(err)
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
    console.error(err)
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
    console.error(err)
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
    console.error(err)
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
    console.error(err)
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
    console.error(err)
    res.status(500).json({ error: 'Failed to read file' })
  }
})

app.patch('/api/templates/invoices/:id', (req, res) => {
  try {
    const { name } = req.body
    if (name !== undefined && typeof name !== 'string') return res.status(400).json({ error: 'Invalid name' })
    updateInvoiceTemplate(req.params.id, { name })
    res.json({ ok: true })
  } catch (err) {
    console.error(err)
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
    console.error(err)
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
    console.error(err)
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
    console.error(err)
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
    console.error(err)
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
    console.error(err)
    res.status(500).json({ error: err.message || 'Failed to delete pipeline stage' })
  }
})

app.post('/api/create-checkout-session', async (req, res) => {
  if (!stripe) {
    return res.status(503).json({
      error: 'Stripe is not configured. Go to Settings to add your Stripe keys.',
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
    console.error('Stripe error:', err.message)
    res.status(500).json({ error: err.message || 'Failed to create checkout session' })
  }
})

// Serve built frontend in production (after all API routes)
const distPath = join(__dirname, '..', 'dist')
if (existsSync(distPath)) {
  app.use(express.static(distPath))
  app.get('*', (req, res) => res.sendFile(join(distPath, 'index.html')))
}

app.listen(PORT, () => {
  console.log(`Aurora Sonnet API running on http://localhost:${PORT}`)
  if (existsSync(distPath)) console.log('Serving frontend from /dist')
  if (!stripeSecret) console.log('Warning: STRIPE_SECRET_KEY not set. Payment endpoints will return 503.')
  logSmtpStatus()
  // Send due calendar reminder emails every 15 minutes when SMTP is configured
  if (reminderTransporter) {
    const REMINDER_INTERVAL_MS = 15 * 60 * 1000
    setInterval(() => {
      sendDueCalendarReminders().then(({ sent }) => {
        if (sent > 0) console.log(`Sent ${sent} calendar reminder email(s)`)
      })
    }, REMINDER_INTERVAL_MS)
    console.log('Calendar reminder emails: will check every 15 minutes')
  }
})
