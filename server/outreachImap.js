import {
  buildReplyMatchingContext,
  imapMessageToInbound,
  isAutomatedNonBounceMessage,
  isBounceCandidate,
  matchInboundBounce,
  matchInboundReply,
} from './outreachImapMatch.js'
import { normalizeMessageId } from './outreachMailer.js'
import { handleHardBounceDetected, handleReplyDetected } from './outreachSequence.js'
import {
  createOutreachInboundMessage,
  getImapSyncState,
  getInboundMessageByImapUid,
  getInboundMessageByMessageId,
  listOutboundSentMessagesForActiveSequences,
  listPartnershipContacts,
  listVenueContactsWithActiveSequences,
  upsertImapSyncState,
} from './db.js'

const DEFAULT_IMAP_HOST = 'imap.hostinger.com'
const DEFAULT_IMAP_PORT = 993
const HEADER_FETCH = [
  'message-id',
  'from',
  'subject',
  'date',
  'in-reply-to',
  'references',
  'auto-submitted',
  'precedence',
  'x-auto-response-suppressed',
  'return-path',
  'content-type',
]

function extractPlainTextFromMimeSource(raw) {
  const text = String(raw || '')
  const idx = text.search(/\r?\n\r?\n/)
  const body = idx >= 0 ? text.slice(idx) : text
  const stripped = body
    .replace(/=\r?\n/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return stripped.slice(0, 8000)
}

export async function fetchImapMessageBodyText(client, uid) {
  if (!client || uid == null) return ''
  try {
    const chunks = []
    for await (const chunk of client.download(uid, undefined, { uid: true })) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    }
    if (!chunks.length) return ''
    return extractPlainTextFromMimeSource(Buffer.concat(chunks).toString('utf8'))
  } catch (_) {
    return ''
  }
}

function recordInboundBounce(inbound, match, { normId, receivedAt, nowIso, severity }) {
  const matchMethod = match.matched
    ? match.matchMethod
    : severity === 'soft'
      ? 'bounce_soft_unmatched'
      : severity === 'unknown'
        ? 'bounce_unknown'
        : 'bounce_unmatched'

  return createOutreachInboundMessage({
    partnershipContactId: match.matched ? match.contactId : null,
    imapUid: inbound.uid ?? null,
    messageId: normId || null,
    fromEmail: inbound.fromEmail,
    subject: inbound.subject,
    receivedAt,
    matchMethod,
    inReplyTo: inbound.inReplyTo || null,
    referencesHeader: inbound.references || null,
    snippet: (inbound.bodyText || inbound.snippet || inbound.subject || '').slice(0, 500),
    processedAt: nowIso,
  })
}

export function getImapConfigFromEnv() {
  return {
    enabled: process.env.OUTREACH_IMAP_ENABLED === 'true',
    host: process.env.IMAP_HOST || DEFAULT_IMAP_HOST,
    port: Number(process.env.IMAP_PORT || DEFAULT_IMAP_PORT),
    user: process.env.IMAP_USER || '',
    pass: process.env.IMAP_PASS || '',
    mailbox: process.env.IMAP_MAILBOX || 'INBOX',
    secure: process.env.IMAP_TLS !== 'false',
  }
}

export async function createImapFlowClient(config) {
  const { ImapFlow } = await import('imapflow')
  return new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.pass },
    logger: false,
    emitLogs: false,
    disableAutoIdle: true,
  })
}

/**
 * Process one fetched IMAP message (headers only — read-only).
 * Returns { status: 'matched'|'bounce'|'unmatched'|'skipped'|'duplicate', ... }
 */
export function processInboundImapMessage(inboundRaw, { matchingContext, mailboxEmail, nowIso }) {
  const inbound = { ...inboundRaw, mailboxEmail }

  if (inbound.uid != null) {
    const byUid = getInboundMessageByImapUid(inbound.uid)
    if (byUid) return { status: 'duplicate', reason: 'imap_uid' }
  }
  const normId = inbound.messageId ? normalizeMessageId(inbound.messageId) : ''
  if (normId) {
    const byMsg = getInboundMessageByMessageId(normId)
    if (byMsg) return { status: 'duplicate', reason: 'message_id' }
  }

  const receivedAt = inbound.receivedAt || nowIso

  if (isBounceCandidate(inbound)) {
    const bounceMatch = matchInboundBounce(inbound, matchingContext)
    recordInboundBounce(inbound, bounceMatch, {
      normId,
      receivedAt,
      nowIso,
      severity: bounceMatch.severity,
    })

    if (bounceMatch.severity !== 'hard') {
      return {
        status: 'skipped',
        reason: bounceMatch.severity === 'soft' ? 'bounce_soft' : 'bounce_unknown',
        severity: bounceMatch.severity,
        contactId: bounceMatch.contactId,
      }
    }

    if (!bounceMatch.matched) {
      return {
        status: 'unmatched',
        reason: bounceMatch.reason || 'bounce_unmatched',
        severity: bounceMatch.severity,
      }
    }

    const bounceResult = handleHardBounceDetected({
      contactId: bounceMatch.contactId,
      bounceReason: bounceMatch.bounceReason,
      receivedAt,
      source: 'imap',
      subject: inbound.subject,
      matchMethod: bounceMatch.matchMethod,
      inbound,
    })

    return {
      status: 'bounce',
      contactId: bounceMatch.contactId,
      matchMethod: bounceMatch.matchMethod,
      severity: bounceMatch.severity,
      cancelledCount: bounceResult.cancelledCount,
    }
  }

  if (isAutomatedNonBounceMessage(inbound, { mailboxEmail })) {
    return { status: 'skipped', reason: 'automated_reply' }
  }

  const match = matchInboundReply(inbound, matchingContext)

  if (!match.matched) {
    createOutreachInboundMessage({
      partnershipContactId: null,
      imapUid: inbound.uid ?? null,
      messageId: normId || null,
      fromEmail: inbound.fromEmail,
      subject: inbound.subject,
      receivedAt,
      matchMethod: 'unmatched',
      inReplyTo: inbound.inReplyTo || null,
      referencesHeader: inbound.references || null,
      snippet: inbound.snippet,
      processedAt: nowIso,
    })
    return { status: 'unmatched', reason: match.reason, contactId: match.contactId }
  }

  const inboundRecord = createOutreachInboundMessage({
    partnershipContactId: match.contactId,
    imapUid: inbound.uid ?? null,
    messageId: normId || null,
    fromEmail: inbound.fromEmail,
    subject: inbound.subject,
    receivedAt,
    matchMethod: match.matchMethod,
    inReplyTo: inbound.inReplyTo || null,
    referencesHeader: inbound.references || null,
    snippet: inbound.snippet,
    processedAt: nowIso,
  })

  const replyResult = handleReplyDetected({
    contactId: match.contactId,
    inbound: { ...inboundRecord, matchMethod: match.matchMethod },
    receivedAt,
  })

  return {
    status: 'matched',
    contactId: match.contactId,
    matchMethod: match.matchMethod,
    cancelledCount: replyResult.cancelledCount,
  }
}

