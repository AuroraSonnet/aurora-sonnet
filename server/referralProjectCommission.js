/**
 * Per-project partner commission rules. A referral (couple attribution) may have many linked projects;
 * each link carries its own admin-confirmed booking, eligible amount, completion, payment and payout.
 * Invoices and projects.value are context only and never confirm anything here.
 */
import { computePartnerReferralAmounts } from './partnerReferralPayout.js'
import { isReferralCommissionEligible } from './referralDecision.js'

export const PROJECT_PAYOUT_STATUSES = ['none', 'pending', 'completed']

export function parentAllowsCommission(referral) {
  return Boolean(referral) && isReferralCommissionEligible(referral)
}

export function legacyPayoutIsHistory(referral) {
  const s = String(referral?.payoutStatus || '').toLowerCase()
  return (s === 'paid' || s === 'completed') && Number(referral?.payoutAmount) > 0
}

export function hasEligibleAmount(link) {
  return Number.isFinite(link?.eligibleAmount) && link.eligibleAmount > 0
}

/** Commission for one project, using the parent referral's frozen terms snapshot. */
export function computeProjectCommission(link, referral) {
  if (!link?.bookedConfirmedAt || !hasEligibleAmount(link)) return 0
  const amounts = computePartnerReferralAmounts(
    {
      bookingAmount: link.eligibleAmount,
      referralStatus: 'booked',
      agreementTermsSnapshot: referral?.agreementTermsSnapshot,
      referralDecisionStatus: referral?.referralDecisionStatus,
      referralDecisionDeadline: referral?.referralDecisionDeadline,
    },
    { termsSnapshot: referral?.agreementTermsSnapshot }
  )
  return amounts.payoutAmount
}

/** @returns {'paid'|'earned'|'pending'|null} */
export function projectCommissionState(link, referral) {
  if (!link) return null
  if (link.payoutStatus === 'completed') return 'paid'
  if (!parentAllowsCommission(referral)) return null
  if (!link.bookedConfirmedAt || !hasEligibleAmount(link)) return null
  if (!(Number(link.commissionAmount) > 0)) return null
  if (link.eventCompletedAt && link.clientPaidInFullAt) return 'earned'
  return 'pending'
}

/** @param {boolean} projectHasLegacyPaidCommission any referral records this project as an already-paid legacy event */
export function validateConfirmBooked(link, projectHasLegacyPaidCommission) {
  if (!link) return 'Link not found.'
  if (link.payoutStatus === 'completed') return 'This commission is paid and locked.'
  if (link.bookedConfirmedAt) return 'Booked performance is already confirmed.'
  if (projectHasLegacyPaidCommission) {
    return 'A commission for this booking was already paid on the original referral record. It cannot earn a second commission.'
  }
  return null
}

export function validateEligibleAmount(link, amount) {
  if (!link) return 'Link not found.'
  if (link.payoutStatus === 'completed') return 'This commission is paid and locked.'
  if (amount !== null && (!Number.isFinite(amount) || amount < 0)) return 'Enter a whole-dollar amount of 0 or more.'
  return null
}

export function validateConfirmCompletePaid(link) {
  if (!link) return 'Link not found.'
  if (link.payoutStatus === 'completed') return 'This commission is paid and locked.'
  if (!link.bookedConfirmedAt) return 'Confirm booked performance first.'
  if (!hasEligibleAmount(link)) return 'Enter the eligible performance amount first.'
  if (link.eventCompletedAt && link.clientPaidInFullAt) return 'Already confirmed.'
  return null
}

export function validateProjectPayoutStatus(link, referral, next) {
  if (!link) return 'Link not found.'
  if (!PROJECT_PAYOUT_STATUSES.includes(next)) return 'Invalid payout status.'
  const cur = link.payoutStatus || 'none'
  if (cur === next) return null
  if (cur === 'completed') return 'A paid commission is kept as history and cannot be reopened.'
  if (next === 'none') return null
  if (!parentAllowsCommission(referral)) return 'The referral must be explicitly accepted before any commission payout.'
  if (!link.bookedConfirmedAt) return 'Confirm booked performance first.'
  if (!hasEligibleAmount(link) || !(Number(link.commissionAmount) > 0)) return 'Enter the eligible performance amount first.'
  if (!link.eventCompletedAt || !link.clientPaidInFullAt) return 'Confirm the event is complete and the client paid in full first.'
  return null
}

export function canUnlink(link) {
  return Boolean(link) && !link.bookedConfirmedAt && !link.eventCompletedAt && !link.clientPaidInFullAt && (link.payoutStatus || 'none') === 'none'
}
