/**
 * Generate v3 sample referral partnership agreement PDFs.
 * Run: node scripts/generate-referral-agreement-sample-v3.mjs
 * Preserves v1 and v2 sample files — writes separate v3 outputs only.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildAgreementHtml, DEFAULT_REFERRAL_PARTNERSHIP_TERMS } from '../server/referralPartnershipTerms.js'
import { renderAgreementPdfFromHtml } from '../server/referralAgreementPdf.js'

const SAMPLE_VERSION_ID = 'RPA-SAMPLE-2026-v3'

const __dirname = dirname(fileURLToPath(import.meta.url))
const outDir = join(__dirname, '..', 'docs', 'samples')
mkdirSync(outDir, { recursive: true })

const fields = {
  venueName: 'Fictional Garden Estate LLC',
  partnerLegalName: 'Fictional Garden Estate LLC',
  partnerAddress: '500 Sample Vineyard Road, Hudson Valley, NY 12545',
  partnerNoticeEmail: 'partnerships@fictional-garden-estate.example',
  signatoryName: 'Jordan Rivera',
  signatoryTitle: 'Director of Events',
  agencyLegalName: 'Aurora Sonnet LLC',
  agencyAddress: '100 Sample Business Plaza, Suite 200, New York, NY 10001',
  agencyNoticeEmail: 'notices@aurora-sonnet-example.test',
  agencySignatoryName: 'Lisa Dubocquet',
  agencySignatoryTitle: 'Founder & Artistic Director',
  effectiveDate: null,
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

const htmlPath = join(outDir, 'referral-partnership-agreement-sample-v3.html')
const signableHtmlPath = join(outDir, 'referral-partnership-agreement-sample-v3-signable.html')
const pdfDraftPath = join(outDir, 'referral-partnership-agreement-sample-v3-draft.pdf')
const pdfSignPath = join(outDir, 'referral-partnership-agreement-sample-v3.pdf')
const pdfExecutedPath = join(outDir, 'referral-partnership-agreement-sample-v3-executed.pdf')
const metaPath = join(outDir, 'referral-partnership-agreement-sample-v3-version.txt')

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
