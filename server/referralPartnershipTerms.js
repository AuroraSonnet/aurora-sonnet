/**
 * Default commercial terms, full agreement document, and immutable snapshot helpers.
 */
import { W9_PAYMENT_LANGUAGE } from './referralPartnershipLegal.js'

export const REFERRAL_PARTNERSHIP_COMMISSION_RATE = 0.1

export const COMMISSION_BASE_EXCLUSION_LABELS = [
  'taxes',
  'travel',
  'lodging',
  'rentals',
  'gratuities',
  'payment processing fees',
  'refunded amounts',
]

export const DEFAULT_REFERRAL_PARTNERSHIP_TERMS = {
  schemaVersion: 2,
  termsKind: 'referral_partnership_mvp',
  commissionRate: REFERRAL_PARTNERSHIP_COMMISSION_RATE,
  minPayoutAmount: null,
  commissionBaseDescription: '10% of the collected performance-service subtotal',
  exclusions: COMMISSION_BASE_EXCLUSION_LABELS,
  excludeUndisclosedInternalExpenses: true,
  excludePerformerCosts: true,
  nonexclusive: true,
  attributionWindowMonths: 12,
  contractSigningWindowMonths: 12,
  payeeEntity: 'contracted_venue_business',
  w9RequiredBeforePayout: true,
  paymentDeadlineDays: 30,
  governingLawState: 'New York',
}

export function buildLegacyDefaultTermsSnapshot() {
  return {
    schemaVersion: 1,
    termsKind: 'legacy_default',
    commissionRate: 0.05,
    minPayoutAmount: 100,
    useLegacyExpenseDeduction: true,
    label: 'Legacy default (5% / $100 min, pre-agreement)',
  }
}

export function parseTermsSnapshot(raw) {
  if (raw == null || raw === '') return null
  if (typeof raw === 'object') return raw
  try {
    return JSON.parse(String(raw))
  } catch {
    return null
  }
}

export function termsSnapshotLabel(snapshot) {
  const s = parseTermsSnapshot(snapshot)
  if (!s) return '—'
  if (s.termsKind === 'legacy_default') return s.label || 'Legacy default'
  if (s.termsKind === 'referral_partnership_mvp') return 'Referral partnership agreement (10%)'
  return String(s.termsKind || 'Custom terms')
}

export function agreementVersionIdentifier(agreement) {
  if (!agreement) return ''
  if (agreement.agreementVersionIdentifier) return String(agreement.agreementVersionIdentifier)
  const v = agreement.version ?? '?'
  const pid = agreement.partnershipId ?? agreement.id ?? 'unknown'
  return `RPA-${pid}-v${v}`
}

