import {
  deferSendToNextBusinessDay,
  isBusinessDay,
  isWithinSendWindow,
  nyBusinessDateString,
} from './businessDays.js'
import {
  OUTREACH_CLAIM_STALE_MS,
  OUTREACH_DAILY_LIMIT,
  OUTREACH_MAX_SEND_ATTEMPTS,
  OUTREACH_RETRY_DELAY_MS,
  OUTREACH_SEND_ELIGIBLE_STAGES,
  buildAutomatedOutreachMail,
  classifySmtpError,
  isSendableContactEmail,
  sendAutomatedOutreachMail,
} from './outreachMailer.js'
import { handleHardBounceDetected, OUTREACH_SEQUENCE_STOP_STAGES } from './outreachSequence.js'
import { logOutreach } from './outreachLogger.js'
import {
  claimScheduledSend,
  completeAutomatedSendBookkeeping,
  createOutreachSendLog,
  finalizeAutomatedSendFromExistingLog,
  getEmailTemplateById,
  getOrCreateDailyQuota,
  getOutreachScheduledSendById,
  getOutreachSequenceByContactId,
  getPartnershipContactById,
  getSuccessfulSendLogForScheduledSend,
  incrementDailyQuotaDeferred,
  listDueScheduledSends,
  listSentMessagesForContact,
  listStaleClaimedSends,
  listClaimedScheduledSends,
  releaseScheduledSendClaim,
  stepAdvanceFor,
  updateOutreachScheduledSend,
} from './db.js'

export function evaluatePreSendChecks({ scheduledSend, contact, sequence }) {
  if (!contact || contact.deletedAt) return { ok: false, reason: 'contact_missing', action: 'cancel' }
  if (!sequence) return { ok: false, reason: 'sequence_missing', action: 'cancel' }
  if (sequence.status !== 'running') return { ok: false, reason: `sequence_${sequence.status}`, action: 'release' }
  if (scheduledSend.status !== 'claimed') return { ok: false, reason: 'not_claimed', action: 'release' }
  if (contact.outreachMethod === 'website_contact_form') {
    return { ok: false, reason: 'website_contact_form', action: 'cancel' }
  }
  if (contact.doNotContact) return { ok: false, reason: 'do_not_contact', action: 'cancel' }
  if (!isSendableContactEmail(contact.email)) return { ok: false, reason: 'invalid_email', action: 'cancel' }
  if (OUTREACH_SEQUENCE_STOP_STAGES.has(contact.stage)) {
    return { ok: false, reason: `stage_${contact.stage}`, action: 'cancel' }
  }
  if (!OUTREACH_SEND_ELIGIBLE_STAGES.has(contact.stage)) {
    return { ok: false, reason: `stage_${contact.stage}`, action: 'release' }
  }
  if (contact.partnerType !== 'venue') return { ok: false, reason: 'not_venue', action: 'cancel' }
  const template = getEmailTemplateById(scheduledSend.templateId)
  if (!template) return { ok: false, reason: 'template_missing', action: 'release' }
  return { ok: true, template }
}

