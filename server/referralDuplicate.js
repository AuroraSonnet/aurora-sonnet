import { normalizeEmail } from './outreachImapMatch.js'

/**
 * Decide whether a couple is already known before referral credit is applied.
 * Email identifies a couple. Phone identifies one only when the full name matches too.
 * A name alone never matches. A blank phone is ignored.
 */

export const ALREADY_REGISTERED_PARTNER_MESSAGE =
  'This couple is already registered with Aurora Sonnet, so this referral can’t be credited to you. Your submission has still been received.'

export const REFERRAL_NEEDS_REVIEW_PARTNER_MESSAGE =
  'Your submission has been received. It needs review before any referral credit is applied.'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function normalizeReferralEmail(value) {
  const email = normalizeEmail(value)
  return EMAIL_RE.test(email) ? email : ''
}

function hasPhoneExtension(value) {
  return /(?:ext(?:ension)?\.?|\bx)\s*\d+/i.test(value) || /\d\s*x\s*\d{1,6}\s*$/i.test(value)
}

function digitsWithExplicitTrunkZeroRemoved(value) {
  return String(value ?? '')
    .replace(/\(\s*0\s*\)/g, '')
    .replace(/\D/g, '')
}

function nanpFold(digits) {
  let national = digits
  // UK +44 only: a trunk 0 right after the country code is formatting. 13 digits keeps this off US 440 area codes.
  if (national.length === 13 && national.startsWith('440')) national = `44${national.slice(3)}`
  if (national.length === 11 && national.startsWith('1')) national = national.slice(1)
  if (national.length < 10 || national.length > 15) return ''
  return national
}

/**
 * Punctuation is ignored, matching the partnership import's 10–15 digit check.
 * A written country code is kept: +44, 0044, and 01144 collapse to the same digits.
 * +1 collapses to the 10-digit US number. An explicit (0) after the country code is dropped.
 * Anything else that is not a reliable number is ignored.
 */
export function normalizeReferralPhone(value) {
  const raw = String(value ?? '').trim()
  if (!raw || hasPhoneExtension(raw)) return ''
  const digits = digitsWithExplicitTrunkZeroRemoved(raw)
  if (!digits) return ''
  if (digits.startsWith('00')) {
    const international = nanpFold(digits.slice(2))
    if (international) return international
  }
  if (digits.startsWith('011')) {
    const international = nanpFold(digits.slice(3))
    if (international) return international
  }
  return nanpFold(digits)
}

/** Canonical digits when the number is reliable. Otherwise keep the typed value and do not use it for matching. */
export function phoneToStore(value) {
  const raw = String(value ?? '').trim()
  if (!raw) return null
  return normalizeReferralPhone(raw) || raw.slice(0, 40)
}

function normalizeFullName(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
}

function sameFullName(recordName, submittedNameKey) {
  if (!submittedNameKey) return false
  const recordKey = normalizeFullName(recordName)
  return Boolean(recordKey) && recordKey === submittedNameKey
}

function earliestReferral(rows) {
  return [...rows].sort((a, b) => {
    const byDate = String(a.submissionDate || '').localeCompare(String(b.submissionDate || ''))
    if (byDate) return byDate
    return Number(a.rowid || 0) - Number(b.rowid || 0)
  })[0]
}

function overlapsEmailIdentity(row, isReferral, emailClientIds, emailReferralIds, emailKey) {
  if (!isReferral && emailClientIds.has(row.id)) return true
  if (isReferral && emailReferralIds.has(row.id)) return true
  const rowEmail = normalizeReferralEmail(isReferral ? row.clientEmail : row.email)
  return Boolean(emailKey) && rowEmail === emailKey
}

/**
 * clients: { id, name, email, phone }
 * referrals: { id, clientName, clientEmail, clientPhone, partnershipId, submissionDate, rowid }
 */
