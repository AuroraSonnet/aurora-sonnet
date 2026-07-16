/** Merge partnership outreach template tags (mirrors PartnershipOutreach.tsx). */

const PARTNER_TYPE_LABELS = {
  venue: 'Venue',
  planner: 'Wedding planner',
  photographer: 'Photographer',
  hotel: 'Hotel',
  private_club: 'Private club',
  florist: 'Florist',
  other: 'Other',
}

export function mergePartnershipTemplateText(text, contact) {
  const firstName = (contact.contactName || '').trim().split(/\s+/)[0] || 'there'
  const values = {
    companyName: contact.companyName || '',
    contactName: contact.contactName || 'there',
    firstName,
    jobTitle: contact.jobTitle || '',
    city: contact.city || '',
    region: contact.region || '',
    partnerType: contact.partnerType
      ? PARTNER_TYPE_LABELS[contact.partnerType] || contact.partnerType
      : '',
  }
  return String(text || '').replace(/\{\{(\w+)\}\}/g, (match, key) =>
    key in values ? values[key] : match
  )
}