/**
 * Read-only IMAP poll — fetches headers only (no \\Seen, move, or delete).
 */
export async function runOutreachImapPoll({ clientFactory, now = new Date() } = {}) {
  const config = getImapConfigFromEnv()
  if (!config.enabled) {
    return { ok: false, disabled: true, processed: 0, matched: 0, unmatched: 0, skipped: 0, bounces: 0 }
  }
  if (!config.user || !config.pass) {
    return { ok: false, error: 'IMAP_USER/IMAP_PASS not configured', processed: 0, matched: 0, bounces: 0 }
  }

  const nowIso = now.toISOString()
  const sentMessages = listOutboundSentMessagesForActiveSequences()
  const contacts = listVenueContactsWithActiveSequences()
  const allContacts = listPartnershipContacts().filter((c) => !c.deletedAt)
  const matchingContext = buildReplyMatchingContext({ sentMessages, contacts, allContacts })

  let client
  let createdClient = false
  try {
    if (clientFactory) {
      client = await clientFactory(config)
    } else {
      client = await createImapFlowClient(config)
      createdClient = true
      await client.connect()
    }

    const lock = await client.getMailboxLock(config.mailbox)
    let maxUid = null
    let processed = 0
    let matched = 0
    let unmatched = 0
    let skipped = 0
    let duplicates = 0
    let bounces = 0

    try {
      const status = await client.status(config.mailbox, { uidValidity: true })
      const sync = getImapSyncState(config.mailbox)
      let startUid = 1
      if (sync?.uidValidity === status.uidValidity && sync.lastUid) {
        startUid = sync.lastUid + 1
      }

      const range = `${startUid}:*`
      for await (const msg of client.fetch(
        range,
        { uid: true, envelope: true, internalDate: true, headers: HEADER_FETCH },
        { uid: true }
      )) {
        if (!msg?.uid) continue
        maxUid = maxUid == null ? msg.uid : Math.max(maxUid, msg.uid)
        processed += 1

        const inboundRaw = imapMessageToInbound(msg, config.user)
        if (isBounceCandidate(inboundRaw)) {
          inboundRaw.bodyText = await fetchImapMessageBodyText(client, msg.uid)
        }
        const result = processInboundImapMessage(inboundRaw, {
          matchingContext,
          mailboxEmail: config.user,
          nowIso,
        })

        if (result.status === 'matched') matched += 1
        else if (result.status === 'bounce') bounces += 1
        else if (result.status === 'unmatched') unmatched += 1
        else if (result.status === 'skipped') skipped += 1
        else if (result.status === 'duplicate') duplicates += 1
      }

      if (maxUid != null) {
        upsertImapSyncState({
          mailbox: config.mailbox,
          lastUid: maxUid,
          lastPollAt: nowIso,
          uidValidity: status.uidValidity,
        })
      } else if (sync?.lastUid) {
        upsertImapSyncState({
          mailbox: config.mailbox,
          lastUid: sync.lastUid,
          lastPollAt: nowIso,
          uidValidity: status.uidValidity,
        })
      } else {
        upsertImapSyncState({
          mailbox: config.mailbox,
          lastUid: 0,
          lastPollAt: nowIso,
          uidValidity: status.uidValidity,
        })
      }

      return {
        ok: true,
        processed,
        matched,
        unmatched,
        skipped,
        duplicates,
        bounces,
        mailbox: config.mailbox,
        uidValidity: status.uidValidity,
      }
    } finally {
      lock.release()
    }
  } catch (err) {
    console.log('[OUTREACH-IMAP] poll failed:', err?.message || err)
    return {
      ok: false,
      error: err?.message || String(err),
      processed: 0,
      matched: 0,
      unmatched: 0,
      skipped: 0,
      bounces: 0,
    }
  } finally {
    if (createdClient && client) {
      try {
        await client.logout()
      } catch (_) {}
    }
  }
}
