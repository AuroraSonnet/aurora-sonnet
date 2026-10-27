/** Booking label shared by Couple Referrals, Partner Accounts, and the partner portal. Display only. */

function statusKey(raw) {
  let s = String(raw ?? '')
    .toLowerCase()
    .trim()
    .replace(/[\s-]+/g, '_')
  if (s === 'closedlost') s = 'closed_lost'
  return s
}

export function bookingStatusLabel(referral, links = []) {
  const key = statusKey(referral?.referralStatus)
  const payout = String(referral?.payoutStatus ?? '').toLowerCase()
  const legacyPaid = (payout === 'paid' || payout === 'completed') && Number(referral?.payoutAmount) > 0
  if (links.some((link) => link?.bookedConfirmedAt) || legacyPaid) return 'Booked'
  if (key === 'closed_lost' || referral?.referralDecisionStatus === 'rejected') return 'Not Booked'
  if (key === 'new' || links.length === 0) return 'New'
  return 'In Progress'
}
