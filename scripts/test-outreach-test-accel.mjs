import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { instantAtNyLocal } from '../server/businessDays.js'
import { VENUE_FOLLOW_UP_1_TEMPLATE_ID } from '../server/partnershipEmailTemplates.js'

const TEST_SAFE_EMAIL = 'e2e-accel-test@aurorasonnet.com'
const TICK_NOW = instantAtNyLocal(2025, 1, 13, 10, 0)
const ANCHOR = instantAtNyLocal(2025, 1, 6, 10, 0).toISOString()
const FIXED_RNG = () => 0

let dataDir
let db
let outreach
let testAccel
let mailerCalls

function createMockTransporter() {
  mailerCalls = []
  return {
    sendMail: async (opts) => {
      mailerCalls.push(opts)
      return {
        messageId: `<mock-accel-${mailerCalls.length}@aurorasonnet.com>`,
        response: '250 OK',
        accepted: [opts.to],
        rejected: [],
      }
    },
  }
}

test.before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'aurora-outreach-accel-'))
  process.env.DATA_DIR = dataDir
  process.env.OUTREACH_TEST_EMAIL = TEST_SAFE_EMAIL
  delete process.env.OUTREACH_ALLOW_PRODUCTION_SENDS
  db = await import('../server/db.js')
  outreach = await import('../server/outreachSequence.js')
  testAccel = await import('../server/outreachTestAccel.js')
})

test.after(() => {
  delete process.env.OUTREACH_TEST_EMAIL
  delete process.env.OUTREACH_ALLOW_PRODUCTION_SENDS
  if (dataDir) rmSync(dataDir, { recursive: true, force: true })
})

function seedE2eContact(email = 'fake-venue-e2e@example.invalid') {
  const id = db.createPartnershipContact({
    companyName: 'E2E Test Venue (fake)',
    email,
    partnerType: 'venue',
    stage: 'first_email_sent',
    outreachMethod: 'email',
  })
  db.createOutreachSentMessage({
    partnershipContactId: id,
    messageId: '<anchor@aurorasonnet.com>',
    subject: 'Live Music Referrals',
    toEmail: email,
    sentAt: ANCHOR,
  })
  outreach.enrollVenueOutreachSequence({ partnershipContactId: id, anchorAt: ANCHOR, rng: FIXED_RNG })
  return id
}

test('rejects acceleration for non-E2E contacts', async () => {
  const id = db.createPartnershipContact({
    companyName: 'Real Venue LLC',
    email: 'venue@example.com',
    partnerType: 'venue',
    stage: 'first_email_sent',
  })
  const result = await testAccel.accelerateAndSendNextTestFollowUp({
    partnershipContactId: id,
    now: TICK_NOW,
    transporter: createMockTransporter(),
    mailFrom: 'contact@aurorasonnet.com',
  })
  assert.equal(result.ok, false)
  assert.match(result.error, /E2E Test/)
})

test('rejects acceleration when OUTREACH_ALLOW_PRODUCTION_SENDS is enabled', async () => {
  process.env.OUTREACH_ALLOW_PRODUCTION_SENDS = 'true'
  const id = seedE2eContact()
  const result = await testAccel.accelerateAndSendNextTestFollowUp({
    partnershipContactId: id,
    now: TICK_NOW,
    transporter: createMockTransporter(),
    mailFrom: 'contact@aurorasonnet.com',
  })
  assert.equal(result.ok, false)
  delete process.env.OUTREACH_ALLOW_PRODUCTION_SENDS
})

test('accelerateTestFollowUpScheduleOnly reschedules without sending', async () => {
  const contactEmail = 'fake-venue-schedule@example.invalid'
  const id = seedE2eContact(contactEmail)
  const transporter = createMockTransporter()

  const result = testAccel.accelerateTestFollowUpScheduleOnly({
    partnershipContactId: id,
    now: TICK_NOW,
  })

  assert.equal(result.ok, true)
  assert.equal(result.step, 'follow_up_1')
  assert.equal(mailerCalls.length, 0)

  const state = outreach.getSequenceState(id)
  const pending = state.scheduledSends.find((s) => s.step === 'follow_up_1')
  assert.equal(pending.status, 'pending')
  assert.equal(pending.scheduledAt, result.scheduledAt)
  assert.ok(new Date(pending.scheduledAt).getTime() > TICK_NOW.getTime() - 1000)
})

test('accelerates and sends follow_up_1 only to OUTREACH_TEST_EMAIL', async () => {
  const contactEmail = 'fake-venue-e2e@example.invalid'
  const id = seedE2eContact(contactEmail)
  const state = outreach.getSequenceState(id)
  const firstPending = state.scheduledSends.find((s) => s.status === 'pending')
  assert.equal(firstPending.step, 'follow_up_1')
  assert.equal(firstPending.templateId, VENUE_FOLLOW_UP_1_TEMPLATE_ID)

  const result = await testAccel.accelerateAndSendNextTestFollowUp({
    partnershipContactId: id,
    now: TICK_NOW,
    transporter: createMockTransporter(),
    mailFrom: 'contact@aurorasonnet.com',
  })

  assert.equal(result.ok, true)
  assert.equal(result.outcome, 'sent')
  assert.equal(result.step, 'follow_up_1')
  assert.equal(result.routedTo, TEST_SAFE_EMAIL)
  assert.equal(result.contactEmail, contactEmail)
  assert.equal(mailerCalls.length, 1)
  assert.equal(mailerCalls[0].to, TEST_SAFE_EMAIL)
  assert.notEqual(mailerCalls[0].to, contactEmail)

  const contact = db.getPartnershipContactById(id)
  assert.equal(contact.stage, 'follow_up_1')

  const after = outreach.getSequenceState(id)
  const sent = after.scheduledSends.find((s) => s.id === firstPending.id)
  assert.equal(sent.status, 'sent')
  const stillPending = after.scheduledSends.filter((s) => s.status === 'pending')
  assert.equal(stillPending.length, 2)
  assert.equal(stillPending[0].step, 'follow_up_2')
})

test('second acceleration sends follow_up_2 without touching other contacts', async () => {
  const otherId = db.createPartnershipContact({
    companyName: 'Other Venue',
    email: 'other@example.com',
    partnerType: 'venue',
    stage: 'first_email_sent',
  })
  outreach.enrollVenueOutreachSequence({
    partnershipContactId: otherId,
    anchorAt: ANCHOR,
    rng: FIXED_RNG,
  })
  db.createOutreachSentMessage({
    partnershipContactId: otherId,
    messageId: '<other-anchor@aurorasonnet.com>',
    subject: 'Live Music Referrals',
    toEmail: 'other@example.com',
    sentAt: ANCHOR,
  })

  const id = seedE2eContact('fake2@example.invalid')
  const transporter = createMockTransporter()

  await testAccel.accelerateAndSendNextTestFollowUp({
    partnershipContactId: id,
    now: TICK_NOW,
    transporter,
    mailFrom: 'contact@aurorasonnet.com',
  })

  mailerCalls = []
  const second = await testAccel.accelerateAndSendNextTestFollowUp({
    partnershipContactId: id,
    now: TICK_NOW,
    transporter,
    mailFrom: 'contact@aurorasonnet.com',
  })

  assert.equal(second.ok, true)
  assert.equal(second.step, 'follow_up_2')
  assert.equal(mailerCalls.length, 1)

  const otherState = outreach.getSequenceState(otherId)
  assert.ok(otherState.scheduledSends.every((s) => s.status === 'pending'))
})