export function recoverOutreachSchedulerState(now = new Date()) {
  const nowIso = now.toISOString()
  const cutoff = new Date(now.getTime() - OUTREACH_CLAIM_STALE_MS).toISOString()
  let recovered = 0
  let released = 0

  const claimed = listStaleClaimedSends(cutoff)
  for (const send of claimed) {
    const successLog = getSuccessfulSendLogForScheduledSend(send.id)
    if (successLog) {
      const businessDate = nyBusinessDateString(new Date(successLog.attemptedAt))
      finalizeAutomatedSendFromExistingLog({
        scheduledSend: send,
        sendLog: successLog,
        businessDate,
        nowIso,
      })
      recovered += 1
      logOutreach('claim_recovered', {
        component: 'scheduler',
        scheduledSendId: send.id,
        partnershipContactId: send.partnershipContactId,
        step: send.step,
        source: 'stale_claim_send_log',
      })
      continue
    }
    if (releaseScheduledSendClaim(send.id, nowIso)) {
      released += 1
      logOutreach('claim_released', {
        component: 'scheduler',
        scheduledSendId: send.id,
        partnershipContactId: send.partnershipContactId,
        step: send.step,
        reason: 'stale_claim_timeout',
      })
    }
  }

  const activeClaims = listClaimedScheduledSends()
  for (const send of activeClaims) {
    const successLog = getSuccessfulSendLogForScheduledSend(send.id)
    if (successLog) {
      const businessDate = nyBusinessDateString(new Date(successLog.attemptedAt))
      finalizeAutomatedSendFromExistingLog({
        scheduledSend: send,
        sendLog: successLog,
        businessDate,
        nowIso,
      })
      recovered += 1
      logOutreach('claim_recovered', {
        component: 'scheduler',
        scheduledSendId: send.id,
        partnershipContactId: send.partnershipContactId,
        step: send.step,
        source: 'active_claim_send_log',
      })
    }
  }

  if (recovered || released) {
    logOutreach('recovery_complete', { component: 'scheduler', recovered, released })
  }

  return { recovered, released }
}

function deferScheduledSend(send, now, rng) {
  const nextAt = deferSendToNextBusinessDay(now, rng)
  updateOutreachScheduledSend(send.id, {
    status: 'deferred',
    scheduledAt: nextAt,
    deferReason: 'daily_limit',
    updatedAt: now.toISOString(),
  })
  incrementDailyQuotaDeferred(nyBusinessDateString(now))
  logOutreach('send_deferred', {
    component: 'scheduler',
    scheduledSendId: send.id,
    partnershipContactId: send.partnershipContactId,
    step: send.step,
    deferReason: 'daily_limit',
    nextScheduledAt: nextAt,
    businessDate: nyBusinessDateString(now),
  })
}

function cancelScheduledSend(send, nowIso, reason) {
  updateOutreachScheduledSend(send.id, {
    status: 'cancelled',
    lastError: reason,
    updatedAt: nowIso,
  })
  createOutreachSendLog({
    scheduledSendId: send.id,
    partnershipContactId: send.partnershipContactId,
    templateId: send.templateId,
    attemptedAt: nowIso,
    result: 'skipped',
    smtpResponse: reason,
  })
}

