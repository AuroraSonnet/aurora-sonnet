/**
 * Referral decision tracking + commission statement tests.
 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  computeReferralDecisionDeadline,
  resolveReferralDecisionStatus,
  isReferralCommissionEligible,
  isReferralDecisionAccepted,
} from '../server/referralDecision.js'
import {
  computePartnerReferralAmounts,
  validatePayoutStatusChange,
  validateCommissionStatementForPayout,
} from '../server/partnerReferralPayout.js'
import { buildCommissionStatementData, renderCommissionStatementPdf } from '../server/commissionStatementPdf.js'
import { DEFAULT_REFERRAL_PARTNERSHIP_TERMS } from '../server/referralPartnershipTerms.js'
import { instantAtNyLocal } from '../server/businessDays.js'

const MVP_TERMS = DEFAULT_REFERRAL_PARTNERSHIP_TERMS
const MON_JAN_6 = instantAtNyLocal(2026, 1, 6, 10, 0)

test('five-business-day deadline skips weekends (Mon + 5 → following Mon)', () => {
  const deadline = computeReferralDecisionDeadline('2026-01-06', 5)
  assert.equal(deadline, '2026-01-13')
})

test('five-business-day deadline skips U.S. federal holidays (MLK Day 2026)', () => {
  // Wed Jan 14 + 5 Business Days: Thu 15, Fri 16, skip weekend, skip MLK Mon 19, Tue–Thu → deadline Jan 22
  const deadline = computeReferralDecisionDeadline('2026-01-14', 5)
  assert.equal(deadline, '2026-01-22')
})

test('five-business-day deadline from Friday lands second Friday', () => {
  const deadline = computeReferralDecisionDeadline('2026-01-09', 5)
  assert.equal(deadline, '2026-01-16')
})

test('resolveReferralDecisionStatus: pending, overdue, accepted, rejected', () => {
  const pending = resolveReferralDecisionStatus(
    { referralDecisionStatus: 'pending', referralDecisionDeadline: '2099-01-01' },
    new Date('2026-01-10T12:00:00Z')
  )
  assert.equal(pending, 'pending')

  const overdue = resolveReferralDecisionStatus(
    { referralDecisionStatus: 'pending', referralDecisionDeadline: '2026-01-01' },
    new Date('2026-01-10T12:00:00Z')
  )
  assert.equal(overdue, 'overdue')

  assert.equal(resolveReferralDecisionStatus({ referralDecisionStatus: 'accepted' }), 'accepted')
  assert.equal(resolveReferralDecisionStatus({ referralDecisionStatus: 'rejected' }), 'rejected')
})

test('silence does not constitute acceptance — overdue is not commission-eligible', () => {
  const referral = {
    agreementTermsSnapshot: MVP_TERMS,
    referralDecisionStatus: 'overdue',
    referralDecisionDeadline: '2026-01-01',
  }
  assert.equal(isReferralDecisionAccepted(referral), false)
  assert.equal(isReferralCommissionEligible(referral), false)
})

test('overdue referral may be expressly accepted later', async () => {
  const { validateReferralDecisionAccept } = await import('../server/referralDecision.js')
  const overdue = {
    agreementTermsSnapshot: MVP_TERMS,
    referralDecisionStatus: 'overdue',
    referralDecisionDeadline: '2026-01-01',
  }
  assert.equal(validateReferralDecisionAccept(overdue), null)
})

test('commission requires explicit acceptance for MVP terms', () => {
  const pending = {
    agreementTermsSnapshot: MVP_TERMS,
    referralDecisionStatus: 'pending',
    referralStatus: 'booked',
    bookingAmount: 1000,
  }
  const accepted = { ...pending, referralDecisionStatus: 'accepted' }
  const legacy = { agreementTermsSnapshot: { termsKind: 'legacy_default' }, referralStatus: 'booked', bookingAmount: 1000 }

  assert.equal(computePartnerReferralAmounts(pending, { termsSnapshot: MVP_TERMS }).payoutAmount, 0)
  assert.equal(computePartnerReferralAmounts(accepted, { termsSnapshot: MVP_TERMS }).payoutAmount, 100)
  assert.equal(computePartnerReferralAmounts(legacy, { termsSnapshot: legacy.agreementTermsSnapshot }).payoutAmount, 100)
})

test('commission statement: $2,000 commissionable × 10% = $200 (regression)', () => {
  const data = buildCommissionStatementData(
    {
      id: 'pref-2000',
      referralReference: 'REF-2000',
      companyName: 'Sample Venue LLC',
      partnerName: 'Pat',
      bookingAmount: 2000,
      commissionableAmount: 2000,
      payoutAmount: 0,
      agreementTermsSnapshot: MVP_TERMS,
    },
    { legalAddress: '100 Sample Business Plaza, New York, NY 10001' }
  )
  assert.equal(data.commissionableSubtotal, 2000)
  assert.equal(data.commissionAmount, 200)
})

test('commission statement data includes required fields without client PII', () => {
  const data = buildCommissionStatementData(
    {
      id: 'pref-99',
      referralReference: 'REF-1099',
      companyName: 'Sample Venue LLC',
      partnerName: 'Jordan',
      bookingAmount: 5000,
      totalExpenseAmount: 500,
      commissionableAmount: 4500,
      payoutAmount: 450,
      eventDate: '2026-09-12',
      agreementTermsSnapshot: MVP_TERMS,
    },
    { legalAddress: '200 Business Center, NY' }
  )
  assert.match(data.statementNumber, /^CS-/)
  assert.equal(data.partnerLegalName, 'Sample Venue LLC')
  assert.equal(data.referralReference, 'REF-1099')
  assert.equal(data.commissionableSubtotal, 4500)
  assert.equal(data.commissionAmount, 450)
  assert.equal(data.collectedSubtotal, 5000)
  assert.ok(!('clientEmail' in data))
})

test('commission statement PDF renders non-empty buffer', async () => {
  const data = buildCommissionStatementData(
    {
      id: 'pref-pdf',
      referralReference: 'REF-PDF',
      companyName: 'Venue LLC',
      partnerName: 'Pat',
      bookingAmount: 1000,
      commissionableAmount: 1000,
      payoutAmount: 100,
      agreementTermsSnapshot: MVP_TERMS,
    },
    {}
  )
  const pdf = await renderCommissionStatementPdf(data)
  assert.ok(pdf.length > 500)
})

test('payout completion blocked without generated and delivered statement', () => {
  const referral = {
    referralStatus: 'booked',
    payoutStatus: 'pending',
    agreementTermsSnapshot: MVP_TERMS,
    referralDecisionStatus: 'accepted',
    eventCompletedAt: '2026-08-01',
    clientPaidInFullAt: '2026-08-02',
  }
  assert.ok(validatePayoutStatusChange(referral, 'completed', {}))
  assert.equal(
    validatePayoutStatusChange(
      { ...referral, commissionStatementGeneratedAt: '2026-08-03' },
      'completed',
      {}
    ),
    'Record commission statement delivery before marking this payout Completed.'
  )
  assert.equal(
    validatePayoutStatusChange(
      {
        ...referral,
        commissionStatementGeneratedAt: '2026-08-03',
        commissionStatementDeliveredAt: '2026-08-04',
      },
      'completed',
      {}
    ),
    null
  )
  assert.equal(validateCommissionStatementForPayout({}), 'Generate a commission statement before marking this payout Completed.')
})

test('integration: decision accept enables commission for booked referral', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'aurora-ref-decision-'))
  process.env.DATA_DIR = dataDir
  const db = await import('../server/db.js')
  const decisions = await import('../server/partnerReferralDecisions.js')
  const org = await import('../server/referralOrganizationSettings.js')
  org.updateAuroraOrganizationSettings({
    legalName: 'Aurora Sonnet LLC',
    legalAddress: '200 Business Center, New York, NY 10001',
    noticeEmail: 'legal@test.test',
  })

  const venueId = db.createVenue({ companyName: 'Decision Venue', stage: 'partner' })
  const partnershipId = `rp-dec-${Date.now()}`
  const agreementId = `rpa-dec-${Date.now()}`
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
    termsJson: JSON.stringify(MVP_TERMS),
    contentHtml: '<p>x</p>',
    signatoryName: 'Pat',
    signatoryTitle: 'GM',
    generatedPdfBlob: Buffer.from('%PDF'),
    signedPdfBlob: Buffer.from('%PDF'),
    partnerSignerName: 'Pat',
    partnerSignedDate: '2026-01-01',
    agencySignerName: 'Lisa',
    agencySignedDate: '2026-01-02',
    auditLogJson: '[]',
    legalApprovalStatus: 'owner_approved',
    legalApprovedAt: now,
    agreementVersionIdentifier: 'RPA-dec-v1',
    createdAt: now,
    updatedAt: now,
  })

  const created = db.createPartnerReferral({
    partnerName: 'Pat',
    partnerEmail: 'pat@venue.test',
    clientName: 'Client',
    clientEmail: 'client@test.com',
    venueId,
    referralStatus: 'booked',
    bookingAmount: 2000,
  })
  const row = db.getPartnerReferral(created.id)
  assert.equal(row.referralDecisionStatus, 'pending')
  assert.ok(row.referralDecisionDeadline)
  assert.equal(computePartnerReferralAmounts(row, { termsSnapshot: MVP_TERMS }).payoutAmount, 0)

  const accepted = decisions.acceptPartnerReferralDecision(created.id, { actor: 'crm', notes: 'Valid referral' })
  assert.equal(accepted.ok, true)
  assert.equal(accepted.referral.referralDecisionStatus, 'accepted')

  const after = db.getPartnerReferral(created.id)
  assert.equal(computePartnerReferralAmounts(after, { termsSnapshot: MVP_TERMS }).payoutAmount, 200)

  const gen = await decisions.generatePartnerReferralCommissionStatement(created.id, {
    paymentDate: '2026-08-15',
    paymentMethod: 'ACH',
    paymentReference: 'TX-123',
  })
  assert.equal(gen.ok, true)
  assert.ok(gen.referral.hasCommissionStatement)
  const afterGen = db.getPartnerReferral(created.id)
  const stmtData = buildCommissionStatementData(afterGen, org.getAuroraOrganizationSettings())
  assert.equal(stmtData.commissionAmount, 200)
  assert.equal(stmtData.commissionableSubtotal, 2000)

  const delivered = decisions.recordPartnerReferralCommissionStatementDelivery(created.id, {
    method: 'Email',
    reference: 'pat@venue.test',
    actor: 'crm',
  })
  assert.equal(delivered.ok, true)

  const outDir = join(process.cwd(), 'docs', 'samples')
  const pdf = db.getPartnerReferralCommissionStatementPdf(created.id)
  writeFileSync(join(outDir, 'referral-commission-statement-sample.pdf'), pdf)

  delete process.env.DATA_DIR
  rmSync(dataDir, { recursive: true, force: true })
})
