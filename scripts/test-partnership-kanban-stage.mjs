import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  validateKanbanStageMove,
  performKanbanStageMove,
  applyStageOverride,
  clearStageOverride,
} from '../src/utils/partnershipKanbanStage.ts'

test('email pipeline allows moves across several stages', () => {
  const stages = [
    'not_contacted',
    'first_email_sent',
    'follow_up_1',
    'follow_up_2',
    'replied',
    'meeting_scheduled',
  ]
  for (let i = 1; i < stages.length; i += 1) {
    const result = validateKanbanStageMove({
      pipelineMode: 'email',
      isFormContact: false,
      fromStage: stages[i - 1],
      toStage: stages[i],
    })
    assert.equal(result.ok, true, `${stages[i - 1]} → ${stages[i]}`)
  }
})

test('form pipeline allows moves across several stages', () => {
  const stages = [
    'form_to_contact',
    'form_submitted',
    'form_follow_up_1',
    'form_follow_up_2',
    'form_replied',
    'form_partner',
  ]
  for (let i = 1; i < stages.length; i += 1) {
    const result = validateKanbanStageMove({
      pipelineMode: 'website_contact_form',
      isFormContact: true,
      fromStage: stages[i - 1],
      toStage: stages[i],
    })
    assert.equal(result.ok, true, `${stages[i - 1]} → ${stages[i]}`)
  }
})

test('blocks cross-pipeline stage targets', () => {
  const emailToForm = validateKanbanStageMove({
    pipelineMode: 'email',
    isFormContact: false,
    fromStage: 'not_contacted',
    toStage: 'form_submitted',
  })
  assert.equal(emailToForm.ok, false)

  const formToEmail = validateKanbanStageMove({
    pipelineMode: 'website_contact_form',
    isFormContact: true,
    fromStage: 'form_to_contact',
    toStage: 'first_email_sent',
  })
  assert.equal(formToEmail.ok, false)
})

test('blocks contact shown in wrong pipeline mode', () => {
  const result = validateKanbanStageMove({
    pipelineMode: 'email',
    isFormContact: true,
    fromStage: 'form_to_contact',
    toStage: 'first_email_sent',
  })
  assert.equal(result.ok, false)
})

test('performKanbanStageMove rolls back override on API failure', async () => {
  const result = await performKanbanStageMove({
    contactId: 'poc-1',
    fromStage: 'not_contacted',
    toStage: 'follow_up_1',
    pipelineMode: 'email',
    isFormContact: false,
    stageOverrides: {},
    updateStage: async () => ({ ok: false, error: 'Simulated network error' }),
    refreshState: async () => {},
  })

  assert.equal(result.error, 'Simulated network error')
  assert.deepEqual(result.stageOverrides, {})
})

test('performKanbanStageMove clears override after successful API update', async () => {
  const calls = []
  const result = await performKanbanStageMove({
    contactId: 'poc-2',
    fromStage: 'not_contacted',
    toStage: 'first_email_sent',
    pipelineMode: 'email',
    isFormContact: false,
    stageOverrides: {},
    updateStage: async (id, stage) => {
      calls.push({ id, stage })
      return { ok: true }
    },
    refreshState: async () => {
      calls.push({ refresh: true })
    },
  })

  assert.equal(result.error, null)
  assert.deepEqual(result.stageOverrides, {})
  assert.deepEqual(calls, [
    { id: 'poc-2', stage: 'first_email_sent' },
    { refresh: true },
  ])
})

test('override helpers add and remove contact stage', () => {
  let overrides = applyStageOverride({}, 'a', 'replied')
  overrides = applyStageOverride(overrides, 'b', 'partner')
  assert.deepEqual(overrides, { a: 'replied', b: 'partner' })
  overrides = clearStageOverride(overrides, 'a')
  assert.deepEqual(overrides, { b: 'partner' })
})