async function processOneDueSend({
  scheduledSend,
  now,
  transporter,
  mailFrom,
  businessDate,
  sentToday,
  rng,
}) {
  const nowIso = now.toISOString()

  if (sentToday >= OUTREACH_DAILY_LIMIT) {
    deferScheduledSend(scheduledSend, now, rng)
    return { outcome: 'deferred' }
  }

  const claimed = claimScheduledSend(scheduledSend.id, nowIso)
  if (!claimed) {
    logOutreach('send_skipped', {
      component: 'scheduler',
      scheduledSendId: scheduledSend.id,
      reason: 'claim_failed',
    })
    return { outcome: 'skipped', reason: 'claim_failed' }
  }

  const existingSuccess = getSuccessfulSendLogForScheduledSend(claimed.id)
  if (existingSuccess) {
    finalizeAutomatedSendFromExistingLog({
      scheduledSend: claimed,
      sendLog: existingSuccess,
      businessDate,
      nowIso,
    })
    logOutreach('send_recovered', {
      component: 'scheduler',
      scheduledSendId: claimed.id,
      partnershipContactId: claimed.partnershipContactId,
      step: claimed.step,
    })
    return { outcome: 'recovered' }
  }

  const contact = getPartnershipContactById(claimed.partnershipContactId)
  const sequence = getOutreachSequenceByContactId(claimed.partnershipContactId)
  const pre = evaluatePreSendChecks({ scheduledSend: claimed, contact, sequence })
  if (!pre.ok) {
    if (pre.action === 'release') releaseScheduledSendClaim(claimed.id, nowIso)
    else cancelScheduledSend(claimed, nowIso, pre.reason)
    return { outcome: 'skipped', reason: pre.reason }
  }

  const priorMessages = listSentMessagesForContact(contact.id)
  const mailPayload = buildAutomatedOutreachMail({
    contact,
    template: pre.template,
    fromAddress: mailFrom,
    priorMessages,
    scheduledSendId: claimed.id,
  })

  try {
    logOutreach('send_attempt', {
      component: 'scheduler',
      scheduledSendId: claimed.id,
      partnershipContactId: claimed.partnershipContactId,
      step: claimed.step,
      attemptCount: (claimed.attemptCount || 0) + 1,
      testMode: mailPayload.isTestOverride,
      toDomain: String(mailPayload.to).split('@')[1] || 'unknown',
    })

    const smtpResult = await sendAutomatedOutreachMail(transporter, mailFrom, mailPayload)
    const sentAt = nowIso
    createOutreachSendLog({
      scheduledSendId: claimed.id,
      partnershipContactId: claimed.partnershipContactId,
      templateId: claimed.templateId,
      subject: mailPayload.subject,
      body: mailPayload.body,
      attemptedAt: sentAt,
      result: 'sent',
      smtpResponse: smtpResult.smtpResponse,
      messageId: smtpResult.messageId,
    })

    const stepMeta = stepAdvanceFor(claimed.step)
    completeAutomatedSendBookkeeping({
      scheduledSendId: claimed.id,
      partnershipContactId: claimed.partnershipContactId,
      sequenceId: sequence.id,
      templateId: claimed.templateId,
      subject: mailPayload.subject,
      body: mailPayload.body,
      messageId: smtpResult.messageId,
      inReplyTo: mailPayload.inReplyTo,
      referencesHeader: mailPayload.referencesHeader,
      toEmail: mailPayload.to,
      sentAt,
      businessDate,
      contactStage: stepMeta.contactStage,
      sequenceCurrentStep: stepMeta.sequenceCurrentStep,
      sequenceStatus: stepMeta.sequenceStatus,
      nowIso: sentAt,
    })

    logOutreach('send_succeeded', {
      component: 'scheduler',
      scheduledSendId: claimed.id,
      partnershipContactId: claimed.partnershipContactId,
      step: claimed.step,
      messageId: smtpResult.messageId,
      testMode: mailPayload.isTestOverride,
    })

    return { outcome: 'sent', messageId: smtpResult.messageId, to: mailPayload.to }
  } catch (err) {
    const kind = classifySmtpError(err)
    const attemptCount = (claimed.attemptCount || 0) + 1
    const errText = err?.response || err?.message || String(err)

    createOutreachSendLog({
      scheduledSendId: claimed.id,
      partnershipContactId: claimed.partnershipContactId,
      templateId: claimed.templateId,
      subject: mailPayload.subject,
      body: mailPayload.body,
      attemptedAt: nowIso,
      result: 'failed',
      smtpResponse: errText,
    })

    if (kind === 'permanent' || attemptCount >= OUTREACH_MAX_SEND_ATTEMPTS) {
      updateOutreachScheduledSend(claimed.id, {
        status: 'failed',
        attemptCount,
        lastAttemptAt: nowIso,
        lastError: errText,
        updatedAt: nowIso,
      })
      if (kind === 'permanent') {
        handleHardBounceDetected({
          contactId: claimed.partnershipContactId,
          bounceReason: errText,
          receivedAt: nowIso,
          source: 'smtp',
          subject: mailPayload.subject,
          matchMethod: 'smtp_permanent',
        })
      }
      logOutreach('send_failed', {
        component: 'scheduler',
        scheduledSendId: claimed.id,
        partnershipContactId: claimed.partnershipContactId,
        step: claimed.step,
        permanent: kind === 'permanent',
        attemptCount,
        error: errText,
      }, { level: 'error' })
      return { outcome: 'failed', reason: errText, permanent: kind === 'permanent' }
    }

    const retryAt = new Date(now.getTime() + OUTREACH_RETRY_DELAY_MS).toISOString()
    updateOutreachScheduledSend(claimed.id, {
      status: 'pending',
      attemptCount,
      lastAttemptAt: nowIso,
      lastError: errText,
      scheduledAt: retryAt,
      updatedAt: nowIso,
    })
    logOutreach('send_retry_scheduled', {
      component: 'scheduler',
      scheduledSendId: claimed.id,
      partnershipContactId: claimed.partnershipContactId,
      step: claimed.step,
      attemptCount,
      retryAt,
      error: errText,
    })
    return { outcome: 'retry_scheduled', reason: errText, retryAt }
  }
}

