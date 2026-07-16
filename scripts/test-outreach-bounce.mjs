import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import Database from 'better-sqlite3'
import { instantAtNyLocal } from '../server/businessDays.js'
import {
  buildReplyMatchingContext,
  classifyBounceSeverity,
  extractBouncedRecipientEmail,
  isBounceCandidate,
  matchInboundBounce,
} from '../server/outreachImapMatch.js'
import { classifySmtpError } from '../server/outreachMailer.js'

const ANCHOR = instantAtNyLocal(2025, 1, 6, 10, 0).toISOString()
const TICK_NOW = instantAtNyLocal(2025, 1, 13, 10, 0)
const FIXED_RNG = () => 0

let dataDir
let db
let outreach
let imap
let scheduler
let mailerCalls

function createMockTransporter(behavior = 'success') {
  mailerCalls = []
  return {
    sendMail: async (opts) => {
      mailerCalls.push(opts)
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
  dataDir = mkdtempSync(join(tmpdir(), 'aurora-outreach-phase5-'))
  process.env.DATA_DIR = dataDir
  process.env.OUTREACH_TEST_EMAIL = 'phase5-test@aurorasonnet.com'
  db = await import('../server/db.js')
  outreach = await import('../server/outreachSequence.js')
  imap = await import('../server/outreachImap.js')
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

function seedActiveSequence(emailSuffix = '') {
  const email = `bounce-venue${emailSuffix}@example.com`
  const id = db.createPartnershipContact({
    companyName: 'Bounce Venue',
    email,
    partnerType: 'venue',
    stage: 'first_email_sent',
    outreachMethod: 'email',
  })
  db.createOutreachSentMessage({
    partnershipContactId: id,
    messageId: `<outbound-${emailSuffix || 'main'}@aurorasonnet.com>`,
    subject: 'Live Music Referrals for Bounce Venue Couples',
    toEmail: email,
    sentAt: ANCHOR,
  })
  outreach.enrollVenueOutreachSequence({
    partnershipContactId: id,
    anchorAt: ANCHOR,
    rng: FIXED_RNG,
  })
  return { contact: db.getPartnershipContactById(id), email }
}

function matchingContextFromDb() {
  const sentMessages = db.listOutboundSentMessagesForActiveSequences()
  const contacts = db.listVenueContactsWithActiveSequences()
  const allContacts = db.listPartnershipContacts()
  return buildReplyMatchingContext({ sentMessages, contacts, allContacts })
}

test('classifyBounceSeverity distinguishes hard vs soft vs unknown', () => {
  assert.equal(
    classifyBounceSeverity({ subject: 'Failure', bodyText: 'Status: 5.1.1\n550 user unknown' }),
    'hard'
  )
  assert.equal(
    classifyBounceSeverity({ subject: 'Deferred', bodyText: 'Status: 4.2.2\ntry again later' }),
    'soft'
  )
  assert.equal(classifyBounceSeverity({ subject: 'Delivery Status Notification (Failure)' }), 'unknown')
  assert.equal(classifySmtpError({ responseCode: 550, response: '550 user unknown' }), 'permanent')
  assert.equal(classifySmtpError({ responseCode: 451, response: '451 try again' }), 'temporary')
})

test('extractBouncedRecipientEmail parses DSN recipient fields', () => {
  const email = extractBouncedRecipientEmail({
    bodyText: 'Final-Recipient: rfc822; bad-user@venue.example\nDiagnostic-Code: smtp; 550',
  })
  assert.equal(email, 'bad-user@venue.example')
})

test('hard bounce via In-Reply-To stops sequence and cancels sends', () => {
  const { contact, email } = seedActiveSequence('-hard')
  const state = outreach.getSequenceState(contact.id)
  db.updateOutreachScheduledSend(state.scheduledSends[1].id, { status: 'deferred' })
  const ctx = matchingContextFromDb()

  const match = matchInboundBounce(
    {
      fromEmail: 'mailer-daemon@hostinger.com',
      subject: 'Delivery Status Notification (Failure)',
      inReplyTo: '<outbound--hard@aurorasonnet.com>',
      bodyText: 'Status: 5.1.1\nDiagnostic-Code: smtp; 550 5.1.1 User unknown',
    },
    ctx
  )
  assert.equal(match.matched, true)
  assert.equal(match.severity, 'hard')

  const result = imap.processInboundImapMessage(
    {
      uid: 9101,
      messageId: '<ndr-hard@example.com>',
      fromEmail: 'mailer-daemon@hostinger.com',
      subject: 'Delivery Status Notification (Failure)',
      inReplyTo: '<outbound--hard@aurorasonnet.com>',
      bodyText: 'Status: 5.1.1\nDiagnostic-Code: smtp; 550 5.1.1 User unknown',
      receivedAt: TICK_NOW.toISOString(),
    },
    { matchingContext: ctx, mailboxEmail: 'contact@aurorasonnet.com', nowIso: TICK_NOW.toISOString() }
  )

  assert.equal(result.status, 'bounce')
  const updated = db.getPartnershipContactById(contact.id)
  assert.equal(updated.stage, 'email_delivery_failed')
  assert.equal(updated.sequenceStatus, 'stopped')
  assert.equal(updated.doNotContact, true)

  const after = outreach.getSequenceState(contact.id)
  assert.equal(after.sequence.status, 'stopped')
  assert.equal(after.sequence.stopReason, 'hard_bounce_detected')
  assert.ok(after.scheduledSends.every((s) => s.status === 'cancelled' || s.status === 'sent'))

  const activity = db.listOutreachActivityForContact(contact.id)
  assert.ok(activity.some((a) => a.type === 'note' && /hard bounce/i.test(a.body)))
  assert.ok(activity.some((a) => a.type === 'stage_change' && /email_delivery_failed/i.test(a.body)))

  const sqlite = new Database(join(dataDir, 'aurora.db'))
  const inbound = sqlite.prepare('SELECT * FROM outreach_inbound_messages WHERE imapUid = 9101').get()
  sqlite.close()
  assert.equal(inbound.matchMethod, 'bounce_thread_in_reply_to')
  assert.equal(inbound.partnershipContactId, contact.id)
})

test('soft bounce is logged but does not stop sequence', () => {
  const { contact } = seedActiveSequence('-soft')
  const ctx = matchingContextFromDb()

  const result = imap.processInboundImapMessage(
    {
      uid: 9102,
      messageId: '<ndr-soft@example.com>',
      fromEmail: 'mailer-daemon@hostinger.com',
      subject: 'Delivery Status Notification (Delay)',
      inReplyTo: '<outbound--soft@aurorasonnet.com>',
      bodyText: 'Status: 4.2.2\nDiagnostic-Code: smtp; 451 4.2.2 try again later',
      receivedAt: TICK_NOW.toISOString(),
    },
    { matchingContext: ctx, mailboxEmail: 'contact@aurorasonnet.com', nowIso: TICK_NOW.toISOString() }
  )

  assert.equal(result.status, 'skipped')
  assert.equal(result.reason, 'bounce_soft')
  assert.equal(db.getPartnershipContactById(contact.id).stage, 'first_email_sent')
  assert.equal(outreach.getSequenceState(contact.id).sequence.status, 'running')
})

test('unmatched hard bounce does not stop any sequence', () => {
  const { contact } = seedActiveSequence('-unmatched')
  const ctx = matchingContextFromDb()

  const result = imap.processInboundImapMessage(
    {
      uid: 9103,
      messageId: '<ndr-unknown@example.com>',
      fromEmail: 'mailer-daemon@hostinger.com',
      subject: 'Delivery Status Notification (Failure)',
      bodyText: 'Status: 5.1.1\nno recipient listed',
      receivedAt: TICK_NOW.toISOString(),
    },
    { matchingContext: ctx, mailboxEmail: 'contact@aurorasonnet.com', nowIso: TICK_NOW.toISOString() }
  )

  assert.equal(result.status, 'unmatched')
  assert.equal(outreach.getSequenceState(contact.id).sequence.status, 'running')
})

test('hard bounce via recipient email fallback', () => {
  const { contact, email } = seedActiveSequence('-recipient')
  const ctx = matchingContextFromDb()

  const result = imap.processInboundImapMessage(
    {
      uid: 9104,
      messageId: '<ndr-recipient@example.com>',
      fromEmail: 'mailer-daemon@hostinger.com',
      subject: 'Undelivered Mail Returned to Sender',
      bodyText: `Final-Recipient: rfc822; ${email}\nStatus: 5.0.0`,
      receivedAt: TICK_NOW.toISOString(),
    },
    { matchingContext: ctx, mailboxEmail: 'contact@aurorasonnet.com', nowIso: TICK_NOW.toISOString() }
  )

  assert.equal(result.status, 'bounce')
  assert.equal(result.matchMethod, 'bounce_recipient')
  assert.equal(db.getPartnershipContactById(contact.id).stage, 'email_delivery_failed')
})

test('outbound permanent SMTP failure stops sequence without retry', async () => {
  const { contact } = seedActiveSequence('-smtp')
  const state = outreach.getSequenceState(contact.id)
  const dueId = state.scheduledSends[0].id
  db.updateOutreachScheduledSend(dueId, { scheduledAt: TICK_NOW.toISOString(), status: 'pending' })

  const transporter = createMockTransporter('perm_fail')
  const tick = await scheduler.runOutreachSchedulerTick({
    now: TICK_NOW,
    transporter,
    mailFrom: 'contact@aurorasonnet.com',
    rng: FIXED_RNG,
    force: true,
  })

  assert.ok(tick.failed >= 1)
  const send = db.getOutreachScheduledSendById(dueId)
  assert.equal(send.status, 'failed')
  assert.equal(send.attemptCount, 1)

  const updated = db.getPartnershipContactById(contact.id)
  assert.equal(updated.stage, 'email_delivery_failed')
  assert.equal(updated.doNotContact, true)
  assert.equal(outreach.getSequenceState(contact.id).sequence.status, 'stopped')
  assert.ok(
    outreach
      .getSequenceState(contact.id)
      .scheduledSends.filter((s) => s.id !== dueId)
      .every((s) => s.status === 'cancelled')
  )
})

test('isBounceCandidate detects mailer-daemon and DSN subjects', () => {
  assert.equal(isBounceCandidate({ fromEmail: 'mailer-daemon@hostinger.com', subject: 'hello' }), true)
  assert.equal(isBounceCandidate({ fromEmail: 'user@venue.com', subject: 'Mail delivery failed' }), true)
  assert.equal(isBounceCandidate({ fromEmail: 'user@venue.com', subject: 'Re: partnership' }), false)
})
