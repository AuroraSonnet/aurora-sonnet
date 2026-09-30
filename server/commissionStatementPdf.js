/**
 * One-page commission statement PDF for partner referral payouts.
 */
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { parseTermsSnapshot } from './referralPartnershipTerms.js'

function wrapText(text, font, size, maxWidth) {
  const words = String(text).split(/\s+/).filter(Boolean)
  const lines = []
  let line = ''
  for (const word of words) {
    const next = line ? `${line} ${word}` : word
    if (font.widthOfTextAtSize(next, size) > maxWidth && line) {
      lines.push(line)
      line = word
    } else {
      line = next
    }
  }
  if (line) lines.push(line)
  return lines
}

function commissionRateFromTerms(termsSnapshot) {
  const t = parseTermsSnapshot(termsSnapshot)
  if (t?.termsKind === 'referral_partnership_mvp') {
    const rate = t?.commissionRate
    return Number.isFinite(rate) && rate >= 0 ? rate : 0.1
  }
  const rate = t?.commissionRate
  return Number.isFinite(rate) && rate >= 0 ? rate : 0.05
}

/**
 * @param {object} data
 * @returns {Promise<Buffer>}
 */
export async function renderCommissionStatementPdf(data) {
  const pdf = await PDFDocument.create()
  const page = pdf.addPage([612, 792])
  const regular = await pdf.embedStandardFont(StandardFonts.Helvetica)
  const bold = await pdf.embedStandardFont(StandardFonts.HelveticaBold)
  const margin = 54
  const maxWidth = 612 - margin * 2
  let y = 792 - margin
  const bodySize = 10
  const titleSize = 16
  const sectionSize = 11
  const lineHeight = 14

  const drawLine = (text, { font = regular, size = bodySize, gap = 4 } = {}) => {
    for (const row of wrapText(text, font, size, maxWidth)) {
      y -= gap
      page.drawText(row, { x: margin, y, size, font, color: rgb(0.1, 0.1, 0.1) })
      y -= lineHeight
    }
  }

  const rate = data.commissionRate ?? commissionRateFromTerms(data.termsSnapshot)
  const ratePct = Math.round(rate * 100)
  const collected = Math.round(Number(data.collectedSubtotal) || 0)
  const adjustments = Math.round(Number(data.adjustmentsTotal) || 0)
  const excluded = Math.round(Number(data.excludedTotal) || 0)
  const commissionable = Math.round(Number(data.commissionableSubtotal) || 0)
  const commission = Math.round(Number(data.commissionAmount) || 0)

  page.drawText('Commission Statement', { x: margin, y, size: titleSize, font: bold, color: rgb(0.08, 0.06, 0.05) })
  y -= lineHeight + 8
  drawLine(`Statement #: ${data.statementNumber}`, { font: bold })
  drawLine(`Statement date: ${data.statementDate}`)
  drawLine(`Aurora Sonnet LLC`)
  if (data.auroraAddress) drawLine(data.auroraAddress)
  y -= 6
  drawLine(`Partner: ${data.partnerLegalName}`, { font: bold, size: sectionSize })
  drawLine(`Referral / booking ID: ${data.referralReference || data.referralId}`)
  if (data.eventDate) drawLine(`Event date: ${data.eventDate}`)
  y -= 6
  drawLine('Commission calculation', { font: bold, size: sectionSize })
  drawLine(`Collected performance-service subtotal: $${collected.toLocaleString('en-US')}`)
  if (adjustments !== 0) drawLine(`Discounts, credits, refunds: ($${Math.abs(adjustments).toLocaleString('en-US')})`)
  if (excluded !== 0) drawLine(`Excluded amounts (taxes, travel, lodging, rentals, gratuities, itemized client surcharges, etc.): ($${Math.abs(excluded).toLocaleString('en-US')})`)
  drawLine(`Final commissionable subtotal: $${commissionable.toLocaleString('en-US')}`, { font: bold })
  drawLine(`${ratePct}% commission: $${commission.toLocaleString('en-US')}`, { font: bold })
  y -= 6
  drawLine('Payment', { font: bold, size: sectionSize })
  drawLine(`Final commission amount: $${commission.toLocaleString('en-US')}`, { font: bold })
  if (data.paymentDate) drawLine(`Payment date: ${data.paymentDate}`)
  if (data.paymentMethod) drawLine(`Payment method: ${data.paymentMethod}`)
  if (data.paymentReference) drawLine(`Payment reference: ${data.paymentReference}`)
  y -= 10
  drawLine('This statement covers referral commission only. Client contact details are omitted intentionally.', { size: 9 })

  return Buffer.from(await pdf.save())
}

export function buildCommissionStatementNumber(referral) {
  const ref = referral?.referralReference || referral?.id || 'unknown'
  const year = new Date().getFullYear()
  return `CS-${year}-${ref}`
}

export function buildCommissionStatementData(referral, org = {}) {
  const rate = commissionRateFromTerms(referral?.agreementTermsSnapshot)
  const collected = Math.round(Number(referral?.bookingAmount) || 0)
  const excluded = Math.round(Number(referral?.totalExpenseAmount) || 0)
  const commissionable = Math.round(Number(referral?.commissionableAmount) || 0)
  const adjustments = Math.max(0, collected - excluded - commissionable)
  let commission = Math.round(Number(referral?.payoutAmount) || 0)
  if (!commission && commissionable > 0) {
    commission = Math.round(commissionable * rate)
  }
  return {
    statementNumber: buildCommissionStatementNumber(referral),
    statementDate: new Date().toISOString().slice(0, 10),
    partnerLegalName: referral?.companyName || referral?.partnerName || 'Partner',
    referralReference: referral?.referralReference,
    referralId: referral?.id,
    eventDate: referral?.eventDate || undefined,
    collectedSubtotal: collected,
    adjustmentsTotal: adjustments,
    excludedTotal: excluded,
    commissionableSubtotal: commissionable,
    commissionRate: rate,
    commissionAmount: commission,
    paymentDate: referral?.commissionPaymentDate || undefined,
    paymentMethod: referral?.commissionPaymentMethod || undefined,
    paymentReference: referral?.commissionPaymentReference || undefined,
    auroraAddress: org.legalAddress || undefined,
    termsSnapshot: referral?.agreementTermsSnapshot,
  }
}
