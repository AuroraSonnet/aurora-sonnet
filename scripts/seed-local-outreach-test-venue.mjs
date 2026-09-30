#!/usr/bin/env node
/**
 * Idempotent local test fixture for Partnership Outreach workflow testing.
 * Safe to re-run — reuses an existing venue when the name marker is found.
 */
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import dotenv from 'dotenv'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: join(__dirname, '..', 'server', '.env') })

const VENUE_NAME = 'E2E Test — Local Sandbox Venue (NOT A REAL VENUE)'
const CONTACT_NAME = 'Lisa (Test Contact)'
const CONTACT_TITLE = 'Test Events Coordinator'

const testEmail = String(process.env.OUTREACH_TEST_EMAIL || process.env.REMINDER_EMAIL_TO || process.env.SMTP_USER || '').trim()
if (!testEmail) {
  console.error('Set OUTREACH_TEST_EMAIL (or SMTP_USER) in server/.env before seeding.')
  process.exit(1)
}

const today = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date())

const {
  listVenues,
  createVenue,
  updateVenue,
  listVenueContactsForVenue,
  createVenueContact,
  updateVenueContact,
  listVisitsForDate,
  createVisit,
} = await import('../server/db.js')

let venue = listVenues().find((v) => v.companyName === VENUE_NAME && !v.deletedAt)
if (!venue) {
  const id = createVenue({
    companyName: VENUE_NAME,
    partnerType: 'venue',
    city: 'New York',
    fitLevel: 'high',
    stage: 'target',
    source: 'local_test_seed',
    notes: 'LOCAL TEST ONLY — safe sandbox for Outreach Today workflow. Do not use for real venue outreach.',
  })
  venue = listVenues().find((v) => v.id === id)
  console.log('Created test venue:', id)
} else {
  console.log('Reusing test venue:', venue.id)
}

let contacts = listVenueContactsForVenue(venue.id).filter((c) => !c.deletedAt)
let contact = contacts.find((c) => c.email?.toLowerCase() === testEmail.toLowerCase())
if (!contact) {
  const contactId = createVenueContact({
    venueId: venue.id,
    name: CONTACT_NAME,
    jobTitle: CONTACT_TITLE,
    email: testEmail,
    isDecisionMaker: true,
    notes: 'Local test contact — all outreach emails route to OUTREACH_TEST_EMAIL.',
  })
  contact = listVenueContactsForVenue(venue.id).find((c) => c.id === contactId)
  console.log('Created test contact:', contactId, testEmail)
} else {
  updateVenueContact(contact.id, {
    name: CONTACT_NAME,
    jobTitle: CONTACT_TITLE,
    notes: 'Local test contact — all outreach emails route to OUTREACH_TEST_EMAIL.',
  })
  console.log('Reusing test contact:', contact.id, testEmail)
}

const visitsToday = listVisitsForDate(today).filter((v) => v.venueId === venue.id)
let visit = visitsToday[0]
if (!visit) {
  visit = createVisit({
    venueId: venue.id,
    plannedDate: today,
    visitTime: '11:00',
    status: 'planned',
  })
  if (venue.stage === 'target') updateVenue(venue.id, { stage: 'visit_planned' })
  console.log('Created visit for today:', visit.id, today)
} else {
  console.log('Reusing visit for today:', visit.id, today)
}

console.log('\nLocal outreach test fixture ready:')
console.log('  Venue:', venue.companyName)
console.log('  Venue ID:', venue.id)
console.log('  Contact email (test inbox):', testEmail)
console.log('  Visit date:', today)
console.log('  Open: http://localhost:5173/outreach-today')
