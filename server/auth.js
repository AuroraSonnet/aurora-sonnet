import session from 'express-session'
import bcrypt from 'bcryptjs'
import { Store } from 'express-session'
import db from './db.js'

const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000 // 24-hour sliding window
const LOGIN_RATE_WINDOW_MS = 15 * 60 * 1000
const LOGIN_RATE_MAX = 10

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
])

function publicApiKey(method, pathOnly) {
  return `${method} ${pathOnly}`
}

function isPublicApiRoute(method, pathOnly) {
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

let authReady = false
let authConfigError = null

export function validateAuthConfig() {
  const username = (process.env.ADMIN_USERNAME || '').trim()
  const passwordHash = (process.env.ADMIN_PASSWORD_HASH || '').trim()
  const sessionSecret = (process.env.SESSION_SECRET || '').trim()

  if (isProduction) {
    const missing = []
    if (!username) missing.push('ADMIN_USERNAME')
    if (!passwordHash) missing.push('ADMIN_PASSWORD_HASH')
    if (!sessionSecret) missing.push('SESSION_SECRET')
    if (missing.length > 0) {
      authConfigError = `Missing required auth environment variables: ${missing.join(', ')}`
      console.error(`[AUTH] ${authConfigError}`)
      return false
    }
    if (!passwordHash.startsWith('$2')) {
      authConfigError = 'ADMIN_PASSWORD_HASH must be a bcrypt hash (generate with: node scripts/hash-password.cjs "yourpassword")'
      console.error(`[AUTH] ${authConfigError}`)
      return false
    }
  } else if (!username || !passwordHash || !sessionSecret) {
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
  return {
    username: (process.env.ADMIN_USERNAME || '').trim(),
    passwordHash: (process.env.ADMIN_PASSWORD_HASH || '').trim(),
  }
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
