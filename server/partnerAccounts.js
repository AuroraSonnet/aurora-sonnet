/**
 * Read-only admin view of signed public partner accounts.
 * Uses referral_partnerships and partner_referrals. Does not create accounts.
 */
import {
  getReferralPartnershipAgreementById,
  getReferralPartnershipById,
  listPartnerReferralsByPartnershipId,
  listReferralPartnerships,
  listReferralProjectLinksWithProjects,
  setPartnerReferralPartnershipId,
} from './db.js'
import { partnerReferralStatusLabel, referralRecordStatusLabel } from './partnerPortal.js'
import { buildPartnerReferralLink } from './publicReferralPartner.js'

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

/** Explicit admin choice only. Null clears the account link. A typed name or email is not an assignment. */
export function normalizeSignedPartnerAssignment(partnershipId) {
  if (partnershipId == null || String(partnershipId).trim() === '') return { partnershipId: null }
  const id = String(partnershipId).trim()
  const partnership = getReferralPartnershipById(id)
  const agreement = partnership?.activeAgreementId
    ? getReferralPartnershipAgreementById(partnership.activeAgreementId)
    : null
  if (!isSignedPublicPartnerAccount(partnership, agreement)) {
    return { error: 'Choose a signed partner account.', status: 400 }
  }
  return { partnershipId: id }
}

export function assignReferralToSignedPartner(referralId, partnershipId) {
  const normalized = normalizeSignedPartnerAssignment(partnershipId)
  if (normalized.error) return normalized
  const referral = setPartnerReferralPartnershipId(referralId, normalized.partnershipId)
  if (!referral) return { error: 'Partner referral not found.', status: 404 }
  return { referral }
}

export function getSignedPublicPartnerAccount(id) {
  const partnership = getReferralPartnershipById(id)
  if (!signedAgreement(partnership)) return null
  const couples = listPartnerReferralsByPartnershipId(partnership.id).map((referral) => ({
    reference: referral.referralReference || null,
    couple: referral.clientName || '',
    recordStatus: referralRecordStatusLabel(referral),
    status: partnerReferralStatusLabel(
      referral,
      listReferralProjectLinksWithProjects(referral.id).map((item) => item.link)
    ),
  }))
  return {
    ...summary(partnership),
    couples,
  }
}
