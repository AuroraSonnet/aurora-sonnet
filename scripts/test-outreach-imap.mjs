import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import Database from 'better-sqlite3'
import { instantAtNyLocal } from '../server/businessDays.js'
import { VENUE_FIRST_OUTREACH_TEMPLATE_ID } from '../server/partnershipEmailTemplates.js'
import {
  buildReplyMatchingContext,
  isAutomatedOrBounceMessage,
  matchInboundReply,
} from '../server/outreachImapMatch.js'

const ANCHOR = instantAtNyLocal(2025, 1, 6, 10, 0).toISOString()
const TICK_NOW = instantAtNyLocal(2025, 1, 13, 10, 0)
const FIXED_RNG = () => 0

let dataDir
let db
let outreach
let imap

test.before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'aurora-outreach-phase4-'))
  process.env.DATA_DIR = dataDir
  process.env.OUTREACH_TEST_EMAIL = 'phase4-test@aurorasonnet.com'
  db = await import('../server/db.js')
  outreach = await import('../server/outreachSequence.js')
  imap = await import('../server/outreachImap.js')
})

test.after(() => {
  delete process.env.OUTREACH_TEST_EMAIL
  delete process.env.OUTREACH_IMAP_ENABLED
  if (dataDir) rmSync(dataDir, { recursive: true, force: true })
})

