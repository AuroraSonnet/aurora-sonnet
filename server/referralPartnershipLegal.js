/**
 * Owner approval gates, party-field validation, and rejection rules for referral agreements.
 */
import { auroraOrgFieldsForAgreement } from './referralOrganizationSettings.js'
import { W9_PAYMENT_LANGUAGE } from './referralPartnershipTerms.js'

export const OWNER_APPROVAL_STATUSES = ['pending', 'owner_approved', 'rejected']

/** @deprecated use OWNER_APPROVAL_STATUSES */
export const LEGAL_APPROVAL_STATUSES = OWNER_APPROVAL_STATUSES

export { W9_PAYMENT_LANGUAGE }

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

function normalizeApprovalStatus(agreement) {
  const s = String(agreement?.legalApprovalStatus || agreement?.ownerApprovalStatus || 'pending').toLowerCase()
  if (s === 'approved') return 'owner_approved'
  return s
}

export function isAgreementOwnerApproved(agreement) {
  const s = normalizeApprovalStatus(agreement)
  return s === 'owner_approved'
}

/** @deprecated use isAgreementOwnerApproved */
export function isAgreementLegallyApproved(agreement) {
  return isAgreementOwnerApproved(agreement)
}

export function isAgreementOwnerRejected(agreement) {
  return normalizeApprovalStatus(agreement) === 'rejected'
}

/** @deprecated */
export function isAgreementLegallyRejected(agreement) {
  return isAgreementOwnerRejected(agreement)
}

export function validateAgreementMutable(agreement) {
  if (isAgreementOwnerRejected(agreement)) {
    return 'This agreement version was rejected and is immutable. Create a new agreement version for any revision.'
  }
  return null
}

export function collectAgreementPartyFieldErrors(agreement, venue, orgOverride = null, context = {}) {
  const org = orgOverride || auroraOrgFieldsForAgreement()
  const errors = []
  const partnerLegalName = venue?.companyName || agreement?.partnerLegalName || ''
  const addressParts = [venue?.address, venue?.city, venue?.borough].filter(Boolean)
  const partnerAddress = addressParts.join(', ') || agreement?.partnerAddress || ''
  const partnerSignatoryName = agreement?.signatoryName || ''
  const partnerSignatoryTitle = agreement?.signatoryTitle || ''
  const contact = context.contact || null
  const partnerNoticeEmail = agreement?.partnerNoticeEmail || contact?.email || venue?.email || ''

  if (isPlaceholderValue(partnerLegalName)) errors.push('Partner legal name is required (no placeholders).')
  if (isPlaceholderValue(partnerAddress)) errors.push('Partner business mailing address is required (no placeholders).')
  if (isPlaceholderValue(partnerSignatoryName)) errors.push('Partner authorized signatory name is required.')
  if (isPlaceholderValue(partnerSignatoryTitle)) errors.push('Partner authorized signatory title is required.')
  if (isPlaceholderValue(partnerNoticeEmail) || !String(partnerNoticeEmail).includes('@')) {
    errors.push('Partner notice email is required (no placeholders).')
  }
  if (isPlaceholderValue(org.agencyLegalName)) errors.push('Aurora Sonnet legal name must be configured in organization settings.')
  if (isPlaceholderValue(org.agencyAddress)) errors.push('Aurora Sonnet business mailing address must be configured in organization settings.')
  if (isPlaceholderValue(org.agencySignatoryName)) errors.push('Aurora Sonnet authorized signatory name must be configured.')
  if (isPlaceholderValue(org.agencySignatoryTitle)) errors.push('Aurora Sonnet authorized signatory title must be configured.')
  if (isPlaceholderValue(org.agencyNoticeEmail) || !String(org.agencyNoticeEmail || '').includes('@')) {
    errors.push('Aurora Sonnet notice email must be configured in organization settings.')
  }
  return errors
}

export function validateAgreementPartyFields(agreement, venue, orgOverride = null, context = {}) {
  const errors = collectAgreementPartyFieldErrors(agreement, venue, orgOverride, context)
  if (errors.length) return errors.join(' ')
  return null
}

export function validateAgreementStatusTransition(agreement, nextStatus, context = {}) {
  const mutableErr = validateAgreementMutable(agreement)
  if (mutableErr) return mutableErr

  const next = String(nextStatus || '').toLowerCase()
  if (next !== 'sent' && next !== 'fully_executed') return null

  const partyErr = validateAgreementPartyFields(agreement, context.venue, null, { contact: context.contact })
  if (partyErr) return partyErr

  if (!isAgreementOwnerApproved(agreement)) {
    return `Owner Approval is required before marking this agreement as "${nextStatus}". Record Owner Approval for version ${agreement?.agreementVersionIdentifier || agreement?.version || '?'}.`
  }
  return null
}

export function validatePartnershipActivation(agreement, context = {}) {
  const mutableErr = validateAgreementMutable(agreement)
  if (mutableErr) return mutableErr

  const partyErr = validateAgreementPartyFields(agreement, context.venue, null, { contact: context.contact })
  if (partyErr) return partyErr

  if (!isAgreementOwnerApproved(agreement)) {
    return 'Partnership cannot activate until this agreement version is Owner Approved.'
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

export function validateOwnerApprovalRecord({ agreement }) {
  if (isAgreementOwnerRejected(agreement)) {
    return 'A rejected agreement version cannot be Owner Approved. Create a new version instead.'
  }
  if (isAgreementOwnerApproved(agreement)) {
    return 'This agreement version is already Owner Approved.'
  }
  return null
}

/** @deprecated */
export function validateLegalApprovalRecord({ legalReviewerName, agreement }) {
  void legalReviewerName
  return validateOwnerApprovalRecord({ agreement })
}

export function validateOwnerRejectionRecord({ rejectionNotes, agreement }) {
  if (isAgreementOwnerRejected(agreement)) {
    return 'This agreement version is already rejected.'
  }
  if (isAgreementOwnerApproved(agreement)) {
    return 'An Owner Approved agreement version cannot be rejected. Create a new version for revisions.'
  }
  const notes = String(rejectionNotes || '').trim()
  if (!notes) return 'Rejection notes are required.'
  return null
}

/** @deprecated */
export function validateLegalRejectionRecord(opts) {
  return validateOwnerRejectionRecord(opts)
}

export function validateExternalCounselReviewRecord({ reviewerName, agreement }) {
  if (isAgreementOwnerRejected(agreement)) {
    return 'Cannot record external counsel review on a rejected version.'
  }
  const name = String(reviewerName || '').trim()
  if (!name) return 'External counsel / reviewer name is required.'
  if (isPlaceholderValue(name)) return 'External counsel / reviewer name cannot be a placeholder.'
  return null
}

export function agreementPdfDocumentMode(agreement) {
  const status = String(agreement?.status || 'draft').toLowerCase()
  if (status === 'fully_executed') return 'executed'
  if (status === 'sent' || status === 'under_review') return 'signature'
  return 'draft'
}
