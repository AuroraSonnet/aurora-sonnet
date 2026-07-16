import { getOutreachSendMode } from './outreachLogger.js'
import { sendSingleScheduledFollowUpNow } from './outreachScheduler.js'
import {
  getActiveOutreachSequenceByContactId,
  getEmailTemplateById,
  getPartnershipContactById,
  listScheduledSendsForSequence,
  updateOutreachScheduledSend,
} from './db.js'

/** Contacts created for end-to-end outreach testing (company name must include this marker). */
export const E2E_TEST_CONTACT_NAME_MARKER = 'E2E Test'

export function isE2eTestAcceleratableContact(contact) {
  return new RegExp(E2E_TEST_CONTACT_NAME_MARKER, 'i').test(String(contact?.companyName || ''))
}

export function assertTestFollowUpAccelerationAllowed(contact) {
  if (!process.env.OUTREACH_TEST_EMAIL?.trim()) {
    return { ok: false, error: 'OUTREACH_TEST_EMAIL is not configured' }
  }
  if (process.env.OUTREACH_ALLOW_PRODUCTION_SENDS === 'true') {
    return {
      ok: false,
      error: 'Test acceleration blocked while OUTREACH_ALLOW_PRODUCTION_SENDS is enabled',
    }
  }
  if (!contact) {
    return { ok: false, error: 'Partnership contact not found' }
  }
  if (!isE2eTestAcceleratableContact(contact)) {
    return {
      ok: false,
      error: `Test acceleration only allowed for contacts whose company name includes "${E2E_TEST_CONTACT_NAME_MARKER}"`,
    }
  }
  return { ok: true, sendMode: getOutreachSendMode() }
}

/**
 * Accelerate and send the next pending/deferred follow-up for one E2E test contact only.
 * Does not change global interval defaults — only moves this contact's next scheduledAt to now.
 */
export async function accelerateAndSendNextTestFollowUp({
  partnershipContactId,
  now = new Date(),
  transporter,
  mailFrom,
}) {
  const contact = getPartnershipContactById(partnershipContactId)
  const gate = assertTestFollowUpAccelerationAllowed(contact)
  if (!gate.ok) {
    return { ok: false, error: gate.error }
  }

  const sequence = getActiveOutreachSequenceByContactId(partnershipContactId)
  if (!sequence || sequence.status !== 'running') {
    return { ok: false, error: 'No active running outreach sequence for this contact' }
  }

  const sends = listScheduledSendsForSequence(sequence.id)
  const nextSend = sends.find((s) => s.status === 'pending' || s.status === 'deferred')
  if (!nextSend) {
    return { ok: false, error: 'No pending follow-up scheduled for this contact' }
  }

  const nowIso = now.toISOString()
  updateOutreachScheduledSend(nextSend.id, {
    scheduledAt: nowIso,
    status: 'pending',
    deferReason: null,
    updatedAt: nowIso,
  })

  const sendResult = await sendSingleScheduledFollowUpNow({
    scheduledSendId: nextSend.id,
    now,
    transporter,
    mailFrom,
  })

  const template = nextSend.templateId ? getEmailTemplateById(nextSend.templateId) : null

  return {
    ok: true,
    contactId: partnershipContactId,
    companyName: contact.companyName,
    step: nextSend.step,
    templateId: nextSend.templateId,
    templateName: template?.name || nextSend.templateId,
    scheduledSendId: nextSend.id,
    sendMode: gate.sendMode,
    routedTo: process.env.OUTREACH_TEST_EMAIL?.trim(),
    contactEmail: contact.email,
    outcome: sendResult.outcome,
    messageId: sendResult.messageId,
    to: sendResult.to,
    reason: sendResult.reason,
    error: sendResult.reason,
  }
}
