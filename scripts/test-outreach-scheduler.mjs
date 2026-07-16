import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import Database from 'better-sqlite3'
import { instantAtNyLocal, nyBusinessDateString } from '../server/businessDays.js'
import { VENUE_FIRST_OUTREACH_TEMPLATE_ID } from '../server/partnershipEmailTemplates.js'
import {
  OUTREACH_DAILY_LIMIT,
  OUTREACH_MAX_SEND_ATTEMPTS,
  OUTREACH_RETRY_DELAY_MS,
  buildThreadingHeaders,
  classifySmtpError,
} from '../server/outreachMailer.js'

const TICK_NOW = instantAtNyLocal(2025, 1, 13, 10, 0)
const ANCHOR = instantAtNyLocal(2025, 1, 6, 10, 0).toISOString()
const FIXED_RNG = () => 0
const TEST_SAFE_EMAIL = 'phase3-test-safe@aurorasonnet.com'

let dataDir
let db
let outreach
let scheduler
let mailerCalls

function createMockTransporter(behavior = 'success') {
  mailerCalls = []
  return {
    sendMail: async (opts) => {
      mailerCalls.push(opts)
      if (behavior === 'temp_fail') {
        const err = new Error('Temporary SMTP failure')
        err.responseCode = 421
        err.response = '421 4.3.2 Service not available'
        throw err
      }
      if (behavior === 'perm_fail') {
        const err = new Error('Permanent SMTP failure')
        err.responseCode = 550
        err.response = '550 5.1.1 User unknown'
        throw err
      }
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
  dataDir = mkdtempSync(join(tmpdir(), 'aurora-outreach-phase3-'))
  process.env.DATA_DIR = dataDir
  process.env.OUTREACH_TEST_EMAIL = TEST_SAFE_EMAIL
  delete process.env.OUTREACH_ALLOW_PRODUCTION_SENDS
  db = await import('../server/db.js')
  outreach = await import('../server/outreachSequence.js')
  scheduler = await import('../server/outreachScheduler.js')
})

test.beforeEach(() => {
  const sqlite = new Database(join(dataDir, 'aurora.db'))
  sqlite.exec('DELETE FROM outreach_daily_quota')
  sqlite.close()
})

test.after(() => {
  delete process.env.OUTREACH_TEST_EMAIL
  if (dataDir) rmSync(dataDir, { recursive: true, force: true })
})

function seedVenue(stage = 'first_email_sent') {
  const id = db.createPartnershipContact({
    companyName: 'Test Venue LLC',
    email: 'real-venue@weddingvenue.example',
    partnerType: 'venue',
    stage,
    outreachMethod: 'email',
  })
  return db.getPartnershipContactById(id)
}

function seedThreadAnchor(contactId) {
  db.createOutreachSentMessage({
    partnershipContactId: contactId,
    messageId: '<first-outreach@aurorasonnet.com>',
    subject: 'Live Music Referrals',
    toEmail: 'real-venue@weddingvenue.example',
    sentAt: ANCHOR,
  })
}

function enrollDueNow(contactId) {
  outreach.enrollVenueOutreachSequence({
    partnershipContactId: contactId,
    anchorAt: ANCHOR,
    rng: FIXED_RNG,
  })
  const state = outreach.getSequenceState(contactId)
  const first = state.scheduledSends[0]
  db.updateOutreachScheduledSend(first.id, {
    scheduledAt: TICK_NOW.toISOString(),
    status: 'pending',
  })
  return state
}

test('scheduler sends due follow-up to OUTREACH_TEST_EMAIL only', async () => {
  const contact = seedVenue()
  seedThreadAnchor(contact.id)
  enrollDueNow(contact.id)
  const transporter = createMockTransporter()

  const result = await scheduler.runOutreachSchedulerTick({
    now: TICK_NOW,
    transporter,
    mailFrom: 'contact@aurorasonnet.com',
    rng: FIXED_RNG,
    force: true,
  })

  assert.equal(result.sent, 1)
  assert.equal(mailerCalls.length, 1)
  assert.equal(mailerCalls[0].to, TEST_SAFE_EMAIL)
  assert.ok(mailerCalls[0].subject.includes('real-venue@weddingvenue.example'))
  assert.equal(mailerCalls[0].headers['In-Reply-To'], '<first-outreach@aurorasonnet.com>')

  const state = outreach.getSequenceState(contact.id)
  const sent = state.scheduledSends.find((s) => s.step === 'follow_up_1')
  assert.equal(sent.status, 'sent')
  assert.ok(sent.messageId)

  const sqlite = new Database(join(dataDir, 'aurora.db'))
  const logs = sqlite.prepare('SELECT * FROM outreach_send_log WHERE result = ?').all('sent')
  const messages = sqlite.prepare('SELECT * FROM outreach_sent_messages WHERE scheduledSendId IS NOT NULL').all()
  sqlite.close()
  assert.equal(logs.length, 1)
  assert.equal(messages.length, 1)
  assert.equal(logs[0].subject, mailerCalls[0].subject)
  assert.equal(messages[0].inReplyTo, '<first-outreach@aurorasonnet.com>')
})

test('double tick does not send the same scheduled step twice', async () => {
  const contact = seedVenue()
  seedThreadAnchor(contact.id)
  enrollDueNow(contact.id)
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
})

test('crash recovery finalizes from send_log without resending', async () => {
  const contact = seedVenue()
  seedThreadAnchor(contact.id)
  const enrolled = enrollDueNow(contact.id)
  const sendId = enrolled.scheduledSends[0].id
  const transporter = createMockTransporter()

  db.claimScheduledSend(sendId, TICK_NOW.toISOString())
  db.createOutreachSendLog({
    scheduledSendId: sendId,
    partnershipContactId: contact.id,
    templateId: enrolled.scheduledSends[0].templateId,
    subject: 'Recovered subject',
    body: 'Recovered body',
    attemptedAt: TICK_NOW.toISOString(),
    result: 'sent',
    smtpResponse: '250 OK',
    messageId: '<recovered@aurorasonnet.com>',
  })

  const result = await scheduler.runOutreachSchedulerTick({
    now: TICK_NOW,
    transporter,
    mailFrom: 'contact@aurorasonnet.com',
    force: true,
  })

  assert.equal(result.recovered, 1)
  assert.equal(mailerCalls.length, 0)
  const row = db.getOutreachScheduledSendById(sendId)
  assert.equal(row.status, 'sent')
})

test('daily quota defers excess sends to next business day', async () => {
  const businessDate = nyBusinessDateString(TICK_NOW)
  const sqlite = new Database(join(dataDir, 'aurora.db'))
  sqlite
    .prepare('INSERT OR REPLACE INTO outreach_daily_quota (businessDate, sentCount, deferredCount, updatedAt) VALUES (?, ?, 0, ?)')
    .run(businessDate, OUTREACH_DAILY_LIMIT, TICK_NOW.toISOString())
  sqlite.close()

  const contact = seedVenue()
  seedThreadAnchor(contact.id)
  const enrolled = enrollDueNow(contact.id)
  const transporter = createMockTransporter()

  const result = await scheduler.runOutreachSchedulerTick({
    now: TICK_NOW,
    transporter,
    mailFrom: 'contact@aurorasonnet.com',
    force: true,
  })

  assert.equal(result.sent, 0)
  assert.equal(result.deferred, 1)
  assert.equal(mailerCalls.length, 0)
  const row = db.getOutreachScheduledSendById(enrolled.scheduledSends[0].id)
  assert.equal(row.status, 'deferred')
  assert.equal(row.deferReason, 'daily_limit')
  assert.ok(new Date(row.scheduledAt).getTime() > TICK_NOW.getTime())
})

test('temporary SMTP errors retry; permanent errors fail the scheduled send', async () => {
  const contact = seedVenue()
  seedThreadAnchor(contact.id)
  const enrolled = enrollDueNow(contact.id)
  const sendId = enrolled.scheduledSends[0].id

  const tempTransport = createMockTransporter('temp_fail')
  await scheduler.runOutreachSchedulerTick({
    now: TICK_NOW,
    transporter: tempTransport,
    mailFrom: 'contact@aurorasonnet.com',
    force: true,
  })
  let row = db.getOutreachScheduledSendById(sendId)
  assert.equal(row.status, 'pending')
  assert.equal(row.attemptCount, 1)
  assert.ok(new Date(row.scheduledAt).getTime() >= TICK_NOW.getTime() + OUTREACH_RETRY_DELAY_MS - 1000)

  const permTransport = createMockTransporter('perm_fail')
  db.updateOutreachScheduledSend(sendId, {
    scheduledAt: TICK_NOW.toISOString(),
    attemptCount: OUTREACH_MAX_SEND_ATTEMPTS,
  })
  await scheduler.runOutreachSchedulerTick({
    now: TICK_NOW,
    transporter: permTransport,
    mailFrom: 'contact@aurorasonnet.com',
    force: true,
  })
  row = db.getOutreachScheduledSendById(sendId)
  assert.equal(row.status, 'failed')
})

test('pre-send checks block website contact form outreach', async () => {
  const contact = seedVenue()
  db.updatePartnershipContact(contact.id, { outreachMethod: 'website_contact_form' })
  seedThreadAnchor(contact.id)
  const enrolled = enrollDueNow(contact.id)
  const transporter = createMockTransporter()

  const result = await scheduler.runOutreachSchedulerTick({
    now: TICK_NOW,
    transporter,
    mailFrom: 'contact@aurorasonnet.com',
    force: true,
  })

  assert.equal(result.sent, 0)
  assert.equal(mailerCalls.length, 0)
  const row = db.getOutreachScheduledSendById(enrolled.scheduledSends[0].id)
  assert.equal(row.status, 'cancelled')
})

test('threading headers chain prior sent messages', () => {
  const headers = buildThreadingHeaders([
    { messageId: '<first@aurorasonnet.com>' },
    { messageId: '<second@aurorasonnet.com>' },
  ])
  assert.equal(headers.inReplyTo, '<first@aurorasonnet.com>')
  assert.equal(headers.references, '<first@aurorasonnet.com> <second@aurorasonnet.com>')
})

test('SMTP error classification', () => {
  assert.equal(classifySmtpError({ responseCode: 550, response: '550 user unknown' }), 'permanent')
  assert.equal(classifySmtpError({ responseCode: 421, response: '421 try again later' }), 'temporary')
})

test('tick outside send window sends nothing without force', async () => {
  const contact = seedVenue()
  seedThreadAnchor(contact.id)
  enrollDueNow(contact.id)
  const transporter = createMockTransporter()
  const saturday = instantAtNyLocal(2025, 1, 11, 10, 0)

  const result = await scheduler.runOutreachSchedulerTick({
    now: saturday,
    transporter,
    mailFrom: 'contact@aurorasonnet.com',
    force: false,
  })

  assert.equal(result.outsideWindow, true)
  assert.equal(result.sent, 0)
  assert.equal(mailerCalls.length, 0)
})

test('no automated mail is addressed to seeded venue emails', async () => {
  const contact = seedVenue()
  seedThreadAnchor(contact.id)
  enrollDueNow(contact.id)
  const transporter = createMockTransporter()

  await scheduler.runOutreachSchedulerTick({
    now: TICK_NOW,
    transporter,
    mailFrom: 'contact@aurorasonnet.com',
    force: true,
  })

  for (const call of mailerCalls) {
    assert.notEqual(call.to, 'real-venue@weddingvenue.example')
    assert.equal(call.to, TEST_SAFE_EMAIL)
  }
})
