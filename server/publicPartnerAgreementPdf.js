/**
 * PDF for the public Partner Referral Agreement (partner signature only).
 * This is the standard form partners e-sign. It is not the venue CRM template.
 */
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { PUBLIC_PARTNER_AGREEMENT_VERSION } from './referralPartnershipTerms.js'

const AGREEMENT_PARAGRAPHS = [
  'AURORA SONNET LLC',
  'PARTNER REFERRAL AGREEMENT',
  'This Partner Referral Agreement ("Agreement") is between Aurora Sonnet LLC ("Aurora Sonnet") and the undersigned referral partner ("Partner").',
  '1. PURPOSE',
  'Partner may refer prospective clients to Aurora Sonnet for live music and performance services in exchange for the referral fees described below. Aurora Sonnet communicates and contracts directly with referred clients.',
  '2. REFERRALS & ATTRIBUTION',
  "Referrals must be submitted through Aurora Sonnet's referral system or another approved method. Referrals are attributed to Partner for 12 months from submission. A referral is eligible only if the client has not already contacted or been referred to Aurora Sonnet. In the case of duplicate referrals, the first valid referral received will receive attribution.",
  '3. REFERRAL FEES',
  'Aurora Sonnet will pay Partner 10% of the amount received for artist and performance services from an eligible referral, excluding taxes, travel, lodging, rentals, gratuities, payment processing fees, refunds, and other third-party expenses. Referral fees are paid within 30 days after the event takes place and the client has paid in full. No fee is earned on cancelled or fully refunded bookings. A W-9 may be required before payment.',
  '4. INDEPENDENT RELATIONSHIP',
  'This Agreement is non-exclusive and there is no minimum referral requirement. Nothing in this Agreement creates an employment, agency, joint venture, or legal partnership between the parties. Partner may not enter into agreements or make commitments on Aurora Sonnet\'s behalf.',
  '5. BRAND & MARKETING',
  "Partner may recommend Aurora Sonnet and use marketing materials provided or approved by Aurora Sonnet. Aurora Sonnet's name, logo, images, or other materials may not be materially altered without approval.",
  '6. CLIENT INFORMATION',
  "Partner confirms that it has permission or another lawful basis to share referred clients' contact information with Aurora Sonnet. Both parties will reasonably protect non-public client and business information received through the referral relationship.",
  '7. NO GUARANTEE',
  'Aurora Sonnet does not guarantee that a referred client will book, that a particular artist will be available, or that Partner will earn any minimum amount of referral fees.',
  '8. TERM & TERMINATION',
  'This Agreement remains in effect until terminated by either party by written notice. Termination does not affect eligible referrals submitted before termination, which remain attributed to Partner for the applicable 12-month attribution period.',
  '9. GENERAL',
  'This Agreement is governed by New York law and constitutes the entire agreement between Aurora Sonnet and Partner regarding the referral relationship. Changes must be agreed to in writing.',
  '10. ELECTRONIC SIGNATURE',
  'By electronically signing below, Partner agrees to this Agreement. Electronic signatures have the same effect as handwritten signatures.',
]

function wrapParagraph(text, font, fontSize, maxWidth) {
  const words = String(text).split(/\s+/).filter(Boolean)
  if (!words.length) return ['']
  const lines = []
  let line = ''
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word
    if (font.widthOfTextAtSize(candidate, fontSize) > maxWidth && line) {
      lines.push(line)
      line = word
    } else {
      line = candidate
    }
  }
  if (line) lines.push(line)
  return lines
}

