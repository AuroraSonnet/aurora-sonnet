/**
 * Partner referral commission math (whole USD, same as invoices — no cents column).
 * Isolated module so tests run without opening SQLite.
 */

export const PARTNER_REFERRAL_COMMISSION_RATE = 0.05
export const PARTNER_REFERRAL_MIN_PAYOUT_AMOUNT = 100

/** Canonical keys stored in DB; UI can show labels from PARTNER_REFERRAL_STATUS_LABELS */
export const PARTNER_REFERRAL_STATUS_KEYS = [
  'new',
  'under_review',
  'contacted',
  'booked',
  'closed_lost',
  'paid',
]

export const PARTNER_REFERRAL_STATUS_LABELS = {
  new: 'New',
  under_review: 'Under Review',
  contacted: 'Contacted',
  booked: 'Booked',
  closed_lost: 'Closed Lost',
  paid: 'Paid',
}

/**
 * Normalize user/API input to a snake_case key for comparisons.
 * Accepts e.g. "Under Review", "under-review", "UNDER_REVIEW" → "under_review"
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
 * True when the referred client has a confirmed booking worth paying commission on.
 *
 * - **booked** — client signed / event is booked (use this instead of the old `confirmed` flag).
 * - **paid** — referral row closed after a successful booking; earned fee still applies (whether the
 *   partner has been paid is **payoutStatus**, not referralStatus).
 * - **closed_lost**, **new**, **under_review**, **contacted** — no earned payout (computed payout 0).
 *
 * Legacy: **confirmed** (Step 2) is treated as **booked** so existing rows keep working.
 * Legacy: **pending** is treated like **new** (no payout).
 */
export function referralStatusEligibleForBookingPayout(referralStatusRaw) {
  const key = normalizeReferralStatusKey(referralStatusRaw)
  if (key === 'confirmed') return true
  if (key === 'booked' || key === 'paid') return true
  return false
}

/**
 * Normalize expense line items from API/DB (array or JSON string).
 * Whole USD amounts; empty names become "Expense".
 */
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

/**
 * Commissionable = booking total (must already include add-ons) − total expenses, floored at 0.
 * Total expenses = sum of {@link normalizeExpenseLineItems} when that list is non-empty; otherwise legacy travel + hotel.
 * Earned payout when {@link referralStatusEligibleForBookingPayout}: max(round(5% × commissionable), $100).
 * Otherwise earned payout = 0 (overrides can still set a manual payout).
 */
export function computePartnerReferralAmounts(values) {
  const booking = Math.max(0, Math.round(Number(values.bookingAmount) || 0))
  const travel = Math.max(0, Math.round(Number(values.travelExpenseAmount) || 0))
  const hotel = Math.max(0, Math.round(Number(values.hotelExpenseAmount) || 0))
  const lines = normalizeExpenseLineItems(values.expenseLineItems)
  const fromLines = lines.reduce((s, l) => s + l.amount, 0)
  const totalExpenseAmount = lines.length > 0 ? fromLines : travel + hotel
  const travelExpenseAmount = lines.length > 0 ? 0 : travel
  const hotelExpenseAmount = lines.length > 0 ? 0 : hotel
  const autoCommissionable = Math.max(0, booking - totalExpenseAmount)

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

  let payoutComputed = 0
  if (eligible) {
    const fivePct = Math.round(commissionableAmount * PARTNER_REFERRAL_COMMISSION_RATE)
    payoutComputed = Math.max(fivePct, PARTNER_REFERRAL_MIN_PAYOUT_AMOUNT)
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
  }
}
