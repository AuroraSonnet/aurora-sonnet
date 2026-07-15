import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  isVenueFirstOutreachContact,
  isVenueFollowUp1Contact,
  pickDefaultSendTemplate,
  VENUE_FIRST_OUTREACH_TEMPLATE_ID,
  VENUE_FOLLOW_UP_1_TEMPLATE_ID,
  EMAIL_TEMPLATE_TYPE_FIRST_EMAIL_SENT,
  EMAIL_TEMPLATE_TYPE_FOLLOW_UP_1,
} from '../src/utils/partnershipEmailTemplates.ts'

const venueFirstTemplate = {
  id: VENUE_FIRST_OUTREACH_TEMPLATE_ID,
  name: 'Venue First Outreach',
  subject: 'Live Music Referrals for {{companyName}} Couples',
  body: 'Hi,',
  category: 'Venue Outreach',
  templateType: EMAIL_TEMPLATE_TYPE_FIRST_EMAIL_SENT,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const venueFollowUpTemplate = {
  id: VENUE_FOLLOW_UP_1_TEMPLATE_ID,
  name: 'Venue Follow-up #1',
  subject: 'Following up regarding a venue partnership',
  body: 'Hi,',
  category: 'Venue Outreach',
  templateType: EMAIL_TEMPLATE_TYPE_FOLLOW_UP_1,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const allTemplates = [venueFirstTemplate, venueFollowUpTemplate]

const venueContact = {
  id: 'poc-1',
  companyName: 'The Plaza',
  email: 'hello@plaza.com',
  partnerType: 'venue',
  stage: 'not_contacted',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

test('venue in not_contacted is eligible for first outreach template', () => {
  assert.equal(isVenueFirstOutreachContact(venueContact), true)
})

test('venue in first_email_sent is eligible for first outreach template', () => {
  assert.equal(
    isVenueFirstOutreachContact({ ...venueContact, stage: 'first_email_sent' }),
    true
  )
})

test('venue in follow_up_1 is eligible for follow-up #1 template', () => {
  assert.equal(
    isVenueFollowUp1Contact({ ...venueContact, stage: 'follow_up_1' }),
    true
  )
})

test('planner is not eligible for venue first outreach template', () => {
  assert.equal(
    isVenueFirstOutreachContact({ ...venueContact, partnerType: 'planner' }),
    false
  )
})

test('venue in follow_up_1 is not eligible for first outreach template', () => {
  assert.equal(
    isVenueFirstOutreachContact({ ...venueContact, stage: 'follow_up_1' }),
    false
  )
})

test('pickDefaultSendTemplate returns venue first outreach for not_contacted', () => {
  const picked = pickDefaultSendTemplate(venueContact, allTemplates)
  assert.equal(picked?.id, VENUE_FIRST_OUTREACH_TEMPLATE_ID)
})

test('pickDefaultSendTemplate returns venue follow-up #1 for follow_up_1 stage', () => {
  const picked = pickDefaultSendTemplate(
    { ...venueContact, stage: 'follow_up_1' },
    allTemplates
  )
  assert.equal(picked?.id, VENUE_FOLLOW_UP_1_TEMPLATE_ID)
  assert.equal(picked?.name, 'Venue Follow-up #1')
})

test('pickDefaultSendTemplate does not suggest first outreach for follow_up_1', () => {
  const picked = pickDefaultSendTemplate(
    { ...venueContact, stage: 'follow_up_1' },
    [venueFirstTemplate]
  )
  assert.equal(picked, undefined)
})

test('pickDefaultSendTemplate returns undefined for non-venue', () => {
  const picked = pickDefaultSendTemplate(
    { ...venueContact, partnerType: 'hotel' },
    allTemplates
  )
  assert.equal(picked, undefined)
})

test('pickDefaultSendTemplate falls back to templateType match for first email', () => {
  const alt = {
    ...venueFirstTemplate,
    id: 'tpl-custom-99',
    name: 'Custom First Email',
  }
  const picked = pickDefaultSendTemplate(venueContact, [alt])
  assert.equal(picked?.id, 'tpl-custom-99')
})

test('pickDefaultSendTemplate falls back to templateType match for follow-up #1', () => {
  const alt = {
    ...venueFollowUpTemplate,
    id: 'tpl-custom-follow-1',
    name: 'Custom Follow-up',
  }
  const picked = pickDefaultSendTemplate(
    { ...venueContact, stage: 'follow_up_1' },
    [alt]
  )
  assert.equal(picked?.id, 'tpl-custom-follow-1')
})
