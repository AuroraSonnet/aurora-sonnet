import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  assertAgreementSnapshotImmutable,
  computePartnerReferralAmounts,
  isReferralPayoutPayable,
  validatePayoutStatusChange,
} from '../server/partnerReferralPayout.js'
import { buildLegacyDefaultTermsSnapshot, DEFAULT_REFERRAL_PARTNERSHIP_TERMS } from '../server/referralPartnershipTerms.js'
import { validateAgreementStatusTransition } from '../server/referralPartnershipLegal.js'

let dataDir
let db
let referralPartnership
const TEST_ACTOR = 'crm'

function setupTestOrgAndAuth() {
  const orgSettings = requireOrgModule()
  orgSettings.updateAuroraOrganizationSettings({
    legalName: 'Aurora Sonnet LLC',
    legalAddress: '200 Business Center, New York, NY 10001',
    signatoryName: 'Lisa Dubocquet',
    signatoryTitle: 'Founder & Managing Member',
  })
  const legalAuth = requireLegalAuthModule()
  legalAuth.setLegalApprovalAuthorizedUsernames([TEST_ACTOR])
}

function requireOrgModule() {
  // dynamic after DATA_DIR set
  return globalThis.__refOrgSettings
}

function requireLegalAuthModule() {
  return globalThis.__refLegalAuth
}

test.before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'aurora-ref-partnership-mvp-'))
  process.env.DATA_DIR = dataDir
  db = await import('../server/db.js')
  referralPartnership = await import('../server/referralPartnership.js')
  globalThis.__refOrgSettings = await import('../server/referralOrganizationSettings.js')
  globalThis.__refLegalAuth = await import('../server/referralLegalApprovalAuth.js')
  setupTestOrgAndAuth()
})

test.after(() => {
  delete process.env.DATA_DIR
  if (dataDir) rmSync(dataDir, { recursive: true, force: true })
})

test('legacy_default snapshot uses expense deduction; agreement terms do not', () => {
  const legacy = buildLegacyDefaultTermsSnapshot()
  const withExpenses = computePartnerReferralAmounts(
    {
      bookingAmount: 5000,
      expenseLineItems: [{ id: '1', name: 'Travel', amount: 500 }],
      referralStatus: 'booked',
    },
    { termsSnapshot: legacy }
  )
  assert.equal(withExpenses.commissionableAmount, 4500)

  const agreement = computePartnerReferralAmounts(
    {
      bookingAmount: 5000,
      expenseLineItems: [{ id: '1', name: 'Travel', amount: 500 }],
      referralStatus: 'booked',
    },
    { termsSnapshot: DEFAULT_REFERRAL_PARTNERSHIP_TERMS }
  )
  assert.equal(agreement.commissionableAmount, 5000)
  assert.equal(agreement.payoutAmount, 500)
})

test('new partnership terms: exactly 10% with no minimum ($500 → $50)', () => {
  const r = computePartnerReferralAmounts(
    { bookingAmount: 500, referralStatus: 'booked' },
    { termsSnapshot: DEFAULT_REFERRAL_PARTNERSHIP_TERMS }
  )
  assert.equal(r.payoutAmount, 50)
})

test('legacy 5%/$100 rules unchanged for legacy_default snapshot', () => {
  const legacy = buildLegacyDefaultTermsSnapshot()
  const r = computePartnerReferralAmounts(
    { bookingAmount: 2000, referralStatus: 'booked' },
    { termsSnapshot: legacy }
  )
  assert.equal(r.payoutAmount, 100)
})

test('payout cannot become pending until event completed and client paid', () => {
  const referral = { referralStatus: 'booked', payoutStatus: 'none', eventCompletedAt: null, clientPaidInFullAt: null }
  assert.equal(isReferralPayoutPayable(referral, {}), false)
  assert.ok(validatePayoutStatusChange(referral, 'pending', {}))

  const ready = {
    referralStatus: 'booked',
    payoutStatus: 'none',
    eventCompletedAt: '2026-08-01T12:00:00.000Z',
    clientPaidInFullAt: '2026-08-02T12:00:00.000Z',
  }
  assert.equal(isReferralPayoutPayable(ready, {}), true)
  assert.equal(validatePayoutStatusChange(ready, 'pending', {}), null)
})

