/**
 * Public 10% partner onboarding and client-link attribution.
 * Uses referral_partnerships / partner_referrals. Does not create a second referral store.
 */
import { randomBytes } from 'node:crypto'
import { nyBusinessDateString } from './businessDays.js'
import db, {
  appendPartnerReferralNote,
  createInquiryInTransaction,
  createPartnerReferral,
  findFirstPartnerReferralByClientEmail,
  getPartnerReferral,
  getReferralPartnershipAgreementById,
  getReferralPartnershipByPartnerEmail,
  getReferralPartnershipByReferralToken,
  insertReferralPartnership,
  insertReferralPartnershipAgreement,
  linkReferralToProject,
  listClientContactIndex,
  listPartnerReferralContactIndex,
} from './db.js'
import { classifyCoupleContacts, referralCreditDecision } from './referralDuplicate.js'
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

export function classifyIncomingCouple({ email, phone, name }) {
  return classifyCoupleContacts({
    email,
    phone,
    name,
    clients: listClientContactIndex(),
    referrals: listPartnerReferralContactIndex(),
  })
}

function referralMatchResult(existing, partnership, linkedProjectId) {
  const projectId = String(linkedProjectId || '').trim()
  if (projectId) linkReferralToProject(existing.id, projectId, 'intake')
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
    linkPartnershipId: partnership.id,
  }
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
  if (!businessType && !meta.allowBlankBusinessType) return { error: 'Type of business is required.', status: 400 }
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
      businessType: businessType || null,
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
    if (typeof meta.beforeCommit === 'function') {
      meta.beforeCommit({
        partnershipId,
        agreementId,
        referralToken,
        partnerName,
        partnerEmail,
        companyName,
      })
    }
  })

  try {
    saveApplication()
  } catch (err) {
    if (!/unique|constraint/i.test(String(err?.message || ''))) throw err
    const raced = getReferralPartnershipByPartnerEmail(partnerEmail)
    if (raced?.status === 'active' && raced.referralToken && raced.activeAgreementId) {
      const agreement = getReferralPartnershipAgreementById(raced.activeAgreementId)
      if (agreement?.termsJson?.termsKind === 'public_partner_agreement') {
        return partnershipResult(raced, { reused: true })
      }
    }
    if (raced) return { error: 'A partnership already exists for this email.', status: 409 }
    throw err
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
 * Saves the couple on an existing public partner account.
 * Runs in one transaction. A duplicate does not create a second referral.
 */
export function savePublicCoupleReferral({
  partnerName,
  partnerEmail,
  companyName,
  referralToken,
  clientName,
  clientEmail,
  clientPhone,
}) {
  return db.transaction(() => {
    const match = classifyIncomingCouple({ email: clientEmail, phone: clientPhone, name: clientName })
    const decision = referralCreditDecision(match)
    if (decision.action !== 'credit') {
      const today = new Date().toISOString().slice(0, 10)
      const adminNote =
        decision.action === 'already_registered'
          ? 'Refer a Couple submission received. Not credited: couple already registered with Aurora Sonnet.'
          : 'Refer a Couple submission received. Needs admin review before referral credit.'
      const recorded = createInquiryInTransaction({
        name: clientName,
        email: clientEmail,
        phone: clientPhone || undefined,
        today,
        weddingDate: today,
        value: 0,
        title: 'Referral submission',
        clientName,
        dueDate: today,
        notes: [
          `Submitted by ${partnerName} <${partnerEmail}>.`,
          `Couple email ${clientEmail}.`,
          clientPhone ? `Couple phone ${clientPhone}.` : '',
          adminNote,
        ].filter(Boolean).join('\n'),
        existingClientId: decision.action === 'already_registered' ? match.clientId : undefined,
      })
      if (match.kind === 'existing_referral' && match.referralId) {
        appendPartnerReferralNote(
          match.referralId,
          `Inquiry ${recorded.projectId} recorded from a Refer a Couple submission. Existing attribution kept. No additional referral credit.`
        )
      }
      return { partnerNotice: decision.partnerNotice, referralReference: null, referralId: null }
    }
    const created = createPartnerReferral({
      partnerName,
      partnerEmail,
      companyName: companyName || null,
      clientName,
      clientEmail,
      clientPhone: clientPhone || null,
      partnerToken: referralToken,
    })
    return {
      partnerNotice: null,
      referralReference: created.referralReference,
      referralId: created.id,
    }
  })()
}

/**
 * A client arrived through a partner's link.
 * Creates one referral when the couple is new. An existing referral or client does not get a second credit.
 * Pass priorMatch from before the inquiry insert so the new client row is not treated as pre-existing.
 */
export function attributeInquiryToReferralPartner({
  partnerToken,
  clientName,
  clientEmail,
  clientPhone,
  eventDate,
  eventLocation,
  linkedProjectId,
  priorMatch,
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

  const match = priorMatch || classifyIncomingCouple({ email, phone: clientPhone, name })
  if (match.kind === 'ambiguous') {
    return { status: 'needs_review', linkPartnershipId: partnership.id }
  }
  if (match.kind === 'existing_client') {
    return { status: 'existing_client', clientId: match.clientId || null, linkPartnershipId: partnership.id }
  }
  if (match.kind === 'existing_referral' && match.referralId) {
    const matched = getPartnerReferral(match.referralId)
    if (matched) return referralMatchResult(matched, partnership, linkedProjectId)
  }

  const existing = findFirstPartnerReferralByClientEmail(email)
  if (existing) return referralMatchResult(existing, partnership, linkedProjectId)

  const created = createPartnerReferral({
    partnerName: partnership.partnerName,
    companyName: partnership.companyName || null,
    partnerEmail: partnership.partnerEmail,
    clientName: name,
    clientEmail: email,
    clientPhone: String(clientPhone ?? '').trim() || null,
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
