import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import Database from 'better-sqlite3'
import { instantAtNyLocal, nyBusinessDateString } from '../server/businessDays.js'
import {
  OUTREACH_CLAIM_STALE_MS,
  OUTREACH_DAILY_LIMIT,
} from '../server/outreachMailer.js'

const TICK_NOW = instantAtNyLocal(2025, 1, 13, 10, 0)
const ANCHOR = instantAtNyLocal(2025, 1, 6, 10, 0).toISOString()
const FIXED_RNG = () => 0
const TEST_SAFE_EMAIL = 'phase7-test@aurorasonnet.com'

let dataDir
let db
let outreach
let scheduler
let cron
let mailerCalls

function createMockTransporter() {
  mailerCalls = []
  return {
    sendMail: async (opts) => {
      mailerCalls.push(opts)
      return {
        messageId: `<mock-${mailerCalls.length}@aurorasonnet.com>`,
        response: '250 OK',
        accepted: [opts.to],
        rejected: [],
      }
    },
  }
}

test.before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'aurora-outreach-phase7-'))
  process.env.DATA_DIR = dataDir
  process.env.OUTREACH_TEST_EMAIL = TEST_SAFE_EMAIL
  delete process.env.OUTREACH_ALLOW_PRODUCTION_SENDS
  db = await import('../server/db.js')
  outreach = await import('../server/outreachSequence.js')
  scheduler = await import('../server/outreachScheduler.js')
  cron = await import('../server/outreachCron.js')
})

test.beforeEach(() => {
  const sqlite = new Database(join(dataDir, 'aurora.db'))
  sqlite.exec('DELETE FROM outreach_daily_quota')
  sqlite.close()
  delete process.env.OUTREACH_SCHEDULER_ENABLED
  delete process.env.OUTREACH_IMAP_ENABLED
  delete process.env.OUTREACH_CRON_SECRET
})

test.after(() => {
  delete process.env.OUTREACH_TEST_EMAIL
  delete process.env.OUTREACH_SCHEDULER_ENABLED
  delete process.env.OUTREACH_IMAP_ENABLED
  delete process.env.OUTREACH_CRON_SECRET
  if (dataDir) rmSync(dataDir, { recursive: true, force: true })
})

function seedDueSend() {
  const id = db.createPartnershipContact({
    companyName: 'Hardening Venue',
    email: 'venue-hardening@example.com',
    partnerType: 'venue',
    stage: 'first_email_sent',
    outreachMethod: 'email',
  })
  db.createOutreachSentMessage({
    partnershipContactId: id,
    messageId: '<anchor@aurorasonnet.com>',
    subject: 'Live Music Referrals',
    toEmail: 'venue-hardening@example.com',
    sentAt: ANCHOR,
  })
  outreach.enrollVenueOutreachSequence({ partnershipContactId: id, anchorAt: ANCHOR, rng: FIXED_RNG })
  const state = outreach.getSequenceState(id)
  const sendId = state.scheduledSends[0].id
  db.updateOutreachScheduledSend(sendId, { scheduledAt: TICK_NOW.toISOString(), status: 'pending' })
  return { contactId: id, sendId }
}

test('daily quota persists across database reopen (restart simulation)', () => {
  const businessDate = nyBusinessDateString(TICK_NOW)
  db.getOrCreateDailyQuota(businessDate)
  db.incrementDailyQuotaSent(businessDate)
  db.incrementDailyQuotaSent(businessDate)
  db.incrementDailyQuotaDeferred(businessDate)

  const sqlite = new Database(join(dataDir, 'aurora.db'))
  const row = sqlite.prepare('SELECT * FROM outreach_daily_quota WHERE businessDate = ?').get(businessDate)
  sqlite.close()

  assert.equal(row.sentCount, 2)
  assert.equal(row.deferredCount, 1)

  const quota = db.getOrCreateDailyQuota(businessDate)
  assert.equal(quota.sentCount, 2)
  assert.equal(quota.deferredCount, 1)
})

