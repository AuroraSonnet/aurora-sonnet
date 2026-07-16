import {
  VENUE_FINAL_FOLLOW_UP_TEMPLATE_ID,
  VENUE_FIRST_OUTREACH_TEMPLATE_ID,
  VENUE_FOLLOW_UP_1_TEMPLATE_ID,
  VENUE_FOLLOW_UP_2_TEMPLATE_ID,
} from './partnershipEmailTemplates.js'
import {
  OUTREACH_FOLLOW_UP_INTERVALS,
  isWithinSendWindow,
  nyBusinessDateString,
  nyDateTimeParts,
  scheduleFollowUpAt,
} from './businessDays.js'
import {
  cancelPendingScheduledSendsForContact,
  createOutreachScheduledSend,
  createOutreachSequence,
  getActiveOutreachSequenceByContactId,
  getOutreachSequenceByContactId,
  getPartnershipContactById,
  listScheduledSendsForSequence,
  updateOutreachScheduledSend,
  updateOutreachSequence,
  updatePartnershipContact,
  createOutreachActivity,
} from './db.js'

export const OUTREACH_SEQUENCE_STOP_STAGES = new Set([
  'replied',
  'meeting_scheduled',
  'partner',
  'not_interested',
  'archived_no_response',
  'email_delivery_failed',
])

export const EMAIL_DELIVERY_FAILED_STAGE = 'email_delivery_failed'

const SEQUENCE_STEPS = [
  {
    step: 'follow_up_1',
    intervalDays: OUTREACH_FOLLOW_UP_INTERVALS.follow_up_1,
    templateId: VENUE_FOLLOW_UP_1_TEMPLATE_ID,
    sortOrder: 1,
  },
  {
    step: 'follow_up_2',
    intervalDays: OUTREACH_FOLLOW_UP_INTERVALS.follow_up_2,
    templateId: VENUE_FOLLOW_UP_2_TEMPLATE_ID,
    sortOrder: 2,
  },
  {
    step: 'follow_up_3',
    intervalDays: OUTREACH_FOLLOW_UP_INTERVALS.follow_up_3,
    templateId: VENUE_FINAL_FOLLOW_UP_TEMPLATE_ID,
    sortOrder: 3,
  },
]

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const FORM_CONTACT_PLACEHOLDER_DOMAIN = '@partnership.placeholder'

function isSendableContactEmail(email) {
  if (typeof email !== 'string') return false
  const e = email.trim()
  return EMAIL_RE.test(e) && !e.endsWith(FORM_CONTACT_PLACEHOLDER_DOMAIN)
}

/** Whether a contact may be auto-enrolled after a successful first venue outreach send. */
export function isEligibleForVenueSequenceEnrollment(contact, { templateId } = {}) {
  if (!contact || contact.deletedAt) return { ok: false, reason: 'contact_missing' }
  if (contact.partnerType !== 'venue') return { ok: false, reason: 'not_venue' }
  if (contact.outreachMethod === 'website_contact_form') return { ok: false, reason: 'website_contact_form' }
  if (contact.doNotContact) return { ok: false, reason: 'do_not_contact' }
  if (!isSendableContactEmail(contact.email)) return { ok: false, reason: 'invalid_email' }
  if (templateId !== VENUE_FIRST_OUTREACH_TEMPLATE_ID) {
    return { ok: false, reason: 'not_first_outreach_template' }
  }
  const active = getActiveOutreachSequenceByContactId(contact.id)
  if (active) return { ok: false, reason: 'sequence_already_active' }
  return { ok: true }
}

function formatNyScheduleLabel(iso) {
  const d = new Date(iso)
  const { hour, minute } = nyDateTimeParts(d)
  const h = hour % 12 || 12
  const ampm = hour < 12 ? 'AM' : 'PM'
  const mm = String(minute).padStart(2, '0')
  return `${nyBusinessDateString(d)} ${h}:${mm} ${ampm} ET`
}

function buildScheduledSends(anchorAt, rng = Math.random) {
  const scheduled = []
  let chainAnchor = new Date(anchorAt)
  for (const stepDef of SEQUENCE_STEPS) {
    const scheduledAt = scheduleFollowUpAt(chainAnchor, stepDef.intervalDays, rng)
    if (!isWithinSendWindow(new Date(scheduledAt))) {
      throw new Error(`Scheduled send for ${stepDef.step} is outside the NY send window`)
    }
    scheduled.push({ ...stepDef, scheduledAt })
    chainAnchor = new Date(scheduledAt)
  }
  return scheduled
}

