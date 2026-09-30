/**
 * Partner referral acceptance decision tracking (5-business-day window).
 */
import { addBusinessDays, instantAtNyLocal, nyBusinessDateString } from './businessDays.js'
import { parseTermsSnapshot } from './referralPartnershipTerms.js'

export const REFERRAL_DECISION_STATUSES = ['pending', 'accepted', 'rejected', 'overdue']

export const REFERRAL_DECISION_STATUS_LABELS = {
  pending: 'Pending',
  accepted: 'Accepted',
  rejected: 'Rejected',
  overdue: 'Overdue',
}

export const DEFAULT_REFERRAL_DECISION_BUSINESS_DAYS = 5

export function requiresExplicitReferralDecision(termsSnapshot) {
  const t = parseTermsSnapshot(termsSnapshot)
  return t?.termsKind === 'referral_partnership_mvp'
}

/** YYYY-MM-DD deadline = submission date + N NY Business Days (Mon–Fri, excluding U.S. federal holidays). */
export function computeReferralDecisionDeadline(submissionDateStr, businessDays = DEFAULT_REFERRAL_DECISION_BUSINESS_DAYS) {
  const raw = String(submissionDateStr || '').trim()
  if (!raw) return null
  const [y, m, d] = raw.split('-').map(Number)
  if (!y || !m || !d) return null
  const anchor = instantAtNyLocal(y, m, d, 12, 0)
  const deadlineInstant = addBusinessDays(anchor, businessDays)
  return nyBusinessDateString(deadlineInstant)
}

export function computeReferralDecisionDeadlineFromInstant(submittedAt, businessDays = DEFAULT_REFERRAL_DECISION_BUSINESS_DAYS) {
  const dateStr = nyBusinessDateString(new Date(submittedAt))
  return computeReferralDecisionDeadline(dateStr, businessDays)
}

/** Resolve display/storage status; overdue is derived when deadline passed and still pending. */
export function resolveReferralDecisionStatus(referral, now = new Date()) {
  const stored = String(referral?.referralDecisionStatus || '').toLowerCase()
  if (stored === 'accepted' || stored === 'rejected') return stored
  if (stored === 'overdue') return 'overdue'
  const deadline = referral?.referralDecisionDeadline
  if (!deadline) return stored || 'pending'
  const today = nyBusinessDateString(now)
  if ((stored === 'pending' || !stored) && today > deadline) return 'overdue'
  return stored || 'pending'
}

export function isReferralDecisionAccepted(referral) {
  const status = resolveReferralDecisionStatus(referral)
  return status === 'accepted'
}

/** Silence never constitutes acceptance. */
export function isReferralCommissionEligible(referral) {
  if (!requiresExplicitReferralDecision(referral?.agreementTermsSnapshot)) return true
  return isReferralDecisionAccepted(referral)
}

export function daysUntilDecisionDeadline(referral, now = new Date()) {
  const deadline = referral?.referralDecisionDeadline
  if (!deadline) return null
  const today = nyBusinessDateString(now)
  if (today > deadline) return 0
  const [ty, tm, td] = today.split('-').map(Number)
  const [dy, dm, dd] = deadline.split('-').map(Number)
  const t0 = Date.UTC(ty, tm - 1, td)
  const d0 = Date.UTC(dy, dm - 1, dd)
  return Math.round((d0 - t0) / (24 * 60 * 60 * 1000))
}

export function isReferralDecisionApproaching(referral, withinCalendarDays = 2, now = new Date()) {
  const status = resolveReferralDecisionStatus(referral, now)
  if (status !== 'pending') return false
  const remaining = daysUntilDecisionDeadline(referral, now)
  if (remaining == null) return false
  return remaining >= 0 && remaining <= withinCalendarDays
}

export function isReferralDecisionActionable(referral, now = new Date()) {
  const status = resolveReferralDecisionStatus(referral, now)
  return status === 'pending' || status === 'overdue'
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

export function appendReferralDecisionAudit(referral, event, detail = {}) {
  const log = parseAuditLog(referral?.referralDecisionAuditJson)
  log.push({ at: new Date().toISOString(), event, ...detail })
  return JSON.stringify(log)
}

export function validateReferralDecisionAccept(referral) {
  if (!requiresExplicitReferralDecision(referral?.agreementTermsSnapshot)) {
    return 'This referral does not require an acceptance decision.'
  }
  const status = resolveReferralDecisionStatus(referral)
  if (status === 'accepted') return 'Referral is already accepted.'
  if (status === 'rejected') return 'Rejected referrals cannot be accepted.'
  if (status !== 'pending' && status !== 'overdue') {
    return 'Only pending or overdue referrals may be accepted.'
  }
  return null
}

export function validateReferralDecisionReject(referral, { notes } = {}) {
  if (!requiresExplicitReferralDecision(referral?.agreementTermsSnapshot)) {
    return 'This referral does not require an acceptance decision.'
  }
  const status = resolveReferralDecisionStatus(referral)
  if (status === 'rejected') return 'Referral is already rejected.'
  if (status === 'accepted') return 'Accepted referrals cannot be rejected.'
  if (!String(notes || '').trim()) return 'Rejection notes are required.'
  return null
}

export function validateReferralDecisionDeadlineAdjust(referral, { newDeadline, reason } = {}) {
  if (!requiresExplicitReferralDecision(referral?.agreementTermsSnapshot)) {
    return 'Decision deadline applies only to partnership-agreement referrals.'
  }
  const status = resolveReferralDecisionStatus(referral)
  if (status === 'accepted' || status === 'rejected') {
    return 'Cannot adjust deadline after a decision has been recorded.'
  }
  const dl = String(newDeadline || '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dl)) return 'New deadline must be YYYY-MM-DD.'
  if (!String(reason || '').trim()) return 'Reason is required when adjusting the deadline (e.g., holiday).'
  return null
}

export function initializeReferralDecisionFields(referralData) {
  if (!requiresExplicitReferralDecision(referralData.agreementTermsSnapshot)) {
    return {}
  }
  const submittedAt = referralData.referralSubmittedAt || new Date().toISOString()
  const submissionDate = referralData.submissionDate || submittedAt.slice(0, 10)
  const deadline =
    referralData.referralDecisionDeadline ||
    computeReferralDecisionDeadlineFromInstant(submittedAt)
  return {
    referralSubmittedAt: submittedAt,
    referralDecisionDeadline: deadline,
    referralDecisionStatus: 'pending',
    referralDecisionAuditJson: JSON.stringify([
      { at: submittedAt, event: 'submitted', submissionDate, deadline },
    ]),
  }
}
