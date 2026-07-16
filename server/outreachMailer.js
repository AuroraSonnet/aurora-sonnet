import { randomBytes } from 'node:crypto'
import { mergePartnershipTemplateText } from './outreachTemplateMerge.js'

export const OUTREACH_DAILY_LIMIT = 30
export const OUTREACH_MAX_SEND_ATTEMPTS = 3
export const OUTREACH_RETRY_DELAY_MS = 30 * 60 * 1000
export const OUTREACH_CLAIM_STALE_MS = 15 * 60 * 1000

/** Stages where automated follow-up sends are allowed. */
export const OUTREACH_SEND_ELIGIBLE_STAGES = new Set([
  'first_email_sent',
  'follow_up_1',
  'follow_up_2',
  'follow_up_3',
])

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const FORM_CONTACT_PLACEHOLDER_DOMAIN = '@partnership.placeholder'

export function isSendableContactEmail(email) {
  if (typeof email !== 'string') return false
  const e = email.trim()
  return EMAIL_RE.test(e) && !e.endsWith(FORM_CONTACT_PLACEHOLDER_DOMAIN)
}

export function normalizeMessageId(messageId) {
  const raw = String(messageId || '').trim()
  if (!raw) return generateOutreachMessageId()
  return raw.startsWith('<') ? raw : `<${raw.replace(/^<|>$/g, '')}>`
}

export function generateOutreachMessageId(fromAddress) {
  const domain = String(fromAddress || 'aurorasonnet.com').split('@').pop() || 'aurorasonnet.com'
  return `<outreach.${randomBytes(16).toString('hex')}@${domain}>`
}

export function mailDomainFromAddress(fromAddress) {
  const m = String(fromAddress || '').match(/@([^>\s]+)/)
  return m ? m[1] : 'aurorasonnet.com'
}

/**
 * Phase 3 safety: automated sends require OUTREACH_TEST_EMAIL unless explicitly allowed.
 */
export function resolveAutomatedRecipient(contactEmail) {
  const override = process.env.OUTREACH_TEST_EMAIL || process.env.OUTREACH_AUTOMATED_TO_OVERRIDE
  if (override && String(override).trim()) {
    return {
      to: String(override).trim(),
      originalTo: contactEmail,
      isTestOverride: true,
    }
  }
  if (process.env.OUTREACH_ALLOW_PRODUCTION_SENDS === 'true') {
    return { to: contactEmail, originalTo: contactEmail, isTestOverride: false }
  }
  const err = new Error(
    'Automated outreach sends blocked: set OUTREACH_TEST_EMAIL (Phase 3) or OUTREACH_ALLOW_PRODUCTION_SENDS=true'
  )
  err.code = 'OUTREACH_SEND_BLOCKED'
  throw err
}

export function buildThreadingHeaders(priorMessages) {
  if (!priorMessages.length) return {}
  const first = priorMessages[0]
  const inReplyTo = normalizeMessageId(first.messageId)
  const references = priorMessages.map((m) => normalizeMessageId(m.messageId)).join(' ')
  return { inReplyTo, references }
}

export function buildAutomatedOutreachMail({
  contact,
  template,
  fromAddress,
  priorMessages,
  scheduledSendId,
}) {
  const { to, originalTo, isTestOverride } = resolveAutomatedRecipient(contact.email)
  let subject = mergePartnershipTemplateText(template.subject, contact)
  let body = mergePartnershipTemplateText(template.body, contact)

  if (isTestOverride) {
    subject = `[Outreach test → ${originalTo}] ${subject}`
    body = `[Phase 3 test routing — intended recipient: ${originalTo}]\n\n${body}`
  }

  const messageId = generateOutreachMessageId(fromAddress)
  const threading = buildThreadingHeaders(priorMessages)

  return {
    to,
    originalTo,
    isTestOverride,
    subject,
    body,
    headers: {
      'Message-ID': messageId,
      ...(threading.inReplyTo ? { 'In-Reply-To': threading.inReplyTo } : {}),
      ...(threading.references ? { References: threading.references } : {}),
      'X-Outreach-Scheduled-Send-Id': scheduledSendId,
    },
    messageId,
    inReplyTo: threading.inReplyTo,
    referencesHeader: threading.references,
  }
}

export function classifySmtpError(err) {
  const response = String(err?.response || err?.message || '')
  const code = Number(err?.responseCode || err?.code || 0)
  if (/550|551|552|553|554|user unknown|mailbox unavailable|does not exist|invalid recipient|permanently rejected/i.test(response)) {
    return 'permanent'
  }
  if (code >= 500 && code < 600 && /quota|temporar|try again|rate limit/i.test(response)) {
    return 'temporary'
  }
  if (code >= 400 && code < 500) return 'temporary'
  if (/timeout|ECONNRESET|ETIMEDOUT|ECONNREFUSED|EAI_AGAIN|ENOTFOUND/i.test(response)) return 'temporary'
  if (code >= 500 && code < 600) return 'temporary'
  return 'temporary'
}

export async function sendAutomatedOutreachMail(transporter, mailFrom, mailPayload) {
  const info = await transporter.sendMail({
    from: mailFrom,
    to: mailPayload.to,
    subject: mailPayload.subject,
    text: mailPayload.body,
    headers: mailPayload.headers,
  })
  const resolvedId = normalizeMessageId(info?.messageId || mailPayload.messageId)
  return {
    messageId: resolvedId,
    smtpResponse: info?.response || '250 OK',
    accepted: info?.accepted || [mailPayload.to],
    rejected: info?.rejected || [],
  }
}
