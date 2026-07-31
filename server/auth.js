import session from 'express-session'
import bcrypt from 'bcryptjs'
import { randomBytes, createHash } from 'node:crypto'
import { Store } from 'express-session'
import db from './db.js'

const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000 // 24-hour sliding window
const LOGIN_RATE_WINDOW_MS = 15 * 60 * 1000
const LOGIN_RATE_MAX = 10
const PASSWORD_RESET_TOKEN_TTL_MS = 30 * 60 * 1000 // 30 minutes
const FORGOT_PASSWORD_RATE_WINDOW_MS = 60 * 60 * 1000
const FORGOT_PASSWORD_RATE_MAX = 5
// Looser than the forgot-password limit — legitimate use makes a couple of these calls
// per flow (validate on page load, then submit). Defense-in-depth only: the token itself
// is a 256-bit random value, so brute force is already infeasible without this.
const RESET_PASSWORD_RATE_WINDOW_MS = 60 * 60 * 1000
const RESET_PASSWORD_RATE_MAX = 20

const isProduction =
  process.env.NODE_ENV === 'production' ||
  process.env.RENDER === 'true' ||
  Boolean((process.env.RENDER_EXTERNAL_URL || '').includes('onrender.com'))

/** Public API paths — everything else under /api requires a valid session. */
const PUBLIC_API_EXACT = new Set([
  'POST /api/login',
  'GET /api/me',
  'POST /api/logout',
  'POST /api/inquiry',
  'POST /api/music-selection',
  'POST /api/stripe-webhook',
  'POST /api/invoices/sync-for-view',
  'POST /api/confirm-payment',
  'POST /api/create-checkout-session',
  'POST /api/partner-referrals',
  // External outreach cron — session bypass; OUTREACH_CRON_SECRET enforced in handler.
  'GET /api/outreach-sequence/tick',
  'POST /api/outreach-sequence/tick',
  // Account recovery — must be reachable while logged out. Protected by a random,
  // single-use, short-lived token (not by session) and by its own rate limit.
  'POST /api/forgot-password',
  'GET /api/reset-password/validate',
  'POST /api/reset-password',
])

function publicApiKey(method, pathOnly) {
  return `${method} ${pathOnly}`
}

export function isPublicApiRoute(method, pathOnly) {
  if (PUBLIC_API_EXACT.has(publicApiKey(method, pathOnly))) return true
  if (method === 'PATCH' && /^\/api\/music-selection\/[^/]+$/.test(pathOnly)) return true
  if (method === 'GET' && /^\/api\/proposals\/[^/]+\/accept-info$/.test(pathOnly)) return true
  if (method === 'POST' && /^\/api\/proposals\/[^/]+\/accept$/.test(pathOnly)) return true
  if (method === 'GET' && /^\/api\/contracts\/[^/]+\/sign-info$/.test(pathOnly)) return true
  if (method === 'POST' && /^\/api\/contracts\/[^/]+\/sign-client$/.test(pathOnly)) return true
  if (method === 'GET' && /^\/api\/invoices\/[^/]+$/.test(pathOnly)) return true
  return false
}