export function classifyCoupleContacts({ email, phone, name, clients, referrals }) {
  const emailKey = normalizeReferralEmail(email)
  const phoneKey = normalizeReferralPhone(phone)
  const nameKey = normalizeFullName(name)
  const clientRows = Array.isArray(clients) ? clients : []
  const referralRows = Array.isArray(referrals) ? referrals : []

  const emailClients = emailKey ? clientRows.filter((row) => normalizeReferralEmail(row.email) === emailKey) : []
  const emailReferrals = emailKey
    ? referralRows.filter((row) => normalizeReferralEmail(row.clientEmail) === emailKey)
    : []
  const phoneClients = phoneKey ? clientRows.filter((row) => normalizeReferralPhone(row.phone) === phoneKey) : []
  const phoneReferrals = phoneKey
    ? referralRows.filter((row) => normalizeReferralPhone(row.clientPhone) === phoneKey)
    : []

  const emailHit = emailClients.length > 0 || emailReferrals.length > 0
  const phoneHit = phoneClients.length > 0 || phoneReferrals.length > 0
  if (!emailHit && !phoneHit) return { kind: 'new' }

  const emailClientIds = new Set(emailClients.map((row) => row.id))
  const emailReferralIds = new Set(emailReferrals.map((row) => row.id))
  const phoneConflictsWithEmail =
    emailHit &&
    phoneHit &&
    [...phoneClients.map((row) => ({ row, isReferral: false })), ...phoneReferrals.map((row) => ({ row, isReferral: true }))].some(
      ({ row, isReferral }) => !overlapsEmailIdentity(row, isReferral, emailClientIds, emailReferralIds, emailKey)
    )
  if (phoneConflictsWithEmail) return { kind: 'ambiguous' }

  if (emailHit) {
    const referral = earliestReferral(emailReferrals)
    if (referral) {
      return {
        kind: 'existing_referral',
        referralId: referral.id,
        partnershipId: referral.partnershipId || null,
        clientId: emailClients[0]?.id || null,
      }
    }
    return { kind: 'existing_client', clientId: emailClients[0].id }
  }

  const namedPhoneClients = phoneClients.filter((row) => sameFullName(row.name, nameKey))
  const namedPhoneReferrals = phoneReferrals.filter((row) => sameFullName(row.clientName, nameKey))
  if (!namedPhoneClients.length && !namedPhoneReferrals.length) return { kind: 'ambiguous' }

  const referral = earliestReferral(namedPhoneReferrals)
  if (referral) {
    return {
      kind: 'existing_referral',
      referralId: referral.id,
      partnershipId: referral.partnershipId || null,
      clientId: namedPhoneClients[0]?.id || null,
    }
  }
  return { kind: 'existing_client', clientId: namedPhoneClients[0].id }
}

export function partnerLinkAdminNote(status) {
  if (status === 'existing' || status === 'already_referred') {
    return 'Existing referral attribution kept. No additional referral credit.'
  }
  if (status === 'existing_client') {
    return 'Not credited. This couple is already an Aurora Sonnet client and has no partner referral.'
  }
  if (status === 'needs_review') {
    return 'Needs admin review. Email and phone do not identify one couple. Not credited.'
  }
  return ''
}

/** Refer a Couple only. Link inquiries do not use these partner-facing sentences. */
export function referralCreditDecision(match) {
  if (!match || match.kind === 'new') return { action: 'credit' }
  if (match.kind === 'ambiguous') {
    return { action: 'needs_review', partnerNotice: REFERRAL_NEEDS_REVIEW_PARTNER_MESSAGE }
  }
  if (match.kind === 'existing_referral' || match.kind === 'existing_client') {
    return {
      action: 'already_registered',
      partnerNotice: ALREADY_REGISTERED_PARTNER_MESSAGE,
      referralId: match.referralId || null,
      clientId: match.clientId || null,
    }
  }
  return { action: 'needs_review', partnerNotice: REFERRAL_NEEDS_REVIEW_PARTNER_MESSAGE }
}