/**
 * Enroll a venue contact in the automated follow-up sequence (no email sent here).
 * Returns null when skipped; throws on unexpected DB errors.
 */
export function enrollVenueOutreachSequence({ partnershipContactId, anchorAt, rng = Math.random }) {
  const contact = getPartnershipContactById(partnershipContactId)
  if (!contact) return { skipped: true, reason: 'contact_missing' }

  const active = getActiveOutreachSequenceByContactId(partnershipContactId)
  if (active) return { skipped: true, reason: 'sequence_already_active' }

  const now = new Date().toISOString()
  const anchor = anchorAt || now
  const planned = buildScheduledSends(anchor, rng)

  const sequence = createOutreachSequence({
    partnershipContactId,
    anchorAt: anchor,
    enrolledAt: now,
    status: 'running',
    currentStep: 'follow_up_1',
    createdAt: now,
    updatedAt: now,
  })

  const scheduledSends = planned.map((row) =>
    createOutreachScheduledSend({
      sequenceId: sequence.id,
      partnershipContactId,
      step: row.step,
      templateId: row.templateId,
      scheduledAt: row.scheduledAt,
      status: 'pending',
      sortOrder: row.sortOrder,
      createdAt: now,
      updatedAt: now,
    })
  )

  updatePartnershipContact(partnershipContactId, { sequenceStatus: 'running' })

  const firstLabel = formatNyScheduleLabel(scheduledSends[0].scheduledAt)
  createOutreachActivity({
    partnershipContactId,
    type: 'note',
    body: `Outreach sequence enrolled automatically after Venue First Outreach. Follow-up #1 scheduled for ${firstLabel}. Follow-up #2 and Final Follow-up scheduled in sequence.`,
  })

  return { sequence, scheduledSends }
}

/** Called after manual first outreach send succeeds. */
export function tryEnrollVenueAfterFirstOutreach({ contactId, contact, templateId, anchorAt, rng }) {
  const eligibility = isEligibleForVenueSequenceEnrollment(contact, { templateId })
  if (!eligibility.ok) return { enrolled: false, reason: eligibility.reason }
  const result = enrollVenueOutreachSequence({
    partnershipContactId: contactId,
    anchorAt,
    rng,
  })
  if (result.skipped) return { enrolled: false, reason: result.reason }
  return { enrolled: true, ...result }
}

export function stopSequenceForContact(partnershipContactId, stopReason, { status = 'stopped' } = {}) {
  const sequence = getActiveOutreachSequenceByContactId(partnershipContactId)
  if (!sequence) return null

  const now = new Date().toISOString()
  const cancelled = cancelPendingScheduledSendsForContact(partnershipContactId, now)
  const updated = updateOutreachSequence(sequence.id, {
    status,
    stoppedAt: status === 'stopped' ? now : sequence.stoppedAt,
    stopReason: stopReason || sequence.stopReason,
    pausedAt: null,
    updatedAt: now,
  })

  updatePartnershipContact(partnershipContactId, {
    sequenceStatus: status === 'stopped' ? 'stopped' : status,
  })

  return { sequence: updated, cancelledCount: cancelled }
}

export function handleContactStageChange(partnershipContactId, newStage) {
  if (!OUTREACH_SEQUENCE_STOP_STAGES.has(newStage)) return null
  return stopSequenceForContact(partnershipContactId, `stage_${newStage}`)
}

export function pauseSequence(partnershipContactId) {
  const sequence = getActiveOutreachSequenceByContactId(partnershipContactId)
  if (!sequence || sequence.status !== 'running') return null
  const now = new Date().toISOString()
  const updated = updateOutreachSequence(sequence.id, {
    status: 'paused',
    pausedAt: now,
    updatedAt: now,
  })
  updatePartnershipContact(partnershipContactId, { sequenceStatus: 'paused' })
  return updated
}

export function resumeSequence(partnershipContactId) {
  const sequence = getOutreachSequenceByContactId(partnershipContactId)
  if (!sequence || sequence.status !== 'paused') return null
  const now = new Date().toISOString()
  const updated = updateOutreachSequence(sequence.id, {
    status: 'running',
    pausedAt: null,
    updatedAt: now,
  })
  updatePartnershipContact(partnershipContactId, { sequenceStatus: 'running' })
  return updated
}

export function stopSequence(partnershipContactId, stopReason = 'manual_stop') {
  return stopSequenceForContact(partnershipContactId, stopReason, { status: 'stopped' })
}

