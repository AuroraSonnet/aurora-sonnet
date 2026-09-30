/**
 * Generate v2 sample referral partnership agreement PDF.
 * Run: node scripts/generate-referral-agreement-sample-v2.mjs
 * Preserves v1 sample files — writes separate v2 outputs only.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildAgreementHtml, DEFAULT_REFERRAL_PARTNERSHIP_TERMS } from '../server/referralPartnershipTerms.js'
import { renderAgreementPdfFromHtml } from '../server/referralAgreementPdf.js'

const SAMPLE_VERSION_ID = 'RPA-SAMPLE-2026-v2'

const __dirname = dirname(fileURLToPath(import.meta.url))
const outDir = join(__dirname, '..', 'docs', 'samples')
mkdirSync(outDir, { recursive: true })

const fields = {
  venueName: 'Sample Wedding Venue LLC',
  partnerLegalName: 'Sample Wedding Venue LLC',
  partnerAddress: '123 Example Lane, Brooklyn, NY 11201',
  partnerNoticeEmail: 'events@sampleweddingvenue.test',
  signatoryName: 'Jordan Rivera',
  signatoryTitle: 'Director of Events',
  agencyLegalName: 'Aurora Sonnet LLC',
  agencyAddress: '[Configure Aurora Sonnet legal/mailing address in CRM — business address only]',
  agencyNoticeEmail: '[Configure Aurora Sonnet notice email in CRM]',
  agencySignatoryName: 'Lisa Dubocquet',
  agencySignatoryTitle: 'Founder & Artistic Director',
  effectiveDate: '[Date of final signature]',
  agreementVersionIdentifier: SAMPLE_VERSION_ID,
  terms: DEFAULT_REFERRAL_PARTNERSHIP_TERMS,
}

const draftHtml = buildAgreementHtml({ ...fields, documentMode: 'draft' })
const signatureHtml = buildAgreementHtml({ ...fields, documentMode: 'signature' })
const executedHtml = buildAgreementHtml({
  ...fields,
  documentMode: 'executed',
  effectiveDate: '2026-08-15',
})

const htmlPath = join(outDir, 'referral-partnership-agreement-sample-v2.html')
const signableHtmlPath = join(outDir, 'referral-partnership-agreement-sample-v2-signable.html')
const pdfDraftPath = join(outDir, 'referral-partnership-agreement-sample-v2-draft.pdf')
const pdfSignPath = join(outDir, 'referral-partnership-agreement-sample-v2.pdf')
const pdfExecutedPath = join(outDir, 'referral-partnership-agreement-sample-v2-executed.pdf')
const metaPath = join(outDir, 'referral-partnership-agreement-sample-v2-version.txt')

writeFileSync(htmlPath, draftHtml, 'utf8')
writeFileSync(signableHtmlPath, signatureHtml, 'utf8')
writeFileSync(metaPath, SAMPLE_VERSION_ID, 'utf8')

const draftPdf = await renderAgreementPdfFromHtml(draftHtml, { includeDraftBanner: true })
const signPdf = await renderAgreementPdfFromHtml(signatureHtml, { includeDraftBanner: false })
const executedPdf = await renderAgreementPdfFromHtml(executedHtml, { includeDraftBanner: false })

writeFileSync(pdfDraftPath, draftPdf)
writeFileSync(pdfSignPath, signPdf)
writeFileSync(pdfExecutedPath, executedPdf)

console.log('Agreement version ID:', SAMPLE_VERSION_ID)
console.log('Template version:', DEFAULT_REFERRAL_PARTNERSHIP_TERMS.agreementTemplateVersion)
console.log('Wrote:', htmlPath)
console.log('Wrote:', signableHtmlPath)
console.log('Wrote:', pdfDraftPath)
console.log('Wrote:', pdfSignPath)
console.log('Wrote:', pdfExecutedPath)
