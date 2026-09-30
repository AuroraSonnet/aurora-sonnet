/**
 * Referral partnership agreement templates, terms, and immutable snapshot helpers.
 */
export const AGREEMENT_TEMPLATE_VERSION = '2026-v3'

export const W9_PAYMENT_LANGUAGE =
  'Before Aurora Sonnet issues any referral commission, Partner must provide a completed and accurate IRS Form W-9 or other applicable tax documentation reasonably requested by Aurora Sonnet. Failure to provide the requested documentation suspends payment but does not otherwise invalidate an eligible referral.'
export const REFERRAL_PARTNERSHIP_COMMISSION_RATE = 0.1

export const COMMISSION_BASE_EXCLUSION_LABELS = [
  'taxes',
  'travel',
  'lodging',
  'rentals',
  'gratuities',
  'itemized client payment-processing surcharges',
  'refunded amounts',
]

export const DEFAULT_REFERRAL_PARTNERSHIP_TERMS = {
  schemaVersion: 4,
  termsKind: 'referral_partnership_mvp',
  agreementTemplateVersion: AGREEMENT_TEMPLATE_VERSION,
  commissionRate: REFERRAL_PARTNERSHIP_COMMISSION_RATE,
  minPayoutAmount: null,
  commissionBaseDescription:
    '10% of the performance-service subtotal actually received and retained by Aurora Sonnet after discounts, credits, refunds, or other client adjustments',
  exclusions: COMMISSION_BASE_EXCLUSION_LABELS,
  excludeUndisclosedInternalExpenses: true,
  excludePerformerCosts: true,
  nonexclusive: true,
  attributionWindowMonths: 12,
  contractSigningWindowMonths: 12,
  referralAcceptanceBusinessDays: 5,
  commissionStatementDisputeDays: 30,
  payeeEntity: 'venue_business_entity_only',
  w9RequiredBeforePayout: true,
  paymentDeadlineDays: 30,
  governingLawState: 'New York',
  governingLawVenue: 'New York County, New York',
  sameEventScopeOnly: true,
}

/** Standard public agreement the partner e-signs. Distinct from the venue CRM template. */
export const PUBLIC_PARTNER_AGREEMENT_VERSION = 'partner-referral-agreement-2026-09-r2'

const PUBLIC_AGREEMENT_EXCLUSIONS = [
  'taxes',
  'travel',
  'lodging',
  'rentals',
  'gratuities',
  'payment processing fees',
  'refunds',
  'other third-party expenses',
]

/** One-off “Refer a Couple” submission. Same 10% fee, no signed partnership row. */
export const PUBLIC_REFERRAL_PROGRAM_TERMS = {
  schemaVersion: 1,
  termsKind: 'public_referral_10',
  agreementTemplateVersion: PUBLIC_PARTNER_AGREEMENT_VERSION,
  commissionRate: 0.1,
  minPayoutAmount: null,
  useLegacyExpenseDeduction: false,
  exclusions: PUBLIC_AGREEMENT_EXCLUSIONS,
  attributionWindowMonths: 12,
  label: 'Public referral program (10%, no minimum)',
}

/** Ongoing partner who e-signed the Partner Referral Agreement. */
export const PUBLIC_PARTNER_AGREEMENT_TERMS = {
  schemaVersion: 1,
  termsKind: 'public_partner_agreement',
  agreementTemplateVersion: PUBLIC_PARTNER_AGREEMENT_VERSION,
  commissionRate: 0.1,
  minPayoutAmount: null,
  useLegacyExpenseDeduction: false,
  exclusions: PUBLIC_AGREEMENT_EXCLUSIONS,
  nonexclusive: true,
  attributionWindowMonths: 12,
  w9MayBeRequiredBeforePayout: true,
  paymentDeadlineDays: 30,
  governingLawState: 'New York',
  label: 'Partner Referral Agreement (10%, no minimum)',
}

