import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import bcrypt from 'bcryptjs'
import { DEFAULT_REFERRAL_PARTNERSHIP_TERMS, PUBLIC_PARTNER_AGREEMENT_TERMS } from '../server/referralPartnershipTerms.js'

const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

const ADMIN_USERNAME = 'accounts-admin'
const ADMIN_PASSWORD = 'accounts-preview-pass'
const SESSION_SECRET = 'partner-accounts-test-secret'

let dataDir
let child
let base
let fixture

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close(() => resolve(port))
    })
  })
}

function cookieHeader(setCookie, name) {
  const rows = Array.isArray(setCookie) ? setCookie : [setCookie].filter(Boolean)
  const row = rows.find((value) => String(value).startsWith(`${name}=`))
  return row ? String(row).split(';')[0] : ''
}

async function hit(path, { method = 'GET', cookie = '', body } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  })
  const buf = Buffer.from(await res.arrayBuffer())
  const setCookie =
    typeof res.headers.getSetCookie === 'function'
      ? res.headers.getSetCookie()
      : [res.headers.get('set-cookie')].filter(Boolean)
  return {
    status: res.status,
    buf,
    setCookie,
    text: buf.toString('utf8'),
    type: res.headers.get('content-type') || '',
    disposition: res.headers.get('content-disposition') || '',
  }
}

