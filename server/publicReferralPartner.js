/**
 * Public 10% partner onboarding and client-link attribution.
 * Uses referral_partnerships / partner_referrals. Does not create a second referral store.
 */
import { randomBytes } from 'node:crypto'
import { nyBusinessDateString } from './businessDays.js'
import db, {
  createPartnerReferral,
  findFirstPartnerReferralByClientEmail,
  getReferralPartnershipAgreementById,
  getReferralPartnershipByPartnerEmail,
  getReferralPartnershipByReferralToken,
  insertReferralPartnership,
  insertReferralPartnershipAgreement,
} from './db.js'
import { decodeSignatureImage, publicPartnerAgreementHtml, renderPublicPartnerAgreementPdf } from './publicPartnerAgreementPdf.js'
import { PUBLIC_PARTNER_AGREEMENT_TERMS, PUBLIC_PARTNER_AGREEMENT_VERSION } from './referralPartnershipTerms.js'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function clean(value, max) {
  const s = String(value ?? '').trim()
  if (!s) return ''
  return s.slice(0, max)
}

function normalizeEmail(value) {
  return clean(value, 120).toLowerCase()
}

export function buildPartnerReferralLink(token) {
  const url = new URL(String(process.env.PARTNER_REFERRAL_LINK_BASE || 'https://aurorasonnet.com/'))
  url.searchParams.set('partner', token)
  return url.toString()
}

function partnershipResult(partnership, { reused }) {
  return {
    reused,
    partnershipId: partnership.id,
    agreementId: partnership.activeAgreementId || null,
    referralToken: partnership.referralToken,
    referralLink: buildPartnerReferralLink(partnership.referralToken),
    status: partnership.status,
  }
}

export async function submitPublicPartnerApplication(input, meta = {}) {
  const partnerName = clean(input?.fullName ?? input?.partnerName, 120)
  const partnerEmail = normalizeEmail(input?.email ?? input?.partnerEmail)
  const partnerPhone = clean(input?.phone ?? input?.partnerPhone, 40)
  const companyName = clean(input?.companyName, 160)
  const businessType = clean(input?.businessType, 80)
  const signature = decodeSignatureImage(input?.signaturePngBase64 ?? input?.signature)

  if (!partnerName) return { error: 'Full name is required.', status: 400 }
  if (!EMAIL_RE.test(partnerEmail)) return { error: 'A valid email is required.', status: 400 }
  if (!companyName) return { error: 'Business / company name is required.', status: 400 }
  if (!businessType) return { error: 'Type of business is required.', status: 400 }
  if (!signature) return { error: 'A signature image is required to sign the agreement.', status: 400 }

  const existing = getReferralPartnershipByPartnerEmail(partnerEmail)
  if (existing) {
    if (existing.status === 'active' && existing.referralToken && existing.activeAgreementId) {
      const agreement = getReferralPartnershipAgreementById(existing.activeAgreementId)
      const kind = agreement?.termsJson?.termsKind
      if (kind === 'public_partner_agreement') return partnershipResult(existing, { reused: true })
    }
    return { error: 'A partnership already exists for this email.', status: 409 }
  }

  const now = new Date()
  const signedDate = nyBusinessDateString(now)
  const signedAt = now.toISOString()
  const partnershipId = `rp-${Date.now()}-${randomBytes(4).toString('hex')}`
  const agreementId = `rpa-${Date.now()}-${randomBytes(4).toString('hex')}`
  const referralToken = randomBytes(24).toString('base64url')
  const versionIdentifier = `RPA-${partnershipId}-v1`
  const html = publicPartnerAgreementHtml({ partnerName, companyName, signedDate })
  let unsignedPdf
  let signedPdf
  try {
    unsignedPdf = await renderPublicPartnerAgreementPdf({ partnerName, companyName, signedDate: null, signature: null })
    signedPdf = await renderPublicPartnerAgreementPdf({ partnerName, companyName, signedDate, signature })
  } catch {
    return { error: 'Signature image could not be read.', status: 400 }
  }
  const auditLogJson = JSON.stringify([
    {
      at: signedAt,
      event: 'public_esign',
      agreementVersion: PUBLIC_PARTNER_AGREEMENT_VERSION,
      ip: meta.ip || null,
      userAgent: meta.userAgent ? String(meta.userAgent).slice(0, 300) : null,
    },
  ])

  const saveApplication = db.transaction(() => {
    insertReferralPartnership({
      id: partnershipId,
      venueId: null,
      status: 'active',
      activeAgreementId: agreementId,
      w9ReceivedAt: null,
      partnerName,
      partnerEmail,
      partnerPhone: partnerPhone || null,
      companyName,
      businessType,
      referralToken,
      createdAt: signedAt,
      updatedAt: signedAt,
    })
    insertReferralPartnershipAgreement({
    id: agreementId,
    partnershipId,
    version: 1,
    status: 'fully_executed',
    termsJson: JSON.stringify(PUBLIC_PARTNER_AGREEMENT_TERMS),
    contentHtml: html,
    authorizedSignatoryContactId: null,
    signatoryName: partnerName,
    signatoryTitle: null,
    partnerSignerName: partnerName,
    partnerSignerTitle: null,
    partnerSignedDate: signedDate,
    agencySignerName: null,
    agencySignedDate: null,
    generatedPdfBlob: unsignedPdf,
    signedPdfBlob: signedPdf,
    auditLogJson,
    legalApprovalStatus: 'not_required',
    legalApprovedAt: null,
    legalApprovalNotes: 'Public standard agreement. Partner e-signature activates the partnership. Owner Approval is not required.',
    legalReviewerName: null,
    legalRecordedByUsername: null,
    legalRejectedAt: null,
    legalRejectionNotes: null,
    externalCounselReviewedAt: null,
    externalCounselReviewerName: null,
    externalCounselReviewNotes: null,
    agreementVersionIdentifier: versionIdentifier,
    createdAt: signedAt,
    updatedAt: signedAt,
  })
  })

  try {
    saveApplication()
  } catch (err) {
    if (!/unique|constraint/i.test(String(err?.message || ''))) throw err
    const raced = getReferralPartnershipByPartnerEmail(partnerEmail)
    if (raced?.status === 'active' && raced.referralToken) return partnershipResult(raced, { reused: true })
    return { error: 'A partnership already exists for this email.', status: 409 }
  }

  return partnershipResult(
    {
      id: partnershipId,
      activeAgreementId: agreementId,
      referralToken,
      status: 'active',
    },
    { reused: false }
  )
}