test('deferred send rolls to next NY business day', async () => {
  const businessDate = nyBusinessDateString(TICK_NOW)
  const sqlite = new Database(join(dataDir, 'aurora.db'))
  sqlite
    .prepare('INSERT OR REPLACE INTO outreach_daily_quota (businessDate, sentCount, deferredCount, updatedAt) VALUES (?, ?, 0, ?)')
    .run(businessDate, OUTREACH_DAILY_LIMIT, TICK_NOW.toISOString())
  sqlite.close()

  const { sendId } = seedDueSend()
  const transporter = createMockTransporter()

  await scheduler.runOutreachSchedulerTick({
    now: TICK_NOW,
    transporter,
    mailFrom: 'contact@aurorasonnet.com',
    rng: FIXED_RNG,
    force: true,
  })

  const row = db.getOutreachScheduledSendById(sendId)
  assert.equal(row.status, 'deferred')
  const deferredDate = nyBusinessDateString(new Date(row.scheduledAt))
  assert.notEqual(deferredDate, businessDate)
})

test('stale claimed send is released then sent once on next tick (redeploy simulation)', async () => {
  const { sendId } = seedDueSend()
  const claimTime = new Date(TICK_NOW.getTime() - OUTREACH_CLAIM_STALE_MS - 60_000)
  db.claimScheduledSend(sendId, claimTime.toISOString())

  const recoveryOnly = scheduler.recoverOutreachSchedulerState(TICK_NOW)
  assert.equal(recoveryOnly.released, 1)
  assert.equal(db.getOutreachScheduledSendById(sendId).status, 'pending')

  const transporter = createMockTransporter()
  const first = await scheduler.runOutreachSchedulerTick({
    now: TICK_NOW,
    transporter,
    mailFrom: 'contact@aurorasonnet.com',
    force: true,
  })
  const second = await scheduler.runOutreachSchedulerTick({
    now: TICK_NOW,
    transporter,
    mailFrom: 'contact@aurorasonnet.com',
    force: true,
  })

  assert.equal(first.sent, 1)
  assert.equal(second.sent, 0)
  assert.equal(mailerCalls.length, 1)
  assert.equal(db.getOutreachScheduledSendById(sendId).status, 'sent')
})

test('verifyOutreachCronSecret rejects missing secret when configured', () => {
  process.env.OUTREACH_CRON_SECRET = 'phase7-secret'
  const ok = cron.verifyOutreachCronSecret({
    get: (h) => (h === 'x-outreach-cron-secret' ? 'phase7-secret' : undefined),
    query: {},
    body: {},
  })
  const bad = cron.verifyOutreachCronSecret({
    get: () => undefined,
    query: {},
    body: {},
  })
  assert.equal(ok.ok, true)
  assert.equal(bad.ok, false)
  assert.equal(bad.reason, 'invalid_secret')
})

test('verifyOutreachCronSecret fails closed in production when secret unset', () => {
  process.env.RENDER = 'true'
  delete process.env.OUTREACH_CRON_SECRET
  const result = cron.verifyOutreachCronSecret({
    get: () => undefined,
    query: {},
    body: {},
  })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'secret_not_configured')
  delete process.env.RENDER
})

test('verifyOutreachCronSecret rejects wrong secret', () => {
  process.env.OUTREACH_CRON_SECRET = 'phase7-secret'
  const result = cron.verifyOutreachCronSecret({
    get: (h) => (h === 'x-outreach-cron-secret' ? 'wrong-secret' : undefined),
    query: {},
    body: {},
  })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'invalid_secret')
})

test('tick routes bypass session auth; other CRM routes do not', async () => {
  const { isPublicApiRoute } = await import('../server/auth.js')
  assert.equal(isPublicApiRoute('GET', '/api/outreach-sequence/tick'), true)
  assert.equal(isPublicApiRoute('POST', '/api/outreach-sequence/tick'), true)
  assert.equal(isPublicApiRoute('GET', '/api/state'), false)
  assert.equal(isPublicApiRoute('GET', '/api/outreach-sequence/dashboard'), false)
  assert.equal(isPublicApiRoute('POST', '/api/partnership-contacts/poc-1/send-email'), false)
})

