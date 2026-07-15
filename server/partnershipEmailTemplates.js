/** Default Partnership Outreach email templates — seeded once, never overwritten. */

export const VENUE_FIRST_OUTREACH_TEMPLATE_ID = 'tpl-venue-first-outreach'
export const VENUE_FOLLOW_UP_1_TEMPLATE_ID = 'tpl-venue-follow-up-1'
export const VENUE_FOLLOW_UP_2_TEMPLATE_ID = 'tpl-venue-follow-up-2'

export const EMAIL_TEMPLATE_TYPE_FIRST_EMAIL_SENT = 'first_email_sent'
export const EMAIL_TEMPLATE_TYPE_FOLLOW_UP_1 = 'follow_up_1'
export const EMAIL_TEMPLATE_TYPE_FOLLOW_UP_2 = 'follow_up_2'

const VENUE_FIRST_OUTREACH_SUBJECT = 'Live Music Referrals for {{companyName}} Couples'

const VENUE_FIRST_OUTREACH_BODY = `Hi,

I run Aurora Sonnet, a small collective of professional singers offering acoustic duos and opera vocalists for New York weddings.

We'd love to become a trusted live music option your team can recommend to your couples, and we're open to discussing a referral or partnership structure that makes sense for your venue.

The easiest way to get a feel for us is in person. I'd be happy to arrange a live performance for your team, no obligation. You can also view our artists here:

https://aurorasonnet.com/our-artists

If you're not the right person for this, I'd really appreciate being pointed to whoever handles wedding partnerships or music.

Warmly,

Lisa Dubocquet
Aurora Sonnet LLC
aurorasonnet.com`

const VENUE_FOLLOW_UP_1_SUBJECT = 'Following up regarding a venue partnership'

const VENUE_FOLLOW_UP_1_BODY = `Hi,

I wasn't sure if you received my previous email, so I wanted to follow up. I'm hoping to connect with the person responsible for wedding partnerships or preferred vendors at {{companyName}}.

Aurora Sonnet is a New York collective of wedding singers specializing in the more intimate moments of a wedding, from the ceremony and cocktail hour to select dinner moments. We'd love the opportunity to become a trusted live music recommendation for your couples and explore a partnership or referral arrangement that creates value for both your venue and your couples.

If there's someone else I should reach out to, I'd really appreciate being pointed in the right direction.

Warmly,

Lisa Dubocquet
Aurora Sonnet LLC
aurorasonnet.com`

const VENUE_FOLLOW_UP_2_SUBJECT = 'Following up'

const VENUE_FOLLOW_UP_2_BODY = `Hi,

I just wanted to follow up one more time in case you missed my previous emails. If you'd be open to exploring a partnership where Aurora Sonnet could become a trusted live music recommendation for your couples, I'd love to connect. If it's easier, I'm also happy to chat by phone or text at (646) 596-4747.

Warmly,

Lisa Dubocquet
Aurora Sonnet LLC
aurorasonnet.com`

export const DEFAULT_PARTNERSHIP_EMAIL_TEMPLATES = [
  {
    id: VENUE_FIRST_OUTREACH_TEMPLATE_ID,
    name: 'Venue First Outreach',
    subject: VENUE_FIRST_OUTREACH_SUBJECT,
    body: VENUE_FIRST_OUTREACH_BODY,
    category: 'Venue Outreach',
    templateType: EMAIL_TEMPLATE_TYPE_FIRST_EMAIL_SENT,
  },
  {
    id: VENUE_FOLLOW_UP_1_TEMPLATE_ID,
    name: 'Venue Follow-up #1',
    subject: VENUE_FOLLOW_UP_1_SUBJECT,
    body: VENUE_FOLLOW_UP_1_BODY,
    category: 'Venue Outreach',
    templateType: EMAIL_TEMPLATE_TYPE_FOLLOW_UP_1,
  },
  {
    id: VENUE_FOLLOW_UP_2_TEMPLATE_ID,
    name: 'Venue Follow-up #2',
    subject: VENUE_FOLLOW_UP_2_SUBJECT,
    body: VENUE_FOLLOW_UP_2_BODY,
    category: 'Venue Outreach',
    templateType: EMAIL_TEMPLATE_TYPE_FOLLOW_UP_2,
  },
]

/** Insert default templates only when their fixed id is missing (idempotent). */
export function ensureDefaultPartnershipEmailTemplates(db, createEmailTemplate) {
  for (const tpl of DEFAULT_PARTNERSHIP_EMAIL_TEMPLATES) {
    const existing = db.prepare('SELECT id FROM email_templates WHERE id = ?').get(tpl.id)
    if (existing) continue
    createEmailTemplate(tpl)
  }
}
