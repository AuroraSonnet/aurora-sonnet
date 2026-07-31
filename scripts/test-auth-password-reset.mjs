import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { execFileSync } from 'node:child_process'
import http from 'node:http'
import express from 'express'
import bcrypt from 'bcryptjs'
import Database from 'better-sqlite3'

const OLD_PASSWORD = 'OldPassw0rd!'
const RECOVERY_EMAIL = 'recovery@example.com'
const SERVER_DIR = new URL('../server/', import.meta.url)

let dataDir
let db
let auth
let mailerCalls
let currentPassword = OLD_PASSWORD

function createMockTransporter() {
  mailerCalls = []
  return {
    sendMail: async (opts) => {
      mailerCalls.push(opts)
      return { messageId: '<mock@aurorasonnet.com>', response: '250 OK', accepted: [opts.to], rejected: [] }
    },
  }
}

function buildServer({ recoveryEmail = RECOVERY_EMAIL } = {}) {
  const transporter = createMockTransporter()
  auth.configurePasswordResetMail({
    transporter,
    mailFrom: 'contact@aurorasonnet.com',
    recoveryEmail,
    appBaseUrl: 'http://localhost:0',
  })
  const app = express()
  app.use(express.json())
  app.use(auth.createSessionMiddleware())
  auth.registerAuthRoutes(app)
  const server = http.createServer(app)
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      resolve({ server, base: `http://127.0.0.1:${port}` })
    })
  })
}

function closeServer(server) {
  return new Promise((resolve) => server.close(resolve))
}

function extractToken(emailText) {
  const m = emailText.match(/token=([a-f0-9]+)/)
  return m ? m[1] : null
}

/**
 * auth.js's rate limiters key off the client IP and are module-level, so — same as in
 * production — they accumulate across every request the process handles. Since this
 * file imports auth.js once and reuses it, each test gets its own fake IP (except the
 * dedicated rate-limit test) so tests can't exhaust each other's quota.
 */
function fetchAs(ip, url, options = {}) {
  return fetch(url, { ...options, headers: { ...options.headers, 'x-forwarded-for': ip } })
}

/**
 * Runs a tiny script in its own Node process against a brand-new DATA_DIR, so module
 * caching can't leak state between scenarios (unlike importing server/auth.js multiple
 * times in-process, whose own internal `import db from './db.js'` always resolves to one
 * cached instance no matter what query string a test uses to import auth.js itself).
 */
function runIsolated(env, body) {
  const scriptPath = join(mkdtempSync(join(tmpdir(), 'aurora-auth-isolated-')), 'run.mjs')
  writeFileSync(
    scriptPath,
    `
    import db from ${JSON.stringify(new URL('db.js', SERVER_DIR).href)}
    import * as auth from ${JSON.stringify(new URL('auth.js', SERVER_DIR).href)}
    ${body}
    `
  )
  const out = execFileSync(process.execPath, [scriptPath], {
    env: { ...process.env, ...env },
    encoding: 'utf8',
  })
  return JSON.parse(out.trim().split('\n').pop())
}

test.before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'aurora-auth-reset-'))
  process.env.DATA_DIR = dataDir
  process.env.ADMIN_USERNAME = 'lisadub'
  process.env.ADMIN_PASSWORD_HASH = bcrypt.hashSync(OLD_PASSWORD, 12)
  process.env.SESSION_SECRET = 'test-only-secret'
  db = await import('../server/db.js')
  auth = await import('../server/auth.js')
})

test.after(() => {
  delete process.env.DATA_DIR
  delete process.env.ADMIN_USERNAME
  delete process.env.ADMIN_PASSWORD_HASH
  delete process.env.SESSION_SECRET
  if (dataDir) rmSync(dataDir, { recursive: true, force: true })
})