test('snapshot immutability is enforced', () => {
  const err = assertAgreementSnapshotImmutable(
    { agreementTermsSnapshot: '{"termsKind":"legacy_default"}', agreementId: null },
    { agreementTermsSnapshot: '{"x":1}' }
  )
  assert.ok(err)
})

test('public-style referral create gets legacy_default snapshot without agreementId', () => {
  const created = db.createPartnerReferral({
    partnerName: 'Hostinger Partner',
    partnerEmail: 'partner@venue.com',
    clientName: 'Client',
    clientEmail: 'client@wedding.com',
    bookingAmount: 4000,
    referralStatus: 'new',
  })
  const row = db.getPartnerReferral(created.id)
  assert.equal(row.agreementId, undefined)
  assert.equal(row.agreementSnapshotKind, 'legacy_default')
  assert.ok(row.agreementTermsSnapshot)
})

test('create referral offer: one partnership per venue, draft reuse, timeline log', async () => {
  const venueId = db.createVenue({ companyName: 'MVP Venue', stage: 'visited' })
  const contactId = db.createVenueContact({ venueId, name: 'Alex Planner', email: 'alex@mvpvenue.test', isDecisionMaker: true })

  const first = await referralPartnership.createReferralOffer({
    venueId,
    primaryContactId: contactId,
    authorizedSignatoryContactId: contactId,
    signatoryName: 'Alex Planner',
    signatoryTitle: 'Director of Events',
  })
  assert.equal(first.reusedDraft, false)
  assert.equal(first.agreement.status, 'draft')
  assert.ok(first.agreement.hasGeneratedPdf)

  const second = await referralPartnership.createReferralOffer({ venueId, primaryContactId: contactId })
  assert.equal(second.reusedDraft, true)
  assert.equal(second.agreement.id, first.agreement.id)

  const dup = db.getReferralPartnershipByVenueId(venueId)
  assert.ok(dup)
  assert.equal(db.listReferralPartnerships().filter((p) => p.venueId === venueId).length, 1)

  const activity = db.listVenueActivity(venueId)
  assert.ok(activity.some((a) => a.type === 'referral_offer_created'))
})

test('legal approval required before sent, fully executed, or activation', () => {
  const agreement = {
    id: 'rpa-legal',
    version: 1,
    agreementVersionIdentifier: 'RPA-test-v1',
    legalApprovalStatus: 'pending',
    status: 'draft',
  }
  assert.ok(validateAgreementStatusTransition(agreement, 'sent'))
  assert.ok(validateAgreementStatusTransition(agreement, 'fully_executed'))

  const venueId = db.createVenue({
    companyName: 'Legal Gate Venue',
    stage: 'visited',
    address: '50 Partner Ave',
    city: 'Brooklyn',
    borough: 'NY',
  })
  const partnershipId = `rp-legal-${Date.now()}`
  const agreementId = `rpa-legal-block-${Date.now()}`
  const now = new Date().toISOString()
  db.insertReferralPartnership({
    id: partnershipId,
    venueId,
    status: 'pending_signature',
    activeAgreementId: null,
    w9ReceivedAt: null,
    createdAt: now,
    updatedAt: now,
  })
  db.insertReferralPartnershipAgreement({
    id: agreementId,
    partnershipId,
    version: 1,
    status: 'draft',
    termsJson: JSON.stringify(DEFAULT_REFERRAL_PARTNERSHIP_TERMS),
    contentHtml: '<p>DRAFT</p>',
    authorizedSignatoryContactId: null,
    signatoryName: 'Pat',
    signatoryTitle: 'GM',
    partnerSignerName: null,
    partnerSignerTitle: null,
    partnerSignedDate: null,
    agencySignerName: null,
    agencySignedDate: null,
    generatedPdfBlob: Buffer.from('%PDF'),
    signedPdfBlob: null,
    auditLogJson: '[]',
    legalApprovalStatus: 'pending',
    legalApprovedAt: null,
    legalApprovalNotes: null,
    agreementVersionIdentifier: 'RPA-block-v1',
    createdAt: now,
    updatedAt: now,
  })
  const blocked = referralPartnership.updateReferralOfferAgreement(agreementId, { status: 'sent' })
  assert.ok(blocked.error)

  referralPartnership.approveReferralAgreementLegal(agreementId, {
    legalReviewerName: 'External Counsel PLLC',
    notes: 'Counsel reviewed v1',
    actor: TEST_ACTOR,
  })
  const allowed = referralPartnership.updateReferralOfferAgreement(agreementId, { status: 'sent' })
  assert.ok(allowed.agreement)
  assert.equal(allowed.agreement.status, 'sent')
})

