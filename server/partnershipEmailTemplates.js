/** Default Partnership Outreach email templates — seeded once, never overwritten. */

export const VENUE_FIRST_OUTREACH_TEMPLATE_ID = 'tpl-venue-first-outreach'
export const VENUE_FOLLOW_UP_1_TEMPLATE_ID = 'tpl-venue-follow-up-1'
export const VENUE_FOLLOW_UP_2_TEMPLATE_ID = 'tpl-venue-follow-up-2'
export const VENUE_FINAL_FOLLOW_UP_TEMPLATE_ID = 'tpl-venue-final-follow-up'
export const VENUE_POST_VISIT_SAME_DAY_TEMPLATE_ID = 'tpl-venue-post-visit-same-day'

export const EMAIL_TEMPLATE_TYPE_FIRST_EMAIL_SENT = 'first_email_sent'
export const EMAIL_TEMPLATE_TYPE_FOLLOW_UP_1 = 'follow_up_1'
export const EMAIL_TEMPLATE_TYPE_FOLLOW_UP_2 = 'follow_up_2'
export const EMAIL_TEMPLATE_TYPE_FOLLOW_UP_3 = 'follow_up_3'
export const EMAIL_TEMPLATE_TYPE_POST_VISIT_SAME_DAY = 'post_visit_same_day'

const VENUE_FIRST_OUTREACH_SUBJECT = 'Live Music Referrals for {{companyName}} Couples'

const VENUE_FIRST_OUTREACH_BODY = `Hi,

I'm the founder of Aurora Sonnet, a New York collective of professional wedding singers offering refined acoustic duos and opera vocalists for ceremonies, cocktail hours, and select dinner moments.

We'd love to become a trusted live music recommendation for your couples and explore a referral or partnership arrangement that creates value for both your venue and your clients.

I'd be happy to arrange a complimentary live performance for your team, with no obligation. You can also view our artists here:

https://aurorasonnet.com/our-artists

If someone else oversees wedding partnerships or preferred vendors, I'd be grateful if you could point me in the right direction.

Warmly,

Lisa Dubocquet
Aurora Sonnet LLC
aurorasonnet.com`

const VENUE_FOLLOW_UP_1_SUBJECT = 'Following up regarding a venue partnership'

const VENUE_FOLLOW_UP_1_BODY = `Hi,

I sent you an email recently regarding a possible partnership with Aurora Sonnet. I just wanted to check that you received it.

Would you be open to discussing it?

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

const VENUE_FINAL_FOLLOW_UP_SUBJECT = 'Just checking in one last time'

const VENUE_FINAL_FOLLOW_UP_BODY = `Hi,

I know you're incredibly busy, so I wanted to send one final follow-up. If partnering with Aurora Sonnet is something your team would like to explore, I'd be delighted to connect whenever the timing is right. If it's easier, you're also welcome to call or text me at (646) 596-4747.

Warmly,

Lisa Dubocquet
Aurora Sonnet LLC
aurorasonnet.com`

const VENUE_POST_VISIT_SAME_DAY_SUBJECT = 'Great meeting you today — Aurora Sonnet'

// Starting-point default only (Decision B). This must always be customized to reference something
// specific from the actual visit before it is reviewed and manually sent — the app never sends this
// automatically. Bracketed placeholders mark what to personalize every time.
const VENUE_POST_VISIT_SAME_DAY_BODY = `Hi {{firstName}},

It was such a pleasure meeting you today at {{companyName}}. [Reference something specific from our conversation — e.g. what you shared about your couples, the space, or your team.]

Thank you again for your time. I think Aurora Sonnet's intimate, refined live-music offering could be a wonderful fit for your couples, especially [restate the relevant partnership fit in one sentence].

As we discussed, [confirm the agreed next step]. [Optional: I'd also love to offer a complimentary short demo performance for your team, whenever it's convenient.]

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
  {
    id: VENUE_FINAL_FOLLOW_UP_TEMPLATE_ID,
    name: 'Venue Final Follow-up',
    subject: VENUE_FINAL_FOLLOW_UP_SUBJECT,
    body: VENUE_FINAL_FOLLOW_UP_BODY,
    category: 'Venue Outreach',
    templateType: EMAIL_TEMPLATE_TYPE_FOLLOW_UP_3,
  },
  {
    id: VENUE_POST_VISIT_SAME_DAY_TEMPLATE_ID,
    name: 'Venue Post-Visit Same-Day Email',
    subject: VENUE_POST_VISIT_SAME_DAY_SUBJECT,
    body: VENUE_POST_VISIT_SAME_DAY_BODY,
    category: 'Venue Outreach',
    templateType: EMAIL_TEMPLATE_TYPE_POST_VISIT_SAME_DAY,
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

/**
 * One-time body refresh for existing installs — updates tpl-venue-first-outreach only.
 * Idempotent: no-op when the row is missing or already matches the canonical seed body.
 */
export function migrateVenueFirstOutreachTemplateBody(db) {
  const existing = db
    .prepare('SELECT id, body FROM email_templates WHERE id = ?')
    .get(VENUE_FIRST_OUTREACH_TEMPLATE_ID)
  if (!existing || existing.body === VENUE_FIRST_OUTREACH_BODY) return

  db.prepare('UPDATE email_templates SET body = ?, updatedAt = ? WHERE id = ?').run(
    VENUE_FIRST_OUTREACH_BODY,
    new Date().toISOString(),
    VENUE_FIRST_OUTREACH_TEMPLATE_ID
  )
}

/**
 * One-time body refresh for existing installs — updates tpl-venue-follow-up-1 only.
 * Idempotent: no-op when the row is missing or already matches the canonical seed body.
 */
export function migrateVenueFollowUp1TemplateBody(db) {
  const existing = db
    .prepare('SELECT id, body FROM email_templates WHERE id = ?')
    .get(VENUE_FOLLOW_UP_1_TEMPLATE_ID)
  if (!existing || existing.body === VENUE_FOLLOW_UP_1_BODY) return

  db.prepare('UPDATE email_templates SET body = ?, updatedAt = ? WHERE id = ?').run(
    VENUE_FOLLOW_UP_1_BODY,
    new Date().toISOString(),
    VENUE_FOLLOW_UP_1_TEMPLATE_ID
  )
}
