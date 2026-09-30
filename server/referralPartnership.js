/**
 * Referral partnership CRUD, offer creation, PDF generation, and venue timeline logging.
 */
import {
  DEFAULT_REFERRAL_PARTNERSHIP_TERMS,
  buildAgreementHtml,
  buildAgreementFieldsFromVenue,
  agreementVersionIdentifier,
  snapshotFromAgreementRecord,
  computeEffectiveDateFromSignatures,
  parseTermsSnapshot,
} from './referralPartnershipTerms.js'
import {
  validateAgreementStatusTransition,
  validatePartnershipActivation,
  validateAgreementMutable,
  validateOwnerApprovalRecord,
  validateOwnerRejectionRecord,
  validateExternalCounselReviewRecord,
  isAgreementOwnerApproved,
  agreementPdfDocumentMode,
} from './referralPartnershipLegal.js'
import { auroraOrgFieldsForAgreement } from './referralOrganizationSettings.js'
import { canUserRecordOwnerApproval } from './referralLegalApprovalAuth.js'
import { renderAgreementPdfFromHtml } from './referralAgreementPdf.js'
import {
  createVenueActivity as dbCreateVenueActivity,
  getReferralPartnershipAgreementById,
  getReferralPartnershipAgreementPdf,
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

function agreementContact(agreement) {
  if (!agreement?.authorizedSignatoryContactId) return null
  return getVenueContactById(agreement.authorizedSignatoryContactId)
}

function buildHtmlForAgreement(agreement, partnership, { statusOverride, editedBody } = {}) {
  const venue = agreementVenueContext(agreement, partnership)
  const contact = agreementContact(agreement)
  const orgFields = auroraOrgFieldsForAgreement()
  const status = statusOverride || agreement.status
  const documentMode = agreementPdfDocumentMode({ ...agreement, status })
  const effectiveDate =
    documentMode === 'executed'
      ? computeEffectiveDateFromSignatures(agreement.partnerSignedDate, agreement.agencySignedDate) || null
      : null
  const fields = buildAgreementFieldsFromVenue(venue, contact, {
    signatoryName: agreement.signatoryName,
    signatoryTitle: agreement.signatoryTitle,
    agreementVersionIdentifier: agreement.agreementVersionIdentifier,
    effectiveDate,
    ...orgFields,
  })
  const terms = parseTermsSnapshot(agreement.termsJson) || DEFAULT_REFERRAL_PARTNERSHIP_TERMS
  const body = editedBody ?? agreement.contentHtml
  const usesTemplate = !body?.trim() || String(body).includes('Referral Partnership Agreement')
  return buildAgreementHtml({
    ...fields,
    terms,
    documentMode,
    effectiveDate,
    editedBody: usesTemplate ? undefined : body,
  })
}

export async function createAgreementPdfBuffer(contentHtml, { documentMode = 'draft' } = {}) {
  const includeDraftBanner = documentMode === 'draft'
  return renderAgreementPdfFromHtml(contentHtml, { includeDraftBanner })
}

async function syncAgreementDocument(agreementId, { statusOverride, editedBody } = {}) {
  const agreement = getReferralPartnershipAgreementById(agreementId)
  if (!agreement) return null
  const terms = parseTermsSnapshot(agreement.termsJson)
  if (terms?.termsKind === 'public_partner_agreement') {
    const pdfBuffer = getReferralPartnershipAgreementPdf(agreementId, 'generated')
    if (pdfBuffer) return { html: agreement.contentHtml, pdfBuffer, documentMode: 'executed' }
  }
  const partnership = getReferralPartnershipById(agreement.partnershipId)
  if (!partnership) return null
  const html = buildHtmlForAgreement(agreement, partnership, { statusOverride, editedBody })
  const status = statusOverride || agreement.status
  const documentMode = agreementPdfDocumentMode({ ...agreement, status })
  const pdfBuffer = await renderAgreementPdfFromHtml(html, {
    includeDraftBanner: documentMode === 'draft',
  })
  return { html, pdfBuffer, documentMode }
}

export function approveReferralAgreementOwner(agreementId, { notes, actor } = {}) {
  if (!canUserRecordOwnerApproval(actor)) {
    return { ok: false, error: 'You are not authorized to record Owner Approval for referral agreements.' }
  }
  const agreement = getReferralPartnershipAgreementById(agreementId)
  if (!agreement) return { ok: false, error: 'Agreement not found' }
  const partnership = getReferralPartnershipById(agreement.partnershipId)
  if (!partnership) return { ok: false, error: 'Partnership not found' }

  const validationErr = validateOwnerApprovalRecord({ agreement })
  if (validationErr) return { ok: false, error: validationErr }

  const now = new Date().toISOString()
  const versionId = agreementVersionIdentifier(agreement)
  updateReferralPartnershipAgreement(agreementId, {
    legalApprovalStatus: 'owner_approved',
    legalApprovedAt: now,
    legalApprovalNotes: notes?.trim() || null,
    legalRecordedByUsername: actor || null,
    updatedAt: now,
    auditLogJson: appendAudit(agreement, 'owner_approved', {
      by: actor || 'crm',
      agreementVersionIdentifier: versionId,
      notes: notes?.trim() || null,
    }),
  })
  const updated = getReferralPartnershipAgreementById(agreementId)
  logVenueActivity(
    partnership.venueId,
    'referral_agreement_owner_approved',
    `Owner Approval recorded (v${updated.version})`,
    `Version ${updated.agreementVersionIdentifier} Owner Approved. Recorded by ${actor || 'crm'}.`,
    {
      agreementId,
      agreementVersionIdentifier: versionId,
      recordedBy: actor,
    }
  )
  return { ok: true, agreement: updated }
}

/** @deprecated use approveReferralAgreementOwner */
export function approveReferralAgreementLegal(agreementId, opts = {}) {
  void opts.legalReviewerName
  return approveReferralAgreementOwner(agreementId, { notes: opts.notes, actor: opts.actor })
}

export function rejectReferralAgreementOwner(agreementId, { rejectionNotes, actor } = {}) {
  if (!canUserRecordOwnerApproval(actor)) {
    return { ok: false, error: 'You are not authorized to record rejection for referral agreements.' }
  }
  const agreement = getReferralPartnershipAgreementById(agreementId)
  if (!agreement) return { ok: false, error: 'Agreement not found' }
  const partnership = getReferralPartnershipById(agreement.partnershipId)
  if (!partnership) return { ok: false, error: 'Partnership not found' }

  const validationErr = validateOwnerRejectionRecord({ rejectionNotes, agreement })
  if (validationErr) return { ok: false, error: validationErr }

  const now = new Date().toISOString()
  const versionId = agreementVersionIdentifier(agreement)
  updateReferralPartnershipAgreement(agreementId, {
    legalApprovalStatus: 'rejected',
    legalRejectedAt: now,
    legalRejectionNotes: String(rejectionNotes).trim(),
    legalRecordedByUsername: actor || null,
    updatedAt: now,
    auditLogJson: appendAudit(agreement, 'owner_rejected', {
      by: actor || 'crm',
      agreementVersionIdentifier: versionId,
      rejectionNotes: String(rejectionNotes).trim(),
    }),
  })
  const updated = getReferralPartnershipAgreementById(agreementId)
  logVenueActivity(
    partnership.venueId,
    'referral_agreement_rejected',
    `Agreement rejected (v${updated.version})`,
    `Version ${updated.agreementVersionIdentifier} rejected. Recorded by ${actor || 'crm'}.`,
    { agreementId, agreementVersionIdentifier: versionId, recordedBy: actor }
  )
  return { ok: true, agreement: updated }
}

/** @deprecated use rejectReferralAgreementOwner */
export function rejectReferralAgreementLegal(agreementId, opts = {}) {
  return rejectReferralAgreementOwner(agreementId, opts)
}

export function recordReferralAgreementExternalCounselReview(agreementId, { reviewerName, notes, actor } = {}) {
  if (!canUserRecordOwnerApproval(actor)) {
    return { ok: false, error: 'You are not authorized to record external counsel review.' }
  }
  const agreement = getReferralPartnershipAgreementById(agreementId)
  if (!agreement) return { ok: false, error: 'Agreement not found' }
  const partnership = getReferralPartnershipById(agreement.partnershipId)
  if (!partnership) return { ok: false, error: 'Partnership not found' }

  const validationErr = validateExternalCounselReviewRecord({ reviewerName, agreement })
  if (validationErr) return { ok: false, error: validationErr }

  const now = new Date().toISOString()
  const versionId = agreementVersionIdentifier(agreement)
  updateReferralPartnershipAgreement(agreementId, {
    externalCounselReviewedAt: now,
    externalCounselReviewerName: String(reviewerName).trim(),
    externalCounselReviewNotes: notes?.trim() || null,
    updatedAt: now,
    auditLogJson: appendAudit(agreement, 'external_counsel_reviewed', {
      by: actor || 'crm',
      agreementVersionIdentifier: versionId,
      reviewerName: String(reviewerName).trim(),
      notes: notes?.trim() || null,
    }),
  })
  const updated = getReferralPartnershipAgreementById(agreementId)
  logVenueActivity(
    partnership.venueId,
    'referral_agreement_external_counsel_reviewed',
    `External counsel review recorded (v${updated.version})`,
    `${updated.externalCounselReviewerName} reviewed ${versionId}. Recorded by ${actor || 'crm'}.`,
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
    buildAgreementHtml({
      ...fields,
      terms,
      agreementVersionIdentifier: versionIdentifier,
      documentMode: 'draft',
    })

  const pdfBuffer = await renderAgreementPdfFromHtml(html, { includeDraftBanner: true })
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
    externalCounselReviewedAt: null,
    externalCounselReviewerName: null,
    externalCounselReviewNotes: null,
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

export async function updateReferralOfferAgreement(agreementId, updates, actor = 'crm') {
  const agreement = getReferralPartnershipAgreementById(agreementId)
  if (!agreement) return { error: 'Agreement not found' }
  const partnership = getReferralPartnershipById(agreement.partnershipId)
  if (!partnership) return { error: 'Partnership not found' }
  const venue = agreementVenueContext(agreement, partnership)
  const contact = agreementContact(agreement)

  const mutableErr = validateAgreementMutable(agreement)
  if (mutableErr) return { error: mutableErr }

  if (updates.status) {
    const err = validateAgreementStatusTransition(agreement, updates.status, { venue, contact })
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
  let updated = getReferralPartnershipAgreementById(agreementId)

  const shouldSyncDoc =
    updates.status ||
    updates.contentHtml ||
    updates.partnerSignedDate ||
    updates.agencySignedDate ||
    updates.regeneratePdf
  if (shouldSyncDoc) {
    const synced = await syncAgreementDocument(agreementId, {
      statusOverride: updated.status,
      editedBody: updates.contentHtml,
    })
    if (synced) {
      updateReferralPartnershipAgreement(agreementId, {
        contentHtml: synced.html,
        generatedPdfBlob: synced.pdfBuffer,
        updatedAt: new Date().toISOString(),
      })
      updated = getReferralPartnershipAgreementById(agreementId)
    }
  }

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
  const synced = await syncAgreementDocument(agreementId)
  if (!synced) return { error: 'Agreement not found' }
  updateReferralPartnershipAgreement(agreementId, {
    contentHtml: synced.html,
    generatedPdfBlob: synced.pdfBuffer,
    updatedAt: new Date().toISOString(),
    auditLogJson: appendAudit(agreement, 'pdf_regenerated', { documentMode: synced.documentMode }),
  })
  return getReferralPartnershipAgreementById(agreementId)
}

export async function uploadSignedAgreementPdf(agreementId, pdfBuffer, meta = {}, actor = 'crm') {
  const agreement = getReferralPartnershipAgreementById(agreementId)
  if (!agreement) return { ok: false, error: 'Agreement not found' }
  const partnership = getReferralPartnershipById(agreement.partnershipId)
  if (!partnership) return { ok: false, error: 'Partnership not found' }
  const venue = agreementVenueContext(agreement, partnership)
  const contact = agreementContact(agreement)

  const mutableErr = validateAgreementMutable(agreement)
  if (mutableErr) return { ok: false, error: mutableErr }

  const nextStatus = meta.status || agreement.status
  if (nextStatus === 'fully_executed' || nextStatus === 'sent') {
    const err = validateAgreementStatusTransition(agreement, nextStatus, { venue, contact })
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
  let updated = getReferralPartnershipAgreementById(agreementId)

  if (updated.status === 'fully_executed') {
    const synced = await syncAgreementDocument(agreementId, { statusOverride: 'fully_executed' })
    if (synced) {
      updateReferralPartnershipAgreement(agreementId, {
        contentHtml: synced.html,
        generatedPdfBlob: synced.pdfBuffer,
        updatedAt: new Date().toISOString(),
      })
      updated = getReferralPartnershipAgreementById(agreementId)
    }
  }

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
  const contact = agreementContact(agreement)

  const err = validatePartnershipActivation(agreement, { venue, contact })
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
  if (!agreement || agreement.status !== 'fully_executed' || !isAgreementOwnerApproved(agreement)) return null
  return { partnership, agreement }
}

export function buildReferralSnapshotForCreate({ venueId, agreementId }) {
  if (agreementId) {
    const agreement = getReferralPartnershipAgreementById(agreementId)
    if (agreement && agreement.status === 'fully_executed' && isAgreementOwnerApproved(agreement)) {
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