test('migrating onto a brand-new admin_credentials table preserves the current password immediately', () => {
  // Real process isolation, run against a persistent disk that has never seen this
  // migration before — exactly the state of production on first deploy of this feature.
  // Render already has ADMIN_USERNAME/ADMIN_PASSWORD_HASH set today, so this is the
  // actual startup path that will run.
  const freshDir = mkdtempSync(join(tmpdir(), 'aurora-auth-fresh-'))
  const hash = bcrypt.hashSync('WhateverIsLiveToday!', 12)
  try {
    const result = runIsolated(
      { DATA_DIR: freshDir, ADMIN_USERNAME: 'lisadub', ADMIN_PASSWORD_HASH: hash, SESSION_SECRET: 's' },
      `
      const before = db.prepare('SELECT * FROM admin_credentials WHERE id = 1').get()
      const ready = auth.validateAuthConfig()
      const after = db.prepare('SELECT * FROM admin_credentials WHERE id = 1').get()
      console.log(JSON.stringify({ before, ready, after }))
      `
    )
    assert.equal(result.before, undefined, 'table must exist but start empty before the first validateAuthConfig() call')
    assert.equal(result.ready, true, 'auth must become ready by seeding from the existing env vars')
    assert.equal(result.after.username, 'lisadub')
    assert.equal(result.after.passwordHash, hash, "seeded hash must exactly match today's Render env var — same password, zero action needed")
  } finally {
    rmSync(freshDir, { recursive: true, force: true })
  }
})

test('if no admin row can be created (no env vars, empty DB), auth fails closed — never open', () => {
  const emptyDir = mkdtempSync(join(tmpdir(), 'aurora-auth-empty-'))
  try {
    const result = runIsolated(
      { DATA_DIR: emptyDir, ADMIN_USERNAME: '', ADMIN_PASSWORD_HASH: '', SESSION_SECRET: 's' },
      `
      const ready = auth.validateAuthConfig()
      console.log(JSON.stringify({ ready, isAuthReady: auth.isAuthReady() }))
      `
    )
    assert.equal(result.ready, false)
    assert.equal(result.isAuthReady, false, 'server must not accept any login when no admin row exists and no env fallback is available')
  } finally {
    rmSync(emptyDir, { recursive: true, force: true })
  }
})

test('full forgot-password -> reset -> login-with-new-password flow', async () => {
  const ip = '10.0.1.1'
  assert.equal(auth.validateAuthConfig(), true)
  const { server, base } = await buildServer()

  try {
    const forgotRes = await fetchAs(ip, `${base}/api/forgot-password`, { method: 'POST' })
    assert.equal(forgotRes.status, 200)
    assert.equal((await forgotRes.json()).ok, true)
    assert.equal(mailerCalls.length, 1)
    assert.equal(mailerCalls[0].to, RECOVERY_EMAIL)
    assert.match(mailerCalls[0].text, /lisadub/)

    const token = extractToken(mailerCalls[0].text)
    assert.ok(token, 'reset email must contain a token link')

    assert.equal((await (await fetchAs(ip, `${base}/api/reset-password/validate?token=${token}`)).json()).valid, true)
    assert.equal((await (await fetchAs(ip, `${base}/api/reset-password/validate?token=wrongtoken`)).json()).valid, false)

    const tooShortRes = await fetchAs(ip, `${base}/api/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, newPassword: 'short' }),
    })
    assert.equal(tooShortRes.status, 400)

    const newPassword = 'NewPassw0rd!'
    const resetRes = await fetchAs(ip, `${base}/api/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, newPassword }),
    })
    assert.equal(resetRes.status, 200)
    const resetJson = await resetRes.json()
    assert.equal(resetJson.ok, true)
    assert.equal(resetJson.username, 'lisadub')
    currentPassword = newPassword

    // Token is single-use.
    const reuseRes = await fetchAs(ip, `${base}/api/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, newPassword: 'AnotherPassw0rd!' }),
    })
    assert.equal(reuseRes.status, 400)

    const oldLoginRes = await fetch(`${base}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'lisadub', password: OLD_PASSWORD }),
    })
    assert.equal(oldLoginRes.status, 401)

    const newLoginRes = await fetch(`${base}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'lisadub', password: currentPassword }),
    })
    assert.equal(newLoginRes.status, 200)
  } finally {
    await closeServer(server)
  }
})

test('resetting the password logs out existing sessions', async () => {
  const ip = '10.0.1.2'
  const { server, base } = await buildServer()

  try {
    const loginRes = await fetch(`${base}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'lisadub', password: currentPassword }),
    })
    assert.equal(loginRes.status, 200)
    const cookie = loginRes.headers.get('set-cookie')?.split(';')[0]
    assert.ok(cookie, 'login must set a session cookie')

    assert.equal((await (await fetch(`${base}/api/me`, { headers: { cookie } })).json()).authenticated, true)

    await fetchAs(ip, `${base}/api/forgot-password`, { method: 'POST' })
    const token = extractToken(mailerCalls[0].text)
    const nextPassword = 'YetAnotherPassw0rd!'
    const resetRes = await fetchAs(ip, `${base}/api/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, newPassword: nextPassword }),
    })
    assert.equal(resetRes.status, 200)
    currentPassword = nextPassword

    const meAfter = await fetch(`${base}/api/me`, { headers: { cookie } })
    assert.equal((await meAfter.json()).authenticated, false, 'old session must be invalidated by a password reset')
  } finally {
    await closeServer(server)
  }
})

test('an expired token is rejected by both validate and reset, even though it was never used', async () => {
  const ip = '10.0.1.3'
  const { server, base } = await buildServer()

  try {
    await fetchAs(ip, `${base}/api/forgot-password`, { method: 'POST' })
    const token = extractToken(mailerCalls[0].text)

    // Backdate the same expiresAt column the routes check, to prove expiry is enforced
    // by that column rather than by how soon the token happens to be consumed.
    const sqlite = new Database(join(dataDir, 'aurora.db'))
    sqlite.prepare("UPDATE password_reset_tokens SET expiresAt = datetime('now', '-1 minute')").run()
    sqlite.close()

    assert.equal(
      (await (await fetchAs(ip, `${base}/api/reset-password/validate?token=${token}`)).json()).valid,
      false,
      'expired token must not validate'
    )

    const resetRes = await fetchAs(ip, `${base}/api/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, newPassword: 'ExpiredFlowPassw0rd!' }),
    })
    assert.equal(resetRes.status, 400, 'expired token must not be usable to reset the password')
  } finally {
    await closeServer(server)
  }
})

