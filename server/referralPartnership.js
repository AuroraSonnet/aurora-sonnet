/**
 * Referral partnership CRUD, offer creation, PDF generation, and venue timeline logging.
 */
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import {
  DEFAULT_REFERRAL_PARTNERSHIP_TERMS,
  buildDraftAgreementHtml,
  buildAgreementFieldsFromVenue,
  agreementVersionIdentifier,
  snapshotFromAgreementRecord,
} from './referralPartnershipTerms.js'
import {
  validateAgreementStatusTransition,
  validatePartnershipActivation,
  validateAgreementMutable,
  validateLegalApprovalRecord,
  validateLegalRejectionRecord,
  isAgreementLegallyApproved,
} from './referralPartnershipLegal.js'
import { auroraOrgFieldsForAgreement } from './referralOrganizationSettings.js'
import { canUserRecordLegalApproval } from './referralLegalApprovalAuth.js'
import {
  createVenueActivity as dbCreateVenueActivity,
  getReferralPartnershipAgreementById,
  getReferralPartnershipById,
  getReferralPartnershipByVenueId,
  getVenueById,
  getVenueContactById,
  insertReferralPartnership,
  insertReferralPartnershipAgreement,
  listReferralPartnershipAgreementsForPartnership,
  listReferralPartnerships,
  listVenueActivity,
  updateReferralPartnership,
  updateReferralPartnershipAgreement,
} from './db.js'

function htmlToPlainText(html) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function wrapTextLines(text, maxChars) {
  const out = []
  for (const para of text.split('\n')) {
    if (!para.trim()) {
      out.push('')
      continue
    }
    const words = para.split(/\s+/)
    let line = ''
    for (const w of words) {
      const next = line ? `${line} ${w}` : w
      if (next.length > maxChars) {
        if (line) out.push(line)
        line = w
      } else {
        line = next
      }
    }
    if (line) out.push(line)
  }
  return out
}

export async function createAgreementPdfBuffer(contentHtml) {
  const text = htmlToPlainText(contentHtml)
  const lines = wrapTextLines(text, 92)
  const pdf = await PDFDocument.create()
  const font = await pdf.embedStandardFont(StandardFonts.Helvetica)
  const fontSize = 10
  const lineHeight = 13
  const margin = 50
  const pageWidth = 595
  const pageHeight = 842
  let page = pdf.addPage([pageWidth, pageHeight])
  let y = pageHeight - margin
  for (const line of lines) {
    if (y < margin) {
      page = pdf.addPage([pageWidth, pageHeight])
      y = pageHeight - margin
    }
    if (line) {
      page.drawText(line.slice(0, 500), {
        x: margin,
        y,
        size: fontSize,
        font,
        color: rgb(0, 0, 0),
        maxWidth: pageWidth - margin * 2,
      })
    }
    y -= lineHeight
  }
  return Buffer.from(await pdf.save())
}

