import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { initReferralPartnershipSchema } from '../server/referralPartnershipSchema.js'
import { computePartnerReferralAmounts } from '../server/partnerReferralPayout.js'
import { buildLegacyDefaultTermsSnapshot, buildPublicReferralProgramSnapshot } from '../server/referralPartnershipTerms.js'

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