/**
 * A client arrived through a partner's link (inquiry or other approved intake).
 * Creates one partner_referrals row attributed to that partner, or returns the earlier referral.
 */
export function attributeInquiryToReferralPartner({
  partnerToken,
  clientName,
  clientEmail,
  clientPhone,
  eventDate,
  eventLocation,
  linkedProjectId,
}) {
  const token = String(partnerToken || '').trim()
  const partnership = getReferralPartnershipByReferralToken(token)
  if (!partnership || partnership.status !== 'active' || !partnership.referralToken) {
    return { status: 'invalid_token' }
  }
  const agreement = partnership.activeAgreementId
    ? getReferralPartnershipAgreementById(partnership.activeAgreementId)
    : null
  if (!agreement || agreement.status !== 'fully_executed' || agreement.termsJson?.termsKind !== 'public_partner_agreement') {
    return { status: 'invalid_token' }
  }

  const name = clean(clientName, 120)
  const email = normalizeEmail(clientEmail)
  if (!name || !EMAIL_RE.test(email)) return { status: 'invalid_client' }

  const existing = findFirstPartnerReferralByClientEmail(email)
  if (existing) {
    if (existing.partnershipId && existing.partnershipId === partnership.id) {
      return {
        status: 'existing',
        referralId: existing.id,
        referralReference: existing.referralReference || null,
        partnershipId: partnership.id,
      }
    }
    return {
      status: 'already_referred',
      referralId: existing.id,
      referralReference: existing.referralReference || null,
    }
  }

  const created = createPartnerReferral({
    partnerName: partnership.partnerName,
    companyName: partnership.companyName || null,
    partnerEmail: partnership.partnerEmail,
    clientName: name,
    clientEmail: email,
    clientPhone: clean(clientPhone, 40) || null,
    eventDate: clean(eventDate, 40) || null,
    eventLocation: clean(eventLocation, 200) || null,
    notes: 'Attributed from partner referral link.',
    partnerToken: partnership.referralToken,
    venueId: partnership.venueId || null,
    linkedProjectId: linkedProjectId || null,
    linkedLeadId: linkedProjectId || null,
  })

  return {
    status: 'created',
    referralId: created.id,
    referralReference: created.referralReference,
    partnershipId: partnership.id,
    partnerName: partnership.partnerName,
    partnerEmail: partnership.partnerEmail,
    companyName: partnership.companyName || null,
  }
}