function parseAuditLog(raw) {
  if (!raw) return []
  try {
    const arr = JSON.parse(String(raw))
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

function appendAudit(agreement, event, detail = {}) {
  const log = Array.isArray(agreement?.auditLog)
    ? [...agreement.auditLog]
    : parseAuditLog(agreement?.auditLogJson)
  log.push({ at: new Date().toISOString(), event, ...detail })
  return JSON.stringify(log)
}

function nextPartnershipId() {
  return `rp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function nextAgreementId() {
  return `rpa-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function nextActivityId() {
  return `va-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function logVenueActivity(venueId, type, subject, body, metadata = {}) {
  return dbCreateVenueActivity({
    id: nextActivityId(),
    venueId,
    type,
    subject: subject || null,
    body: body || null,
    metadataJson: JSON.stringify(metadata),
    createdAt: new Date().toISOString(),
  })
}

function agreementVenueContext(agreement, partnership) {
  return getVenueById(partnership?.venueId)
}

export function approveReferralAgreementLegal(agreementId, { legalReviewerName, notes, actor } = {}) {
  if (!canUserRecordLegalApproval(actor)) {
    return { ok: false, error: 'You are not authorized to record legal approval for referral agreements.' }
  }
  const agreement = getReferralPartnershipAgreementById(agreementId)
  if (!agreement) return { ok: false, error: 'Agreement not found' }
  const partnership = getReferralPartnershipById(agreement.partnershipId)
  if (!partnership) return { ok: false, error: 'Partnership not found' }

  const validationErr = validateLegalApprovalRecord({ legalReviewerName, agreement })
  if (validationErr) return { ok: false, error: validationErr }

  const now = new Date().toISOString()
  const versionId = agreementVersionIdentifier(agreement)
  updateReferralPartnershipAgreement(agreementId, {
    legalApprovalStatus: 'approved',
    legalApprovedAt: now,
    legalApprovalNotes: notes?.trim() || null,
    legalReviewerName: String(legalReviewerName).trim(),
    legalRecordedByUsername: actor || null,
    updatedAt: now,
    auditLogJson: appendAudit(agreement, 'legal_approved', {
      by: actor || 'crm',
      legalReviewerName: String(legalReviewerName).trim(),
      agreementVersionIdentifier: versionId,
      notes: notes?.trim() || null,
    }),
  })
  const updated = getReferralPartnershipAgreementById(agreementId)
  logVenueActivity(
    partnership.venueId,
    'referral_agreement_legal_approved',
    `Legal approval recorded (v${updated.version})`,
    `External reviewer ${updated.legalReviewerName} approved ${updated.agreementVersionIdentifier}. Recorded by ${actor || 'crm'}.`,
    {
      agreementId,
      agreementVersionIdentifier: updated.agreementVersionIdentifier,
      legalReviewerName: updated.legalReviewerName,
      recordedBy: actor,
    }
  )
  return { ok: true, agreement: updated }
}

export function rejectReferralAgreementLegal(agreementId, { rejectionNotes, actor } = {}) {
  if (!canUserRecordLegalApproval(actor)) {
    return { ok: false, error: 'You are not authorized to record legal rejection for referral agreements.' }
  }
  const agreement = getReferralPartnershipAgreementById(agreementId)
  if (!agreement) return { ok: false, error: 'Agreement not found' }
  const partnership = getReferralPartnershipById(agreement.partnershipId)
  if (!partnership) return { ok: false, error: 'Partnership not found' }

  const validationErr = validateLegalRejectionRecord({ rejectionNotes, agreement })
  if (validationErr) return { ok: false, error: validationErr }

  const now = new Date().toISOString()
  const versionId = agreementVersionIdentifier(agreement)
  updateReferralPartnershipAgreement(agreementId, {
    legalApprovalStatus: 'rejected',
    legalRejectedAt: now,
    legalRejectionNotes: String(rejectionNotes).trim(),
    legalRecordedByUsername: actor || null,
    updatedAt: now,
    auditLogJson: appendAudit(agreement, 'legal_rejected', {
      by: actor || 'crm',
      agreementVersionIdentifier: versionId,
      rejectionNotes: String(rejectionNotes).trim(),
    }),
  })
  const updated = getReferralPartnershipAgreementById(agreementId)
  logVenueActivity(
    partnership.venueId,
    'referral_agreement_legal_rejected',
    `Agreement rejected (v${updated.version})`,
    `Version ${updated.agreementVersionIdentifier} rejected. Recorded by ${actor || 'crm'}.`,
    { agreementId, agreementVersionIdentifier: versionId, recordedBy: actor }
  )
  return { ok: true, agreement: updated }
}

/**
 * Create or reuse partnership for venue; create draft agreement with PDF.
 * Never sends email. Returns { partnership, agreement }.
 */
export async function createReferralOffer({
  venueId,
  primaryContactId,
  authorizedSignatoryContactId,
  signatoryName,
  signatoryTitle,
  termsJson,
  contentHtml,
  createdBy,
}) {
  const venue = getVenueById(venueId)
  if (!venue) throw new Error('Venue not found')

  let partnership = getReferralPartnershipByVenueId(venueId)
  if (!partnership) {
    const now = new Date().toISOString()
    const id = nextPartnershipId()
    insertReferralPartnership({
      id,
      venueId,
      status: 'pending_signature',
      activeAgreementId: null,
      w9ReceivedAt: null,
      createdAt: now,
      updatedAt: now,
    })
    partnership = getReferralPartnershipById(id)
    logVenueActivity(venueId, 'referral_partnership_created', 'Referral partnership created', `Partnership record created for ${venue.companyName}.`, {
      partnershipId: id,
    })
  }

  const existingAgreements = listReferralPartnershipAgreementsForPartnership(partnership.id)
  const draft = existingAgreements.find((a) => a.status === 'draft')
  if (draft) {
    return { partnership, agreement: draft, reusedDraft: true }
  }

  const maxVersion = existingAgreements.reduce((m, a) => Math.max(m, a.version || 0), 0)
  const version = maxVersion + 1
  const contact =
    (authorizedSignatoryContactId && getVenueContactById(authorizedSignatoryContactId)) ||
    (primaryContactId && getVenueContactById(primaryContactId)) ||
    null

  const resolvedSignatoryName = signatoryName?.trim() || contact?.name || ''
  const resolvedSignatoryTitle = signatoryTitle?.trim() || contact?.jobTitle || ''
  const terms = termsJson || DEFAULT_REFERRAL_PARTNERSHIP_TERMS
  const agreementId = nextAgreementId()
  const versionIdentifier = `RPA-${partnership.id}-v${version}`
  const orgFields = auroraOrgFieldsForAgreement()
  const fields = buildAgreementFieldsFromVenue(venue, contact, {
    signatoryName: resolvedSignatoryName,
    signatoryTitle: resolvedSignatoryTitle,
    agreementVersionIdentifier: versionIdentifier,
    ...orgFields,
  })
  const html =
    contentHtml?.trim() ||
    buildDraftAgreementHtml({
      ...fields,
      terms,
      agreementVersionIdentifier: versionIdentifier,
    })

  const pdfBuffer = await createAgreementPdfBuffer(html)
  const now = new Date().toISOString()
  const auditLogJson = JSON.stringify([
    { at: now, event: 'offer_created', by: createdBy || 'crm', version, agreementVersionIdentifier: versionIdentifier },
  ])

  insertReferralPartnershipAgreement({
    id: agreementId,
    partnershipId: partnership.id,
    version,
    status: 'draft',
    termsJson: JSON.stringify(terms),
    contentHtml: html,
    authorizedSignatoryContactId: authorizedSignatoryContactId || primaryContactId || null,
    signatoryName: resolvedSignatoryName || null,
    signatoryTitle: resolvedSignatoryTitle || null,
    partnerSignerName: null,
    partnerSignerTitle: null,
    partnerSignedDate: null,
    agencySignerName: null,
    agencySignedDate: null,
    generatedPdfBlob: pdfBuffer,
    signedPdfBlob: null,
    auditLogJson,
    legalApprovalStatus: 'pending',
    legalApprovedAt: null,
    legalApprovalNotes: null,
    legalReviewerName: null,
    legalRecordedByUsername: null,
    legalRejectedAt: null,
    legalRejectionNotes: null,
    agreementVersionIdentifier: versionIdentifier,
    createdAt: now,
    updatedAt: now,
  })

  updateReferralPartnership(partnership.id, { status: 'pending_signature', updatedAt: now })

  const agreement = getReferralPartnershipAgreementById(agreementId)
  logVenueActivity(
    venueId,
    'referral_offer_created',
    `Referral offer v${version} prepared`,
    `Draft referral partnership offer prepared for ${venue.companyName}. Signatory: ${resolvedSignatoryName || 'TBD'}. Not sent automatically.`,
    { partnershipId: partnership.id, agreementId, version, agreementVersionIdentifier: versionIdentifier, createdBy: createdBy || 'crm' }
  )

  return { partnership: getReferralPartnershipById(partnership.id), agreement, reusedDraft: false }
}

export function updateReferralOfferAgreement(agreementId, updates, actor = 'crm') {
  const agreement = getReferralPartnershipAgreementById(agreementId)
  if (!agreement) return { error: 'Agreement not found' }
  const partnership = getReferralPartnershipById(agreement.partnershipId)
  if (!partnership) return { error: 'Partnership not found' }
  const venue = agreementVenueContext(agreement, partnership)

  const mutableErr = validateAgreementMutable(agreement)
  if (mutableErr) return { error: mutableErr }

  if (updates.status) {
    const err = validateAgreementStatusTransition(agreement, updates.status, { venue })
    if (err) return { error: err }
  }

  const now = new Date().toISOString()
  const patch = { ...updates, updatedAt: now }
  if (updates.status && updates.status !== agreement.status) {
    patch.auditLogJson = appendAudit(agreement, 'status_changed', {
      from: agreement.status,
      to: updates.status,
      by: actor,
    })
  }
  updateReferralPartnershipAgreement(agreementId, patch)
  const updated = getReferralPartnershipAgreementById(agreementId)

  if (updates.status) {
    logVenueActivity(
      partnership.venueId,
      'referral_offer_status',
      `Offer v${updated.version}: ${updates.status}`,
      `Agreement status updated to ${updates.status}.`,
      { agreementId, status: updates.status }
    )
  }

  if (updated.status === 'fully_executed') {
    const activation = tryActivatePartnership(partnership.id, updated.id, actor)
    if (activation && !activation.activated) {
      return { agreement: updated, activationWarning: activation.reason }
    }
  }

  return { agreement: updated }
}

export async function regenerateOfferPdf(agreementId) {
  const agreement = getReferralPartnershipAgreementById(agreementId)
  if (!agreement) return null
  const mutableErr = validateAgreementMutable(agreement)
  if (mutableErr) return { error: mutableErr }
  const pdfBuffer = await createAgreementPdfBuffer(agreement.contentHtml)
  updateReferralPartnershipAgreement(agreementId, {
    generatedPdfBlob: pdfBuffer,
    updatedAt: new Date().toISOString(),
    auditLogJson: appendAudit(agreement, 'pdf_regenerated', {}),
  })
  return getReferralPartnershipAgreementById(agreementId)
}

export function uploadSignedAgreementPdf(agreementId, pdfBuffer, meta = {}, actor = 'crm') {
  const agreement = getReferralPartnershipAgreementById(agreementId)
  if (!agreement) return { ok: false, error: 'Agreement not found' }
  const partnership = getReferralPartnershipById(agreement.partnershipId)
  if (!partnership) return { ok: false, error: 'Partnership not found' }
  const venue = agreementVenueContext(agreement, partnership)

  const mutableErr = validateAgreementMutable(agreement)
  if (mutableErr) return { ok: false, error: mutableErr }

  const nextStatus = meta.status || agreement.status
  if (nextStatus === 'fully_executed' || nextStatus === 'sent') {
    const err = validateAgreementStatusTransition(agreement, nextStatus, { venue })
    if (err) return { ok: false, error: err }
  }

  const now = new Date().toISOString()
  const patch = {
    signedPdfBlob: pdfBuffer,
    updatedAt: now,
    auditLogJson: appendAudit(agreement, 'signed_pdf_uploaded', { by: actor }),
  }
  if (meta.partnerSignerName) patch.partnerSignerName = meta.partnerSignerName
  if (meta.partnerSignerTitle) patch.partnerSignerTitle = meta.partnerSignerTitle
  if (meta.partnerSignedDate) patch.partnerSignedDate = meta.partnerSignedDate
  if (meta.agencySignerName) patch.agencySignerName = meta.agencySignerName
  if (meta.agencySignedDate) patch.agencySignedDate = meta.agencySignedDate
  if (meta.status) patch.status = meta.status

  updateReferralPartnershipAgreement(agreementId, patch)
  const updated = getReferralPartnershipAgreementById(agreementId)

  logVenueActivity(
    partnership.venueId,
    'referral_signed_pdf_uploaded',
    `Signed PDF uploaded (v${updated.version})`,
    'Externally signed agreement PDF stored.',
    { agreementId }
  )

  if (updated.status === 'fully_executed') {
    const activation = tryActivatePartnership(partnership.id, updated.id, actor)
    if (!activation?.activated) {
      return { ok: true, agreement: updated, activationWarning: activation?.reason }
    }
  }

  return { ok: true, agreement: updated }
}

export function tryActivatePartnership(partnershipId, agreementId, actor = 'crm') {
  const agreement = getReferralPartnershipAgreementById(agreementId)
  const partnership = getReferralPartnershipById(partnershipId)
  if (!agreement || !partnership) return null
  const venue = agreementVenueContext(agreement, partnership)

  const err = validatePartnershipActivation(agreement, { venue })
  if (err) return { activated: false, reason: err }

  const now = new Date().toISOString()
  updateReferralPartnership(partnershipId, {
    status: 'active',
    activeAgreementId: agreementId,
    updatedAt: now,
  })

  logVenueActivity(
    partnership.venueId,
    'referral_partnership_activated',
    `Partnership active (agreement v${agreement.version})`,
    `Referral partnership is active under ${agreement.agreementVersionIdentifier}. New referrals will receive immutable 10% terms snapshots.`,
    { partnershipId, agreementId, by: actor }
  )

  return { activated: true, partnership: getReferralPartnershipById(partnershipId) }
}

export function resolveActiveAgreementForVenue(venueId) {
  const partnership = getReferralPartnershipByVenueId(venueId)
  if (!partnership || partnership.status !== 'active' || !partnership.activeAgreementId) return null
  const agreement = getReferralPartnershipAgreementById(partnership.activeAgreementId)
  if (!agreement || agreement.status !== 'fully_executed' || !isAgreementLegallyApproved(agreement)) return null
  return { partnership, agreement }
}

export function buildReferralSnapshotForCreate({ venueId, agreementId }) {
  if (agreementId) {
    const agreement = getReferralPartnershipAgreementById(agreementId)
    if (agreement && agreement.status === 'fully_executed' && isAgreementLegallyApproved(agreement)) {
      return {
        agreementId: agreement.id,
        partnershipId: agreement.partnershipId,
        agreementSnapshotKind: 'agreement',
        agreementTermsSnapshot: JSON.stringify(snapshotFromAgreementRecord(agreement)),
      }
    }
  }
  if (venueId) {
    const active = resolveActiveAgreementForVenue(venueId)
    if (active) {
      return {
        agreementId: active.agreement.id,
        partnershipId: active.partnership.id,
        agreementSnapshotKind: 'agreement',
        agreementTermsSnapshot: JSON.stringify(snapshotFromAgreementRecord(active.agreement)),
      }
    }
  }
  return {
    agreementId: null,
    partnershipId: venueId ? getReferralPartnershipByVenueId(venueId)?.id ?? null : null,
    agreementSnapshotKind: 'legacy_default',
    agreementTermsSnapshot: JSON.stringify({
      schemaVersion: 1,
      termsKind: 'legacy_default',
      commissionRate: 0.05,
      minPayoutAmount: 100,
      useLegacyExpenseDeduction: true,
      label: 'Legacy default (5% / $100 min, pre-agreement)',
    }),
  }
}

export { listReferralPartnerships, listVenueActivity, snapshotFromAgreementRecord, agreementVersionIdentifier }
