export type PipelineMode = 'email' | 'website_contact_form'

/** Email pipeline stage ids — kept in sync with PartnershipOutreach.tsx EMAIL_STAGES. */
export const EMAIL_STAGE_IDS = [
  'not_contacted',
  'first_email_sent',
  'follow_up_1',
  'follow_up_2',
  'follow_up_3',
  'replied',
  'meeting_scheduled',
  'partner',
  'not_interested',
  'archived_no_response',
] as const

/** Form pipeline stage ids — kept in sync with partnershipImport.ts FORM_CONTACT_STAGES. */
export const FORM_STAGE_IDS = [
  'form_to_contact',
  'form_submitted',
  'form_follow_up_1',
  'form_follow_up_2',
  'form_follow_up_3',
  'form_replied',
  'form_meeting_scheduled',
  'form_partner',
  'form_not_interested',
  'form_archived_no_response',
] as const

const EMAIL_STAGE_SET = new Set<string>(EMAIL_STAGE_IDS)
const FORM_STAGE_SET = new Set<string>(FORM_STAGE_IDS)

export function activeStageIdsForPipeline(pipelineMode: PipelineMode): Set<string> {
  return pipelineMode === 'website_contact_form' ? FORM_STAGE_SET : EMAIL_STAGE_SET
}

export function validateKanbanStageMove(input: {
  pipelineMode: PipelineMode
  isFormContact: boolean
  fromStage: string
  toStage: string
}): { ok: true } | { ok: false; error: string } {
  const { pipelineMode, isFormContact, fromStage, toStage } = input
  if (fromStage === toStage) return { ok: false, error: 'Contact is already in this stage.' }

  const pipelineIsForm = pipelineMode === 'website_contact_form'
  if (isFormContact !== pipelineIsForm) {
    return {
      ok: false,
      error: 'Cannot move contacts between Email Outreach and Website Contact Form pipelines.',
    }
  }

  const active = activeStageIdsForPipeline(pipelineMode)
  if (!active.has(toStage)) {
    return { ok: false, error: 'That stage is not available in the current pipeline.' }
  }

  if (pipelineIsForm && !FORM_STAGE_SET.has(toStage)) {
    return { ok: false, error: 'Cannot move a form contact to an email pipeline stage.' }
  }
  if (!pipelineIsForm && !EMAIL_STAGE_SET.has(toStage)) {
    return { ok: false, error: 'Cannot move an email contact to a website form pipeline stage.' }
  }

  return { ok: true }
}

export function applyStageOverride(
  overrides: Record<string, string>,
  contactId: string,
  stage: string
): Record<string, string> {
  return { ...overrides, [contactId]: stage }
}

export function clearStageOverride(
  overrides: Record<string, string>,
  contactId: string
): Record<string, string> {
  const next = { ...overrides }
  delete next[contactId]
  return next
}

export type StageUpdateResult = { ok: true } | { ok: false; error: string }

/** Optimistic kanban move with rollback when the API update fails. */
export async function performKanbanStageMove(input: {
  contactId: string
  fromStage: string
  toStage: string
  pipelineMode: PipelineMode
  isFormContact: boolean
  stageOverrides: Record<string, string>
  updateStage: (contactId: string, stage: string) => Promise<StageUpdateResult>
  refreshState: () => Promise<void>
}): Promise<{ stageOverrides: Record<string, string>; error: string | null }> {
  const validation = validateKanbanStageMove({
    pipelineMode: input.pipelineMode,
    isFormContact: input.isFormContact,
    fromStage: input.fromStage,
    toStage: input.toStage,
  })
  if (!validation.ok) {
    return { stageOverrides: input.stageOverrides, error: validation.error }
  }

  let stageOverrides = applyStageOverride(input.stageOverrides, input.contactId, input.toStage)

  const result = await input.updateStage(input.contactId, input.toStage)
  if (!result.ok) {
    return {
      stageOverrides: clearStageOverride(stageOverrides, input.contactId),
      error: result.error,
    }
  }

  await input.refreshState()
  stageOverrides = clearStageOverride(stageOverrides, input.contactId)
  return { stageOverrides, error: null }
}