export function decodeSignatureImage(input) {
  const raw = String(input || '').trim()
  if (!raw) return null
  const dataUrl = raw.match(/^data:(image\/(?:png|jpeg|jpg));base64,([A-Za-z0-9+/=\s]+)$/i)
  let mime = 'image/png'
  let b64 = raw.replace(/\s/g, '')
  if (dataUrl) {
    mime = dataUrl[1].toLowerCase() === 'image/jpg' ? 'image/jpeg' : dataUrl[1].toLowerCase()
    b64 = dataUrl[2].replace(/\s/g, '')
  }
  if (!/^[A-Za-z0-9+/]+=*$/.test(b64)) return null
  const buffer = Buffer.from(b64, 'base64')
  if (!buffer.length || buffer.length > 1_500_000) return null
  if (mime === 'image/png' && buffer.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') return null
  if (mime === 'image/jpeg' && !(buffer[0] === 0xff && buffer[1] === 0xd8)) return null
  return { mime, buffer }
}

export function publicPartnerAgreementHtml({ partnerName, companyName, signedDate, version = PUBLIC_PARTNER_AGREEMENT_VERSION }) {
  const body = AGREEMENT_PARAGRAPHS.map((p) => `<p>${p}</p>`).join('\n')
  return `<article data-agreement-version="${version}">
${body}
<p>PARTNER</p>
<p>Full Legal Name: ${partnerName || ''}</p>
<p>Business / Company: ${companyName || ''}</p>
<p>Signature: ${signedDate ? 'Electronically signed' : ''}</p>
<p>Date: ${signedDate || ''}</p>
</article>`
}

/**
 * @param {{ partnerName: string, companyName: string, signedDate?: string|null, signature?: { mime: string, buffer: Buffer }|null }} fields
 */
export async function renderPublicPartnerAgreementPdf(fields) {
  const pdf = await PDFDocument.create()
  const regular = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const pageWidth = 612
  const pageHeight = 792
  const margin = 54
  const maxWidth = pageWidth - margin * 2
  let page = pdf.addPage([pageWidth, pageHeight])
  let y = pageHeight - margin

  const newPageIfNeeded = (needed) => {
    if (y - needed < margin) {
      page = pdf.addPage([pageWidth, pageHeight])
      y = pageHeight - margin
    }
  }

  const drawLines = (text, { heading = false } = {}) => {
    const size = heading ? 11 : 10
    const font = heading ? bold : regular
    const lines = wrapParagraph(text, font, size, maxWidth)
    for (const line of lines) {
      newPageIfNeeded(16)
      page.drawText(line, { x: margin, y: y - 12, size, font, color: rgb(0.1, 0.08, 0.07) })
      y -= heading ? 16 : 14
    }
    y -= heading ? 6 : 8
  }

  AGREEMENT_PARAGRAPHS.forEach((paragraph, index) => {
    drawLines(paragraph, { heading: index < 2 || /^\d+\.\s/.test(paragraph) })
  })

  drawLines('PARTNER', { heading: true })
  drawLines(`Full Legal Name: ${fields.partnerName || ''}`)
  drawLines(`Business / Company: ${fields.companyName || ''}`)

  newPageIfNeeded(70)
  page.drawText('Signature:', {
    x: margin,
    y: y - 12,
    size: 10,
    font: regular,
    color: rgb(0.1, 0.08, 0.07),
  })
  if (fields.signature?.buffer) {
    const image =
      fields.signature.mime === 'image/jpeg'
        ? await pdf.embedJpg(fields.signature.buffer)
        : await pdf.embedPng(fields.signature.buffer)
    const maxW = 180
    const maxH = 48
    const scale = Math.min(maxW / image.width, maxH / image.height, 1)
    const w = image.width * scale
    const h = image.height * scale
    page.drawImage(image, { x: margin + 70, y: y - h - 4, width: w, height: h })
    y -= Math.max(h + 10, 20)
  } else {
    y -= 28
    page.drawLine({
      start: { x: margin + 70, y: y },
      end: { x: margin + 280, y: y },
      thickness: 0.6,
      color: rgb(0.2, 0.16, 0.14),
    })
    y -= 16
  }

  drawLines(`Date: ${fields.signedDate || ''}`)
  drawLines(`Agreement version: ${PUBLIC_PARTNER_AGREEMENT_VERSION}`, { heading: false })

  return Buffer.from(await pdf.save())
}