test('partnership activates only when legally approved, fully executed, signatures, and signed PDF', () => {
  const venueId = db.createVenue({
    companyName: 'Activate Venue',
    stage: 'partner',
    address: '99 Partner Blvd',
    city: 'New York',
    borough: 'NY',
  })
  const partnershipId = `rp-test-${Date.now()}`
  const agreementId = `rpa-test-${Date.now()}`
  const now = new Date().toISOString()
  db.insertReferralPartnership({
    id: partnershipId,
    venueId,
    status: 'pending_signature',
    activeAgreementId: null,
    w9ReceivedAt: null,
    createdAt: now,
    updatedAt: now,
  })
  db.insertReferralPartnershipAgreement({
    id: agreementId,
    partnershipId,
    version: 1,
    status: 'fully_executed',
    termsJson: JSON.stringify(DEFAULT_REFERRAL_PARTNERSHIP_TERMS),
    contentHtml: '<p>DRAFT</p>',
    authorizedSignatoryContactId: null,
    signatoryName: 'Pat',
    signatoryTitle: 'GM',
    partnerSignerName: null,
    partnerSignerTitle: null,
    partnerSignedDate: null,
    agencySignerName: null,
    agencySignedDate: null,
    generatedPdfBlob: Buffer.from('%PDF'),
    signedPdfBlob: null,
    auditLogJson: '[]',
    legalApprovalStatus: 'pending',
    legalApprovedAt: null,
    legalApprovalNotes: null,
    agreementVersionIdentifier: 'RPA-activate-v1',
    createdAt: now,
    updatedAt: now,
  })

  const blockedLegal = referralPartnership.tryActivatePartnership(partnershipId, agreementId)
  assert.equal(blockedLegal.activated, false)

  referralPartnership.approveReferralAgreementLegal(agreementId, {
    legalReviewerName: 'External Counsel PLLC',
    notes: 'Approved',
    actor: TEST_ACTOR,
  })

  const blocked = referralPartnership.tryActivatePartnership(partnershipId, agreementId)
  assert.equal(blocked.activated, false)

  db.updateReferralPartnershipAgreement(agreementId, {
    partnerSignerName: 'Pat',
    partnerSignedDate: '2026-08-01',
    agencySignerName: 'Lisa',
    agencySignedDate: '2026-08-02',
    signedPdfBlob: Buffer.from('%PDF-signed'),
    updatedAt: new Date().toISOString(),
  })

  const ok = referralPartnership.tryActivatePartnership(partnershipId, agreementId)
  assert.equal(ok.activated, true)
  const p = db.getReferralPartnershipById(partnershipId)
  assert.equal(p.status, 'active')
  assert.equal(p.activeAgreementId, agreementId)
})

