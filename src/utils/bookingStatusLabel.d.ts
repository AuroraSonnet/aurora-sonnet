export function bookingStatusLabel(
  referral: {
    referralStatus?: string | null
    referralDecisionStatus?: string | null
    payoutStatus?: string | null
    payoutAmount?: number | null
  } | null | undefined,
  links?: { bookedConfirmedAt?: string | null }[]
): string
