/**
 * Frontend mirror of server/venuePipeline.js constants (labels only — validation lives server-side).
 * Kept in sync manually since the frontend build does not include server/ code.
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
] as const

export type VenueStage = (typeof VENUE_STAGES)[number]

export const VENUE_STAGE_LABELS: Record<string, string> = {
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

export const VENUE_STAGES_CLOSED: Set<string> = new Set(['not_interested', 'not_fit_archived'])

export const RELATIONSHIP_STRENGTH_LABELS: Record<number, string> = {
  1: 'New contact',
  2: 'Friendly',
  3: 'Knows Aurora Sonnet',
  4: 'Refers occasionally',
  5: 'Strong partner',
}
export const RELATIONSHIP_STRENGTH_VALUES = [1, 2, 3, 4, 5]

export const PARTNERSHIP_CONFIDENCE_VALUES = [1, 2, 3, 4, 5]
export const PARTNERSHIP_CONFIDENCE_LABELS: Record<number, string> = {
  1: 'Very unlikely to refer',
  2: 'Unlikely',
  3: 'Possible',
  4: 'Likely',
  5: 'Very likely to refer',
}

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
] as const

export const VISIT_OUTCOME_LABELS: Record<string, string> = {
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

export const VISIT_NEXT_ACTIONS = [
  'send_email_today',
  'call_on_date',
  'return_on_date',
  'invite_to_showcase',
  'connect_linkedin',
  'schedule_meeting',
  'other',
  'no_further_action',
] as const

export const VISIT_NEXT_ACTION_LABELS: Record<string, string> = {
  send_email_today: 'Send personalized email today',
  call_on_date: 'Call on a selected date',
  return_on_date: 'Return on a selected date',
  invite_to_showcase: 'Invite to showcase',
  connect_linkedin: 'Connect on LinkedIn',
  schedule_meeting: 'Schedule meeting',
  other: 'Other',
  no_further_action: 'No further action',
}

export const VISIT_NEXT_ACTIONS_REQUIRING_DUE_DATE: Set<string> = new Set(
  VISIT_NEXT_ACTIONS.filter((a) => a !== 'no_further_action')
)

export const VISIT_CLOSED_STATUSES = ['not_interested', 'not_fit_archived']
export const VISIT_CLOSED_STATUS_LABELS: Record<string, string> = {
  not_interested: 'Not interested',
  not_fit_archived: 'Not a fit / archived',
}

export const OBJECTION_TAGS = [
  'already_has_musicians',
  'does_not_refer_vendors',
  'asked_to_email',
  'budget_concern',
  'too_busy',
  'not_decision_maker',
  'not_interested',
  'other',
] as const

export const OBJECTION_TAG_LABELS: Record<string, string> = {
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
export const PREFERRED_COMMUNICATION_METHOD_LABELS: Record<string, string> = {
  email: 'Email',
  phone: 'Phone',
  text: 'Text',
  linkedin: 'LinkedIn',
  in_person: 'In person',
  other: 'Other',
}

export function venueStageLabel(stage?: string): string {
  if (!stage) return '—'
  return VENUE_STAGE_LABELS[stage] ?? stage
}