/** Cancel the next pending scheduled send and advance currentStep. */
export function skipNextScheduledSend(partnershipContactId) {
  const sequence = getActiveOutreachSequenceByContactId(partnershipContactId)
  if (!sequence) return null

  const sends = listScheduledSendsForSequence(sequence.id)
  const nextPending = sends.find((s) => s.status === 'pending')
  if (!nextPending) return { sequence, skippedSend: null }

  const now = new Date().toISOString()
  const skippedSend = updateOutreachScheduledSend(nextPending.id, {
    status: 'cancelled',
    updatedAt: now,
  })

  const stepOrder = SEQUENCE_STEPS.map((s) => s.step)
  const idx = stepOrder.indexOf(nextPending.step)
  const nextStep = idx >= 0 && idx < stepOrder.length - 1 ? stepOrder[idx + 1] : 'done'

  const updated = updateOutreachSequence(sequence.id, {
    currentStep: nextStep,
    updatedAt: now,
  })

  createOutreachActivity({
    partnershipContactId,
    type: 'note',
    body: `Skipped scheduled ${nextPending.step.replace(/_/g, ' ')}. Sequence advanced to ${nextStep}.`,
  })

  return { sequence: updated, skippedSend }
}

export function getSequenceState(partnershipContactId) {
  const sequence = getOutreachSequenceByContactId(partnershipContactId)
  if (!sequence) return null
  const scheduledSends = listScheduledSendsForSequence(sequence.id)
  return { sequence, scheduledSends }
}

/** Reply detected via IMAP — stop sequence, cancel sends, mark contact replied. */
export function handleReplyDetected({ contactId, inbound, receivedAt }) {
  const now = receivedAt || new Date().toISOString()
  const contact = getPartnershipContactById(contactId)
  if (!contact) return { ok: false, reason: 'contact_missing' }

  const priorStage = contact.stage
  updatePartnershipContact(contactId, { stage: 'replied', sequenceStatus: 'stopped' })

  createOutreachActivity({
    partnershipContactId: contactId,
    type: 'reply',
    subject: inbound.subject,
    body: inbound.snippet || inbound.subject,
  })

  if (priorStage !== 'replied') {
    createOutreachActivity({
      partnershipContactId: contactId,
      type: 'stage_change',
      body: `Stage changed from "${priorStage}" to "replied" (reply detected via ${inbound.matchMethod})`,
    })
  }

  const active = getActiveOutreachSequenceByContactId(contactId)
  let cancelledCount = 0
  if (active) {
    const stopped = stopSequenceForContact(contactId, 'reply_detected', { status: 'stopped' })
    cancelledCount = stopped?.cancelledCount || 0
    updateOutreachSequence(active.id, { lastInboundAt: now, updatedAt: now })
  }

  return { ok: true, contactId, cancelledCount, matchMethod: inbound.matchMethod }
}

/** Hard bounce (IMAP NDR or outbound permanent SMTP failure) — stop sequence and mark undeliverable. */
export function handleHardBounceDetected({
  contactId,
  bounceReason,
  receivedAt,
  source = 'imap',
  subject,
  matchMethod,
  inbound,
}) {
  const now = receivedAt || new Date().toISOString()
  const contact = getPartnershipContactById(contactId)
  if (!contact) return { ok: false, reason: 'contact_missing' }

  const reasonText = String(bounceReason || 'Email delivery failed').slice(0, 500)
  const priorStage = contact.stage

  updatePartnershipContact(contactId, {
    stage: EMAIL_DELIVERY_FAILED_STAGE,
    sequenceStatus: 'stopped',
    doNotContact: true,
  })

  createOutreachActivity({
    partnershipContactId: contactId,
    type: 'note',
    subject: subject || inbound?.subject || 'Email delivery failed',
    body: `Email delivery failed (hard bounce via ${source}${matchMethod ? ` / ${matchMethod}` : ''}): ${reasonText}`,
  })

  if (priorStage !== EMAIL_DELIVERY_FAILED_STAGE) {
    createOutreachActivity({
      partnershipContactId: contactId,
      type: 'stage_change',
      body: `Stage changed from "${priorStage}" to "${EMAIL_DELIVERY_FAILED_STAGE}" (hard bounce detected)`,
    })
  }

  const active = getActiveOutreachSequenceByContactId(contactId)
  let cancelledCount = 0
  if (active) {
    const stopped = stopSequenceForContact(contactId, 'hard_bounce_detected', { status: 'stopped' })
    cancelledCount = stopped?.cancelledCount || 0
    updateOutreachSequence(active.id, { lastInboundAt: now, updatedAt: now })
  }

  return {
    ok: true,
    contactId,
    cancelledCount,
    matchMethod,
    bounceReason: reasonText,
    source,
  }
}
