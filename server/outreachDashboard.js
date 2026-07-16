import { nyBusinessDateString } from './businessDays.js'
import { OUTREACH_DAILY_LIMIT } from './outreachMailer.js'
import { getSequenceState } from './outreachSequence.js'
import {
  countContactsByStage,
  countSequencesByStatus,
  getEmailTemplateById,
  getImapSyncState,
  getOrCreateDailyQuota,
  getPartnershipContactById,
  listFailedScheduledSends,
  listInboundBouncesForContact,
  listInboundRepliesForContact,
  listOutreachActivityForContact,
  listScheduledSendsForBusinessDate,
} from './db.js'

const STEP_LABELS = {
  follow_up_1: 'Follow-up #1',
  follow_up_2: 'Follow-up #2',
  follow_up_3: 'Final Follow-up',
  done: 'Done',
}

const STATUS_LABELS = {
  running: 'Running',
  paused: 'Paused',
  stopped: 'Stopped',
  completed: 'Completed',
}

const ACTIVE_SEND_STATUSES = new Set(['pending', 'deferred', 'claimed'])

function statusLabel(status) {
  return STATUS_LABELS[status] || status
}

function stepLabel(step) {
  return STEP_LABELS[step] || step
}

function formatTemplateStep(send) {
  const tpl = send.templateId ? getEmailTemplateById(send.templateId) : null
  return {
    step: send.step,
    stepLabel: stepLabel(send.step),
    templateId: send.templateId,
    templateName: tpl?.name || send.templateId || 'Follow-up email',
    scheduledAt: send.scheduledAt,
    status: send.status,
  }
}

function findLastReply(contactId, sequence) {
  const inbound = listInboundRepliesForContact(contactId, 1)[0]
  if (inbound) {
    return {
      at: inbound.receivedAt,
      subject: inbound.subject,
      snippet: inbound.snippet,
      matchMethod: inbound.matchMethod,
    }
  }
  const activity = listOutreachActivityForContact(contactId).find((a) => a.type === 'reply')
  if (activity) {
    return {
      at: activity.createdAt,
      subject: activity.subject,
      snippet: activity.body,
      matchMethod: 'activity',
    }
  }
  if (sequence?.lastInboundAt) {
    return { at: sequence.lastInboundAt, subject: undefined, snippet: 'Reply detected', matchMethod: 'sequence' }
  }
  return null
}

function findLastFailure(contactId) {
  const inboundBounce = listInboundBouncesForContact(contactId, 1)[0]
  if (inboundBounce) {
    return {
      at: inboundBounce.receivedAt,
      reason: inboundBounce.snippet || inboundBounce.subject || 'Hard bounce detected',
      source: 'imap',
      matchMethod: inboundBounce.matchMethod,
    }
  }

  const activity = listOutreachActivityForContact(contactId).find(
    (a) => a.type === 'note' && /hard bounce|delivery failed/i.test(a.body || '')
  )
  if (activity) {
    const match = (activity.body || '').match(/hard bounce[^:]*:\s*(.+)$/i)
    return {
      at: activity.createdAt,
      reason: (match?.[1] || activity.body || 'Email delivery failed').trim(),
      source: 'activity',
    }
  }

  const failedSend = listFailedScheduledSends(contactId, 1)[0]
  if (failedSend?.lastError) {
    return {
      at: failedSend.lastAttemptAt || failedSend.updatedAt,
      reason: failedSend.lastError,
      source: 'smtp',
      step: failedSend.step,
    }
  }

  return null
}

export function buildSequencePanelState(partnershipContactId) {
  const state = getSequenceState(partnershipContactId)
  if (!state) return null

  const { sequence, scheduledSends } = state
  const remaining = scheduledSends.filter((s) => ACTIVE_SEND_STATUSES.has(s.status))
  const nextSend = remaining
    .slice()
    .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))[0]

  return {
    sequence,
    scheduledSends,
    panel: {
      status: sequence.status,
      statusLabel: statusLabel(sequence.status),
      currentStep: sequence.currentStep,
      currentStepLabel: stepLabel(sequence.currentStep),
      nextScheduled: nextSend ? formatTemplateStep(nextSend) : null,
      remainingCount: remaining.length,
      remaining: remaining.map(formatTemplateStep),
      lastReply: findLastReply(partnershipContactId, sequence),
      lastFailure: findLastFailure(partnershipContactId),
      stopReason: sequence.stopReason || undefined,
    },
  }
}

