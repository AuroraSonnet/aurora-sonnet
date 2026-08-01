/**
 * Bridges the new visit-first Venue pipeline to the existing, unmodified, battle-tested
 * cold-outreach sequence engine (outreachSequence.js / outreachScheduler.js / outreachImap.js).
 *
 * Design: every venue that needs an automatic follow-up sequence gets (or reuses) exactly one
 * "shadow" partnership_contacts row. The scheduler/mailer/IMAP code keeps operating on
 * partnershipContactId exactly as it always has — zero changes to that proven code path.
 * outreach_sequences / outreach_scheduled_sends additionally carry sequenceType='post_visit',
 * venueId, and visitId (additive columns) purely for dashboard/scoreboard queries and to let the
 * venue-side UI show sequence state without knowing about the shadow contact.
 */
import { isSendableContactEmail } from './outreachMailer.js'
import { enrollVenueOutreachSequence, stopSequenceForContact } from './outreachSequence.js'
import { VENUE_SEQUENCE_STOP_STAGES } from './venuePipeline.js'
import {
  createPartnershipContact,
  getPartnershipContactById,
  getVenueById,
  getVenueContactById,
  updateOutreachScheduledSend,
  updateOutreachSequence,
  updateVenue,
} from './db.js'

/** Reuse the existing partnership_contacts row if one is already linked; otherwise create it. */
export function ensureShadowPartnershipContactForVenue(venue, contact) {
  if (venue.linkedPartnershipContactId) {
    const existing = getPartnershipContactById(venue.linkedPartnershipContactId)
    if (existing && !existing.deletedAt) return existing
  }
  const email =
    contact?.email && String(contact.email).trim()
      ? String(contact.email).trim()
      : `venue-${venue.id}@partnership.placeholder`
  const newId = createPartnershipContact({
    companyName: venue.companyName,
    email,
    partnerType: venue.partnerType || 'venue',
    contactName: contact?.name || undefined,
    jobTitle: contact?.jobTitle || undefined,
    website: venue.website || undefined,
    city: venue.city || undefined,
    region: venue.regionRaw || undefined,
    // The same-day email is always sent manually before this is ever called (Decision B), so the
    // shadow row's internal email-progress state starts one step in — it is never shown in the UI.
    stage: 'first_email_sent',
    source: 'venue_visit',
    outreachMethod: 'email',
  })
  updateVenue(venue.id, { linkedPartnershipContactId: newId })
  return getPartnershipContactById(newId)
}

/**
 * Called only after the personalized same-day email has been reviewed and manually sent, and the
 * sender explicitly checked "Start automatic follow-up sequence" (playbook requirement).
 */
export function enrollVenuePostVisitSequence({ venueId, visitId, contactId, anchorAt, rng }) {
  const venue = getVenueById(venueId)
  if (!venue || venue.deletedAt) return { enrolled: false, reason: 'venue_missing' }
  if (venue.doNotContact) return { enrolled: false, reason: 'do_not_contact' }
  if (VENUE_SEQUENCE_STOP_STAGES.has(venue.stage)) return { enrolled: false, reason: `stage_${venue.stage}` }

  const contact = contactId ? getVenueContactById(contactId) : null
  const shadow = ensureShadowPartnershipContactForVenue(venue, contact)
  if (!isSendableContactEmail(shadow.email)) return { enrolled: false, reason: 'invalid_email' }

  const result = enrollVenueOutreachSequence({ partnershipContactId: shadow.id, anchorAt, rng })
  if (result.skipped) return { enrolled: false, reason: result.reason }

  const taggedSequence = updateOutreachSequence(result.sequence.id, {
    sequenceType: 'post_visit',
    venueId,
    visitId,
  })
  const taggedSends = result.scheduledSends.map((send) =>
    updateOutreachScheduledSend(send.id, { sequenceType: 'post_visit', venueId, visitId })
  )

  return { enrolled: true, sequence: taggedSequence, scheduledSends: taggedSends }
}

/**
 * Recheck-and-stop hook. Call whenever a venue's stage or doNotContact flag changes. Mirrors
 * handleContactStageChange but keyed by venue (relationship pipeline), not by email stage.
 */
export function syncVenueSequenceStopConditions(venue, reasonOverride) {
  if (!venue || !venue.linkedPartnershipContactId) return null
  const shouldStop = venue.doNotContact || VENUE_SEQUENCE_STOP_STAGES.has(venue.stage)
  if (!shouldStop) return null
  const reason = reasonOverride || (venue.doNotContact ? 'venue_do_not_contact' : `venue_stage_${venue.stage}`)
  return stopSequenceForContact(venue.linkedPartnershipContactId, reason)
}
