/**
 * Partner referral commission math (whole USD, same as invoices — no cents column).
 * Isolated module so tests run without opening SQLite.
 */

import { parseTermsSnapshot } from './referralPartnershipTerms.js'

export const PARTNER_REFERRAL_COMMISSION_RATE = 0.05
export const PARTNER_REFERRAL_MIN_PAYOUT_AMOUNT = 100

/** Status keys available for new referrals (legacy `paid` excluded). */
export const PARTNER_REFERRAL_STATUS_KEYS_NEW = [
  'new',
  'under_review',
  'contacted',
  'booked',
  'closed_lost',
]

/** Canonical keys stored in DB; includes legacy values for read/display. */
export const PARTNER_REFERRAL_STATUS_KEYS = [...PARTNER_REFERRAL_STATUS_KEYS_NEW, 'paid']

export const PARTNER_REFERRAL_STATUS_LABELS = {
  new: 'New',
  under_review: 'Under Review',
  contacted: 'Contacted',
  booked: 'Booked',
  closed_lost: 'Closed Lost',
  paid: 'Paid (legacy — use Payout status)',
}

/**
 * Normalize user/API input to a snake_case key for comparisons.
 */
export function normalizeReferralStatusKey(raw) {
  let s = String(raw ?? '')
    .toLowerCase()
    .trim()
    .replace(/[\s-]+/g, '_')
  if (s === 'closedlost') s = 'closed_lost'
  return s
}

/**
 * True when the referred client has a confirmed booking worth an estimated commission.
 * Legacy `paid` and `confirmed` remain eligible for read/back-compat until migration.
 */
export function referralStatusEligibleForBookingPayout(referralStatusRaw) {
  const key = normalizeReferralStatusKey(referralStatusRaw)
  if (key === 'confirmed') return true
  if (key === 'booked' || key === 'paid') return true
  return false
}

export function normalizeExpenseLineItems(raw) {
  if (raw == null || raw === '') return []
  let arr = raw
  if (typeof raw === 'string') {
    try {
      arr = JSON.parse(raw)
    } catch {
      return []
    }
  }
  if (!Array.isArray(arr)) return []
  return arr.map((row, i) => ({
    id: String(row?.id != null && String(row.id).trim() ? row.id : `exp-${i}`).slice(0, 64),
    name: String(row?.name ?? 'Expense').trim() || 'Expense',
    amount: Math.max(0, Math.round(Number(row?.amount) || 0)),
  }))
}

function termsUseLegacyExpenseDeduction(termsSnapshot) {
  const t = parseTermsSnapshot(termsSnapshot)
  if (!t) return true
  if (t.termsKind === 'legacy_default' || t.useLegacyExpenseDeduction) return true
  return false
}

function commissionRateFromTerms(termsSnapshot) {
  const t = parseTermsSnapshot(termsSnapshot)
  if (isPartnershipTermsSnapshot(t)) {
    const rate = t?.commissionRate
    return Number.isFinite(rate) && rate >= 0 ? rate : 0.1
  }
  const rate = t?.commissionRate
  return Number.isFinite(rate) && rate >= 0 ? rate : PARTNER_REFERRAL_COMMISSION_RATE
}

function isPartnershipTermsSnapshot(termsSnapshot) {
  const t = parseTermsSnapshot(termsSnapshot)
  return t?.termsKind === 'referral_partnership_mvp'
}

function minPayoutFromTerms(termsSnapshot) {
  const t = parseTermsSnapshot(termsSnapshot)
  if (isPartnershipTermsSnapshot(t)) return 0
  if (!t || t.termsKind === 'legacy_default' || t.useLegacyExpenseDeduction) {
    const min = t?.minPayoutAmount
    return Number.isFinite(min) && min >= 0 ? min : PARTNER_REFERRAL_MIN_PAYOUT_AMOUNT
  }
  const min = t?.minPayoutAmount
  if (min == null || min === '') return 0
  return Number.isFinite(min) && min >= 0 ? min : PARTNER_REFERRAL_MIN_PAYOUT_AMOUNT
}

/**
 * @param {object} values - booking/expense/status fields
 * @param {{ termsSnapshot?: object|string|null }} [options]
 */