test('a successful reset invalidates every other outstanding token, not just the one used', async () => {
  const ip = '10.0.1.4'
  const { server, base } = await buildServer()

  try {
    await fetchAs(ip, `${base}/api/forgot-password`, { method: 'POST' })
    const firstToken = extractToken(mailerCalls[0].text)

    await fetchAs(ip, `${base}/api/forgot-password`, { method: 'POST' })
    const secondToken = extractToken(mailerCalls[1].text)
    assert.notEqual(firstToken, secondToken)

    const nextPassword = 'SecondTokenPassw0rd!'
    const resetRes = await fetchAs(ip, `${base}/api/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: secondToken, newPassword: nextPassword }),
    })
    assert.equal(resetRes.status, 200)
    currentPassword = nextPassword

    const staleValidate = await fetchAs(ip, `${base}/api/reset-password/validate?token=${firstToken}`)
    assert.equal((await staleValidate.json()).valid, false, 'unused sibling token must be invalidated by the reset')
  } finally {
    await closeServer(server)
  }
})

test('forgot-password is rate limited per client', async () => {
  const ip = '10.0.1.5'
  const { server, base } = await buildServer()

  try {
    let lastStatus = 200
    for (let i = 0; i < 7; i++) {
      lastStatus = (await fetchAs(ip, `${base}/api/forgot-password`, { method: 'POST' })).status
    }
    assert.equal(lastStatus, 429)
  } finally {
    await closeServer(server)
  }
})

test('forgot-password responds generically (no state leak) when recovery email is unconfigured', async () => {
  const ip = '10.0.1.6'
  const { server, base } = await buildServer({ recoveryEmail: '' })

  try {
    const res = await fetchAs(ip, `${base}/api/forgot-password`, { method: 'POST' })
    assert.equal(res.status, 200)
    assert.equal((await res.json()).ok, true)
    assert.equal(mailerCalls.length, 0, 'no email should be sent when recovery email is not configured')
  } finally {
    await closeServer(server)
  }
})

test('reset-password rejects an unknown token', async () => {
  const ip = '10.0.1.7'
  const { server, base } = await buildServer()

  try {
    const res = await fetchAs(ip, `${base}/api/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'not-a-real-token', newPassword: 'Whatever123!' }),
    })
    assert.equal(res.status, 400)
  } finally {
    await closeServer(server)
  }
})

test('login keeps working with the current password after everything above', async () => {
  const { server, base } = await buildServer()
  try {
    const res = await fetch(`${base}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'lisadub', password: currentPassword }),
    })
    assert.equal(res.status, 200)
  } finally {
    await closeServer(server)
  }
})
