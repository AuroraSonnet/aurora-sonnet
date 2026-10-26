/**
 * Read-only admin view of signed public partner accounts.
 * Uses referral_partnerships and partner_referrals. Does not create accounts.
 */
import {
  getReferralPartnershipAgreementById,
  getReferralPartnershipById,
  listPartnerReferralsByPartnershipId,
  listReferralPartnerships,
} from './db.js'
import { normalizeReferralStatusKey } from './partnerReferralPayout.js'
import { buildPartnerReferralLink } from './publicReferralPartner.js'

const REFERRAL_STATUS_LABELS = {
  new: 'New',
  under_review: 'Under Review',
  contacted: 'Contacted',
  booked: 'Booked',
  closed_lost: 'Closed Lost',
  paid: 'Paid',
  pending: 'New (legacy)',
  confirmed: 'Booked (legacy)',
}

export function referralStatusLabel(status) {
  const key = normalizeReferralStatusKey(status)
  if (REFERRAL_STATUS_LABELS[key]) return REFERRAL_STATUS_LABELS[key]
  const raw = String(status || '').trim()
  if (!raw) return 'New'
  return raw.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

export function isSignedPublicPartnerAccount(partnership, agreement) {
  if (!partnership?.id || !agreement) return false
  if (agreement.partnershipId !== partnership.id) return false
  if (String(agreement.status || '').toLowerCase() !== 'fully_executed') return false
  const kind =
    agreement.termsJson && typeof agreement.termsJson === 'object' ? agreement.termsJson.termsKind : ''
  return kind === 'public_partner_agreement'
}

function accountStatusLabel(status) {
  if (status === 'active') return 'Active'
  if (status === 'pending_signature') return 'Pending signature'
  return 'Inactive'
}

function summary(partnership) {
  const token = partnership.status === 'active' ? String(partnership.referralToken || '').trim() : ''
  return {
    id: partnership.id,
    partnerName: partnership.partnerName || '',
    companyName: partnership.companyName || null,
    partnerEmail: partnership.partnerEmail || '',
    accountStatus: accountStatusLabel(partnership.status),
    agreementStatus: 'Signed',
    referralLink: token ? buildPartnerReferralLink(token) : null,
  }
}

function signedAgreement(partnership) {
  if (!partnership?.activeAgreementId) return null
  const agreement = getReferralPartnershipAgreementById(partnership.activeAgreementId)
  return isSignedPublicPartnerAccount(partnership, agreement) ? agreement : null
}

export function listSignedPublicPartnerAccounts() {
  return listReferralPartnerships()
    .filter((partnership) => signedAgreement(partnership))
    .map(summary)
    .sort(
      (a, b) =>
        a.partnerName.localeCompare(b.partnerName, undefined, { sensitivity: 'base' }) ||
        a.partnerEmail.localeCompare(b.partnerEmail)
    )
}

export function getSignedPublicPartnerAccount(id) {
  const partnership = getReferralPartnershipById(id)
  if (!signedAgreement(partnership)) return null
  const couples = listPartnerReferralsByPartnershipId(partnership.id).map((referral) => ({
    reference: referral.referralReference || null,
    couple: referral.clientName || '',
    status: referralStatusLabel(referral.referralStatus),
  }))
  return {
    ...summary(partnership),
    couples,
  }
}
