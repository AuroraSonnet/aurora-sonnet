import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { initReferralPartnershipSchema } from '../server/referralPartnershipSchema.js'
import { computePartnerReferralAmounts } from '../server/partnerReferralPayout.js'
import { buildLegacyDefaultTermsSnapshot, buildPublicReferralProgramSnapshot } from '../server/referralPartnershipTerms.js'
import {
  ALREADY_REGISTERED_PARTNER_MESSAGE,
  classifyCoupleContacts,
  normalizeReferralPhone,
  referralCreditDecision,
} from '../server/referralDuplicate.js'

const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

let dataDir
let db
let partners

test.before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'aurora-public-referral-'))
  process.env.DATA_DIR = dataDir
  db = await import('../server/db.js')
  const opened = String(db.default?.name || '')
  if (!opened.startsWith(dataDir)) {
    throw new Error(`Test opened ${opened} instead of ${dataDir}. Refusing to touch another database.`)
  }
  partners = await import('../server/publicReferralPartner.js')
})

test.after(() => {
  delete process.env.DATA_DIR
  if (dataDir) rmSync(dataDir, { recursive: true, force: true })
})

test('venue-required partnerships migrate without dropping existing rows', () => {
  const memory = new Database(':memory:')
  const now = new Date().toISOString()
  memory.exec(`
    CREATE TABLE partner_referrals (id TEXT PRIMARY KEY);
    CREATE TABLE referral_partnerships (
      id TEXT PRIMARY KEY,
      venueId TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'inactive',
      activeAgreementId TEXT,
      w9ReceivedAt TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );
  `)
  memory.prepare(
    `INSERT INTO referral_partnerships (id, venueId, status, activeAgreementId, w9ReceivedAt, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run('rp-old', 'venue-1', 'active', null, null, now, now)

  initReferralPartnershipSchema(memory)

  const venueCol = memory.prepare('PRAGMA table_info(referral_partnerships)').all().find((c) => c.name === 'venueId')
  assert.equal(venueCol.notnull, 0)
  const kept = memory.prepare('SELECT * FROM referral_partnerships WHERE id = ?').get('rp-old')
  assert.equal(kept.venueId, 'venue-1')
  assert.equal(kept.status, 'active')
  memory.prepare(
    `INSERT INTO referral_partnerships (
      id, venueId, status, createdAt, updatedAt, partnerEmail
    ) VALUES (?, NULL, 'active', ?, ?, ?)`
  ).run('rp-open', now, now, 'planner@example.com')
  const open = memory.prepare('SELECT venueId, partnerEmail FROM referral_partnerships WHERE id = ?').get('rp-open')
  assert.equal(open.venueId, null)
  assert.equal(open.partnerEmail, 'planner@example.com')
  memory.close()
})

test('e-sign activates a non-venue partner and reuses the same link', async () => {
  const first = await partners.submitPublicPartnerApplication({
    fullName: 'Alex Planner',
    email: 'Alex@Planner.example',
    phone: '212-555-0100',
    companyName: 'Planner Co',
    businessType: 'Wedding planner',
    signaturePngBase64: TINY_PNG,
  }, { ip: '127.0.0.1', userAgent: 'test' })
  assert.equal(first.reused, false)
  assert.equal(first.status, 'active')
  assert.ok(first.referralToken)
  assert.match(first.referralLink, /\?partner=/)

  const partnership = db.getReferralPartnershipById(first.partnershipId)
  assert.equal(partnership.venueId, undefined)
  assert.equal(partnership.partnerEmail, 'alex@planner.example')
  assert.equal(partnership.businessType, 'Wedding planner')
  assert.equal(partnership.status, 'active')

  const agreement = db.getReferralPartnershipAgreementById(first.agreementId)
  assert.equal(agreement.status, 'fully_executed')
  assert.equal(agreement.legalApprovalStatus, 'not_required')
  assert.equal(agreement.agencySignerName, undefined)
  assert.equal(agreement.partnerSignerName, 'Alex Planner')
  assert.equal(agreement.termsJson.termsKind, 'public_partner_agreement')
  assert.equal(agreement.termsJson.commissionRate, 0.1)
  assert.equal(agreement.hasSignedPdf, true)
  const signed = db.getReferralPartnershipAgreementPdf(first.agreementId, 'signed')
  assert.ok(signed && signed.length > 100)
  assert.equal(Buffer.from(signed).subarray(0, 4).toString(), '%PDF')

  const again = await partners.submitPublicPartnerApplication({
    fullName: 'Alex Planner',
    email: 'alex@planner.example',
    companyName: 'Planner Co',
    businessType: 'Wedding planner',
    signaturePngBase64: TINY_PNG,
  })
  assert.equal(again.reused, true)
  assert.equal(again.referralToken, first.referralToken)
})

test('manual referral without the new program stays on legacy terms', () => {
  const created = db.createPartnerReferral({
    partnerName: 'Old Partner',
    partnerEmail: 'old@example.com',
    clientName: 'Old Couple',
    clientEmail: 'old-couple@example.com',
  })
  const row = db.getPartnerReferral(created.id)
  assert.equal(row.agreementSnapshotKind, 'legacy_default')
  assert.equal(row.agreementTermsSnapshot.termsKind, 'legacy_default')
  assert.equal(row.agreementTermsSnapshot.commissionRate, 0.05)
  assert.equal(row.agreementTermsSnapshot.minPayoutAmount, 100)
  assert.equal(row.termsAcceptedAt, undefined)
})

test('refer-a-couple public program is 10 percent and records terms acceptance', () => {
  const created = db.createPartnerReferral({
    referralProgram: 'public_10',
    termsAcceptedAt: '2026-09-30T04:00:00.000Z',
    partnerName: 'One Off',
    companyName: 'Photo Studio',
    partnerEmail: 'oneoff@example.com',
    clientName: 'Jamie and Sam',
    clientEmail: 'jamie@example.com',
    clientPhone: '917-555-0101',
  })
  const row = db.getPartnerReferral(created.id)
  assert.equal(row.agreementSnapshotKind, 'public_program')
  assert.equal(row.agreementTermsSnapshot.termsKind, 'public_referral_10')
  assert.equal(row.agreementTermsSnapshot.commissionRate, 0.1)
  assert.equal(row.agreementTermsSnapshot.minPayoutAmount, null)
  assert.equal(row.termsAcceptedAt, '2026-09-30T04:00:00.000Z')
  assert.equal(row.referralDecisionDeadline, undefined)
  assert.equal(row.partnershipId, undefined)

  const legacy = db.getPartnerReferral(
    db.findFirstPartnerReferralByClientEmail('old-couple@example.com').id
  )
  assert.equal(legacy.agreementTermsSnapshot.termsKind, 'legacy_default')

  const amounts = computePartnerReferralAmounts(
    { bookingAmount: 4000, travelExpenseAmount: 500, referralStatus: 'booked' },
    { termsSnapshot: buildPublicReferralProgramSnapshot() }
  )
  assert.equal(amounts.commissionableAmount, 4000)
  assert.equal(amounts.payoutAmount, 400)
  const legacyAmounts = computePartnerReferralAmounts(
    { bookingAmount: 4000, travelExpenseAmount: 500, referralStatus: 'booked' },
    { termsSnapshot: buildLegacyDefaultTermsSnapshot() }
  )
  assert.equal(legacyAmounts.commissionableAmount, 3500)
  assert.equal(legacyAmounts.payoutAmount, Math.max(Math.round(3500 * 0.05), 100))
})

test('a client using the partner link is attributed without another submission', async () => {
  const signed = await partners.submitPublicPartnerApplication({
    fullName: 'Riley Photo',
    email: 'riley@photo.example',
    companyName: 'Riley Photo',
    businessType: 'Photographer',
    signaturePngBase64: TINY_PNG,
  })
  const first = partners.attributeInquiryToReferralPartner({
    partnerToken: signed.referralToken,
    clientName: 'Casey and Jordan',
    clientEmail: 'Casey@Clients.example',
    clientPhone: '646-555-0199',
    eventDate: '2027-06-12',
    eventLocation: 'Brooklyn',
    linkedProjectId: 'proj-test-1',
  })
  assert.equal(first.status, 'created')
  const row = db.getPartnerReferral(first.referralId)
  assert.equal(row.partnerEmail, 'riley@photo.example')
  assert.equal(row.clientEmail, 'casey@clients.example')
  assert.equal(row.partnershipId, signed.partnershipId)
  assert.equal(row.agreementId, signed.agreementId)
  assert.equal(row.agreementSnapshotKind, 'agreement')
  assert.equal(row.agreementTermsSnapshot.termsKind, 'public_partner_agreement')
  assert.equal(row.agreementTermsSnapshot.commissionRate, 0.1)
  assert.equal(row.termsAcceptedAt, undefined)
  assert.equal(row.eventDate, '2027-06-12')
  assert.equal(row.linkedProjectId, 'proj-test-1')
  assert.equal(row.referralDecisionDeadline, undefined)

  const repeat = partners.attributeInquiryToReferralPartner({
    partnerToken: signed.referralToken,
    clientName: 'Casey and Jordan',
    clientEmail: 'casey@clients.example',
  })
  assert.equal(repeat.status, 'existing')
  assert.equal(repeat.referralId, first.referralId)

  const other = await partners.submitPublicPartnerApplication({
    fullName: 'Other Vendor',
    email: 'other@vendor.example',
    companyName: 'Other Vendor',
    businessType: 'Florist',
    signaturePngBase64: TINY_PNG,
  })
  const stolen = partners.attributeInquiryToReferralPartner({
    partnerToken: other.referralToken,
    clientName: 'Casey and Jordan',
    clientEmail: 'casey@clients.example',
  })
  assert.equal(stolen.status, 'already_referred')
  assert.equal(stolen.referralId, first.referralId)

  const bad = partners.attributeInquiryToReferralPartner({
    partnerToken: 'not-a-real-token',
    clientName: 'New Couple',
    clientEmail: 'new@example.com',
  })
  assert.equal(bad.status, 'invalid_token')
})

test('a partner token attributes only when the referrer email matches', async () => {
  const signedApp = await partners.submitPublicPartnerApplication({
    fullName: 'Matched Partner',
    email: 'matched@partner.example',
    companyName: 'Matched Co',
    businessType: 'Venue',
    signaturePngBase64: TINY_PNG,
  })
  const signed = db.getReferralPartnershipByReferralToken(signedApp.referralToken)
  const created = db.createPartnerReferral({
    referralProgram: 'public_10',
    termsAcceptedAt: '2026-09-30T05:00:00.000Z',
    partnerToken: signed.referralToken,
    partnerName: 'Someone Else',
    companyName: 'Else Co',
    partnerEmail: 'else@example.com',
    clientName: 'Pat and Quinn',
    clientEmail: 'pat@example.com',
  })
  const row = db.getPartnerReferral(created.id)
  assert.equal(row.agreementSnapshotKind, 'public_program')
  assert.equal(row.partnershipId, undefined)

  const matched = db.createPartnerReferral({
    referralProgram: 'public_10',
    termsAcceptedAt: '2026-09-30T05:00:00.000Z',
    partnerName: 'Matched Partner',
    companyName: 'Matched Co',
    partnerEmail: 'Matched@Partner.example',
    clientName: 'Avery and Blake',
    clientEmail: 'avery@example.com',
  })
  const matchedRow = db.getPartnerReferral(matched.id)
  assert.equal(matchedRow.partnershipId, undefined, 'Refer a Couple never attaches to a partnership by email alone')
  assert.equal(matchedRow.agreementSnapshotKind, 'public_program')
  assert.equal(matchedRow.agreementTermsSnapshot.commissionRate, 0.1)

  const viaToken = db.createPartnerReferral({
    referralProgram: 'public_10',
    termsAcceptedAt: '2026-09-30T05:00:00.000Z',
    partnerToken: signed.referralToken,
    partnerName: 'Matched Partner',
    partnerEmail: 'matched@partner.example',
    clientName: 'Drew and Emery',
    clientEmail: 'drew@example.com',
  })
  const viaTokenRow = db.getPartnerReferral(viaToken.id)
  assert.equal(viaTokenRow.partnershipId, signed.id)
  assert.equal(viaTokenRow.agreementSnapshotKind, 'agreement')
})

test('email identifies a couple, phone only with the same full name', () => {
  const clients = [
    { id: 'c1', name: 'Alex and Blair', email: 'one@example.com', phone: '2125550101' },
    { id: 'c2', name: 'Casey and Jordan', email: 'two@example.com', phone: '+44 20 7946 0958' },
  ]

  const emailOnly = classifyCoupleContacts({
    email: 'ONE@example.com',
    phone: '',
    name: 'A Different Name',
    clients,
    referrals: [],
  })
  assert.equal(emailOnly.kind, 'existing_client')

  const missingPhone = classifyCoupleContacts({
    email: 'brand-new@example.com',
    name: 'Alex and Blair',
    clients,
    referrals: [],
  })
  assert.equal(missingPhone.kind, 'new')

  const phoneAndName = classifyCoupleContacts({
    email: 'other@example.com',
    phone: '+1 (212) 555-0101',
    name: 'alex  and blair',
    clients,
    referrals: [],
  })
  assert.equal(phoneAndName.kind, 'existing_client')
  assert.equal(phoneAndName.clientId, 'c1')

  const internationalPhone = classifyCoupleContacts({
    email: 'uk-new@example.com',
    phone: '44 20 7946 0958',
    name: 'Casey and Jordan',
    clients,
    referrals: [],
  })
  assert.equal(internationalPhone.kind, 'existing_client')
  assert.equal(internationalPhone.clientId, 'c2')

  const nameOnly = classifyCoupleContacts({
    email: 'third@example.com',
    phone: '6465550199',
    name: 'Alex and Blair',
    clients,
    referrals: [],
  })
  assert.equal(nameOnly.kind, 'new')

  const phoneNameConflict = classifyCoupleContacts({
    email: 'other@example.com',
    phone: '212-555-0101',
    name: 'Someone Else',
    clients,
    referrals: [],
  })
  assert.equal(phoneNameConflict.kind, 'ambiguous')

  const splitRecords = classifyCoupleContacts({
    email: 'one@example.com',
    phone: '2125550101',
    name: 'Alex and Blair',
    clients: [
      { id: 'c1', name: 'Alex and Blair', email: 'one@example.com', phone: '9175550100' },
      { id: 'c2', name: 'Alex and Blair', email: 'two@example.com', phone: '2125550101' },
    ],
    referrals: [],
  })
  assert.equal(splitRecords.kind, 'ambiguous')
  assert.equal(referralCreditDecision(splitRecords).action, 'needs_review')
  assert.notEqual(referralCreditDecision(splitRecords).partnerNotice, ALREADY_REGISTERED_PARTNER_MESSAGE)
  assert.equal(
    referralCreditDecision(emailOnly).partnerNotice,
    'This couple is already registered with Aurora Sonnet, so this referral can’t be credited to you. Your submission has still been received.'
  )

  const uk = '442079460958'
  assert.equal(normalizeReferralPhone('+44 (0)20 7946 0958'), uk)
  assert.equal(normalizeReferralPhone('+44 020 7946 0958'), uk)
  assert.equal(normalizeReferralPhone('+44 20 7946 0958'), uk)
  assert.equal(normalizeReferralPhone('0044 020 7946 0958'), uk)
  assert.equal(normalizeReferralPhone('011 44 020 7946 0958'), uk)
  assert.equal(normalizeReferralPhone('4402079460958'), uk)
  assert.equal(normalizeReferralPhone('(440) 794-0958'), '4407940958')
  assert.equal(normalizeReferralPhone('+44 20 7946 0958 ext 12'), '')
  assert.equal(normalizeReferralPhone(''), '')
  assert.equal(normalizeReferralPhone('020 7946 0958'), '02079460958')
  assert.notEqual(normalizeReferralPhone('020 7946 0958'), uk)
})

test('a country-code phone is stored in the form used for matching', () => {
  const inquiry = db.createInquiryInTransaction({
    name: 'Format Couple',
    email: 'format-couple@example.com',
    phone: '+44 (0) 20 7946 0958',
    today: '2026-10-24',
    weddingDate: '2027-06-01',
    title: 'Inquiry',
    clientName: 'Format Couple',
    dueDate: '2027-06-01',
    value: 0,
  })
  assert.equal(db.getClientById(inquiry.clientId).phone, '442079460958')
  const referral = db.createPartnerReferral({
    partnerName: 'Format Partner',
    partnerEmail: 'format-partner@example.com',
    clientName: 'Other Couple',
    clientEmail: 'format-referral@example.com',
    clientPhone: '011 44 20 7946 0958',
  })
  assert.equal(db.getPartnerReferral(referral.id).clientPhone, '442079460958')
})

test('a known couple is not credited again from a partner link', async () => {
  db.createClient({
    id: 'c-known-couple',
    name: 'Known Couple',
    email: 'known.couple@example.com',
    phone: '9175550144',
    partnerName: null,
    createdAt: '2026-01-01',
  })
  const signed = await partners.submitPublicPartnerApplication({
    fullName: 'Known Link Partner',
    email: 'known-link@partner.example',
    companyName: 'Known Link Co',
    businessType: 'Planner',
    signaturePngBase64: TINY_PNG,
  })
  const before = db.listPartnerReferralContactIndex().length
  const byEmail = partners.attributeInquiryToReferralPartner({
    partnerToken: signed.referralToken,
    clientName: 'A Different Name',
    clientEmail: 'Known.Couple@example.com',
    clientPhone: '555-0100',
  })
  assert.equal(byEmail.status, 'existing_client')
  assert.equal(byEmail.partnerName, undefined)
  assert.equal(byEmail.partnerEmail, undefined)

  const phoneDifferentName = partners.attributeInquiryToReferralPartner({
    partnerToken: signed.referralToken,
    clientName: 'Phone Only Match',
    clientEmail: 'phone-only-match@example.com',
    clientPhone: '(917) 555-0144',
  })
  assert.equal(phoneDifferentName.status, 'needs_review')

  const phoneSameName = partners.attributeInquiryToReferralPartner({
    partnerToken: signed.referralToken,
    clientName: 'Known Couple',
    clientEmail: 'phone-and-name@example.com',
    clientPhone: '+1 917-555-0144',
  })
  assert.equal(phoneSameName.status, 'existing_client')
  assert.equal(db.listPartnerReferralContactIndex().length, before)

  const fresh = partners.attributeInquiryToReferralPartner({
    partnerToken: signed.referralToken,
    clientName: 'Known Couple',
    clientEmail: 'truly-new-couple@example.com',
    clientPhone: '6465550190',
    linkedProjectId: 'proj-known-1',
  })
  assert.equal(fresh.status, 'created')
  const credited = db.getPartnerReferral(fresh.referralId)
  const payoutBefore = credited.payoutAmount
  const bookingBefore = credited.bookingAmount

  const other = await partners.submitPublicPartnerApplication({
    fullName: 'Second Link Partner',
    email: 'second-link@partner.example',
    companyName: 'Second Link Co',
    businessType: 'Florist',
    signaturePngBase64: TINY_PNG,
  })
  const differentName = partners.attributeInquiryToReferralPartner({
    partnerToken: other.referralToken,
    clientName: 'Someone New',
    clientEmail: 'name-conflict@example.com',
    clientPhone: '646-555-0190',
  })
  assert.equal(differentName.status, 'needs_review')

  const again = partners.attributeInquiryToReferralPartner({
    partnerToken: other.referralToken,
    clientName: 'Known Couple',
    clientEmail: 'another-email@example.com',
    clientPhone: '646-555-0190',
  })
  assert.equal(again.status, 'already_referred')
  assert.equal(again.referralId, fresh.referralId)
  assert.equal(again.partnerName, undefined)
  assert.equal(again.partnerEmail, undefined)
  db.appendPartnerReferralNote(fresh.referralId, 'Inquiry p-extra recorded. Existing attribution kept. No additional referral credit.')
  const after = db.getPartnerReferral(fresh.referralId)
  assert.equal(after.payoutAmount, payoutBefore)
  assert.equal(after.bookingAmount, bookingBefore)
  assert.equal(after.linkedProjectId, 'proj-known-1')
  assert.match(after.notes, /No additional referral credit/)
  assert.equal(
    db.listPartnerReferralContactIndex().filter((row) => row.clientPhone && String(row.clientPhone).includes('0190')).length,
    1
  )
})
