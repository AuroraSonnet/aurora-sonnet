/**
 * Shared email signature and helpers for Aurora Sonnet emails.
 * Used in Proposals, Bookings inquiry reply, Client detail reply, and Newsletter.
 */

export const EMAIL_SIGNATURE = `Best,

Lisa Dubocquet
Aurora Sonnet LLC
aurorasonnet.com`

/** Appends the standard signature to the body if not already present. */
export function appendSignature(body: string): string {
  const trimmed = (body || '').trim()
  if (trimmed.includes('Lisa Dubocquet')) return trimmed
  return trimmed ? `${trimmed}\n\n${EMAIL_SIGNATURE}` : EMAIL_SIGNATURE
}

/** Default inquiry reply body (luxury tone) with signature. Use for Bookings and Client reply. */
export function getInquiryReplyBody(firstName: string, notes?: string): string {
  const name = firstName.trim() || '[Name]'
  const message = notes?.trim()
    ? `Dear ${name},\n\nThank you for your inquiry. We have received your message and will be in touch shortly.\n\nYou wrote:\n${notes}`
    : `Dear ${name},\n\nThank you for your inquiry. We have received your message and will be in touch shortly.`
  return appendSignature(message)
}