export function getOutreachDashboardStats(now = new Date()) {
  const businessDate = nyBusinessDateString(now)
  const quota = getOrCreateDailyQuota(businessDate)
  const scheduledToday = listScheduledSendsForBusinessDate(businessDate)
  const sentToday = quota.sentCount
  const deferredToday = quota.deferredCount
  const remainingToday = Math.max(0, OUTREACH_DAILY_LIMIT - sentToday)

  return {
    businessDate,
    dailyLimit: OUTREACH_DAILY_LIMIT,
    scheduledToday: scheduledToday.length,
    sentToday,
    remainingToday,
    deferredToday,
    newReplies: listInboundRepliesForContact(null, null, businessDate).length,
    pausedSequences: countSequencesByStatus('paused'),
    failedSends: listFailedScheduledSends().length,
    hardBounces: countContactsByStage('email_delivery_failed'),
  }
}

const IMAP_STALE_MS = 24 * 60 * 60 * 1000

export function getOutreachSystemStatus({ smtpConfigured, now = new Date() } = {}) {
  const schedulerEnabled = process.env.OUTREACH_SCHEDULER_ENABLED === 'true'
  const imapEnabled = process.env.OUTREACH_IMAP_ENABLED === 'true'
  const imapMailbox = process.env.IMAP_MAILBOX || 'INBOX'
  const imapConfigured = Boolean(process.env.IMAP_USER && process.env.IMAP_PASS)
  const sync = getImapSyncState(imapMailbox)
  const lastImapPollAt = sync?.lastPollAt || null
  const lastPollAgeMs = lastImapPollAt ? now.getTime() - new Date(lastImapPollAt).getTime() : null

  let imapHealth = 'disabled'
  if (imapEnabled && imapConfigured) {
    if (!lastImapPollAt) imapHealth = 'never_polled'
    else if (lastPollAgeMs > IMAP_STALE_MS) imapHealth = 'stale'
    else imapHealth = 'ok'
  }

  return {
    automatedSendingEnabled: schedulerEnabled,
    automatedSendingReady: schedulerEnabled && Boolean(smtpConfigured),
    replyDetectionEnabled: imapEnabled,
    replyDetectionReady: imapEnabled && imapConfigured,
    smtpConfigured: Boolean(smtpConfigured),
    imapConfigured,
    imapHealth,
    lastImapPollAt,
    warnings: buildSystemWarnings({
      schedulerEnabled,
      imapEnabled,
      smtpConfigured: Boolean(smtpConfigured),
      imapConfigured,
      imapHealth,
    }),
  }
}

function buildSystemWarnings({ schedulerEnabled, imapEnabled, smtpConfigured, imapConfigured, imapHealth }) {
  const warnings = []
  if (!schedulerEnabled) {
    warnings.push({
      code: 'scheduler_disabled',
      level: 'info',
      message: 'Automated follow-up sending is disabled. Scheduled emails will not send until automation is enabled on the server.',
    })
  } else if (!smtpConfigured) {
    warnings.push({
      code: 'smtp_not_configured',
      level: 'warning',
      message: 'Automated sending is enabled but SMTP is not configured. Outreach emails cannot send.',
    })
  }

  if (!imapEnabled) {
    warnings.push({
      code: 'imap_disabled',
      level: 'info',
      message: 'Reply and bounce detection is disabled. Inbox polling is not running.',
    })
  } else if (!imapConfigured) {
    warnings.push({
      code: 'imap_not_configured',
      level: 'warning',
      message: 'Reply detection is enabled but IMAP is not configured. Inbox polling cannot run.',
    })
  } else if (imapHealth === 'never_polled') {
    warnings.push({
      code: 'imap_never_polled',
      level: 'warning',
      message: 'IMAP is configured but no successful inbox poll has been recorded yet.',
    })
  } else if (imapHealth === 'stale') {
    warnings.push({
      code: 'imap_stale',
      level: 'warning',
      message: 'IMAP inbox polling looks stale (no poll in the last 24 hours). Reply and bounce detection may be behind.',
    })
  }

  return warnings
}

export function getOutreachContactSequenceView(contactId) {
  const contact = getPartnershipContactById(contactId)
  if (!contact) return { ok: false, reason: 'contact_missing' }
  const state = buildSequencePanelState(contactId)
  return { ok: true, contact, state }
}