export function computePartnerReferralAmounts(values, options = {}) {
  const booking = Math.max(0, Math.round(Number(values.bookingAmount) || 0))
  const travel = Math.max(0, Math.round(Number(values.travelExpenseAmount) || 0))
  const hotel = Math.max(0, Math.round(Number(values.hotelExpenseAmount) || 0))
  const lines = normalizeExpenseLineItems(values.expenseLineItems)
  const fromLines = lines.reduce((s, l) => s + l.amount, 0)
  const legacyExpenseMode = termsUseLegacyExpenseDeduction(options.termsSnapshot)
  const totalExpenseAmount = legacyExpenseMode ? (lines.length > 0 ? fromLines : travel + hotel) : 0
  const travelExpenseAmount = legacyExpenseMode && lines.length === 0 ? travel : 0
  const hotelExpenseAmount = legacyExpenseMode && lines.length === 0 ? hotel : 0
  const autoCommissionable = legacyExpenseMode
    ? Math.max(0, booking - totalExpenseAmount)
    : Math.max(0, booking)

  let commissionableOverrideAmount = values.commissionableOverrideAmount
  if (
    commissionableOverrideAmount !== undefined &&
    commissionableOverrideAmount !== null &&
    commissionableOverrideAmount !== ''
  ) {
    commissionableOverrideAmount = Math.max(0, Math.round(Number(commissionableOverrideAmount)))
  } else {
    commissionableOverrideAmount = null
  }

  const commissionableAmount =
    commissionableOverrideAmount != null ? commissionableOverrideAmount : autoCommissionable

  const eligible = referralStatusEligibleForBookingPayout(values.referralStatus)
  const rate = commissionRateFromTerms(options.termsSnapshot)
  const minPayout = minPayoutFromTerms(options.termsSnapshot)

  let payoutComputed = 0
  if (eligible) {
    const pct = Math.round(commissionableAmount * rate)
    payoutComputed = minPayout > 0 ? Math.max(pct, minPayout) : pct
  }

  let payoutOverrideAmount = values.payoutOverrideAmount
  if (payoutOverrideAmount !== undefined && payoutOverrideAmount !== null && payoutOverrideAmount !== '') {
    payoutOverrideAmount = Math.max(0, Math.round(Number(payoutOverrideAmount)))
  } else {
    payoutOverrideAmount = null
  }

  const payoutAmount = payoutOverrideAmount != null ? payoutOverrideAmount : payoutComputed

  return {
    bookingAmount: booking,
    travelExpenseAmount,
    hotelExpenseAmount,
    totalExpenseAmount,
    expenseLineItems: lines,
    commissionableAmount,
    commissionableOverrideAmount,
    payoutAmount,
    payoutOverrideAmount,
    estimatedPayout: eligible ? payoutAmount : 0,
  }
}

/** Event completed: explicit timestamp, linked project stage, or legacy inference. */
export function isReferralEventCompleted(referral, project) {
  if (referral?.eventCompletedAt) return true
  if (project && normalizeReferralStatusKey(project.stage) === 'completed') return true
  return false
}

/** Client paid in full: explicit timestamp or all project invoices paid. */
export function isReferralClientPaidInFull(referral, projectInvoices) {
  if (referral?.clientPaidInFullAt) return true
  const invoices = Array.isArray(projectInvoices) ? projectInvoices : []
  if (invoices.length === 0) return false
  return invoices.every((inv) => String(inv?.status || '').toLowerCase() === 'paid')
}

/**
 * Payout may become pending/paid only when booked-eligible, event completed, and client paid in full.
 */
export function isReferralPayoutPayable(referral, context = {}) {
  if (!referralStatusEligibleForBookingPayout(referral?.referralStatus)) return false
  if (!isReferralEventCompleted(referral, context.project)) return false
  if (!isReferralClientPaidInFull(referral, context.projectInvoices)) return false
  return true
}

/**
 * Validates payoutStatus transitions. Returns error string or null if allowed.
 */
export function validatePayoutStatusChange(referral, nextPayoutStatus, context = {}) {
  const next = String(nextPayoutStatus || 'none').toLowerCase()
  const cur = String(referral?.payoutStatus || 'none').toLowerCase()
  if (next === cur) return null
  if (next === 'none') return null
  if (next === 'pending' || next === 'paid') {
    if (!isReferralPayoutPayable(referral, context)) {
      return 'Payout cannot be Pending or Paid until the event is completed and the client has paid Aurora Sonnet in full.'
    }
  }
  return null
}

/** Immutable snapshot must not change once written. */
export function assertAgreementSnapshotImmutable(existingRow, updates) {
  if (!existingRow?.agreementTermsSnapshot) return null
  if (updates.agreementTermsSnapshot !== undefined || updates.agreementSnapshotKind !== undefined) {
    return 'Agreement terms snapshot cannot be modified after creation.'
  }
  if (updates.agreementId !== undefined && updates.agreementId !== existingRow.agreementId) {
    return 'Agreement link cannot be changed after snapshot is set.'
  }
  return null
}