export function buildPublicReferralProgramSnapshot() {
  return { ...PUBLIC_REFERRAL_PROGRAM_TERMS, exclusions: [...PUBLIC_AGREEMENT_EXCLUSIONS] }
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
  if (s.termsKind === 'referral_partnership_mvp') {
    const ver = s.agreementTemplateVersion ? ` (${s.agreementTemplateVersion})` : ''
    return `Referral partnership agreement (10%)${ver}`
  }
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

/** Effective date = later of the two signature dates when both present. */
export function computeEffectiveDateFromSignatures(partnerSignedDate, agencySignedDate) {
  const dates = [partnerSignedDate, agencySignedDate]
    .map((d) => String(d || '').trim())
    .filter(Boolean)
    .map((d) => new Date(`${d}T12:00:00`))
    .filter((d) => !Number.isNaN(d.getTime()))
  if (!dates.length) return null
  const latest = dates.reduce((a, b) => (a > b ? a : b))
  return latest.toISOString().slice(0, 10)
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

function commercialTermsSummaryHtml(t, fields) {
  const ratePct = Math.round((t.commissionRate ?? REFERRAL_PARTNERSHIP_COMMISSION_RATE) * 100)
  const exclusions = formatExclusionsList(t.exclusions)
  const { venueName, signatoryName, signatoryTitle } = fields
  return `<section class="commercial-summary">
<h2>Commercial Terms (Summary — Page 1)</h2>
<p><strong>Partner venue / business:</strong> ${escapeHtml(venueName || '[Venue legal name]')}</p>
<p><strong>Authorized signatory:</strong> ${escapeHtml(signatoryName || '[Signatory name]')}${signatoryTitle ? `, ${escapeHtml(signatoryTitle)}` : ''}</p>
<ul>
  <li><strong>Commission:</strong> ${ratePct}% of the performance-service subtotal actually received and retained by Aurora Sonnet (after discounts, credits, refunds, or other client adjustments). <em>There is no minimum payout.</em> Example: a $500 qualifying subtotal produces a $50 commission.</li>
  <li><strong>Commission-base exclusions:</strong> ${escapeHtml(exclusions)}. Stripe, credit-card, or other processing fees paid by Aurora Sonnet are internal business expenses and do <strong>not</strong> reduce the commission base.</li>
  <li>Aurora Sonnet's internal expenses and performer costs do <strong>not</strong> reduce the commission base.</li>
  <li><strong>Scope:</strong> Commission applies only to the referred couple's initial event contract and add-ons for that same event—not unrelated future events.</li>
  <li><strong>Payee:</strong> Commissions are paid only to the venue/business legal entity named in this Agreement and matching tax documentation—never to an individual coordinator, employee, or representative.</li>
  <li><strong>Relationship:</strong> Nonexclusive; each party remains an independent business.</li>
  <li><strong>Attribution:</strong> The client's booking contract must be signed within ${t.attributionWindowMonths ?? 12} months of the introduction.</li>
  <li><strong>Referral acceptance:</strong> Aurora Sonnet must accept or reject a submitted referral within ${t.referralAcceptanceBusinessDays ?? 5} Business Days; if undecided, the referral becomes Overdue—not accepted. Silence is not acceptance.</li>
  <li><strong>Payment eligibility:</strong> Event completed; client paid in full; no unresolved refund or chargeback. Tax documentation required before commission is issued (see full agreement).</li>
  <li><strong>Payment timing:</strong> Within ${t.paymentDeadlineDays ?? 30} days after eligibility conditions are met, with a commission statement.</li>
</ul>
<p><em>If this summary conflicts with the complete agreement below, the complete agreement controls.</em></p>
</section>`
}

function effectiveDateDisplayHtml(fields, documentMode) {
  const raw = fields.effectiveDate && !/\[/.test(String(fields.effectiveDate)) ? String(fields.effectiveDate).trim() : ''
  if (documentMode === 'executed' && raw) {
    return `${escapeHtml(raw)} (the date of the final party's signature below)`
  }
  return '________________'
}

function fullAgreementBodyHtml(fields, t, documentMode = 'draft') {
  const ratePct = Math.round((t.commissionRate ?? REFERRAL_PARTNERSHIP_COMMISSION_RATE) * 100)
  const exclusions = formatExclusionsList(t.exclusions)
  const effectiveDateLine = effectiveDateDisplayHtml(fields, documentMode)
  const partnerLegalName = fields.partnerLegalName || fields.venueName || '[Partner legal name]'
  const partnerAddress = fields.partnerAddress || '[Partner address]'
  const partnerNoticeEmail = fields.partnerNoticeEmail || '[Partner notice email]'
  const agencyLegalName = fields.agencyLegalName || 'Aurora Sonnet LLC'
  const agencyAddress = fields.agencyAddress || '[Aurora Sonnet address]'
  const agencyNoticeEmail = fields.agencyNoticeEmail || '[Aurora Sonnet notice email]'
  const signatoryName = fields.signatoryName || '[Authorized signatory name]'
  const signatoryTitle = fields.signatoryTitle || '[Title]'
  const agencySignatoryName = fields.agencySignatoryName || '[Aurora Sonnet signatory name]'
  const agencySignatoryTitle = fields.agencySignatoryTitle || '[Title]'
  const versionId = fields.agreementVersionIdentifier || '[Agreement version ID]'

  return `<section class="full-agreement">
<h2>Referral Partnership Agreement</h2>
<p><strong>Agreement version:</strong> ${escapeHtml(versionId)}</p>
<p><strong>Effective date:</strong> ${effectiveDateLine}</p>

<h3>1. Parties, payee, and authorization</h3>
<p><strong>Partner:</strong> ${escapeHtml(partnerLegalName)}, with its business mailing address at ${escapeHtml(partnerAddress)} ("Partner"). <strong>Partner notice email:</strong> ${escapeHtml(partnerNoticeEmail)}.</p>
<p><strong>Aurora Sonnet:</strong> ${escapeHtml(agencyLegalName)}, with its business mailing address at ${escapeHtml(agencyAddress)} ("Aurora Sonnet"). <strong>Aurora Sonnet notice email:</strong> ${escapeHtml(agencyNoticeEmail)}.</p>
<p>Partner's authorized signatory for this Agreement: ${escapeHtml(signatoryName)}, ${escapeHtml(signatoryTitle)}.</p>
<p>Aurora Sonnet's signatory for this Agreement, ${escapeHtml(agencySignatoryName)}, ${escapeHtml(agencySignatoryTitle)}, acts as Aurora Sonnet's duly authorized representative.</p>
<p><strong>Referral payee.</strong> Referral commissions may be paid <strong>only</strong> to the venue/business legal entity named as Partner above and matching Partner's tax documentation on file with Aurora Sonnet. Aurora Sonnet shall <strong>never</strong> pay an individual coordinator, employee, or representative.</p>
<p><strong>Partner confirmations.</strong> Partner represents and confirms that: (a) Partner's business authorized this referral arrangement; (b) the signatory identified above has authority to bind Partner; and (c) receiving commissions under this Agreement complies with Partner's internal policies.</p>

<h3>2. Purpose</h3>
<p>Partner may refer prospective clients to Aurora Sonnet for live musical performance services at weddings and related events. This Agreement sets the commercial and legal terms for eligible referrals and commission payments.</p>

<h3>3. Referral eligibility, acceptance, and competing referrals</h3>
<p><strong>Business Day</strong> means Monday through Friday, excluding U.S. federal holidays observed in New York.</p>
<p><strong>Existing Lead</strong> means a prospective client whose documented inquiry Aurora Sonnet received <strong>before</strong> the timestamp of Partner's written referral submission.</p>
<p>A referral qualifies only if:</p>
<ul>
  <li>Partner submits the referral in writing through Aurora Sonnet's designated referral process;</li>
  <li>Partner confirms the couple's permission for Aurora Sonnet to contact them;</li>
  <li>Aurora Sonnet expressly accepts the referral in writing within <strong>${t.referralAcceptanceBusinessDays ?? 5} Business Days</strong> after receipt; and</li>
  <li>The referral is not an Existing Lead, duplicate referral, or independently sourced lead.</li>
</ul>
<p><strong>Silence does not constitute acceptance.</strong> If Aurora Sonnet does not decide within ${t.referralAcceptanceBusinessDays ?? 5} Business Days after receipt, the referral becomes <strong>Overdue</strong>—not accepted. An Overdue referral may qualify only if Aurora Sonnet later expressly accepts it in writing. No commission may be earned without explicit acceptance.</p>
<p><strong>Competing referrals.</strong> If multiple partners refer the same prospective client, the <strong>first valid written referral received</strong> by Aurora Sonnet controls attribution, subject to the Existing Lead rule and Aurora Sonnet's written acceptance.</p>
<p><strong>No commission</strong> is owed for an Existing Lead, duplicate referral, independently sourced lead, or any referral Aurora Sonnet rejects or does not expressly accept in writing.</p>

<h3>4. Attribution window</h3>
<p>A referral is attributed to Partner only if the client's booking contract with Aurora Sonnet for the referred event is signed within <strong>${t.contractSigningWindowMonths ?? 12} months</strong> after Aurora Sonnet's written acceptance of Partner's referral.</p>

<h3>5. Commission scope and calculation</h3>
<p>Aurora Sonnet shall pay Partner a commission equal to <strong>${ratePct}%</strong> of the <strong>commissionable performance-service subtotal</strong> for each completed, fully paid qualifying booking. <strong>There is no minimum commission.</strong></p>
<p>The <strong>commissionable performance-service subtotal</strong> means the performance-service subtotal actually received and retained by Aurora Sonnet after discounts, credits, refunds, or other client adjustments, and excludes: ${escapeHtml(exclusions)}. Only payment-processing surcharges <strong>separately itemized and charged to the client</strong> are excluded from the commission base. Stripe, credit-card, or other processing fees paid by Aurora Sonnet are internal business expenses and shall <strong>not</strong> reduce the commission base. Aurora Sonnet's internal costs, undisclosed internal expenses, and performer costs shall not reduce the commission base.</p>
<p>Commission applies <strong>only</strong> to the referred couple's initial event contract and add-ons for that same event. Commission does <strong>not</strong> apply to unrelated future events or bookings.</p>

<h3>6. Payment eligibility, statements, disputes, and timing</h3>
<p>Commission becomes payable only when <strong>all</strong> of the following are true:</p>
<ul>
  <li>The event has been completed;</li>
  <li>The client has paid Aurora Sonnet in full for the qualifying services;</li>
  <li>There is no unresolved refund, chargeback, or payment dispute affecting the booking; and</li>
  <li>Partner has provided tax documentation as described below.</li>
</ul>
<p>${escapeHtml(W9_PAYMENT_LANGUAGE)}</p>
<p>With each commission payment, Aurora Sonnet shall provide Partner a short written statement showing: (a) the commissionable performance-service subtotal; (b) applicable adjustments or exclusions; (c) the ${ratePct}% calculation; and (d) the final commission paid.</p>
<p>Partner may dispute a commission calculation by written notice to Aurora Sonnet within <strong>${t.commissionStatementDisputeDays ?? 30} days</strong> after receiving the statement, with reasonable detail supporting the dispute.</p>
<p>Eligible commissions shall be paid within <strong>${t.paymentDeadlineDays ?? 30} days</strong> after the event-completion and payment conditions above are satisfied and any required tax documentation has been received.</p>

<h3>7. Cancellations, refunds, and chargebacks</h3>
<p>No commission is owed on amounts Aurora Sonnet did not ultimately receive and retain. If a refund, credit, or chargeback reduces amounts received after a commission was paid, Aurora Sonnet may offset the overpayment against future commissions payable to Partner. If no sufficient future commission is available, Partner must repay the documented overpayment within <strong>30 days</strong> after receiving written notice and a supporting calculation from Aurora Sonnet.</p>

<h3>8. Partner conduct and referral disclosure</h3>
<p>Partner shall not make unauthorized promises, pricing commitments, or contractual commitments on behalf of Aurora Sonnet. Partner is solely responsible for its own marketing statements.</p>
<p>Partner shall <strong>clearly disclose</strong> the compensated referral relationship with Aurora Sonnet whenever disclosure is legally required, including in consumer-facing communications where a referral fee or similar compensation may materially affect the audience's understanding of the recommendation. One permitted example is: <em>"We may receive a referral commission if you book Aurora Sonnet."</em> Substantially similar wording is acceptable if it is clear and presented with the recommendation.</p>

<h3>9. Aurora Sonnet business control</h3>
<p>Aurora Sonnet retains sole control over artist availability and selection, pricing, proposals and contract terms, whether to accept a prospective client or booking, and how services are delivered. Neither party guarantees any minimum number of referrals, bookings, revenue, or commissions.</p>

<h3>10. Relationship of the parties</h3>
<p>The parties are independent contractors. This Agreement is <strong>nonexclusive</strong>. Nothing herein creates a partnership, joint venture, agency, or employment relationship.</p>

<h3>11. Couple consent, data sharing, privacy, and confidentiality</h3>
<p>Partner represents that it has obtained the couple's consent before sharing contact information with Aurora Sonnet. Each party shall use referral and client information only for purposes of this referral program, comply with applicable privacy laws, and keep non-public business information confidential except as required by law or with consent.</p>

<h3>12. Term and termination</h3>
<p>This Agreement begins on the Effective Date and continues until terminated. Either party may terminate on written notice. Referrals expressly accepted before termination remain eligible if the booking contract is signed within the ${t.contractSigningWindowMonths ?? 12}-month attribution window and every other commission requirement is satisfied. Pending, rejected, or unaccepted referrals do not survive termination unless Aurora Sonnet expressly agrees otherwise in writing.</p>

<h3>13. Taxes</h3>
<p>Partner is solely responsible for all taxes arising from commissions paid under this Agreement. Aurora Sonnet may issue informational tax reporting as required by law.</p>

<h3>14. Governing law, jurisdiction, and general provisions</h3>
<p>This Agreement is governed by the laws of the State of ${escapeHtml(t.governingLawState || 'New York')}, without regard to conflict-of-law rules. Any dispute arising out of or relating to this Agreement shall be subject to the exclusive jurisdiction of the state or federal courts located in ${escapeHtml(t.governingLawVenue || 'New York County, New York')}.</p>
<ul>
  <li><strong>Summary vs. agreement.</strong> If the Commercial Terms summary on page 1 conflicts with this Agreement, <strong>this Agreement controls</strong>.</li>
  <li><strong>Entire agreement.</strong> This document is the entire agreement regarding the parties' complete referral relationship—not merely referral compensation.</li>
  <li><strong>Amendments.</strong> Valid only if signed in writing by both parties.</li>
  <li><strong>Notices.</strong> Notices must be in writing and sent by email to the notice email address identified for each party above (or updated addresses provided in writing).</li>
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
<p><strong>Aurora Sonnet</strong> (${escapeHtml(agencyLegalName)}), by its duly authorized representative:</p>
<p>Signature: _________________________________</p>
<p>Printed name: ${escapeHtml(agencySignatoryName)}</p>
<p>Title: ${escapeHtml(agencySignatoryTitle)}</p>
<p>Date: _________________________________</p>
</section>`
}

/**
 * @param {'draft'|'signature'|'executed'} documentMode
 * - draft: preview with DRAFT — NOT FOR SIGNATURE
 * - signature: released for external signature (no draft warnings)
 * - executed: fully signed (no draft warnings; effective date may be filled)
 */
export function buildAgreementHtml({
  venueName,
  partnerLegalName,
  partnerAddress,
  partnerNoticeEmail,
  signatoryName,
  signatoryTitle,
  agencyLegalName,
  agencyAddress,
  agencyNoticeEmail,
  agencySignatoryName,
  agencySignatoryTitle,
  effectiveDate,
  agreementVersionIdentifier: versionId,
  terms,
  editedBody,
  documentMode = 'draft',
}) {
  if (editedBody && String(editedBody).trim()) {
    if (documentMode === 'draft') {
      return `<h1>DRAFT — NOT FOR SIGNATURE</h1>${String(editedBody).trim()}`
    }
    return String(editedBody).trim()
  }
  const t = terms || DEFAULT_REFERRAL_PARTNERSHIP_TERMS
  const fields = {
    venueName,
    partnerLegalName: partnerLegalName || venueName,
    partnerAddress,
    partnerNoticeEmail,
    signatoryName,
    signatoryTitle,
    agencyLegalName,
    agencyAddress,
    agencyNoticeEmail,
    agencySignatoryName,
    agencySignatoryTitle,
    effectiveDate,
    agreementVersionIdentifier: versionId,
  }
  const summary = commercialTermsSummaryHtml(t, fields)
  const full = fullAgreementBodyHtml(fields, t, documentMode)
  const banner = documentMode === 'draft' ? '<h1>DRAFT — NOT FOR SIGNATURE</h1>' : ''
  const draftFooter =
    documentMode === 'draft'
      ? '<p><em>Preview only — not for signature. Owner Approval is required before this version may be sent, executed, or used to activate a partnership.</em></p>'
      : ''
  return `${banner}
${summary}
<hr/>
${full}
${draftFooter}`
}

/** @deprecated use buildAgreementHtml with documentMode */
export function buildDraftAgreementHtml(opts) {
  return buildAgreementHtml({ ...opts, documentMode: opts.draftBanner === false ? 'signature' : 'draft' })
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
  const partnerNoticeEmail = contact?.email || venue?.email || agreementMeta.partnerNoticeEmail || ''
  return {
    venueName: venue?.companyName || '',
    partnerLegalName: venue?.companyName || '',
    partnerAddress: addressParts.join(', ') || '',
    partnerNoticeEmail,
    signatoryName: agreementMeta.signatoryName || contact?.name || '',
    signatoryTitle: agreementMeta.signatoryTitle || contact?.jobTitle || '',
    agencyLegalName: agreementMeta.agencyLegalName,
    agencyAddress: agreementMeta.agencyAddress,
    agencyNoticeEmail: agreementMeta.agencyNoticeEmail,
    agencySignatoryName: agreementMeta.agencySignatoryName,
    agencySignatoryTitle: agreementMeta.agencySignatoryTitle,
    effectiveDate: agreementMeta.effectiveDate ?? null,
    agreementVersionIdentifier: agreementMeta.agreementVersionIdentifier,
  }
}
