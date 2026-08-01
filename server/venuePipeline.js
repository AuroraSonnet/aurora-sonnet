/**
 * Shared constants and pure helpers for the Venue relationship pipeline (visit-first workflow).
 * Deliberately separate from email-sequence progress (outreach_sequences/outreach_scheduled_sends)
 * and from relationship-strength / partnership-confidence scores — see docs in the audit plan.
 */

export const VENUE_STAGES = [
  'target',
  'visit_planned',
  'visited',
  'engaged_replied',
  'meeting_scheduled',
  'showcase_scheduled',
  'referral_partner',
  'preferred_partner',
  'not_interested',
  'not_fit_archived',
]

export const VENUE_STAGE_LABELS = {
  target: 'Target',
  visit_planned: 'Visit Planned',
  visited: 'Visited',
  engaged_replied: 'Engaged/Replied',
  meeting_scheduled: 'Meeting Scheduled',
  showcase_scheduled: 'Showcase Scheduled',
  referral_partner: 'Referral Partner',
  preferred_partner: 'Preferred Partner',
  not_interested: 'Not Interested',
  not_fit_archived: 'Not Fit/Archived',
}

/** Relative progress rank — used only to avoid moving a venue "backwards" on automatic stage advance. */
export const VENUE_STAGE_RANK = {
  target: 0,
  visit_planned: 1,
  visited: 2,
  engaged_replied: 3,
  meeting_scheduled: 4,
  showcase_scheduled: 5,
  referral_partner: 6,
  preferred_partner: 7,
  not_interested: -1,
  not_fit_archived: -1,
}

/** Stages where an active automatic follow-up sequence must stop immediately (playbook safety rules). */
export const VENUE_SEQUENCE_STOP_STAGES = new Set([
  'meeting_scheduled',
  'showcase_scheduled',
  'referral_partner',
  'preferred_partner',
  'not_interested',
  'not_fit_archived',
])

export const VENUE_STAGES_CLOSED = new Set(['not_interested', 'not_fit_archived'])

/** Relationship-strength scale (playbook, 1-5) — separate from partnership-confidence. */
export const RELATIONSHIP_STRENGTH_LABELS = {
  1: 'New contact',
  2: 'Friendly',
  3: 'Knows Aurora Sonnet',
  4: 'Refers occasionally',
  5: 'Strong partner',
}
export const RELATIONSHIP_STRENGTH_VALUES = [1, 2, 3, 4, 5]

export const PARTNERSHIP_CONFIDENCE_VALUES = [1, 2, 3, 4, 5]

/** Required multi-select visit outcomes — at least one is mandatory to complete a visit. */
export const VISIT_OUTCOMES = [
  'met_decision_maker',
  'left_presentation_folder',
  'collected_email',
  'collected_business_card',
  'scheduled_showcase',
  'asked_to_email',
  'asked_to_come_back',
  'no_one_available',
  'not_a_fit',
]

export const VISIT_OUTCOME_LABELS = {
  met_decision_maker: 'Met decision maker',
  left_presentation_folder: 'Left presentation folder',
  collected_email: 'Collected email',
  collected_business_card: 'Collected business card',
  scheduled_showcase: 'Scheduled showcase',
  asked_to_email: 'Asked to email',
  asked_to_come_back: 'Asked to come back',
  no_one_available: 'No one available',
  not_a_fit: 'Not a fit',
}

/** Required next action — every completed visit must end with exactly one of these. */
export const VISIT_NEXT_ACTIONS = [
  'send_email_today',
  'call_on_date',
  'return_on_date',
  'invite_to_showcase',
  'connect_linkedin',
  'schedule_meeting',
  'other',
  'no_further_action',
]

export const VISIT_NEXT_ACTION_LABELS = {
  send_email_today: 'Send personalized email today',
  call_on_date: 'Call on a selected date',
  return_on_date: 'Return on a selected date',
  invite_to_showcase: 'Invite to showcase',
  connect_linkedin: 'Connect on LinkedIn',
  schedule_meeting: 'Schedule meeting',
  other: 'Other',
  no_further_action: 'No further action',
}

/** A due date is required for every next action except "No further action". */
export const VISIT_NEXT_ACTIONS_REQUIRING_DUE_DATE = new Set(
  VISIT_NEXT_ACTIONS.filter((a) => a !== 'no_further_action')
)

/** "No further action" must close the venue with one of these statuses + a reason. */
export const VISIT_CLOSED_STATUSES = ['not_interested', 'not_fit_archived']

export const OBJECTION_TAGS = [
  'already_has_musicians',
  'does_not_refer_vendors',
  'asked_to_email',
  'budget_concern',
  'too_busy',
  'not_decision_maker',
  'not_interested',
  'other',
]

export const OBJECTION_TAG_LABELS = {
  already_has_musicians: 'Already has musicians',
  does_not_refer_vendors: 'Does not refer vendors',
  asked_to_email: 'Asked to email',
  budget_concern: 'Budget concern',
  too_busy: 'Too busy',
  not_decision_maker: 'Not the decision maker',
  not_interested: 'Not interested',
  other: 'Other',
}

export const PREFERRED_COMMUNICATION_METHODS = ['email', 'phone', 'text', 'linkedin', 'in_person', 'other']

/**
 * Automatic stage advance after a visit debrief is saved. Never moves a venue "backwards" except
 * into an explicit closed status (not_interested / not_fit_archived), which always wins.
 */
export function deriveStageAdvanceFromDebrief({ currentStage, outcomes = [], nextAction, closedStatus }) {
  if (closedStatus && VISIT_CLOSED_STATUSES.includes(closedStatus)) return closedStatus

  let candidate = 'visited'
  if (Array.isArray(outcomes) && outcomes.includes('scheduled_showcase')) candidate = 'showcase_scheduled'
  else if (nextAction === 'schedule_meeting') candidate = 'meeting_scheduled'

  const currentRank = VENUE_STAGE_RANK[currentStage] ?? 0
  const candidateRank = VENUE_STAGE_RANK[candidate] ?? 0
  if (currentRank < 0) return currentStage // already closed; a new visit shouldn't silently reopen it
  return candidateRank > currentRank ? candidate : currentStage
}

export function isValidVenueStage(stage) {
  return typeof stage === 'string' && VENUE_STAGES.includes(stage)
}
