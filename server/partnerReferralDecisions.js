/**
 * Partner referral decision actions and commission statement workflow.
 */
import {
  computeReferralDecisionDeadlineFromInstant,
  requiresExplicitReferralDecision,
  validateReferralDecisionAccept,
  validateReferralDecisionReject,
  validateReferralDecisionDeadlineAdjust,
  appendReferralDecisionAudit,
  resolveReferralDecisionStatus,
  isReferralDecisionActionable,
  isReferralDecisionApproaching,
} from './referralDecision.js'
import {
  buildCommissionStatementData,
  renderCommissionStatementPdf,
} from './commissionStatementPdf.js'
import { getAuroraOrganizationSettings } from './referralOrganizationSettings.js'
import { canUserRecordOwnerApproval } from './referralLegalApprovalAuth.js'
import {
  getPartnerReferral,
  patchPartnerReferralFields,
  listPartnerReferralsNeedingDecision,
} from './db.js'

export function listReferralDecisionsForOutreach({ approachingDays = 2 } = {}) {
  const rows = listPartnerReferralsNeedingDecision()
  const now = new Date()
  return rows
    .map((r) => ({ ...r, referralDecisionStatus: resolveReferralDecisionStatus(r, now) }))
    .filter((r) => {
      const s = r.referralDecisionStatus
      if (s === 'overdue') return true
      if (s === 'pending' && isReferralDecisionApproaching(r, approachingDays, now)) return true
      return isReferralDecisionActionable(r, now)
    })
    .sort((a, b) => String(a.referralDecisionDeadline).localeCompare(String(b.referralDecisionDeadline)))
}

export function acceptPartnerReferralDecision(referralId, { actor, notes } = {}) {
  const referral = getPartnerReferral(referralId)
  if (!referral) return { ok: false, error: 'Referral not found' }
  const err = validateReferralDecisionAccept(referral)
  if (err) return { ok: false, error: err }
  const now = new Date().toISOString()
  patchPartnerReferralFields(referralId, {
    referralDecisionStatus: 'accepted',
    referralAcceptedAt: now,
    referralDecisionBy: actor || null,
    referralDecisionNotes: notes?.trim() || null,
    referralDecisionAuditJson: appendReferralDecisionAudit(referral, 'accepted', {
      by: actor,
      notes: notes?.trim() || null,
    }),
  })
  return { ok: true, referral: getPartnerReferral(referralId) }
}

export function rejectPartnerReferralDecision(referralId, { actor, notes } = {}) {
  const referral = getPartnerReferral(referralId)
  if (!referral) return { ok: false, error: 'Referral not found' }
  const err = validateReferralDecisionReject(referral, { notes })
  if (err) return { ok: false, error: err }
  const now = new Date().toISOString()
  patchPartnerReferralFields(referralId, {
    referralDecisionStatus: 'rejected',
    referralRejectedAt: now,
    referralDecisionBy: actor || null,
    referralDecisionNotes: String(notes).trim(),
    referralDecisionAuditJson: appendReferralDecisionAudit(referral, 'rejected', {
      by: actor,
      notes: String(notes).trim(),
    }),
  })
  return { ok: true, referral: getPartnerReferral(referralId) }
}

export function adjustPartnerReferralDecisionDeadline(referralId, { actor, newDeadline, reason } = {}) {
  if (!canUserRecordOwnerApproval(actor)) {
    return { ok: false, error: 'You are not authorized to adjust referral decision deadlines.' }
  }
  const referral = getPartnerReferral(referralId)
  if (!referral) return { ok: false, error: 'Referral not found' }
  const err = validateReferralDecisionDeadlineAdjust(referral, { newDeadline, reason })
  if (err) return { ok: false, error: err }
  const prev = referral.referralDecisionDeadline
  patchPartnerReferralFields(referralId, {
    referralDecisionDeadline: String(newDeadline).trim(),
    referralDecisionDeadlineAdjustedAt: new Date().toISOString(),
    referralDecisionDeadlineAdjustedBy: actor || null,
    referralDecisionDeadlineAdjustReason: String(reason).trim(),
    referralDecisionStatus: 'pending',
    referralDecisionAuditJson: appendReferralDecisionAudit(referral, 'deadline_adjusted', {
      by: actor,
      from: prev,
      to: newDeadline,
      reason: String(reason).trim(),
    }),
  })
  return { ok: true, referral: getPartnerReferral(referralId) }
}

export async function generatePartnerReferralCommissionStatement(referralId, paymentMeta = {}) {
  const referral = getPartnerReferral(referralId)
  if (!referral) return { ok: false, error: 'Referral not found' }
  const org = getAuroraOrganizationSettings()
  const merged = {
    ...referral,
    commissionPaymentDate: paymentMeta.paymentDate ?? referral.commissionPaymentDate,
    commissionPaymentMethod: paymentMeta.paymentMethod ?? referral.commissionPaymentMethod,
    commissionPaymentReference: paymentMeta.paymentReference ?? referral.commissionPaymentReference,
  }
  const data = buildCommissionStatementData(merged, org)
  const pdfBuffer = await renderCommissionStatementPdf(data)
  const now = new Date().toISOString()
  patchPartnerReferralFields(referralId, {
    commissionStatementNumber: data.statementNumber,
    commissionStatementGeneratedAt: now,
    commissionStatementBlob: pdfBuffer,
    commissionStatementDataJson: JSON.stringify(data),
    commissionPaymentDate: paymentMeta.paymentDate ?? referral.commissionPaymentDate ?? null,
    commissionPaymentMethod: paymentMeta.paymentMethod ?? referral.commissionPaymentMethod ?? null,
    commissionPaymentReference: paymentMeta.paymentReference ?? referral.commissionPaymentReference ?? null,
  })
  return { ok: true, referral: getPartnerReferral(referralId), statementNumber: data.statementNumber }
}

export function recordPartnerReferralCommissionStatementDelivery(referralId, { method, reference, actor } = {}) {
  const referral = getPartnerReferral(referralId)
  if (!referral) return { ok: false, error: 'Referral not found' }
  if (!referral.commissionStatementGeneratedAt) {
    return { ok: false, error: 'Generate the commission statement before recording delivery.' }
  }
  const deliveryMethod = String(method || '').trim()
  if (!deliveryMethod) return { ok: false, error: 'Delivery method is required.' }
  const now = new Date().toISOString()
  patchPartnerReferralFields(referralId, {
    commissionStatementDeliveredAt: now,
    commissionStatementDeliveryMethod: deliveryMethod,
    commissionStatementDeliveryReference: reference?.trim() || null,
    commissionStatementDeliveredBy: actor || null,
  })
  return { ok: true, referral: getPartnerReferral(referralId) }
}
