/**
 * Payout rules (whole USD): 5% of commissionable, min $100, only when booking is won.
 * Run: npm run test:referral-payout
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  computePartnerReferralAmounts,
  normalizeExpenseLineItems,
  referralStatusEligibleForBookingPayout,
  normalizeReferralStatusKey,
  PARTNER_REFERRAL_MIN_PAYOUT_AMOUNT,
} from './partnerReferralPayout.js'

describe('referralStatusEligibleForBookingPayout', () => {
  it('is false for pipeline before a booking', () => {
    assert.equal(referralStatusEligibleForBookingPayout('new'), false)
    assert.equal(referralStatusEligibleForBookingPayout('under_review'), false)
    assert.equal(referralStatusEligibleForBookingPayout('Under Review'), false)
    assert.equal(referralStatusEligibleForBookingPayout('contacted'), false)
    assert.equal(referralStatusEligibleForBookingPayout('pending'), false)
  })
  it('is false for closed lost', () => {
    assert.equal(referralStatusEligibleForBookingPayout('closed_lost'), false)
    assert.equal(referralStatusEligibleForBookingPayout('Closed Lost'), false)
  })
  it('is true for booked and paid (and legacy confirmed)', () => {
    assert.equal(referralStatusEligibleForBookingPayout('booked'), true)
    assert.equal(referralStatusEligibleForBookingPayout('Booked'), true)
    assert.equal(referralStatusEligibleForBookingPayout('paid'), true)
    assert.equal(referralStatusEligibleForBookingPayout('confirmed'), true)
  })
})

describe('normalizeReferralStatusKey', () => {
  it('normalizes labels and hyphens', () => {
    assert.equal(normalizeReferralStatusKey('Under Review'), 'under_review')
    assert.equal(normalizeReferralStatusKey('closed-lost'), 'closed_lost')
  })
})

describe('normalizeExpenseLineItems', () => {
  it('parses JSON string and rounds amounts', () => {
    const lines = normalizeExpenseLineItems('[{"id":"a","name":"Car","amount": 99.4}]')
    assert.equal(lines.length, 1)
    assert.equal(lines[0].amount, 99)
    assert.equal(lines[0].name, 'Car')
  })
})

describe('partnership terms (10%, no minimum)', () => {
  const partnershipTerms = {
    termsKind: 'referral_partnership_mvp',
    commissionRate: 0.1,
    minPayoutAmount: null,
  }
  const booked = { referralStatus: 'booked' }

  it('$500 subtotal → $50 commission', () => {
    const r = computePartnerReferralAmounts({ bookingAmount: 500, ...booked }, { termsSnapshot: partnershipTerms })
    assert.equal(r.payoutAmount, 50)
  })

  it('$2,000 booking → $200 (no $100 floor)', () => {
    const r = computePartnerReferralAmounts(
      { bookingAmount: 2000, travelExpenseAmount: 0, hotelExpenseAmount: 0, ...booked },
      { termsSnapshot: partnershipTerms }
    )
    assert.equal(r.payoutAmount, 200)
  })

  it('travel/hotel expenses do not reduce commission base', () => {
    const r = computePartnerReferralAmounts(
      {
        bookingAmount: 4000,
        travelExpenseAmount: 300,
        hotelExpenseAmount: 200,
        ...booked,
      },
      { termsSnapshot: partnershipTerms }
    )
    assert.equal(r.commissionableAmount, 4000)
    assert.equal(r.payoutAmount, 400)
  })

  it('pays less below $1,000 commissionable vs legacy, equal at $1,000, more above', () => {
    const legacy = {
      termsKind: 'legacy_default',
      commissionRate: 0.05,
      minPayoutAmount: 100,
      useLegacyExpenseDeduction: true,
    }
    assert.equal(
      computePartnerReferralAmounts({ bookingAmount: 500, ...booked }, { termsSnapshot: partnershipTerms }).payoutAmount,
      50
    )
    assert.equal(
      computePartnerReferralAmounts({ bookingAmount: 500, ...booked }, { termsSnapshot: legacy }).payoutAmount,
      100
    )
    assert.equal(
      computePartnerReferralAmounts({ bookingAmount: 1000, ...booked }, { termsSnapshot: partnershipTerms }).payoutAmount,
      100
    )
    assert.equal(
      computePartnerReferralAmounts({ bookingAmount: 1000, ...booked }, { termsSnapshot: legacy }).payoutAmount,
      100
    )
    assert.equal(
      computePartnerReferralAmounts({ bookingAmount: 2000, ...booked }, { termsSnapshot: partnershipTerms }).payoutAmount,
      200
    )
    assert.equal(
      computePartnerReferralAmounts({ bookingAmount: 2000, ...booked }, { termsSnapshot: legacy }).payoutAmount,
      100
    )
  })
})

describe('legacy_default snapshot (5% / $100 min) unchanged', () => {
  const legacy = {
    termsKind: 'legacy_default',
    commissionRate: 0.05,
    minPayoutAmount: 100,
    useLegacyExpenseDeduction: true,
  }
  const booked = { referralStatus: 'booked' }

  it('$2,000 booking → $100 (5%=$100, min $100)', () => {
    const r = computePartnerReferralAmounts(
      { bookingAmount: 2000, travelExpenseAmount: 0, hotelExpenseAmount: 0, ...booked },
      { termsSnapshot: legacy }
    )
    assert.equal(r.payoutAmount, 100)
  })

  it('expenses reduce commissionable base', () => {
    const r = computePartnerReferralAmounts(
      { bookingAmount: 4000, travelExpenseAmount: 300, hotelExpenseAmount: 200, ...booked },
      { termsSnapshot: legacy }
    )
    assert.equal(r.commissionableAmount, 3500)
    assert.equal(r.payoutAmount, 175)
  })
})

describe('computePartnerReferralAmounts — user examples (default legacy, no termsSnapshot)', () => {
  const booked = { referralStatus: 'booked' }

  it('$2,000 booking, no travel/hotel → payout $100 (5%=$100, min $100)', () => {
    const r = computePartnerReferralAmounts({
      bookingAmount: 2000,
      travelExpenseAmount: 0,
      hotelExpenseAmount: 0,
      ...booked,
    })
    assert.equal(r.commissionableAmount, 2000)
    assert.equal(r.payoutAmount, 100)
  })

  it('$2,500 booking, no travel/hotel → payout $125', () => {
    const r = computePartnerReferralAmounts({
      bookingAmount: 2500,
      travelExpenseAmount: 0,
      hotelExpenseAmount: 0,
      ...booked,
    })
    assert.equal(r.payoutAmount, 125)
  })

  it('$4,000 with $500 excluded (travel+hotel) → commissionable $3,500 → payout $175', () => {
    const r = computePartnerReferralAmounts({
      bookingAmount: 4000,
      travelExpenseAmount: 300,
      hotelExpenseAmount: 200,
      ...booked,
    })
    assert.equal(r.totalExpenseAmount, 500)
    assert.equal(r.commissionableAmount, 3500)
    assert.equal(r.payoutAmount, 175)
  })

  it('expense line items replace travel/hotel when non-empty', () => {
    const r = computePartnerReferralAmounts({
      bookingAmount: 4000,
      travelExpenseAmount: 300,
      hotelExpenseAmount: 200,
      expenseLineItems: [
        { id: '1', name: 'Flights', amount: 400 },
        { id: '2', name: 'Hotel', amount: 100 },
      ],
      ...booked,
    })
    assert.equal(r.totalExpenseAmount, 500)
    assert.equal(r.travelExpenseAmount, 0)
    assert.equal(r.hotelExpenseAmount, 0)
    assert.equal(r.commissionableAmount, 3500)
    assert.equal(r.payoutAmount, 175)
  })

  it('add-ons: larger final bookingAmount is the base (single field includes add-ons)', () => {
    const base = computePartnerReferralAmounts({
      bookingAmount: 4000,
      travelExpenseAmount: 0,
      hotelExpenseAmount: 0,
      ...booked,
    })
    const withAddons = computePartnerReferralAmounts({
      bookingAmount: 5500,
      travelExpenseAmount: 0,
      hotelExpenseAmount: 0,
      ...booked,
    })
    assert.equal(base.payoutAmount, 200)
    assert.equal(withAddons.payoutAmount, 275)
  })

  it('no payout until status is booked (or paid / legacy confirmed)', () => {
    assert.equal(
      computePartnerReferralAmounts({
        bookingAmount: 10000,
        travelExpenseAmount: 0,
        hotelExpenseAmount: 0,
        referralStatus: 'new',
      }).payoutAmount,
      0
    )
    assert.equal(
      computePartnerReferralAmounts({
        bookingAmount: 10000,
        travelExpenseAmount: 0,
        hotelExpenseAmount: 0,
        referralStatus: 'contacted',
      }).payoutAmount,
      0
    )
    assert.equal(
      computePartnerReferralAmounts({
        bookingAmount: 10000,
        travelExpenseAmount: 0,
        hotelExpenseAmount: 0,
        referralStatus: 'closed_lost',
      }).payoutAmount,
      0
    )
  })

  it('paid status still earns formula (partner settlement is payoutStatus)', () => {
    const r = computePartnerReferralAmounts({
      bookingAmount: 2000,
      travelExpenseAmount: 0,
      hotelExpenseAmount: 0,
      referralStatus: 'paid',
    })
    assert.equal(r.payoutAmount, 100)
  })
})

describe('overrides', () => {
  it('payoutOverrideAmount wins over computed', () => {
    const r = computePartnerReferralAmounts({
      bookingAmount: 2000,
      travelExpenseAmount: 0,
      hotelExpenseAmount: 0,
      referralStatus: 'booked',
      payoutOverrideAmount: 999,
    })
    assert.equal(r.payoutAmount, 999)
  })

  it('commissionableOverrideAmount changes 5% base (min $100 still applies when eligible)', () => {
    const r = computePartnerReferralAmounts({
      bookingAmount: 10000,
      travelExpenseAmount: 0,
      hotelExpenseAmount: 0,
      referralStatus: 'booked',
      commissionableOverrideAmount: 1000,
    })
    assert.equal(r.commissionableAmount, 1000)
    assert.equal(r.payoutAmount, 100)
  })
})

describe('recalculation model (matches PATCH /api/partner-referrals/:id)', () => {
  it('re-running compute with higher booking updates payout when booked', () => {
    const first = computePartnerReferralAmounts({
      bookingAmount: 2000,
      travelExpenseAmount: 0,
      hotelExpenseAmount: 0,
      referralStatus: 'booked',
    })
    const afterAddons = computePartnerReferralAmounts({
      bookingAmount: 5000,
      travelExpenseAmount: 0,
      hotelExpenseAmount: 0,
      referralStatus: 'booked',
    })
    assert.equal(first.payoutAmount, 100)
    assert.equal(afterAddons.payoutAmount, 250)
  })

  it('moving from contacted to booked turns on payout', () => {
    const before = computePartnerReferralAmounts({
      bookingAmount: 2000,
      referralStatus: 'contacted',
    })
    const after = computePartnerReferralAmounts({
      bookingAmount: 2000,
      referralStatus: 'booked',
    })
    assert.equal(before.payoutAmount, 0)
    assert.equal(after.payoutAmount, PARTNER_REFERRAL_MIN_PAYOUT_AMOUNT)
  })
})