test.before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'aurora-partner-accounts-'))
  process.env.DATA_DIR = dataDir
  process.env.SESSION_SECRET = SESSION_SECRET
  const db = await import('../server/db.js')
  await import('../server/auth.js')
  const opened = String(db.default?.name || '')
  if (!opened.startsWith(dataDir)) throw new Error(`Test opened ${opened} instead of ${dataDir}`)

  const now = new Date().toISOString()
  db.default
    .prepare('INSERT INTO admin_credentials (id, username, passwordHash, updatedAt) VALUES (1, ?, ?, ?)')
    .run(ADMIN_USERNAME, bcrypt.hashSync(ADMIN_PASSWORD, 8), now)

  const partners = await import('../server/publicReferralPartner.js')
  const a = await partners.submitPublicPartnerApplication({
    fullName: 'Avery Quinn',
    email: 'avery@example.com',
    companyName: 'Quinn Events',
    businessType: 'Planner',
    signaturePngBase64: TINY_PNG,
  })
  const b = await partners.submitPublicPartnerApplication({
    fullName: 'Robin Blake',
    email: 'robin@example.com',
    companyName: 'Blake Photo',
    businessType: 'Photographer',
    signaturePngBase64: TINY_PNG,
  })
  const referCouple = await partners.submitPublicPartnerApplication(
    {
      fullName: 'Sam Cole',
      email: 'sam@example.com',
      companyName: 'Cole Music',
      signaturePngBase64: TINY_PNG,
    },
    { allowBlankBusinessType: true }
  )
  const coupleA = partners.savePublicCoupleReferral({
    partnerName: 'Avery Quinn',
    partnerEmail: 'avery@example.com',
    companyName: 'Quinn Events',
    referralToken: a.referralToken,
    clientName: 'Casey Nolan',
    clientEmail: 'casey@example.com',
    clientPhone: '2125550101',
  })
  const coupleB = partners.savePublicCoupleReferral({
    partnerName: 'Robin Blake',
    partnerEmail: 'robin@example.com',
    companyName: 'Blake Photo',
    referralToken: b.referralToken,
    clientName: 'Jordan Hale',
    clientEmail: 'jordan@example.com',
    clientPhone: '2125550102',
  })
  assert.ok(coupleA.referralReference)
  assert.ok(coupleB.referralReference)

  const venueId = db.createVenue({ companyName: 'Garden Hall', stage: 'partner' })
  const venuePartnershipId = 'rp-venue-accounts'
  const venueAgreementId = 'rpa-venue-accounts'
  db.insertReferralPartnership({
    id: venuePartnershipId,
    venueId,
    status: 'active',
    activeAgreementId: venueAgreementId,
    partnerName: 'Garden Hall',
    partnerEmail: 'garden@venue.test',
    companyName: 'Garden Hall',
    referralToken: 'venue-token-should-not-list',
    createdAt: now,
    updatedAt: now,
  })
  db.insertReferralPartnershipAgreement({
    id: venueAgreementId,
    partnershipId: venuePartnershipId,
    version: 1,
    status: 'fully_executed',
    termsJson: JSON.stringify(DEFAULT_REFERRAL_PARTNERSHIP_TERMS),
    contentHtml: '<p>venue</p>',
    signatoryName: 'Pat',
    signatoryTitle: 'GM',
    partnerSignerName: 'Pat',
    partnerSignedDate: '2026-01-01',
    agencySignerName: 'Lisa',
    agencySignedDate: '2026-01-02',
    auditLogJson: '[]',
    legalApprovalStatus: 'owner_approved',
    legalApprovedAt: now,
    agreementVersionIdentifier: 'RPA-venue-accounts-v1',
    createdAt: now,
    updatedAt: now,
  })
  db.createPartnerReferral({
    partnerName: 'Garden Hall',
    partnerEmail: 'garden@venue.test',
    clientName: 'Venue Couple',
    clientEmail: 'venue-couple@example.com',
    clientPhone: '2125550103',
    venueId,
  })

  const unsignedId = 'rp-unsigned-accounts'
  const unsignedAgreementId = 'rpa-unsigned-accounts'
  db.insertReferralPartnership({
    id: unsignedId,
    status: 'pending_signature',
    activeAgreementId: unsignedAgreementId,
    partnerName: 'Not Signed',
    partnerEmail: 'unsigned@example.com',
    companyName: 'Not Signed Co',
    createdAt: now,
    updatedAt: now,
  })
  db.insertReferralPartnershipAgreement({
    id: unsignedAgreementId,
    partnershipId: unsignedId,
    version: 1,
    status: 'sent',
    termsJson: JSON.stringify(PUBLIC_PARTNER_AGREEMENT_TERMS),
    contentHtml: '<p>unsigned</p>',
    auditLogJson: '[]',
    createdAt: now,
    updatedAt: now,
  })

  db.createPartnerReferral({
    partnerName: 'Walk-in Planner',
    partnerEmail: 'walkin@example.com',
    clientName: 'No Account Couple',
    clientEmail: 'no-account@example.com',
    clientPhone: '2125550104',
  })

  const accounts = await import('../server/partnerAccounts.js')
  const beforeCount = db.default.prepare('SELECT COUNT(*) AS n FROM referral_partnerships').get().n
  const listed = accounts.listSignedPublicPartnerAccounts()
  const afterCount = db.default.prepare('SELECT COUNT(*) AS n FROM referral_partnerships').get().n
  assert.equal(afterCount, beforeCount)
  assert.deepEqual(
    listed.map((row) => row.partnerName).sort(),
    ['Avery Quinn', 'Robin Blake', 'Sam Cole']
  )
  assert.equal(accounts.getSignedPublicPartnerAccount(venuePartnershipId), null)
  assert.equal(accounts.getSignedPublicPartnerAccount(unsignedId), null)
  const avery = accounts.getSignedPublicPartnerAccount(a.partnershipId)
  assert.equal(avery.agreementStatus, 'Signed')
  assert.deepEqual(
    avery.couples.map((row) => row.couple),
    ['Casey Nolan']
  )
  assert.equal(avery.couples[0].reference, coupleA.referralReference)
  assert.equal(avery.couples[0].status, 'New')
  assert.ok(avery.referralLink.includes(a.referralToken))
  assert.equal(Object.hasOwn(avery, 'referralToken'), false)

  const portal = await import('../server/partnerPortal.js')
  fixture = {
    averyId: a.partnershipId,
    robinId: b.partnershipId,
    venueId: venuePartnershipId,
    unsignedId,
    averyToken: a.referralToken,
    robinToken: b.referralToken,
    averyRef: coupleA.referralReference,
    loginA: portal.createPortalLoginToken(a.partnershipId),
    loginAPage: portal.createPortalLoginToken(a.partnershipId),
    loginB: portal.createPortalLoginToken(b.partnershipId),
  }
  db.default.close()

  const port = await freePort()
  base = `http://127.0.0.1:${port}`
  child = spawn(process.execPath, ['server/index.js'], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      DATA_DIR: dataDir,
      PORT: String(port),
      SESSION_SECRET,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server did not start\n${log}`)), 25000)
    let log = ''
    const onData = (chunk) => {
      log += chunk.toString()
      if (log.includes('Aurora Sonnet API running')) {
        clearTimeout(timer)
        resolve()
      }
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.once('exit', (code) => {
      clearTimeout(timer)
      reject(new Error(`server exited ${code}\n${log}`))
    })
  })
})

test.after(() => {
  if (child && !child.killed) child.kill('SIGTERM')
  delete process.env.DATA_DIR
  delete process.env.SESSION_SECRET
  if (dataDir) rmSync(dataDir, { recursive: true, force: true })
})

test('admin partner accounts stay behind admin login and exclude other records', async () => {
  const anon = await hit('/api/partner-accounts')
  assert.equal(anon.status, 401)

  const login = await hit('/api/login', {
    method: 'POST',
    body: { username: ADMIN_USERNAME, password: ADMIN_PASSWORD },
  })
  assert.equal(login.status, 200)
  const adminCookie = cookieHeader(login.setCookie, 'aurora_sid')
  assert.ok(adminCookie)

  const partnerLogin = await hit('/api/partner-portal/verify', {
    method: 'POST',
    body: { token: fixture.loginA },
  })
  assert.equal(partnerLogin.status, 200)
  const partnerCookie = cookieHeader(partnerLogin.setCookie, 'aurora_partner_sid')
  assert.ok(partnerCookie)
  const partnerOnAdmin = await hit('/api/partner-accounts', { cookie: partnerCookie })
  assert.equal(partnerOnAdmin.status, 401)

  const list = await hit('/api/partner-accounts', { cookie: adminCookie })
  assert.equal(list.status, 200)
  const names = JSON.parse(list.text).accounts.map((row) => row.partnerName)
  assert.deepEqual(names, ['Avery Quinn', 'Robin Blake', 'Sam Cole'])
  assert.equal(list.text.includes('Garden Hall'), false)
  assert.equal(list.text.includes('Not Signed'), false)
  assert.equal(list.text.includes('Walk-in Planner'), false)
  const listed = JSON.parse(list.text).accounts
  assert.equal(listed[0].agreementStatus, 'Signed')
  assert.equal(listed[0].referralLink.includes(fixture.averyToken), true)
  assert.equal(list.text.includes('"referralToken"'), false)

  const adminKit = await hit('/api/partner-portal/media-kit/wedding-performance', { cookie: adminCookie })
  assert.equal(adminKit.status, 401)

  assert.equal((await hit(`/api/partner-accounts/${fixture.venueId}`, { cookie: adminCookie })).status, 404)
  assert.equal((await hit(`/api/partner-accounts/${fixture.unsignedId}`, { cookie: adminCookie })).status, 404)

  const detail = await hit(`/api/partner-accounts/${fixture.averyId}`, { cookie: adminCookie })
  assert.equal(detail.status, 200)
  assert.equal(detail.setCookie.some((row) => String(row).includes('aurora_partner_sid')), false)
  const account = JSON.parse(detail.text)
  assert.deepEqual(Object.keys(account).sort(), [
    'accountStatus',
    'agreementStatus',
    'companyName',
    'couples',
    'id',
    'partnerEmail',
    'partnerName',
    'referralLink',
  ])
  assert.equal(account.partnerEmail, 'avery@example.com')
  assert.equal(account.accountStatus, 'Active')
  assert.equal(account.agreementStatus, 'Signed')
  assert.deepEqual(account.couples, [{ reference: fixture.averyRef, couple: 'Casey Nolan', status: 'New' }])
  assert.equal(account.referralLink.includes('/partner'), false)
  assert.equal(JSON.stringify(account).includes('Jordan Hale'), false)

  for (const method of ['POST', 'PATCH', 'DELETE']) {
    const blocked = await hit(`/api/partner-accounts/${fixture.averyId}`, { method, cookie: adminCookie, body: { partnerName: 'Changed' } })
    assert.equal(blocked.status, 404, method)
  }
})

test('each partner sees only their portal and the same media kit', async () => {
  const robinLogin = await hit('/api/partner-portal/verify', {
    method: 'POST',
    body: { token: fixture.loginB },
  })
  assert.equal(robinLogin.status, 200)
  const robinCookie = cookieHeader(robinLogin.setCookie, 'aurora_partner_sid')

  const averyLogin = await hit('/api/partner-portal/verify', {
    method: 'POST',
    body: { token: fixture.loginAPage },
  })
  assert.equal(averyLogin.status, 200)
  const averyCookie = cookieHeader(averyLogin.setCookie, 'aurora_partner_sid')

  const averyPage = await hit('/partner', { cookie: averyCookie })
  assert.equal(averyPage.status, 200)
  assert.equal(averyPage.text.includes('Casey Nolan'), true)
  assert.equal(averyPage.text.includes('Jordan Hale'), false)
  assert.equal(averyPage.text.includes('Media Kit'), true)
  assert.equal(averyPage.text.includes('/api/partner-portal/media-kit/wedding-performance'), true)
  assert.equal(averyPage.text.includes('Logo, transparent background'), false)
  assert.equal(averyPage.text.includes(fixture.robinToken), false)

  const robinPage = await hit('/partner', { cookie: robinCookie })
  assert.equal(robinPage.status, 200)
  assert.equal(robinPage.text.includes('Jordan Hale'), true)
  assert.equal(robinPage.text.includes('Casey Nolan'), false)
  assert.equal(robinPage.text.includes(fixture.averyToken), false)

  const anonKit = await hit('/api/partner-portal/media-kit/wedding-performance')
  assert.equal(anonKit.status, 401)

  const missing = await hit('/api/partner-portal/media-kit/not-a-file', { cookie: averyCookie })
  assert.equal(missing.status, 404)
  assert.equal((await hit('/api/partner-portal/media-kit/logo-transparent', { cookie: averyCookie })).status, 404)

  const averyKit = await hit('/api/partner-portal/media-kit/wedding-performance', { cookie: averyCookie })
  const robinKit = await hit('/api/partner-portal/media-kit/wedding-performance', { cookie: robinCookie })
  assert.equal(averyKit.status, 200)
  assert.equal(averyKit.type.includes('image/png'), true)
  assert.equal(averyKit.buf.subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
  assert.equal(averyKit.buf.includes(fixture.averyToken), false)
  assert.equal(averyKit.buf.includes(Buffer.from('Casey Nolan')), false)
  assert.deepEqual(averyKit.buf, robinKit.buf)

  const signedOut = await hit('/partner')
  assert.equal(signedOut.text.includes('/api/partner-portal/media-kit/'), false)
  for (const item of [
    ['wedding-performance', 'Aurora-Sonnet-wedding-performance.png', 'Wedding performance photo'],
    ['as-monogram', 'Aurora-Sonnet-monogram.png', 'AS monogram'],
    ['wordmark', 'Aurora-Sonnet-wordmark.png', 'Aurora Sonnet wordmark'],
  ]) {
    const [id, filename, label] = item
    assert.equal(averyPage.text.includes(label), true)
    assert.equal(averyPage.text.includes(filename), true)
    assert.equal(averyPage.text.includes(`/api/partner-portal/media-kit/${id}?download=1`), true)
    assert.equal((await hit(`/api/partner-portal/media-kit/${id}?download=1`)).status, 401)
    const averyFile = await hit(`/api/partner-portal/media-kit/${id}?download=1`, { cookie: averyCookie })
    const robinFile = await hit(`/api/partner-portal/media-kit/${id}?download=1`, { cookie: robinCookie })
    assert.equal(averyFile.status, 200)
    assert.equal(averyFile.type.includes('image/png'), true)
    assert.equal(averyFile.buf.subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
    assert.equal(averyFile.disposition.includes('attachment'), true)
    assert.equal(averyFile.disposition.includes(filename), true)
    assert.deepEqual(averyFile.buf, robinFile.buf)
  }
})
