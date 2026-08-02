/**
 * Legal approval gates, party-field validation, and rejection rules for referral agreements.
 */
import { auroraOrgFieldsForAgreement } from './referralOrganizationSettings.js'

export const LEGAL_APPROVAL_STATUSES = ['pending', 'approved', 'rejected']

export const W9_PAYMENT_LANGUAGE =
  'Before Aurora Sonnet issues any referral commission, Partner must provide a completed and accurate IRS Form W-9 or other applicable tax documentation reasonably requested by Aurora Sonnet. Failure to provide the requested documentation suspends payment but does not otherwise invalidate an eligible referral.'

const PLACEHOLDER_PATTERNS = [
  /^\[.*\]$/,
  /\[[^\]]+\]/,
  /^tbd$/i,
  /placeholder/i,
  /^_{2,}$/,
]

export function isPlaceholderValue(value) {
  const s = String(value ?? '').trim()
  if (!s) return true
  return PLACEHOLDER_PATTERNS.some((re) => re.test(s))
}

export function isAgreementLegallyApproved(agreement) {
  return String(agreement?.legalApprovalStatus || 'pending').toLowerCase() === 'approved'
}

export function isAgreementLegallyRejected(agreement) {
  return String(agreement?.legalApprovalStatus || 'pending').toLowerCase() === 'rejected'
}

export function validateAgreementMutable(agreement) {
  if (isAgreementLegallyRejected(agreement)) {
    return 'This agreement version was rejected and is immutable. Create a new agreement version for any revision.'
  }
  return null
}

/** Required party fields for send / execute / activation (no placeholders). */
export function collectAgreementPartyFieldErrors(agreement, venue, orgOverride = null) {
  const org = orgOverride || auroraOrgFieldsForAgreement()
  const errors = []
  const partnerLegalName = venue?.companyName || agreement?.partnerLegalName || ''
  const addressParts = [venue?.address, venue?.city, venue?.borough].filter(Boolean)
  const partnerAddress = addressParts.join(', ') || agreement?.partnerAddress || ''
  const partnerSignatoryName = agreement?.signatoryName || ''
  const partnerSignatoryTitle = agreement?.signatoryTitle || ''

  if (isPlaceholderValue(partnerLegalName)) errors.push('Partner legal name is required (no placeholders).')
  if (isPlaceholderValue(partnerAddress)) errors.push('Partner address is required (no placeholders).')
  if (isPlaceholderValue(partnerSignatoryName)) errors.push('Partner authorized signatory name is required.')
  if (isPlaceholderValue(partnerSignatoryTitle)) errors.push('Partner authorized signatory title is required.')
  if (isPlaceholderValue(org.agencyLegalName)) errors.push('Aurora Sonnet legal name must be configured in organization settings.')
  if (isPlaceholderValue(org.agencyAddress)) errors.push('Aurora Sonnet legal/mailing address must be configured in organization settings.')
  if (isPlaceholderValue(org.agencySignatoryName)) errors.push('Aurora Sonnet authorized signatory name must be configured.')
  if (isPlaceholderValue(org.agencySignatoryTitle)) errors.push('Aurora Sonnet authorized signatory title must be configured.')
  return errors
}

export function validateAgreementPartyFields(agreement, venue, orgOverride = null) {
  const errors = collectAgreementPartyFieldErrors(agreement, venue, orgOverride)
  if (errors.length) return errors.join(' ')
  return null
}

export function validateAgreementStatusTransition(agreement, nextStatus, context = {}) {
  const mutableErr = validateAgreementMutable(agreement)
  if (mutableErr) return mutableErr

  const next = String(nextStatus || '').toLowerCase()
  if (next !== 'sent' && next !== 'fully_executed') return null

  const partyErr = validateAgreementPartyFields(agreement, context.venue)
  if (partyErr) return partyErr

  if (!isAgreementLegallyApproved(agreement)) {
    return `Legal approval is required before marking this agreement as "${nextStatus}". Record legal approval for version ${agreement?.agreementVersionIdentifier || agreement?.version || '?'}.`
  }
  return null
}

export function validatePartnershipActivation(agreement, context = {}) {
  const mutableErr = validateAgreementMutable(agreement)
  if (mutableErr) return mutableErr

  const partyErr = validateAgreementPartyFields(agreement, context.venue)
  if (partyErr) return partyErr

  if (!isAgreementLegallyApproved(agreement)) {
    return 'Partnership cannot activate until this agreement version is legally approved.'
  }
  if (String(agreement?.status || '').toLowerCase() !== 'fully_executed') {
    return 'Partnership cannot activate until the agreement is Fully Executed.'
  }
  const hasPartnerSign =
    Boolean(agreement?.partnerSignerName?.trim()) && Boolean(agreement?.partnerSignedDate?.trim())
  const hasAgencySign =
    Boolean(agreement?.agencySignerName?.trim()) && Boolean(agreement?.agencySignedDate?.trim())
  const hasSignedPdf = Boolean(agreement?.hasSignedPdf)
  if (!hasPartnerSign || !hasAgencySign || !hasSignedPdf) {
    return 'Both signatures, signature dates, and an uploaded externally signed PDF are required.'
  }
  return null
}

export function validateLegalApprovalRecord({ legalReviewerName, agreement }) {
  if (isAgreementLegallyRejected(agreement)) {
    return 'A rejected agreement version cannot be approved. Create a new version instead.'
  }
  if (isAgreementLegallyApproved(agreement)) {
    return 'This agreement version is already legally approved.'
  }
  const reviewer = String(legalReviewerName || '').trim()
  if (!reviewer) return 'External attorney/reviewer name is required.'
  if (isPlaceholderValue(reviewer)) return 'External attorney/reviewer name cannot be a placeholder.'
  return null
}

export function validateLegalRejectionRecord({ rejectionNotes, agreement }) {
  if (isAgreementLegallyRejected(agreement)) {
    return 'This agreement version is already rejected.'
  }
  if (isAgreementLegallyApproved(agreement)) {
    return 'An approved agreement version cannot be rejected. Create a new version for revisions.'
  }
  const notes = String(rejectionNotes || '').trim()
  if (!notes) return 'Rejection notes are required.'
  return null
}
