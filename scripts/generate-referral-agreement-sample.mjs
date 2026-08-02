/**
 * Generate a sample referral partnership agreement PDF for counsel review.
 * Run: node scripts/generate-referral-agreement-sample.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildDraftAgreementHtml, DEFAULT_REFERRAL_PARTNERSHIP_TERMS } from '../server/referralPartnershipTerms.js'
import { createAgreementPdfBuffer } from '../server/referralPartnership.js'

const SAMPLE_VERSION_ID = 'RPA-SAMPLE-2026-v1'

const __dirname = dirname(fileURLToPath(import.meta.url))
const outDir = join(__dirname, '..', 'docs', 'samples')
mkdirSync(outDir, { recursive: true })

const html = buildDraftAgreementHtml({
  venueName: 'Sample Wedding Venue LLC',
  partnerLegalName: 'Sample Wedding Venue LLC',
  partnerAddress: '123 Example Lane, Brooklyn, NY 11201',
  signatoryName: 'Jordan Rivera',
  signatoryTitle: 'Director of Events',
  agencyLegalName: 'Aurora Sonnet LLC',
  agencyAddress: '[Configure Aurora Sonnet legal/mailing address in CRM — business address only]',
  agencySignatoryName: 'Lisa Dubocquet',
  agencySignatoryTitle: 'Founder & Artistic Director',
  effectiveDate: '2026-08-02',
  agreementVersionIdentifier: SAMPLE_VERSION_ID,
  terms: DEFAULT_REFERRAL_PARTNERSHIP_TERMS,
  draftBanner: true,
})

const htmlPath = join(outDir, 'referral-partnership-agreement-sample.html')
const pdfPath = join(outDir, 'referral-partnership-agreement-sample.pdf')
const metaPath = join(outDir, 'referral-partnership-agreement-sample-version.txt')
writeFileSync(htmlPath, html, 'utf8')

const pdf = await createAgreementPdfBuffer(html)
writeFileSync(pdfPath, pdf)
writeFileSync(metaPath, SAMPLE_VERSION_ID, 'utf8')

console.log('Agreement version ID:', SAMPLE_VERSION_ID)
console.log('Wrote:', htmlPath)
console.log('Wrote:', pdfPath)