test('active partnership snapshots apply to new referrals only', () => {
  const venueId = db.createVenue({ companyName: 'Snapshot Venue', stage: 'partner' })
  const partnershipId = `rp-snap-${Date.now()}`
  const agreementId = `rpa-snap-${Date.now()}`
  const now = new Date().toISOString()
  db.insertReferralPartnership({
    id: partnershipId,
    venueId,
    status: 'active',
    activeAgreementId: agreementId,
    w9ReceivedAt: null,
    createdAt: now,
    updatedAt: now,
  })
  db.insertReferralPartnershipAgreement({
    id: agreementId,
    partnershipId,
    version: 1,
    status: 'fully_executed',
    termsJson: JSON.stringify({ ...DEFAULT_REFERRAL_PARTNERSHIP_TERMS, commissionRate: 0.06 }),
    contentHtml: '<p>DRAFT</p>',
    authorizedSignatoryContactId: null,
    signatoryName: 'Pat',
    signatoryTitle: null,
    partnerSignerName: 'Pat',
    partnerSignedDate: '2026-08-01',
    agencySignerName: 'Lisa',
    agencySignedDate: '2026-08-01',
    generatedPdfBlob: Buffer.from('%PDF'),
    signedPdfBlob: Buffer.from('%PDF'),
    auditLogJson: '[]',
    legalApprovalStatus: 'approved',
    legalApprovedAt: now,
    legalApprovalNotes: 'v1 approved',
    agreementVersionIdentifier: 'RPA-snap-v1',
    createdAt: now,
    updatedAt: now,
  })

  const before = db.createPartnerReferral({
    partnerName: 'Old',
    partnerEmail: 'old@test.com',
    clientName: 'C1',
    clientEmail: 'c1@test.com',
    venueId,
    referralStatus: 'booked',
    bookingAmount: 1000,
  })
  assert.equal(before.id ? db.getPartnerReferral(before.id).agreementSnapshotKind : '', 'agreement')

  db.updateReferralPartnershipAgreement(agreementId, {
    termsJson: JSON.stringify({ ...DEFAULT_REFERRAL_PARTNERSHIP_TERMS, commissionRate: 0.1 }),
    updatedAt: new Date().toISOString(),
  })

  const after = db.createPartnerReferral({
    partnerName: 'New',
    partnerEmail: 'new@test.com',
    clientName: 'C2',
    clientEmail: 'c2@test.com',
    venueId,
    referralStatus: 'booked',
    bookingAmount: 1000,
  })
  const rowBefore = db.getPartnerReferral(before.id)
  const rowAfter = db.getPartnerReferral(after.id)
  assert.notEqual(rowBefore.agreementTermsSnapshot.commissionRate, rowAfter.agreementTermsSnapshot.commissionRate)
})

test('venue and contact linking on referral', () => {
  const venueId = db.createVenue({ companyName: 'Link Venue', stage: 'visited' })
  const contactId = db.createVenueContact({ venueId, name: 'Referrer', email: 'ref@link.test' })
  const created = db.createPartnerReferral({
    partnerName: 'Referrer',
    partnerEmail: 'ref@link.test',
    clientName: 'Client',
    clientEmail: 'client@link.test',
    venueId,
    referringContactId: contactId,
  })
  const row = db.getPartnerReferral(created.id)
  assert.equal(row.venueId, venueId)
  assert.equal(row.referringContactId, contactId)
  assert.equal(row.partnerName, 'Referrer')
})

test('unauthorized user cannot record legal approval', () => {
  const venueId = db.createVenue({ companyName: 'Auth Venue', stage: 'visited', address: '1 St', city: 'NY', borough: 'NY' })
  const partnershipId = `rp-auth-${Date.now()}`
  const agreementId = `rpa-auth-${Date.now()}`
  const now = new Date().toISOString()
  db.insertReferralPartnership({
    id: partnershipId,
    venueId,
    status: 'pending_signature',
    activeAgreementId: null,
    w9ReceivedAt: null,
    createdAt: now,
    updatedAt: now,
  })
  db.insertReferralPartnershipAgreement({
    id: agreementId,
    partnershipId,
    version: 1,
    status: 'draft',
    termsJson: JSON.stringify(DEFAULT_REFERRAL_PARTNERSHIP_TERMS),
    contentHtml: '<p>DRAFT</p>',
    authorizedSignatoryContactId: null,
    signatoryName: 'Pat',
    signatoryTitle: 'GM',
    partnerSignerName: null,
    partnerSignerTitle: null,
    partnerSignedDate: null,
    agencySignerName: null,
    agencySignedDate: null,
    generatedPdfBlob: Buffer.from('%PDF'),
    signedPdfBlob: null,
    auditLogJson: '[]',
    legalApprovalStatus: 'pending',
    legalApprovedAt: null,
    legalApprovalNotes: null,
    agreementVersionIdentifier: 'RPA-auth-v1',
    createdAt: now,
    updatedAt: now,
  })
  const denied = referralPartnership.approveReferralAgreementLegal(agreementId, {
    legalReviewerName: 'Counsel',
    actor: 'intruder',
  })
  assert.equal(denied.ok, false)
})