function seedActiveSequence() {
  const email = `venue-reply-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`
  const id = db.createPartnershipContact({
    companyName: 'Reply Venue',
    email,
    partnerType: 'venue',
    stage: 'first_email_sent',
    outreachMethod: 'email',
  })
  db.createOutreachSentMessage({
    partnershipContactId: id,
    messageId: '<first-outreach@aurorasonnet.com>',
    subject: 'Live Music Referrals for Reply Venue Couples',
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

test('matchInboundReply: In-Reply-To thread match (priority 1)', () => {
  const { contact, email } = seedActiveSequence()
  const ctx = matchingContextFromDb()
  const match = matchInboundReply(
    {
      inReplyTo: '<first-outreach@aurorasonnet.com>',
      fromEmail: email,
      subject: 'Re: Live Music Referrals',
    },
    ctx
  )
  assert.equal(match.matched, true)
  assert.equal(match.contactId, contact.id)
  assert.equal(match.matchMethod, 'thread_in_reply_to')
})

test('matchInboundReply: References thread match (priority 2)', () => {
  const { contact, email } = seedActiveSequence()
  const ctx = matchingContextFromDb()
  const match = matchInboundReply(
    {
      references: '<other@x.com> <first-outreach@aurorasonnet.com>',
      fromEmail: email,
      subject: 'Re: Live Music Referrals',
    },
    ctx
  )
  assert.equal(match.matched, true)
  assert.equal(match.contactId, contact.id)
  assert.equal(match.matchMethod, 'thread_references')
})

test('matchInboundReply: sender + normalized subject fallback (priority 3)', () => {
  const { contact, email } = seedActiveSequence()
  const ctx = matchingContextFromDb()
  const match = matchInboundReply(
    {
      fromEmail: email,
      subject: 'Re: Live Music Referrals for Reply Venue Couples',
    },
    ctx
  )
  assert.equal(match.matched, true)
  assert.equal(match.contactId, contact.id)
  assert.equal(match.matchMethod, 'sender_subject')
})

test('uncertain sender match logs unmatched without cancelling sequence', () => {
  const { contact, email } = seedActiveSequence()
  const ctx = matchingContextFromDb()
  const uncertain = matchInboundReply(
    {
      fromEmail: email,
      subject: 'Totally different subject',
    },
    ctx
  )
  assert.equal(uncertain.matched, false)
  assert.equal(uncertain.reason, 'uncertain_fallback')

  const result = imap.processInboundImapMessage(
    {
      uid: 9001,
      messageId: '<uncertain@example.com>',
      fromEmail: email,
      subject: 'Totally different subject',
      receivedAt: TICK_NOW.toISOString(),
      snippet: 'Totally different subject',
    },
    { matchingContext: ctx, mailboxEmail: 'contact@aurorasonnet.com', nowIso: TICK_NOW.toISOString() }
  )
  assert.equal(result.status, 'unmatched')

  const state = outreach.getSequenceState(contact.id)
  assert.equal(state.sequence.status, 'running')
  assert.ok(state.scheduledSends.some((s) => s.status === 'pending' || s.status === 'deferred'))

  const sqlite = new Database(join(dataDir, 'aurora.db'))
  const inbound = sqlite.prepare('SELECT * FROM outreach_inbound_messages WHERE imapUid = 9001').get()
  sqlite.close()
  assert.equal(inbound.matchMethod, 'unmatched')
  assert.equal(inbound.partnershipContactId, null)
})

test('matched reply stops sequence and cancels pending/deferred/claimed sends', () => {
  const { contact, email } = seedActiveSequence()
  const state = outreach.getSequenceState(contact.id)
  const deferredId = state.scheduledSends[1].id
  db.updateOutreachScheduledSend(deferredId, { status: 'deferred' })
  db.claimScheduledSend(state.scheduledSends[0].id, TICK_NOW.toISOString())

  const ctx = matchingContextFromDb()
  const result = imap.processInboundImapMessage(
    {
      uid: 9002,
      messageId: '<reply@example.com>',
      inReplyTo: '<first-outreach@aurorasonnet.com>',
      fromEmail: email,
      subject: 'Re: Live Music Referrals',
      receivedAt: TICK_NOW.toISOString(),
      snippet: 'Thanks, interested',
    },
    { matchingContext: ctx, mailboxEmail: 'contact@aurorasonnet.com', nowIso: TICK_NOW.toISOString() }
  )

  assert.equal(result.status, 'matched')
  assert.equal(result.matchMethod, 'thread_in_reply_to')

  const updated = db.getPartnershipContactById(contact.id)
  assert.equal(updated.stage, 'replied')
  assert.equal(updated.sequenceStatus, 'stopped')

  const after = outreach.getSequenceState(contact.id)
  assert.equal(after.sequence.status, 'stopped')
  assert.equal(after.sequence.stopReason, 'reply_detected')
  assert.ok(after.sequence.lastInboundAt)
  assert.ok(after.scheduledSends.every((s) => s.status === 'cancelled' || s.status === 'sent'))

  const activity = db.listOutreachActivityForContact(contact.id)
  assert.ok(activity.some((a) => a.type === 'reply'))
})

test('automated non-bounce messages are skipped; hard bounces are processed', () => {
  const { contact, email } = seedActiveSequence()
  const ctx = matchingContextFromDb()

  assert.equal(
    isAutomatedOrBounceMessage({
      fromEmail: 'contact@aurorasonnet.com',
      subject: 'Out of office',
      autoSubmitted: 'auto-replied',
    }),
    true
  )

  const bounce = imap.processInboundImapMessage(
    {
      uid: 9020,
      messageId: '<bounce-hard@example.com>',
      fromEmail: 'mailer-daemon@hostinger.com',
      subject: 'Delivery Status Notification (Failure)',
      inReplyTo: '<first-outreach@aurorasonnet.com>',
      bodyText: 'Status: 5.1.1\nDiagnostic-Code: smtp; 550 5.1.1 User unknown',
      receivedAt: TICK_NOW.toISOString(),
    },
    { matchingContext: ctx, mailboxEmail: 'contact@aurorasonnet.com', nowIso: TICK_NOW.toISOString() }
  )
  assert.equal(bounce.status, 'bounce')
  assert.equal(db.getPartnershipContactById(contact.id).stage, 'email_delivery_failed')
})

test('duplicate UID and Message-ID are not processed twice', () => {
  const { contact, email } = seedActiveSequence()
  const ctx = matchingContextFromDb()
  const payload = {
    uid: 9010,
    messageId: '<dup@example.com>',
    inReplyTo: '<first-outreach@aurorasonnet.com>',
      fromEmail: email,
    subject: 'Re: Live Music Referrals',
    receivedAt: TICK_NOW.toISOString(),
    snippet: 'dup',
  }
  const first = imap.processInboundImapMessage(payload, {
    matchingContext: ctx,
    mailboxEmail: 'contact@aurorasonnet.com',
    nowIso: TICK_NOW.toISOString(),
  })
  assert.equal(first.status, 'matched')

  const second = imap.processInboundImapMessage(payload, {
    matchingContext: ctx,
    mailboxEmail: 'contact@aurorasonnet.com',
    nowIso: TICK_NOW.toISOString(),
  })
  assert.equal(second.status, 'duplicate')
})

test('mock IMAP poll is read-only and does not send SMTP', async () => {
  const { contact, email } = seedActiveSequence()
  process.env.OUTREACH_IMAP_ENABLED = 'true'
  process.env.IMAP_USER = 'contact@aurorasonnet.com'
  process.env.IMAP_PASS = 'test-only'

  const fetchCalls = []
  const mockClient = {
    connect: async () => {},
    getMailboxLock: async () => ({ release: () => {} }),
    status: async () => ({ uidValidity: 42 }),
    fetch: async function* () {
      fetchCalls.push('fetch')
      yield {
        uid: 5001,
        envelope: {
          subject: 'Re: Live Music Referrals for Reply Venue Couples',
          from: [{ address: email }],
          date: TICK_NOW,
        },
        internalDate: TICK_NOW,
        headers: new Map([
          ['in-reply-to', '<first-outreach@aurorasonnet.com>'],
          ['message-id', '<mock-poll@example.com>'],
        ]),
      }
    },
    logout: async () => {},
  }

  const result = await imap.runOutreachImapPoll({
    clientFactory: async () => mockClient,
    now: TICK_NOW,
  })

  assert.equal(result.ok, true)
  assert.equal(result.matched, 1)
  assert.equal(fetchCalls.length, 1)
  assert.equal(db.getPartnershipContactById(contact.id).stage, 'replied')

  const sync = db.getImapSyncState('INBOX')
  assert.equal(sync.lastUid, 5001)
  assert.equal(sync.uidValidity, 42)

  const sqlite = new Database(join(dataDir, 'aurora.db'))
  const sendLog = sqlite.prepare('SELECT COUNT(*) AS n FROM outreach_send_log').get().n
  sqlite.close()
  assert.equal(sendLog, 0)
})

test('IMAP poll failure is safe — no stage changes', async () => {
  const { contact } = seedActiveSequence()
  process.env.OUTREACH_IMAP_ENABLED = 'true'
  process.env.IMAP_USER = 'contact@aurorasonnet.com'
  process.env.IMAP_PASS = 'test-only'

  const result = await imap.runOutreachImapPoll({
    clientFactory: async () => {
      throw new Error('IMAP connection refused')
    },
    now: TICK_NOW,
  })

  assert.equal(result.ok, false)
  assert.match(result.error, /connection refused/i)
  assert.equal(db.getPartnershipContactById(contact.id).stage, 'first_email_sent')
})
