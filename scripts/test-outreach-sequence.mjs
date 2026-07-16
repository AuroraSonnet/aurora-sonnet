import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import Database from 'better-sqlite3'
import { instantAtNyLocal, nyBusinessDateString, isWithinSendWindow } from '../server/businessDays.js'
import {
  VENUE_FIRST_OUTREACH_TEMPLATE_ID,
  VENUE_FOLLOW_UP_1_TEMPLATE_ID,
  VENUE_FOLLOW_UP_2_TEMPLATE_ID,
  VENUE_FINAL_FOLLOW_UP_TEMPLATE_ID,
} from '../server/partnershipEmailTemplates.js'

const ANCHOR = instantAtNyLocal(2025, 1, 6, 10, 0).toISOString()
const FIXED_RNG = () => 0

let dataDir
let db
let outreach

test.before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'aurora-outreach-phase2-'))
  process.env.DATA_DIR = dataDir
  db = await import('../server/db.js')
  outreach = await import('../server/outreachSequence.js')
})

test.after(() => {
  if (dataDir) rmSync(dataDir, { recursive: true, force: true })
})

function seedVenueContact(overrides = {}) {
  const id = db.createPartnershipContact({
    companyName: 'Test Venue',
    email: `venue-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
    partnerType: 'venue',
    stage: 'not_contacted',
    outreachMethod: 'email',
    ...overrides,
  })
  return db.getPartnershipContactById(id)
}

test('enrollment schedules chained follow-ups with venue templates', () => {
  const contact = seedVenueContact()
  const eligibility = outreach.isEligibleForVenueSequenceEnrollment(contact, {
    templateId: VENUE_FIRST_OUTREACH_TEMPLATE_ID,
  })
  assert.equal(eligibility.ok, true)

  const result = outreach.enrollVenueOutreachSequence({
    partnershipContactId: contact.id,
    anchorAt: ANCHOR,
    rng: FIXED_RNG,
  })
  assert.equal(result.skipped, undefined)
  assert.equal(result.sequence.status, 'running')
  assert.equal(result.sequence.currentStep, 'follow_up_1')
  assert.equal(result.scheduledSends.length, 3)

  const [fu1, fu2, fu3] = result.scheduledSends
  assert.equal(fu1.step, 'follow_up_1')
  assert.equal(fu1.templateId, VENUE_FOLLOW_UP_1_TEMPLATE_ID)
  assert.equal(fu2.step, 'follow_up_2')
  assert.equal(fu2.templateId, VENUE_FOLLOW_UP_2_TEMPLATE_ID)
  assert.equal(fu3.step, 'follow_up_3')
  assert.equal(fu3.templateId, VENUE_FINAL_FOLLOW_UP_TEMPLATE_ID)

  assert.equal(nyBusinessDateString(new Date(fu1.scheduledAt)), '2025-01-13')
  assert.equal(nyBusinessDateString(new Date(fu2.scheduledAt)), '2025-01-22')
  assert.equal(nyBusinessDateString(new Date(fu3.scheduledAt)), '2025-02-05')

  for (const send of result.scheduledSends) {
    assert.equal(send.status, 'pending')
    assert.equal(isWithinSendWindow(new Date(send.scheduledAt)), true)
  }

  const updated = db.getPartnershipContactById(contact.id)
  assert.equal(updated.sequenceStatus, 'running')

  const activity = db.listOutreachActivityForContact(contact.id)
  assert.ok(activity.some((a) => a.type === 'note' && a.body.includes('Outreach sequence enrolled')))

  const sqlite = new Database(join(dataDir, 'aurora.db'))
  const sendLog = sqlite.prepare('SELECT COUNT(*) AS n FROM outreach_send_log').get().n
  sqlite.close()
  assert.equal(sendLog, 0)
})

test('duplicate active sequence is prevented', () => {
  const contact = seedVenueContact()
  outreach.enrollVenueOutreachSequence({
    partnershipContactId: contact.id,
    anchorAt: ANCHOR,
    rng: FIXED_RNG,
  })
  const second = outreach.enrollVenueOutreachSequence({
    partnershipContactId: contact.id,
    anchorAt: ANCHOR,
    rng: FIXED_RNG,
  })
  assert.equal(second.skipped, true)
  assert.equal(second.reason, 'sequence_already_active')

  const state = outreach.getSequenceState(contact.id)
  assert.equal(state.scheduledSends.filter((s) => s.status === 'pending').length, 3)
})

test('ineligible contacts are not enrolled', () => {
  const planner = seedVenueContact({ partnerType: 'planner' })
  assert.equal(
    outreach.isEligibleForVenueSequenceEnrollment(planner, { templateId: VENUE_FIRST_OUTREACH_TEMPLATE_ID }).reason,
    'not_venue'
  )

  const formContact = seedVenueContact({ outreachMethod: 'website_contact_form' })
  assert.equal(
    outreach.isEligibleForVenueSequenceEnrollment(formContact, { templateId: VENUE_FIRST_OUTREACH_TEMPLATE_ID }).reason,
    'website_contact_form'
  )

  const dnc = seedVenueContact()
  db.updatePartnershipContact(dnc.id, { doNotContact: true })
  assert.equal(
    outreach.isEligibleForVenueSequenceEnrollment(db.getPartnershipContactById(dnc.id), {
      templateId: VENUE_FIRST_OUTREACH_TEMPLATE_ID,
    }).reason,
    'do_not_contact'
  )

  const badEmail = seedVenueContact({ email: 'not-an-email' })
  assert.equal(
    outreach.isEligibleForVenueSequenceEnrollment(badEmail, { templateId: VENUE_FIRST_OUTREACH_TEMPLATE_ID }).reason,
    'invalid_email'
  )

  const wrongTemplate = seedVenueContact()
  assert.equal(
    outreach.isEligibleForVenueSequenceEnrollment(wrongTemplate, { templateId: VENUE_FOLLOW_UP_1_TEMPLATE_ID }).reason,
    'not_first_outreach_template'
  )
})

test('stage change to replied stops sequence and cancels pending sends', () => {
  const contact = seedVenueContact()
  outreach.enrollVenueOutreachSequence({
    partnershipContactId: contact.id,
    anchorAt: ANCHOR,
    rng: FIXED_RNG,
  })

  const stopResult = outreach.handleContactStageChange(contact.id, 'replied')
  assert.ok(stopResult)
  assert.equal(stopResult.sequence.status, 'stopped')
  assert.equal(stopResult.cancelledCount, 3)

  const state = outreach.getSequenceState(contact.id)
  assert.ok(state.scheduledSends.every((s) => s.status === 'cancelled'))
  assert.equal(db.getPartnershipContactById(contact.id).sequenceStatus, 'stopped')
})

test('pause, resume, stop, and skip-next behave correctly', () => {
  const contact = seedVenueContact()
  outreach.enrollVenueOutreachSequence({
    partnershipContactId: contact.id,
    anchorAt: ANCHOR,
    rng: FIXED_RNG,
  })

  const paused = outreach.pauseSequence(contact.id)
  assert.equal(paused.status, 'paused')
  assert.equal(db.getPartnershipContactById(contact.id).sequenceStatus, 'paused')

  const resumed = outreach.resumeSequence(contact.id)
  assert.equal(resumed.status, 'running')

  const skipped = outreach.skipNextScheduledSend(contact.id)
  assert.equal(skipped.skippedSend.step, 'follow_up_1')
  assert.equal(skipped.skippedSend.status, 'cancelled')
  assert.equal(skipped.sequence.currentStep, 'follow_up_2')

  const stopped = outreach.stopSequence(contact.id, 'manual_test')
  assert.equal(stopped.sequence.status, 'stopped')
  const pendingLeft = outreach
    .getSequenceState(contact.id)
    .scheduledSends.filter((s) => s.status === 'pending')
  assert.equal(pendingLeft.length, 0)
})

test('tryEnrollVenueAfterFirstOutreach enrolls without sending mail', () => {
  const contact = seedVenueContact()
  const result = outreach.tryEnrollVenueAfterFirstOutreach({
    contactId: contact.id,
    contact,
    templateId: VENUE_FIRST_OUTREACH_TEMPLATE_ID,
    anchorAt: ANCHOR,
    rng: FIXED_RNG,
  })
  assert.equal(result.enrolled, true)
  assert.equal(result.scheduledSends.length, 3)
})