export async function runOutreachSchedulerTick({
  now = new Date(),
  transporter,
  mailFrom,
  rng = Math.random,
  force = false,
}) {
  if (!transporter || !mailFrom) {
    return { sent: 0, deferred: 0, skipped: 0, failed: 0, recovered: 0, error: 'smtp_not_configured' }
  }

  const recovery = recoverOutreachSchedulerState(now)

  if (!force && (!isBusinessDay(now) || !isWithinSendWindow(now))) {
    logOutreach('scheduler_outside_window', {
      component: 'scheduler',
      recovered: recovery.recovered,
      released: recovery.released,
      businessDate: nyBusinessDateString(now),
    })
    return {
      sent: 0,
      deferred: 0,
      skipped: 0,
      failed: 0,
      recovered: recovery.recovered,
      released: recovery.released,
      outsideWindow: true,
    }
  }

  const nowIso = now.toISOString()
  const businessDate = nyBusinessDateString(now)
  const quota = getOrCreateDailyQuota(businessDate)
  let sentToday = quota.sentCount

  const due = listDueScheduledSends(nowIso)
  let sent = 0
  let deferred = 0
  let skipped = 0
  let failed = 0

  logOutreach('scheduler_tick', {
    component: 'scheduler',
    businessDate,
    dueCount: due.length,
    sentToday,
    dailyLimit: OUTREACH_DAILY_LIMIT,
    recovered: recovery.recovered,
    released: recovery.released,
  })

  for (const row of due) {
    const current = getOutreachScheduledSendById(row.id)
    if (!current || !['pending', 'deferred'].includes(current.status)) continue

    const result = await processOneDueSend({
      scheduledSend: current,
      now,
      transporter,
      mailFrom,
      businessDate,
      sentToday,
      rng,
    })

    if (result.outcome === 'sent' || result.outcome === 'recovered') {
      sent += 1
      sentToday += 1
    } else if (result.outcome === 'deferred') {
      deferred += 1
    } else if (result.outcome === 'failed') {
      failed += 1
    } else {
      skipped += 1
    }
  }

  logOutreach('scheduler_tick_complete', {
    component: 'scheduler',
    businessDate,
    sent,
    deferred,
    skipped,
    failed,
    recovered: recovery.recovered,
    released: recovery.released,
  })

  return {
    sent,
    deferred,
    skipped,
    failed,
    recovered: recovery.recovered,
    released: recovery.released,
    businessDate,
    quotaAfter: getOrCreateDailyQuota(businessDate),
  }
}

/** Send one scheduled follow-up immediately (used by E2E test acceleration only). */
export async function sendSingleScheduledFollowUpNow({
  scheduledSendId,
  now = new Date(),
  transporter,
  mailFrom,
  rng = Math.random,
}) {
  const row = getOutreachScheduledSendById(scheduledSendId)
  if (!row) {
    return { outcome: 'skipped', reason: 'send_not_found' }
  }

  const businessDate = nyBusinessDateString(now)
  const quota = getOrCreateDailyQuota(businessDate)

  return processOneDueSend({
    scheduledSend: row,
    now,
    transporter,
    mailFrom,
    businessDate,
    sentToday: quota.sentCount,
    rng,
  })
}
