import type { EmailTemplate, PartnershipContact } from '../api/db'

export const VENUE_FIRST_OUTREACH_TEMPLATE_ID = 'tpl-venue-first-outreach'
export const VENUE_FOLLOW_UP_1_TEMPLATE_ID = 'tpl-venue-follow-up-1'

export const EMAIL_TEMPLATE_TYPE_FIRST_EMAIL_SENT = 'first_email_sent'
export const EMAIL_TEMPLATE_TYPE_FOLLOW_UP_1 = 'follow_up_1'

const FIRST_OUTREACH_STAGES = new Set(['not_contacted', 'first_email_sent'])
const FOLLOW_UP_1_STAGE = 'follow_up_1'

const DEFAULT_TEMPLATE_ID_BY_TYPE: Record<string, string> = {
  [EMAIL_TEMPLATE_TYPE_FIRST_EMAIL_SENT]: VENUE_FIRST_OUTREACH_TEMPLATE_ID,
  [EMAIL_TEMPLATE_TYPE_FOLLOW_UP_1]: VENUE_FOLLOW_UP_1_TEMPLATE_ID,
}

const TEMPLATE_TYPE_LABELS: Record<string, string> = {
  [EMAIL_TEMPLATE_TYPE_FIRST_EMAIL_SENT]: 'First Email Sent',
  [EMAIL_TEMPLATE_TYPE_FOLLOW_UP_1]: 'Follow-up #1',
}

function templateTypeForVenueStage(stage: string): string | undefined {
  if (FIRST_OUTREACH_STAGES.has(stage)) return EMAIL_TEMPLATE_TYPE_FIRST_EMAIL_SENT
  if (stage === FOLLOW_UP_1_STAGE) return EMAIL_TEMPLATE_TYPE_FOLLOW_UP_1
  return undefined
}

/** Venue contacts eligible for the default first-outreach template suggestion. */
export function isVenueFirstOutreachContact(contact: PartnershipContact): boolean {
  if (contact.partnerType !== 'venue') return false
  return FIRST_OUTREACH_STAGES.has(contact.stage)
}

/** Venue contacts eligible for the default follow-up #1 template suggestion. */
export function isVenueFollowUp1Contact(contact: PartnershipContact): boolean {
  if (contact.partnerType !== 'venue') return false
  return contact.stage === FOLLOW_UP_1_STAGE
}

/** Default template for venue outreach — does not send email, only suggests in the UI. */
export function pickDefaultSendTemplate(
  contact: PartnershipContact,
  templates: EmailTemplate[]
): EmailTemplate | undefined {
  if (contact.partnerType !== 'venue') return undefined

  const templateType = templateTypeForVenueStage(contact.stage)
  if (!templateType) return undefined

  const preferredId = DEFAULT_TEMPLATE_ID_BY_TYPE[templateType]
  const byId = templates.find((t) => t.id === preferredId)
  if (byId) return byId

  return templates.find((t) => t.templateType === templateType)
}

export function templateTypeLabel(templateType?: string): string | undefined {
  if (!templateType) return undefined
  return TEMPLATE_TYPE_LABELS[templateType] ?? templateType.replace(/_/g, ' ')
}
