/**
 * Partner Portal V1: a read-only, partner-facing view of existing referral_partnerships /
 * partner_referrals / referral_partnership_agreements data. Stores nothing but one-time login tokens.
 */
import { createHash, randomBytes } from 'node:crypto'
import db, {
  getPartnerReferralPayableContext,
  getReferralPartnershipAgreementById,
  getReferralPartnershipById,
  getReferralPartnershipByPartnerEmail,
  listPartnerReferralsByPartnershipId,
  listReferralPartnershipAgreementsForPartnership,
} from './db.js'
import {
  isReferralPayoutPayable,
  normalizeReferralStatusKey,
  referralStatusEligibleForBookingPayout,
} from './partnerReferralPayout.js'
import { isReferralCommissionEligible } from './referralDecision.js'
import { buildPartnerReferralLink } from './publicReferralPartner.js'

export const PORTAL_LOGIN_TOKEN_TTL_MS = 30 * 60 * 1000
export const PORTAL_WELCOME_TOKEN_TTL_MS = 72 * 60 * 60 * 1000

db.exec(`
  CREATE TABLE IF NOT EXISTS partner_portal_login_tokens (
    id TEXT PRIMARY KEY,
    tokenHash TEXT NOT NULL UNIQUE,
    partnershipId TEXT NOT NULL,
    createdAt TEXT NOT NULL,
    expiresAt TEXT NOT NULL,
    usedAt TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_partner_portal_login_tokens_partnership
    ON partner_portal_login_tokens (partnershipId);
`)

function hashToken(token) {
  return createHash('sha256').update(String(token)).digest('hex')
}

/** Returns the raw token; only its hash is stored. */
export function createPortalLoginToken(partnershipId, ttlMs = PORTAL_LOGIN_TOKEN_TTL_MS) {
  const now = Date.now()
  db.prepare('DELETE FROM partner_portal_login_tokens WHERE expiresAt < ?').run(new Date(now).toISOString())
  const token = randomBytes(32).toString('base64url')
  db.prepare(
    `INSERT INTO partner_portal_login_tokens (id, tokenHash, partnershipId, createdAt, expiresAt, usedAt)
     VALUES (?, ?, ?, ?, ?, NULL)`
  ).run(
    `ppt-${now}-${randomBytes(4).toString('hex')}`,
    hashToken(token),
    partnershipId,
    new Date(now).toISOString(),
    new Date(now + ttlMs).toISOString()
  )
  return token
}

/** Single use: marks the token used and returns its partnershipId, or null if unknown, used, or expired. */
export function consumePortalLoginToken(token) {
  const raw = String(token || '').trim()
  if (!raw || raw.length > 200) return null
  const nowIso = new Date().toISOString()
  const row = db
    .prepare(
      `UPDATE partner_portal_login_tokens SET usedAt = ?
       WHERE tokenHash = ? AND usedAt IS NULL AND expiresAt > ?
       RETURNING partnershipId`
    )
    .get(nowIso, hashToken(raw), nowIso)
  return row?.partnershipId || null
}

function isPublicPartnerAgreement(agreement, partnershipId) {
  return Boolean(
    agreement &&
      agreement.partnershipId === partnershipId &&
      String(agreement.status || '').toLowerCase() === 'fully_executed' &&
      agreement.termsJson?.termsKind === 'public_partner_agreement'
  )
}

function signedPublicAgreementFor(partnership) {
  const active = partnership.activeAgreementId
    ? getReferralPartnershipAgreementById(partnership.activeAgreementId)
    : null
  if (isPublicPartnerAgreement(active, partnership.id)) return active
  const all = listReferralPartnershipAgreementsForPartnership(partnership.id)
  for (let i = all.length - 1; i >= 0; i -= 1) {
    if (isPublicPartnerAgreement(all[i], partnership.id)) return all[i]
  }
  return null
}

/** 'paid' | 'earned' | 'pending' | null, derived only from existing referral/payout fields. */
export function partnerCommissionState(referral, context = {}) {
  const payoutStatus = String(referral?.payoutStatus || 'none').toLowerCase()
  if (payoutStatus === 'paid' || payoutStatus === 'completed') return 'paid'
  if (normalizeReferralStatusKey(referral?.referralStatus) === 'closed_lost') return null
  if (referral?.referralDecisionStatus === 'rejected') return null
  if (!referralStatusEligibleForBookingPayout(referral?.referralStatus)) return null
  if (!isReferralCommissionEligible(referral)) return null
  if (!(Number(referral?.payoutAmount) > 0)) return null
  if (payoutStatus === 'pending' || isReferralPayoutPayable(referral, context)) return 'earned'
  return 'pending'
}

export function partnerReferralStatusLabel(referral) {
  const key = normalizeReferralStatusKey(referral?.referralStatus)
  if (key === 'closed_lost' || referral?.referralDecisionStatus === 'rejected') return 'Not Booked'
  if (referralStatusEligibleForBookingPayout(key)) return 'Booked'
  if (key === 'new') return 'Received'
  return 'In Progress'
}

const COMMISSION_STATUS_LABELS = { pending: 'Pending', earned: 'Earned', paid: 'Paid' }

/** Only the fields a partner needs; everything else on the referral stays server-side. */
export function summarizePartnerReferrals(referrals, contextFor = () => ({})) {
  const earnings = { pending: 0, earned: 0, paid: 0 }
  const rows = referrals.map((r) => {
    const state = partnerCommissionState(r, contextFor(r))
    const amount = state ? Math.max(0, Math.round(Number(r.payoutAmount) || 0)) : 0
    if (state) earnings[state] += amount
    return {
      couple: r.clientName,
      eventDate: r.eventDate || null,
      status: partnerReferralStatusLabel(r),
      commission: state ? amount : null,
      commissionStatus: state ? COMMISSION_STATUS_LABELS[state] : null,
    }
  })
  return { earnings, referrals: rows }
}

function loadSummary(partnershipId) {
  return summarizePartnerReferrals(
    listPartnerReferralsByPartnershipId(partnershipId),
    getPartnerReferralPayableContext
  )
}

/**
 * Portal access: a signed public Partner Referral Agreement, and either an active partnership
 * or (former partners) outstanding pending/earned commission.
 */
export function resolvePortalAccess(partnership) {
  if (!partnership?.id) return null
  const agreement = signedPublicAgreementFor(partnership)
  if (!agreement) return null
  const active = partnership.status === 'active' && Boolean(partnership.referralToken)
  const summary = loadSummary(partnership.id)
  if (!active && summary.earnings.pending + summary.earnings.earned <= 0) return null
  return { partnership, agreement, active, summary }
}

export function resolvePortalAccessByEmail(email) {
  return resolvePortalAccess(getReferralPartnershipByPartnerEmail(email))
}

export function resolvePortalAccessById(partnershipId) {
  return partnershipId ? resolvePortalAccess(getReferralPartnershipById(partnershipId)) : null
}

export function portalDashboard(access) {
  const p = access.partnership
  return {
    partnerName: p.partnerName || null,
    companyName: p.companyName || null,
    active: access.active,
    referralLink: access.active ? buildPartnerReferralLink(p.referralToken) : null,
    earnings: access.summary.earnings,
    referrals: access.summary.referrals,
  }
}
