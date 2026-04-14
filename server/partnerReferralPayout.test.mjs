/**
 * Payout rules (whole USD): 5% of commissionable, min $100, only when booking is won.
 * Run: npm run test:referral-payout
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  computePartnerReferralAmounts,
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

describe('computePartnerReferralAmounts — user examples', () => {
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
