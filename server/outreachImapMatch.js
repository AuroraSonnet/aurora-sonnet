import { normalizeMessageId } from './outreachMailer.js'

export function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase()
}

export function normalizeSubject(subject) {
  return String(subject || '')
    .replace(/^(re|fwd|fw):\s*/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

export function parseMessageIdList(headerValue) {
  if (!headerValue) return []
  const matches = String(headerValue).match(/<[^>]+>/g) || []
  return [...new Set(matches.map((m) => normalizeMessageId(m)))]
}

export function extractEmailAddress(fromValue) {
  if (!fromValue) return ''
  if (typeof fromValue === 'object' && fromValue.address) return normalizeEmail(fromValue.address)
  const text = Array.isArray(fromValue)
    ? fromValue.map((f) => f.address || f.mailbox + '@' + f.host).join(' ')
    : String(fromValue)
  const angle = text.match(/<([^>]+)>/)
  if (angle) return normalizeEmail(angle[1])
  const plain = text.match(/[^\s<>]+@[^\s<>]+/)
  return plain ? normalizeEmail(plain[0]) : ''
}

export function buildReplyMatchingContext({ sentMessages, contacts, allContacts } = {}) {
  const outboundById = new Map()
  const sentByContact = new Map()
  for (const msg of sentMessages) {
    const id = normalizeMessageId(msg.messageId)
    outboundById.set(id, msg)
    const list = sentByContact.get(msg.partnershipContactId) || []
    list.push(msg)
    sentByContact.set(msg.partnershipContactId, list)
  }
  const contactsByEmail = new Map()
  const contactRows = allContacts || contacts || []
  for (const c of contactRows) {
    if (c?.email) contactsByEmail.set(normalizeEmail(c.email), c)
  }
  return { outboundById, sentByContact, contactsByEmail }
}

/** Delivery failure / NDR messages (mailer-daemon, DSN subjects). */
export function isBounceCandidate(inbound) {
  const fromEmail = normalizeEmail(inbound.fromEmail)
  const subject = String(inbound.subject || '')
  const contentType = String(inbound.contentType || '').toLowerCase()

  if (/mailer-daemon@|postmaster@|mail-daemon@|mdaemon@/.test(fromEmail)) return true
  if (/multipart\/report|message\/delivery-status/.test(contentType)) return true
  if (
    /delivery status notification|undeliverable|failure notice|returned mail|mail delivery failed|delivery failed|undelivered mail|delivery failure/i.test(
      subject
    )
  ) {
    return true
  }
  return false
}

/** OOO / auto-replies — skip without treating as human reply or bounce. */
export function isAutomatedNonBounceMessage(inbound, { mailboxEmail } = {}) {
  if (isBounceCandidate(inbound)) return false

  const fromEmail = normalizeEmail(inbound.fromEmail)
  const subject = String(inbound.subject || '')
  const autoSubmitted = String(inbound.autoSubmitted || '').toLowerCase()
  const precedence = String(inbound.precedence || '').toLowerCase()
  const xAuto = inbound.xAutoResponseSuppressed != null && String(inbound.xAutoResponseSuppressed).trim() !== ''

  if (/noreply@|no-reply@|donotreply@/.test(fromEmail)) return true
  if (autoSubmitted && autoSubmitted !== 'no') return true
  if (/auto_reply|bulk|junk|list/.test(precedence)) return true
  if (xAuto) return true
  if (/auto.?reply|out of office|automatic reply|away from/i.test(subject)) return true
  if (mailboxEmail && fromEmail === normalizeEmail(mailboxEmail)) return true
  return false
}

/** @deprecated Use isBounceCandidate / isAutomatedNonBounceMessage */
export function isAutomatedOrBounceMessage(inbound, options = {}) {
  return isBounceCandidate(inbound) || isAutomatedNonBounceMessage(inbound, options)
}

function bounceTextBlob(inbound) {
  return `${inbound.subject || ''}\n${inbound.bodyText || ''}\n${inbound.snippet || ''}`
}

/**
 * Classify inbound NDR severity.
 * hard = permanent failure (stop sequence); soft = temporary (log only); unknown = log only.
 */
export function classifyBounceSeverity(inbound) {
  const text = bounceTextBlob(inbound).toLowerCase()

  if (/status:\s*5\.\d\.\d|\b5\.\d\.\d\b/.test(text)) return 'hard'
  if (
    /\b550\b|\b551\b|\b552\b|\b553\b|\b554\b|user unknown|mailbox unavailable|does not exist|no such user|invalid recipient|permanently rejected|address rejected|mailbox not found|recipient address rejected|account disabled|user not found/i.test(
      text
    )
  ) {
    return 'hard'
  }

  if (/status:\s*4\.\d\.\d|\b4\.\d\.\d\b/.test(text)) return 'soft'
  if (
    /\b421\b|\b450\b|\b451\b|\b452\b|temporarily unavailable|try again later|deferred|mailbox full|over quota|greylist|rate limit|service unavailable/i.test(
      text
    )
  ) {
    return 'soft'
  }

  return 'unknown'
}

const BOUNCED_RECIPIENT_PATTERNS = [
  /final-recipient:\s*rfc822;\s*<?([^>\s;]+@[^>\s;]+)>?/i,
  /original-recipient:\s*rfc822;\s*<?([^>\s;]+@[^>\s;]+)>?/i,
  /x-failed-recipients:\s*<?([^>\s;,]+@[^>\s;,]+)>?/i,
  /delivery to the following recipient(?:s)? failed[^\n]*:\s*<?([^>\s,]+@[^>\s>,]+)>?/i,
  /did not reach the following recipient:\s*<?([^>\s]+@[^>\s>]+)>?/i,
  /could not be delivered to\s*<?([^>\s]+@[^>\s>]+)>?/i,
  /undeliverable:\s*<?([^>\s]+@[^>\s>]+)>?/i,
]

/** Extract the failed recipient address from an NDR subject/body. */
export function extractBouncedRecipientEmail(inbound) {
  const text = bounceTextBlob(inbound)
  for (const pattern of BOUNCED_RECIPIENT_PATTERNS) {
    const m = text.match(pattern)
    if (m?.[1]) return normalizeEmail(m[1])
  }
  const emails = [...text.matchAll(/<?([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})>?/gi)].map((m) =>
    normalizeEmail(m[1])
  )
  const filtered = emails.filter(
    (e) => !/mailer-daemon|postmaster|mdaemon|aurorasonnet\.com/.test(e)
  )
  return filtered[0] || ''
}

export function summarizeBounceReason(inbound) {
  const text = bounceTextBlob(inbound)
  const diag = text.match(/diagnostic-code:\s*([^\n]+)/i)?.[1]?.trim()
  if (diag) return diag.slice(0, 500)
  const status = text.match(/status:\s*([^\n]+)/i)?.[1]?.trim()
  if (status) return `Status: ${status}`.slice(0, 500)
  return String(inbound.subject || 'Email delivery failed').slice(0, 500)
}

/**
 * Match inbound hard-bounce NDR to a partnership contact.
 * Returns { matched, contactId, matchMethod, severity, bounceReason, ... }.
 */
export function matchInboundBounce(inbound, context) {
  const severity = classifyBounceSeverity(inbound)
  const bounceReason = summarizeBounceReason(inbound)
  const base = { severity, bounceReason }

  if (!isBounceCandidate(inbound)) {
    return { matched: false, reason: 'not_bounce', ...base }
  }

  const { outboundById, contactsByEmail } = context

  if (inbound.inReplyTo) {
    const hit = outboundById.get(normalizeMessageId(inbound.inReplyTo))
    if (hit) {
      return {
        matched: true,
        contactId: hit.partnershipContactId,
        matchMethod: 'bounce_thread_in_reply_to',
        confidence: 'high',
        ...base,
      }
    }
  }

  for (const ref of parseMessageIdList(inbound.references)) {
    const hit = outboundById.get(ref)
    if (hit) {
      return {
        matched: true,
        contactId: hit.partnershipContactId,
        matchMethod: 'bounce_thread_references',
        confidence: 'high',
        ...base,
      }
    }
  }

  const bouncedEmail = extractBouncedRecipientEmail(inbound)
  if (bouncedEmail) {
    const contact = contactsByEmail.get(bouncedEmail)
    if (contact) {
      return {
        matched: true,
        contactId: contact.id,
        matchMethod: 'bounce_recipient',
        confidence: 'medium',
        bouncedEmail,
        ...base,
      }
    }
    return { matched: false, reason: 'no_contact_for_bounced_recipient', bouncedEmail, ...base }
  }

  return { matched: false, reason: 'bounce_unmatched', ...base }
}

function subjectMatchesOutbound(inboundSubject, sentMessages) {
  const normInbound = normalizeSubject(inboundSubject)
  if (!normInbound) return false
  for (const sent of sentMessages) {
    const base = normalizeSubject(sent.subject)
    if (!base) continue
    if (normInbound === base) return true
    if (normInbound === `re: ${base}`) return true
    if (normInbound.startsWith(`re: ${base}`)) return true
  }
  return false
}

/**
 * Match inbound reply to a partnership contact.
 * Returns { matched: true, contactId, matchMethod, confidence } or { matched: false, reason, ... }.
 */
export function matchInboundReply(inbound, context) {
  const { outboundById, sentByContact, contactsByEmail } = context

  if (inbound.inReplyTo) {
    const replyId = normalizeMessageId(inbound.inReplyTo)
    const hit = outboundById.get(replyId)
    if (hit) {
      return {
        matched: true,
        contactId: hit.partnershipContactId,
        matchMethod: 'thread_in_reply_to',
        confidence: 'high',
      }
    }
  }

  for (const ref of parseMessageIdList(inbound.references)) {
    const hit = outboundById.get(ref)
    if (hit) {
      return {
        matched: true,
        contactId: hit.partnershipContactId,
        matchMethod: 'thread_references',
        confidence: 'high',
      }
    }
  }

  const fromEmail = normalizeEmail(inbound.fromEmail)
  const contact = contactsByEmail.get(fromEmail)
  if (!contact) return { matched: false, reason: 'no_contact_for_sender' }

  const sentForContact = sentByContact.get(contact.id) || []
  if (subjectMatchesOutbound(inbound.subject, sentForContact)) {
    return {
      matched: true,
      contactId: contact.id,
      matchMethod: 'sender_subject',
      confidence: 'medium',
    }
  }

  return {
    matched: false,
    reason: 'uncertain_fallback',
    contactId: contact.id,
    fromEmail,
  }
}

export function imapHeaderValue(headers, name) {
  if (!headers) return ''
  const key = name.toLowerCase()
  if (headers instanceof Map) {
    const v = headers.get(key)
    return v == null ? '' : String(v)
  }
  if (typeof headers.get === 'function') {
    const v = headers.get(key)
    return v == null ? '' : String(v)
  }
  return String(headers[key] || headers[name] || '')
}

export function imapMessageToInbound(msg, mailboxEmail) {
  const fromEnvelope = msg.envelope?.from?.[0]
  const fromHeader = imapHeaderValue(msg.headers, 'from')
  const fromEmail = extractEmailAddress(fromEnvelope || fromHeader)
  const subject = msg.envelope?.subject || imapHeaderValue(msg.headers, 'subject') || ''
  const receivedAt = (msg.envelope?.date || msg.internalDate || new Date()).toISOString?.()
    ? new Date(msg.envelope?.date || msg.internalDate || new Date()).toISOString()
    : new Date().toISOString()

  return {
    uid: msg.uid,
    messageId: imapHeaderValue(msg.headers, 'message-id') || (msg.envelope?.messageId ? `<${msg.envelope.messageId}>` : ''),
    fromEmail,
    subject,
    receivedAt,
    inReplyTo: imapHeaderValue(msg.headers, 'in-reply-to'),
    references: imapHeaderValue(msg.headers, 'references'),
    autoSubmitted: imapHeaderValue(msg.headers, 'auto-submitted'),
    precedence: imapHeaderValue(msg.headers, 'precedence'),
    xAutoResponseSuppressed: imapHeaderValue(msg.headers, 'x-auto-response-suppressed'),
    contentType: imapHeaderValue(msg.headers, 'content-type'),
    snippet: String(subject).slice(0, 500),
    bodyText: msg.bodyText || '',
    mailboxEmail,
  }
}