class SqliteSessionStore extends Store {
  constructor(database) {
    super()
    this.db = database
    database.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        sid TEXT PRIMARY KEY,
        sess TEXT NOT NULL,
        expired INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_expired ON sessions(expired);
    `)
    this._purgeExpired()
    setInterval(() => this._purgeExpired(), 60 * 60 * 1000).unref()
  }

  _purgeExpired() {
    try {
      this.db.prepare('DELETE FROM sessions WHERE expired <= ?').run(Date.now())
    } catch {
      // ignore
    }
  }

  get(sid, cb) {
    try {
      const row = this.db.prepare('SELECT sess FROM sessions WHERE sid = ? AND expired > ?').get(sid, Date.now())
      if (!row) return cb(null, null)
      cb(null, JSON.parse(row.sess))
    } catch (err) {
      cb(err)
    }
  }

  set(sid, sess, cb) {
    try {
      const maxAge = typeof sess.cookie?.maxAge === 'number' ? sess.cookie.maxAge : SESSION_MAX_AGE_MS
      const expired = Date.now() + maxAge
      const data = JSON.stringify(sess)
      this.db
        .prepare(
          `INSERT INTO sessions (sid, sess, expired) VALUES (?, ?, ?)
           ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expired = excluded.expired`
        )
        .run(sid, data, expired)
      cb(null)
    } catch (err) {
      cb(err)
    }
  }

  destroy(sid, cb) {
    try {
      this.db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid)
      cb(null)
    } catch (err) {
      cb(err)
    }
  }

  touch(sid, sess, cb) {
    this.set(sid, sess, cb)
  }
}

// Admin credentials + password-reset tokens live in the same persistent SQLite db as
// everything else, not only in env vars. Env vars still bootstrap the account on first
// run, but once a reset happens the DB row is the source of truth — this is what lets a
// password reset survive a Render restart/redeploy without needing the static env var
// (which we have no way to update programmatically) to change too.
db.exec(`
  CREATE TABLE IF NOT EXISTS admin_credentials (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    username TEXT NOT NULL,
    passwordHash TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id TEXT PRIMARY KEY,
    tokenHash TEXT NOT NULL,
    createdAt TEXT NOT NULL,
    expiresAt TEXT NOT NULL,
    usedAt TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_hash ON password_reset_tokens(tokenHash);
`)

function bootstrapAdminCredentialsFromEnv() {
  const existing = db.prepare('SELECT id FROM admin_credentials WHERE id = 1').get()
  if (existing) return
  const username = (process.env.ADMIN_USERNAME || '').trim()
  const passwordHash = (process.env.ADMIN_PASSWORD_HASH || '').trim()
  if (!username || !passwordHash) return
  db.prepare('INSERT INTO admin_credentials (id, username, passwordHash, updatedAt) VALUES (1, ?, ?, ?)').run(
    username,
    passwordHash,
    new Date().toISOString()
  )
}

let authReady = false
let authConfigError = null

export function validateAuthConfig() {
  const sessionSecret = (process.env.SESSION_SECRET || '').trim()
  bootstrapAdminCredentialsFromEnv()
  const stored = db.prepare('SELECT username, passwordHash FROM admin_credentials WHERE id = 1').get()

  if (isProduction) {
    const missing = []
    if (!stored?.username) missing.push('ADMIN_USERNAME')
    if (!stored?.passwordHash) missing.push('ADMIN_PASSWORD_HASH')
    if (!sessionSecret) missing.push('SESSION_SECRET')
    if (missing.length > 0) {
      authConfigError = `Missing required auth environment variables: ${missing.join(', ')}`
      console.error(`[AUTH] ${authConfigError}`)
      return false
    }
    if (!stored.passwordHash.startsWith('$2')) {
      authConfigError = 'ADMIN_PASSWORD_HASH must be a bcrypt hash (generate with: node scripts/hash-password.cjs "yourpassword")'
      console.error(`[AUTH] ${authConfigError}`)
      return false
    }
  } else if (!stored?.username || !stored?.passwordHash || !sessionSecret) {
    console.warn(
      '[AUTH] Dev mode: set ADMIN_USERNAME, ADMIN_PASSWORD_HASH, and SESSION_SECRET for login. Protected routes return 503 until configured.'
    )
    authConfigError = 'Auth not configured for development'
    return false
  }

  authConfigError = null
  authReady = true
  return true
}

export function isAuthReady() {
  return authReady
}

function getAdminCredentials() {
  const row = db.prepare('SELECT username, passwordHash FROM admin_credentials WHERE id = 1').get()
  return {
    username: row?.username || '',
    passwordHash: row?.passwordHash || '',
  }
}

/**
 * Wired up from index.js once the SMTP transporter exists, so auth.js doesn't need its
 * own SMTP config. recoveryEmail is where the "forgot username/password" email is sent —
 * always a fixed address, never something the caller can choose, so there is no
 * user-enumeration or send-to-arbitrary-address risk on this public endpoint.
 */
let resetMailConfig = null
export function configurePasswordResetMail({ transporter, mailFrom, recoveryEmail, appBaseUrl }) {
  resetMailConfig = { transporter, mailFrom, recoveryEmail, appBaseUrl }
}

function hashResetToken(token) {
  return createHash('sha256').update(token).digest('hex')
}

const forgotPasswordRateLimit = new Map()
function isForgotPasswordRateLimited(key) {
  const now = Date.now()
  const data = forgotPasswordRateLimit.get(key) || { count: 0, start: now }
  if (now - data.start > FORGOT_PASSWORD_RATE_WINDOW_MS) {
    data.count = 0
    data.start = now
  }
  data.count += 1
  forgotPasswordRateLimit.set(key, data)
  return data.count > FORGOT_PASSWORD_RATE_MAX
}

const resetPasswordRateLimit = new Map()
function isResetPasswordRateLimited(key) {
  const now = Date.now()
  const data = resetPasswordRateLimit.get(key) || { count: 0, start: now }
  if (now - data.start > RESET_PASSWORD_RATE_WINDOW_MS) {
    data.count = 0
    data.start = now
  }
  data.count += 1
  resetPasswordRateLimit.set(key, data)
  return data.count > RESET_PASSWORD_RATE_MAX
}

function clientKey(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown'
}

const loginRateLimit = new Map()

function cleanupLoginRateLimit() {
  const now = Date.now()
  for (const [key, data] of loginRateLimit.entries()) {
    if (now - data.start > LOGIN_RATE_WINDOW_MS) loginRateLimit.delete(key)
  }
}

export function loginRateLimitMiddleware(req, res, next) {
  if (req.method !== 'POST' || req.path !== '/api/login') return next()
  cleanupLoginRateLimit()
  const key = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown'
  const data = loginRateLimit.get(key) || { count: 0, start: Date.now() }
  data.count++
  loginRateLimit.set(key, data)
  if (data.count > LOGIN_RATE_MAX) {
    return res.status(429).json({ error: 'Too many login attempts. Please wait and try again.' })
  }
  next()
}

export function createSessionMiddleware() {
  const secret = (process.env.SESSION_SECRET || 'dev-only-insecure-secret').trim()
  return session({
    name: 'aurora_sid',
    secret,
    store: new SqliteSessionStore(db),
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      maxAge: SESSION_MAX_AGE_MS,
    },
  })
}

export function requireAuth(req, res, next) {
  const pathOnly = (req.path || '').split('?')[0]
  if (!pathOnly.startsWith('/api')) return next()
  if (isPublicApiRoute(req.method, pathOnly)) return next()

  if (!authReady) {
    return res.status(503).json({
      error: authConfigError || 'Authentication is not configured on this server.',
    })
  }

  if (req.session?.authenticated) return next()
  return res.status(401).json({ error: 'Authentication required.' })
}

export function registerAuthRoutes(app) {
  app.get('/api/me', (req, res) => {
    if (!authReady) {
      return res.status(503).json({ authenticated: false, error: authConfigError || 'Auth not configured' })
    }
    if (req.session?.authenticated) {
      return res.json({ authenticated: true, username: req.session.username || null })
    }
    return res.json({ authenticated: false })
  })

  app.post('/api/login', async (req, res) => {
    if (!authReady) {
      return res.status(503).json({ error: authConfigError || 'Authentication is not configured on this server.' })
    }
    const { username, password } = req.body || {}
    const creds = getAdminCredentials()
    if (!username || !password || typeof username !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ error: 'Username and password are required.' })
    }
    const usernameMatch = username.trim() === creds.username
    let passwordMatch = false
    try {
      passwordMatch = await bcrypt.compare(password, creds.passwordHash)
    } catch {
      passwordMatch = false
    }
    if (!usernameMatch || !passwordMatch) {
      return res.status(401).json({ error: 'Invalid username or password.' })
    }
    req.session.authenticated = true
    req.session.username = creds.username
    req.session.loginAt = Date.now()
    return res.json({ ok: true, username: creds.username })
  })

  app.post('/api/forgot-password', async (req, res) => {
    if (isForgotPasswordRateLimited(clientKey(req))) {
      return res.status(429).json({ error: 'Too many requests. Please wait and try again later.' })
    }
    // Always return the same generic response, whether or not recovery email is
    // configured or anything below succeeds — this endpoint must never reveal state.
    const generic = { ok: true, message: 'If account recovery is configured, an email has been sent.' }
    try {
      if (!authReady || !resetMailConfig?.transporter || !resetMailConfig?.recoveryEmail) {
        console.warn('[AUTH] /api/forgot-password called but recovery email is not configured (set ADMIN_RECOVERY_EMAIL / SMTP_*)')
        return res.json(generic)
      }
      const creds = getAdminCredentials()
      const token = randomBytes(32).toString('hex')
      const tokenHash = hashResetToken(token)
      const now = Date.now()
      db.prepare('DELETE FROM password_reset_tokens WHERE expiresAt < ?').run(new Date(now).toISOString())
      db.prepare(
        'INSERT INTO password_reset_tokens (id, tokenHash, createdAt, expiresAt, usedAt) VALUES (?, ?, ?, ?, NULL)'
      ).run(
        `prt-${randomBytes(8).toString('hex')}`,
        tokenHash,
        new Date(now).toISOString(),
        new Date(now + PASSWORD_RESET_TOKEN_TTL_MS).toISOString()
      )

      const base = (resetMailConfig.appBaseUrl || '').replace(/\/$/, '')
      const resetUrl = `${base}/reset-password?token=${token}`
      await resetMailConfig.transporter.sendMail({
        from: resetMailConfig.mailFrom,
        to: resetMailConfig.recoveryEmail,
        subject: 'Aurora Sonnet CRM — account recovery',
        text: [
          `Your CRM username is: ${creds.username}`,
          '',
          `To set a new password, open this link within 30 minutes:`,
          resetUrl,
          '',
          "If you didn't request this, you can ignore this email — nothing has been changed.",
        ].join('\n'),
      })
      return res.json(generic)
    } catch (err) {
      console.error('[AUTH] /api/forgot-password failed:', err?.message || err)
      return res.json(generic)
    }
  })

  app.get('/api/reset-password/validate', (req, res) => {
    if (isResetPasswordRateLimited(clientKey(req))) {
      return res.status(429).json({ valid: false, error: 'Too many requests. Please wait and try again later.' })
    }
    const token = String(req.query?.token || '')
    if (!token) return res.json({ valid: false })
    const row = db
      .prepare('SELECT id FROM password_reset_tokens WHERE tokenHash = ? AND usedAt IS NULL AND expiresAt > ?')
      .get(hashResetToken(token), new Date().toISOString())
    return res.json({ valid: Boolean(row) })
  })

  app.post('/api/reset-password', async (req, res) => {
    if (isResetPasswordRateLimited(clientKey(req))) {
      return res.status(429).json({ error: 'Too many requests. Please wait and try again later.' })
    }
    const { token, newPassword } = req.body || {}
    if (!token || typeof token !== 'string' || !newPassword || typeof newPassword !== 'string') {
      return res.status(400).json({ error: 'Token and new password are required.' })
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters.' })
    }
    const tokenHash = hashResetToken(token)
    const row = db
      .prepare('SELECT id FROM password_reset_tokens WHERE tokenHash = ? AND usedAt IS NULL AND expiresAt > ?')
      .get(tokenHash, new Date().toISOString())
    if (!row) {
      return res.status(400).json({ error: 'This reset link is invalid or has expired. Request a new one.' })
    }

    const passwordHash = await bcrypt.hash(newPassword, 12)
    const nowIso = new Date().toISOString()
    db.prepare('UPDATE admin_credentials SET passwordHash = ?, updatedAt = ? WHERE id = 1').run(passwordHash, nowIso)
    // Consume this token and invalidate any other outstanding ones for safety.
    db.prepare('UPDATE password_reset_tokens SET usedAt = ? WHERE usedAt IS NULL').run(nowIso)
    // A password reset likely means the account was at risk — sign out everywhere.
    try {
      db.prepare('DELETE FROM sessions').run()
    } catch {
      // ignore
    }

    const creds = getAdminCredentials()
    return res.json({ ok: true, username: creds.username })
  })

  app.post('/api/logout', (req, res) => {
    if (!req.session) return res.json({ ok: true })
    req.session.destroy((err) => {
      if (err) return res.status(500).json({ error: 'Could not log out. Try again.' })
      res.clearCookie('aurora_sid', {
        httpOnly: true,
        secure: isProduction,
        sameSite: 'lax',
      })
      return res.json({ ok: true })
    })
  })
}