test('placeholder or missing org address blocks send even after legal approval', () => {
  const orgSettings = requireOrgModule()
  orgSettings.updateAuroraOrganizationSettings({ legalAddress: '[Configure address]' })
  const venueId = db.createVenue({
    companyName: 'Placeholder Venue',
    stage: 'visited',
    address: '10 Real St',
    city: 'Brooklyn',
    borough: 'NY',
  })
  const partnershipId = `rp-ph-${Date.now()}`
  const agreementId = `rpa-ph-${Date.now()}`
  const now = new Date().toISOString()
  db.insertReferralPartnership({
    id: partnershipId,
    venueId,
    status: 'pending_signature',
    activeAgreementId: null,
    w9ReceivedAt: null,
    createdAt: now,
    updatedAt: now,
  })
  db.insertReferralPartnershipAgreement({
    id: agreementId,
    partnershipId,
    version: 1,
    status: 'draft',
    termsJson: JSON.stringify(DEFAULT_REFERRAL_PARTNERSHIP_TERMS),
    contentHtml: '<p>DRAFT</p>',
    authorizedSignatoryContactId: null,
    signatoryName: 'Pat',
    signatoryTitle: 'GM',
    partnerSignerName: null,
    partnerSignerTitle: null,
    partnerSignedDate: null,
    agencySignerName: null,
    agencySignedDate: null,
    generatedPdfBlob: Buffer.from('%PDF'),
    signedPdfBlob: null,
    auditLogJson: '[]',
    legalApprovalStatus: 'pending',
    legalApprovedAt: null,
    legalApprovalNotes: null,
    agreementVersionIdentifier: 'RPA-ph-v1',
    createdAt: now,
    updatedAt: now,
  })
  referralPartnership.approveReferralAgreementLegal(agreementId, {
    legalReviewerName: 'Counsel',
    actor: TEST_ACTOR,
  })
  const blocked = referralPartnership.updateReferralOfferAgreement(agreementId, { status: 'sent' })
  assert.ok(blocked.error)
  setupTestOrgAndAuth()
})

test('rejected version is immutable and cannot be approved or sent', () => {
  const venueId = db.createVenue({
    companyName: 'Reject Venue',
    stage: 'visited',
    address: '22 Reject Rd',
    city: 'Brooklyn',
    borough: 'NY',
  })
  const partnershipId = `rp-rej-${Date.now()}`
  const agreementId = `rpa-rej-${Date.now()}`
  const now = new Date().toISOString()
  db.insertReferralPartnership({
    id: partnershipId,
    venueId,
    status: 'pending_signature',
    activeAgreementId: null,
    w9ReceivedAt: null,
    createdAt: now,
    updatedAt: now,
  })
  db.insertReferralPartnershipAgreement({
    id: agreementId,
    partnershipId,
    version: 1,
    status: 'draft',
    termsJson: JSON.stringify(DEFAULT_REFERRAL_PARTNERSHIP_TERMS),
    contentHtml: '<p>DRAFT</p>',
    authorizedSignatoryContactId: null,
    signatoryName: 'Pat',
    signatoryTitle: 'GM',
    partnerSignerName: null,
    partnerSignerTitle: null,
    partnerSignedDate: null,
    agencySignerName: null,
    agencySignedDate: null,
    generatedPdfBlob: Buffer.from('%PDF'),
    signedPdfBlob: null,
    auditLogJson: '[]',
    legalApprovalStatus: 'pending',
    legalApprovedAt: null,
    legalApprovalNotes: null,
    agreementVersionIdentifier: 'RPA-rej-v1',
    createdAt: now,
    updatedAt: now,
  })
  const rejected = referralPartnership.rejectReferralAgreementLegal(agreementId, {
    rejectionNotes: 'Section 5 wording needs revision',
    actor: TEST_ACTOR,
  })
  assert.equal(rejected.ok, true)
  assert.equal(rejected.agreement.legalApprovalStatus, 'rejected')

  const sendBlocked = referralPartnership.updateReferralOfferAgreement(agreementId, { status: 'sent' })
  assert.ok(sendBlocked.error)

  const approveBlocked = referralPartnership.approveReferralAgreementLegal(agreementId, {
    legalReviewerName: 'Counsel',
    actor: TEST_ACTOR,
  })
  assert.equal(approveBlocked.ok, false)
})