test('valid cron secret with automation flags off sends nothing', async () => {
  process.env.OUTREACH_CRON_SECRET = 'phase7-secret'
  const auth = cron.verifyOutreachCronSecret({
    get: (h) => (h === 'x-outreach-cron-secret' ? 'phase7-secret' : undefined),
    query: {},
    body: {},
  })
  assert.equal(auth.ok, true)

  const result = await cron.runOutreachAutomationTick({
    transporter: createMockTransporter(),
    mailFrom: 'contact@aurorasonnet.com',
  })
  assert.equal(result.disabled, true)
  assert.equal(result.sent, 0)
  assert.equal(mailerCalls.length, 0)
})

test('runOutreachAutomationTick blocks production without test email or allow flag', async () => {
  process.env.OUTREACH_SCHEDULER_ENABLED = 'true'
  delete process.env.OUTREACH_TEST_EMAIL

  const result = await cron.runOutreachAutomationTick({
    transporter: createMockTransporter(),
    mailFrom: 'contact@aurorasonnet.com',
    force: true,
  })

  assert.equal(result.sendMode, 'blocked')
  assert.equal(result.error, 'outreach_send_blocked')
  assert.equal(mailerCalls.length, 0)
})

test('runOutreachAutomationTick routes to OUTREACH_TEST_EMAIL in test mode', async () => {
  process.env.OUTREACH_SCHEDULER_ENABLED = 'true'
  process.env.OUTREACH_TEST_EMAIL = TEST_SAFE_EMAIL
  const { sendId } = seedDueSend()

  const result = await cron.runOutreachAutomationTick({
    now: TICK_NOW,
    transporter: createMockTransporter(),
    mailFrom: 'contact@aurorasonnet.com',
    force: true,
  })

  assert.equal(result.sendMode, 'test')
  assert.equal(result.sent, 1)
  assert.equal(mailerCalls[0].to, TEST_SAFE_EMAIL)
  assert.equal(db.getOutreachScheduledSendById(sendId).status, 'sent')
})

test('runOutreachAutomationTick blocks scheduler in production when IMAP reply detection is off', async () => {
  process.env.OUTREACH_SCHEDULER_ENABLED = 'true'
  process.env.OUTREACH_TEST_EMAIL = TEST_SAFE_EMAIL
  delete process.env.OUTREACH_IMAP_ENABLED
  delete process.env.OUTREACH_ALLOW_SENDING_WITHOUT_IMAP
  process.env.RENDER = 'true'
  const { sendId } = seedDueSend()

  try {
    const result = await cron.runOutreachAutomationTick({
      now: TICK_NOW,
      transporter: createMockTransporter(),
      mailFrom: 'contact@aurorasonnet.com',
      force: true,
    })

    assert.equal(result.ok, false)
    assert.equal(result.error, 'imap_reply_detection_required')
    assert.equal(mailerCalls.length, 0)
    assert.equal(db.getOutreachScheduledSendById(sendId).status, 'pending')
  } finally {
    delete process.env.RENDER
  }
})

test('OUTREACH_ALLOW_SENDING_WITHOUT_IMAP explicitly overrides the production IMAP guard', async () => {
  process.env.OUTREACH_SCHEDULER_ENABLED = 'true'
  process.env.OUTREACH_TEST_EMAIL = TEST_SAFE_EMAIL
  delete process.env.OUTREACH_IMAP_ENABLED
  process.env.OUTREACH_ALLOW_SENDING_WITHOUT_IMAP = 'true'
  process.env.RENDER = 'true'
  const { sendId } = seedDueSend()

  try {
    const result = await cron.runOutreachAutomationTick({
      now: TICK_NOW,
      transporter: createMockTransporter(),
      mailFrom: 'contact@aurorasonnet.com',
      force: true,
    })

    assert.equal(result.ok, true)
    assert.ok(result.sent >= 1)
    assert.equal(db.getOutreachScheduledSendById(sendId).status, 'sent')
  } finally {
    delete process.env.RENDER
    delete process.env.OUTREACH_ALLOW_SENDING_WITHOUT_IMAP
  }
})

test('automation tick returns disabled when flags are off', async () => {
  const result = await cron.runOutreachAutomationTick({
    transporter: createMockTransporter(),
    mailFrom: 'contact@aurorasonnet.com',
  })
  assert.equal(result.disabled, true)
  assert.equal(result.schedulerEnabled, false)
  assert.equal(result.imapEnabled, false)
})