export function isPartnershipTermsSnapshot(termsSnapshot) {
  const t = parseTermsSnapshot(termsSnapshot)
  return t?.termsKind === 'referral_partnership_mvp'
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function formatExclusionsList(exclusions) {
  const list = Array.isArray(exclusions) && exclusions.length ? exclusions : COMMISSION_BASE_EXCLUSION_LABELS
  if (list.length <= 1) return list[0] || ''
  return `${list.slice(0, -1).join(', ')}, and ${list[list.length - 1]}`
}

function commercialTermsSummaryHtml(t, { venueName, signatoryName, signatoryTitle }) {
  const ratePct = Math.round((t.commissionRate ?? REFERRAL_PARTNERSHIP_COMMISSION_RATE) * 100)
  const exclusions = formatExclusionsList(t.exclusions)
  return `<section class="commercial-summary">
<h2>Commercial Terms (Summary — Page 1)</h2>
<p><strong>Partner venue / business:</strong> ${escapeHtml(venueName || '[Venue legal name]')}</p>
<p><strong>Authorized signatory:</strong> ${escapeHtml(signatoryName || '[Signatory name]')}${signatoryTitle ? `, ${escapeHtml(signatoryTitle)}` : ''}</p>
<ul>
  <li><strong>Commission:</strong> ${ratePct}% of the collected performance-service subtotal. <em>There is no minimum payout.</em> For example, a $500 qualifying subtotal produces a $${Math.round(500 * (t.commissionRate ?? 0.1))} commission.</li>
  <li><strong>Commission-base exclusions:</strong> ${escapeHtml(exclusions)}.</li>
  <li>Aurora Sonnet's internal expenses and performer costs do <strong>not</strong> reduce the commission base.</li>
  <li><strong>Relationship:</strong> Nonexclusive; each party remains an independent business.</li>
  <li><strong>Attribution:</strong> The client's booking contract must be signed within ${t.attributionWindowMonths ?? 12} months of the introduction.</li>
  <li><strong>Payee:</strong> The contracted venue/business entity (not an individual coordinator unless designated in writing).</li>
  <li><strong>Payment eligibility:</strong> Event completed; client paid Aurora Sonnet in full; no unresolved refund or chargeback. Tax documentation required before commission is issued (see full agreement).</li>
  <li><strong>Payment timing:</strong> Within ${t.paymentDeadlineDays ?? 30} days after all eligibility conditions are met.</li>
</ul>
<p><em>This summary is for convenience only. The complete agreement below governs.</em></p>
</section>`
}

function fullAgreementBodyHtml(fields, t) {
  const ratePct = Math.round((t.commissionRate ?? REFERRAL_PARTNERSHIP_COMMISSION_RATE) * 100)
  const exclusions = formatExclusionsList(t.exclusions)
  const effectiveDate = fields.effectiveDate || '[Effective date]'
  const partnerLegalName = fields.partnerLegalName || fields.venueName || '[Partner legal name]'
  const partnerAddress = fields.partnerAddress || '[Partner address]'
  const agencyLegalName = fields.agencyLegalName || 'Aurora Sonnet LLC'
  const agencyAddress = fields.agencyAddress || '[Aurora Sonnet address]'
  const signatoryName = fields.signatoryName || '[Authorized signatory name]'
  const signatoryTitle = fields.signatoryTitle || '[Title]'
  const agencySignatoryName = fields.agencySignatoryName || '[Aurora Sonnet signatory name]'
  const agencySignatoryTitle = fields.agencySignatoryTitle || '[Title]'
  const versionId = fields.agreementVersionIdentifier || '[Agreement version ID]'

  return `<section class="full-agreement">
<h2>Referral Partnership Agreement</h2>
<p><strong>Agreement version:</strong> ${escapeHtml(versionId)}</p>
<p><strong>Effective date:</strong> ${escapeHtml(effectiveDate)}</p>

<h3>1. Parties</h3>
<p><strong>Partner:</strong> ${escapeHtml(partnerLegalName)}, with its principal address at ${escapeHtml(partnerAddress)} ("Partner").</p>
<p><strong>Aurora Sonnet:</strong> ${escapeHtml(agencyLegalName)}, with its principal address at ${escapeHtml(agencyAddress)} ("Aurora Sonnet").</p>
<p>Partner's authorized signatory for this Agreement: ${escapeHtml(signatoryName)}, ${escapeHtml(signatoryTitle)}.</p>

<h3>2. Purpose</h3>
<p>Partner may refer prospective clients to Aurora Sonnet for live musical performance services at weddings and related events. This Agreement sets the commercial and legal terms for eligible referrals and commission payments.</p>

<h3>3. Referral eligibility</h3>
<p>A referral qualifies only if:</p>
<ul>
  <li>Partner submits the referral in writing through Aurora Sonnet's designated referral process;</li>
  <li>Partner confirms the couple's permission for Aurora Sonnet to contact them; and</li>
  <li>Aurora Sonnet accepts the lead as a new, attributable introduction.</li>
</ul>
<p><strong>No commission</strong> is owed for existing clients, duplicate leads, or clients who independently contacted Aurora Sonnet or were already in Aurora Sonnet's active pipeline before Partner's written referral.</p>

<h3>4. Attribution window</h3>
<p>A referral is attributed to Partner only if the client's booking contract with Aurora Sonnet is signed within <strong>${t.contractSigningWindowMonths ?? 12} months</strong> after Partner's written introduction.</p>

<h3>5. Commission</h3>
<p>Aurora Sonnet shall pay Partner a commission equal to <strong>${ratePct}%</strong> of the <strong>collected performance-service subtotal</strong> for each completed, fully paid qualifying booking. <strong>There is no minimum commission.</strong></p>
<p>The collected performance-service subtotal excludes: ${escapeHtml(exclusions)}. Aurora Sonnet's internal costs, undisclosed internal expenses, and performer costs shall not reduce the commission base.</p>

<h3>6. Payment eligibility and timing</h3>
<p>Commission becomes payable only when <strong>all</strong> of the following are true:</p>
<ul>
  <li>The event has been completed;</li>
  <li>The client has paid Aurora Sonnet in full for the qualifying services; and</li>
  <li>There is no unresolved refund, chargeback, or payment dispute affecting the booking.</li>
</ul>
<p>${escapeHtml(W9_PAYMENT_LANGUAGE)}</p>
<p>Eligible commissions shall be paid within <strong>${t.paymentDeadlineDays ?? 30} days</strong> after the event-completion and payment conditions above are satisfied and any required tax documentation has been received.</p>

<h3>7. Cancellations, refunds, and chargebacks</h3>
<p>No commission is owed on amounts Aurora Sonnet did not ultimately collect. If a refund or chargeback reduces amounts collected after a commission was paid, Aurora Sonnet may offset the overpayment against future commissions payable to Partner.</p>

<h3>8. Partner conduct</h3>
<p>Partner shall not make unauthorized promises, pricing commitments, or contractual commitments on behalf of Aurora Sonnet. Partner is solely responsible for its own marketing statements and must comply with applicable disclosure laws for compensated referrals.</p>

<h3>9. Relationship of the parties</h3>
<p>The parties are independent contractors. This Agreement is <strong>nonexclusive</strong>. Nothing herein creates a partnership, joint venture, agency, or employment relationship.</p>

<h3>10. Couple consent, data sharing, privacy, and confidentiality</h3>
<p>Partner represents that it has obtained the couple's consent before sharing contact information with Aurora Sonnet. Each party shall use referral and client information only for purposes of this referral program, comply with applicable privacy laws, and keep non-public business information confidential except as required by law or with consent.</p>

<h3>11. Term and termination</h3>
<p>This Agreement begins on the Effective Date and continues until terminated. Either party may terminate on written notice. Termination does not affect commissions earned for qualifying referrals introduced <strong>before</strong> termination, provided those referrals meet all eligibility requirements under this Agreement.</p>

<h3>12. Taxes</h3>
<p>Partner is solely responsible for all taxes arising from commissions paid under this Agreement. Aurora Sonnet may issue informational tax reporting as required by law.</p>

<h3>13. Governing law</h3>
<p>This Agreement is governed by the laws of the State of ${escapeHtml(t.governingLawState || 'New York')}, without regard to conflict-of-law rules.</p>

<h3>14. General provisions</h3>
<ul>
  <li><strong>Entire agreement.</strong> This document (including the Commercial Terms summary) is the entire agreement regarding referral compensation between the parties.</li>
  <li><strong>Amendments.</strong> Valid only if signed in writing by both parties.</li>
  <li><strong>Notices.</strong> Notices must be in writing to the addresses above (or updated addresses provided in writing).</li>
  <li><strong>Assignment.</strong> Neither party may assign this Agreement without the other's written consent, except Aurora Sonnet may assign to a successor entity.</li>
  <li><strong>Severability.</strong> If any provision is unenforceable, the remainder stays in effect.</li>
  <li><strong>Waiver.</strong> Failure to enforce a provision is not a waiver of future enforcement.</li>
  <li><strong>Counterparts &amp; electronic signatures.</strong> This Agreement may be executed in counterparts and by electronic signature, each of which is an original.</li>
</ul>

<h3>15. Signatures</h3>
<p><strong>Partner</strong> (${escapeHtml(partnerLegalName)})</p>
<p>Signature: _________________________________</p>
<p>Printed name: ${escapeHtml(signatoryName)}</p>
<p>Title: ${escapeHtml(signatoryTitle)}</p>
<p>Date: _________________________________</p>
<p>&nbsp;</p>
<p><strong>Aurora Sonnet</strong> (${escapeHtml(agencyLegalName)})</p>
<p>Signature: _________________________________</p>
<p>Printed name: ${escapeHtml(agencySignatoryName)}</p>
<p>Title: ${escapeHtml(agencySignatoryTitle)}</p>
<p>Date: _________________________________</p>
</section>`
}

/** Complete agreement HTML: summary + full contract. Preview PDFs include DRAFT banner. */
export function buildDraftAgreementHtml({
  venueName,
  partnerLegalName,
  partnerAddress,
  signatoryName,
  signatoryTitle,
  agencyLegalName,
  agencyAddress,
  agencySignatoryName,
  agencySignatoryTitle,
  effectiveDate,
  agreementVersionIdentifier: versionId,
  terms,
  editedBody,
  draftBanner = true,
}) {
  if (editedBody && String(editedBody).trim()) {
    const banner = draftBanner
      ? '<p><strong>DRAFT — LEGAL REVIEW REQUIRED</strong></p>'
      : ''
    return `${banner}${String(editedBody).trim()}`
  }
  const t = terms || DEFAULT_REFERRAL_PARTNERSHIP_TERMS
  const banner = draftBanner ? '<h1>DRAFT — LEGAL REVIEW REQUIRED</h1>' : ''
  const summary = commercialTermsSummaryHtml(t, { venueName, signatoryName, signatoryTitle })
  const full = fullAgreementBodyHtml(
    {
      venueName,
      partnerLegalName: partnerLegalName || venueName,
      partnerAddress,
      signatoryName,
      signatoryTitle,
      agencyLegalName,
      agencyAddress,
      agencySignatoryName,
      agencySignatoryTitle,
      effectiveDate,
      agreementVersionIdentifier: versionId,
    },
    t
  )
  return `${banner}
${summary}
<hr/>
${full}
<p><em>Generated by Aurora Sonnet CRM for external execution. This draft is not legal advice. Do not send for signature or activate the partnership until legal approval is recorded for this exact agreement version.</em></p>`
}

export function snapshotFromAgreementRecord(agreement) {
  const parsed =
    typeof agreement?.termsJson === 'object'
      ? agreement.termsJson
      : parseTermsSnapshot(agreement?.termsJson)
  if (parsed) {
    return {
      ...parsed,
      agreementId: agreement.id,
      agreementVersion: agreement.version,
      agreementVersionIdentifier: agreementVersionIdentifier(agreement),
    }
  }
  return {
    ...DEFAULT_REFERRAL_PARTNERSHIP_TERMS,
    agreementId: agreement?.id,
    agreementVersion: agreement?.version,
    agreementVersionIdentifier: agreementVersionIdentifier(agreement),
  }
}

export function buildAgreementFieldsFromVenue(venue, contact, agreementMeta = {}) {
  const addressParts = [venue?.address, venue?.city, venue?.borough].filter(Boolean)
  return {
    venueName: venue?.companyName || '',
    partnerLegalName: venue?.companyName || '',
    partnerAddress: addressParts.join(', ') || '',
    signatoryName: agreementMeta.signatoryName || contact?.name || '',
    signatoryTitle: agreementMeta.signatoryTitle || contact?.jobTitle || '',
    agencyLegalName: agreementMeta.agencyLegalName,
    agencyAddress: agreementMeta.agencyAddress,
    agencySignatoryName: agreementMeta.agencySignatoryName,
    agencySignatoryTitle: agreementMeta.agencySignatoryTitle,
    effectiveDate: agreementMeta.effectiveDate || new Date().toISOString().slice(0, 10),
    agreementVersionIdentifier: agreementMeta.agreementVersionIdentifier,
  }
}
