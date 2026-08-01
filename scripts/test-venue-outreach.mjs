import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

let dataDir
let db
let venueOutreach

test.before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'aurora-venue-outreach-'))
  process.env.DATA_DIR = dataDir
  db = await import('../server/db.js')
  venueOutreach = await import('../server/venueOutreach.js')
})

test.after(() => {
  delete process.env.DATA_DIR
  if (dataDir) rmSync(dataDir, { recursive: true, force: true })
})

function makeVenue(overrides = {}) {
  return db.createVenue({
    companyName: 'Outreach Test Venue',
    partnerType: 'venue',
    stage: 'visited',
    ...overrides,
  })
}

function makeContact(venueId, overrides = {}) {
  return db.createVenueContact({
    venueId,
    name: 'Pat Coordinator',
    email: 'pat@outreachtestvenue.example.com',
    ...overrides,
  })
}

test('enrollVenuePostVisitSequence genuinely creates a running 3-step sequence, not just a UI flag', () => {
  const venueId = makeVenue()
  const contactId = makeContact(venueId)

  const result = venueOutreach.enrollVenuePostVisitSequence({
    venueId,
    visitId: 'visit-1',
    contactId,
    anchorAt: new Date().toISOString(),
    rng: () => 0,
  })

  assert.equal(result.enrolled, true)
  assert.equal(result.sequence.status, 'running')
  assert.equal(result.sequence.sequenceType, 'post_visit')
  assert.equal(result.sequence.venueId, venueId)
  assert.equal(result.sequence.visitId, 'visit-1')
  assert.equal(result.scheduledSends.length, 3, 'exactly three follow-up emails must be scheduled')
  const steps = result.scheduledSends.map((s) => s.step).sort()
  assert.deepEqual(steps, ['follow_up_1', 'follow_up_2', 'follow_up_3'])
  for (const send of result.scheduledSends) {
    assert.equal(send.status, 'pending')
    assert.equal(send.sequenceType, 'post_visit')
    assert.equal(send.venueId, venueId)
  }

  const venue = db.getVenueById(venueId)
  assert.ok(venue.linkedPartnershipContactId, 'a shadow partnership_contacts row must be linked back from the venue')
  const shadow = db.getPartnershipContactById(venue.linkedPartnershipContactId)
  assert.equal(shadow.email, 'pat@outreachtestvenue.example.com')
  assert.equal(shadow.companyName, 'Outreach Test Venue')
})

test('a second enrollment for the same venue reuses the shadow contact and does not double-enroll', () => {
  const venueId = makeVenue()
  const contactId = makeContact(venueId)

  const first = venueOutreach.enrollVenuePostVisitSequence({
    venueId,
    visitId: 'visit-a',
    contactId,
    anchorAt: new Date().toISOString(),
    rng: () => 0,
  })
  assert.equal(first.enrolled, true)
  const venueAfterFirst = db.getVenueById(venueId)

  const second = venueOutreach.enrollVenuePostVisitSequence({
    venueId,
    visitId: 'visit-b',
    contactId,
    anchorAt: new Date().toISOString(),
    rng: () => 0,
  })

  assert.equal(second.enrolled, false, 'must not start a second concurrent sequence for the same shadow contact')
  assert.equal(second.reason, 'sequence_already_active')
  const venueAfterSecond = db.getVenueById(venueId)
  assert.equal(
    venueAfterSecond.linkedPartnershipContactId,
    venueAfterFirst.linkedPartnershipContactId,
    'the same shadow contact must be reused, not recreated'
  )
})

test('enrollVenuePostVisitSequence refuses venues marked doNotContact or in a closed stage', () => {
  const dncVenueId = makeVenue({ doNotContact: true })
  const dncContactId = makeContact(dncVenueId, { email: 'dnc@example.com' })
  const dncResult = venueOutreach.enrollVenuePostVisitSequence({
    venueId: dncVenueId,
    visitId: 'visit-dnc',
    contactId: dncContactId,
    anchorAt: new Date().toISOString(),
  })
  assert.equal(dncResult.enrolled, false)
  assert.equal(dncResult.reason, 'do_not_contact')

  const closedVenueId = makeVenue({ stage: 'not_interested' })
  const closedContactId = makeContact(closedVenueId, { email: 'closed@example.com' })
  const closedResult = venueOutreach.enrollVenuePostVisitSequence({
    venueId: closedVenueId,
    visitId: 'visit-closed',
    contactId: closedContactId,
    anchorAt: new Date().toISOString(),
  })
  assert.equal(closedResult.enrolled, false)
  assert.equal(closedResult.reason, 'stage_not_interested')
})

test('enrollVenuePostVisitSequence refuses venues without a usable email', () => {
  const venueId = makeVenue()
  // No contact created at all, and no contactId passed — ensureShadowPartnershipContactForVenue
  // falls back to a non-sendable placeholder address.
  const result = venueOutreach.enrollVenuePostVisitSequence({
    venueId,
    visitId: 'visit-no-email',
    contactId: null,
    anchorAt: new Date().toISOString(),
  })
  assert.equal(result.enrolled, false)
  assert.equal(result.reason, 'invalid_email')
})

test('syncVenueSequenceStopConditions stops the running sequence when a venue becomes doNotContact', () => {
  const venueId = makeVenue()
  const contactId = makeContact(venueId, { email: 'stopcheck@example.com' })
  venueOutreach.enrollVenuePostVisitSequence({
    venueId,
    visitId: 'visit-stop',
    contactId,
    anchorAt: new Date().toISOString(),
    rng: () => 0,
  })

  const updatedVenue = db.updateVenue(venueId, { doNotContact: true })
  const stopped = venueOutreach.syncVenueSequenceStopConditions(updatedVenue)
  assert.ok(stopped, 'sync must find and stop the active sequence')
  assert.equal(stopped.sequence.status, 'stopped')
  assert.equal(stopped.sequence.stopReason, 'venue_do_not_contact')

  const shadow = db.getPartnershipContactById(updatedVenue.linkedPartnershipContactId)
  const seq = db.getOutreachSequenceByContactId(shadow.id)
  assert.equal(seq.status, 'stopped')
})

test('syncVenueSequenceStopConditions stops the sequence when the venue reaches a terminal pipeline stage', () => {
  const venueId = makeVenue()
  const contactId = makeContact(venueId, { email: 'terminal@example.com' })
  venueOutreach.enrollVenuePostVisitSequence({
    venueId,
    visitId: 'visit-terminal',
    contactId,
    anchorAt: new Date().toISOString(),
    rng: () => 0,
  })

  const updatedVenue = db.updateVenue(venueId, { stage: 'not_fit_archived' })
  const stopped = venueOutreach.syncVenueSequenceStopConditions(updatedVenue)
  assert.ok(stopped)
  assert.equal(stopped.sequence.stopReason, 'venue_stage_not_fit_archived')
})

test('syncVenueSequenceStopConditions is a no-op for venues with no linked sequence', () => {
  const venueId = makeVenue({ doNotContact: true })
  const venue = db.getVenueById(venueId)
  const result = venueOutreach.syncVenueSequenceStopConditions(venue)
  assert.equal(result, null)
})
