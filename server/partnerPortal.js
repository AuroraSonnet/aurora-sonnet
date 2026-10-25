/**
 * Partner Portal V1: a read-only, partner-facing view of existing referral_partnerships /
 * partner_referrals / referral_partnership_agreements data. Stores nothing but one-time login tokens.
 */
import { createHash, randomBytes } from 'node:crypto'
import db, {
  getReferralPartnershipAgreementById,
  getReferralPartnershipById,
  getReferralPartnershipByPartnerEmail,
  listPartnerReferralsByPartnershipId,
  listReferralPartnershipAgreementsForPartnership,
  listReferralProjectLinksWithProjects,
} from './db.js'
import { normalizeReferralStatusKey } from './partnerReferralPayout.js'
import { legacyPayoutIsHistory, projectCommissionState } from './referralProjectCommission.js'
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

const COMMISSION_STATUS_LABELS = { pending: 'Pending', earned: 'Earned', paid: 'Paid' }
const PAYOUT_STATUS_LABELS = { none: 'Not paid', pending: 'Payment scheduled', completed: 'Paid' }

function wholeUsd(v) {
  return Math.max(0, Math.round(Number(v) || 0))
}

/** Couple-level label. Only an admin-confirmed project booking (or a legacy paid commission) counts as Booked. */
export function partnerReferralStatusLabel(referral, links = []) {
  const key = normalizeReferralStatusKey(referral?.referralStatus)
  if (links.some((l) => l.bookedConfirmedAt) || legacyPayoutIsHistory(referral)) return 'Booked'
  if (key === 'closed_lost' || referral?.referralDecisionStatus === 'rejected') return 'Not Booked'
  if (key === 'new' || links.length === 0) return 'Received'
  return 'In Progress'
}

function projectEntry({ link, projectDate }, referral) {
  const state = projectCommissionState(link, referral)
  const commission = state ? wholeUsd(link.commissionAmount) : null
  return {
    state,
    entry: {
      projectDate: projectDate || null,
      eligibleAmount: link.bookedConfirmedAt && link.eligibleAmount != null ? wholeUsd(link.eligibleAmount) : null,
      commission,
      commissionStatus: state ? COMMISSION_STATUS_LABELS[state] : null,
      bookingStatus: link.bookedConfirmedAt ? 'Booked' : 'Not yet confirmed',
      completionStatus:
        link.eventCompletedAt && link.clientPaidInFullAt
          ? 'Complete, paid in full'
          : link.bookedConfirmedAt
            ? 'Awaiting event and final payment'
            : 'Not started',
      payoutStatus: PAYOUT_STATUS_LABELS[link.payoutStatus] || PAYOUT_STATUS_LABELS.none,
    },
  }
}

/**
 * One couple per referral, one entry per linked project. Commissions come only from project rows;
 * a referral-level commission already marked paid is shown once as an earlier record.
 * Only the fields a partner needs; contact details and project values stay server-side.
 */
export function summarizePartnerReferrals(referrals, projectsFor = () => []) {
  const earnings = { pending: 0, earned: 0, paid: 0 }
  const rows = referrals.map((r) => {
    const items = projectsFor(r)
    const coveredByEarlierRecord = legacyPayoutIsHistory(r) && r.legacyPaidProjectId ? r.legacyPaidProjectId : null
    const visibleItems = items.filter((item) => !coveredByEarlierRecord || item.link?.projectId !== coveredByEarlierRecord)
    const projects = visibleItems.map((item) => {
      const { state, entry } = projectEntry(item, r)
      if (state) earnings[state] += entry.commission
      return entry
    })
    let earlierRecord = null
    if (legacyPayoutIsHistory(r)) {
      earlierRecord = { commission: wholeUsd(r.payoutAmount), commissionStatus: COMMISSION_STATUS_LABELS.paid }
      earnings.paid += earlierRecord.commission
    }
    return {
      couple: r.clientName,
      eventDate: r.eventDate || null,
      status: partnerReferralStatusLabel(r, items.map((i) => i.link)),
      projects,
      earlierRecord,
    }
  })
  return { earnings, referrals: rows }
}

function loadSummary(partnershipId) {
  return summarizePartnerReferrals(listPartnerReferralsByPartnershipId(partnershipId), (r) =>
    listReferralProjectLinksWithProjects(r.id)
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
