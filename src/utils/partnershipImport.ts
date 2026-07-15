// Spreadsheet import for Partnership Outreach: parsing (.csv/.xlsx), column auto-detection,
// row validation, and duplicate detection. Pure logic — no API calls, no React — so it's easy to
// test and keeps PartnershipImportWizard.tsx focused on UI wiring.
import * as XLSX from 'xlsx'
import type { PartnershipContact } from '../api/db'

export type MappableField =
  | 'companyName'
  | 'partnerType'
  | 'contactName'
  | 'jobTitle'
  | 'email'
  | 'website'
  | 'instagram'
  | 'city'
  | 'region'
  | 'fitLevel'
  | 'notes'
  | 'stage'
  | ''

export const MAPPABLE_FIELDS: { id: MappableField; label: string; required?: boolean }[] = [
  { id: '', label: 'Ignore this column' },
  { id: 'companyName', label: 'Company / Venue name', required: true },
  { id: 'email', label: 'Email', required: true },
  { id: 'contactName', label: 'Contact name' },
  { id: 'jobTitle', label: 'Job title' },
  { id: 'partnerType', label: 'Partner type' },
  { id: 'website', label: 'Website' },
  { id: 'instagram', label: 'Instagram' },
  { id: 'city', label: 'City' },
  { id: 'region', label: 'Region' },
  { id: 'fitLevel', label: 'Fit level' },
  { id: 'stage', label: 'Stage' },
  { id: 'notes', label: 'Notes' },
]

// Kept in sync with PartnershipOutreach.tsx's STAGES/PARTNER_TYPES/FIT_LEVELS constants (duplicated
// here on purpose to avoid a circular import between the page and this standalone lib module).
const STAGE_OPTIONS: { id: string; label: string }[] = [
  { id: 'not_contacted', label: 'Not Contacted' },
  { id: 'first_email_sent', label: 'First Email Sent' },
  { id: 'follow_up_needed', label: 'Follow-Up Needed' },
  { id: 'replied', label: 'Replied' },
  { id: 'interested', label: 'Interested' },
  { id: 'meeting_scheduled', label: 'Meeting Scheduled' },
  { id: 'demo_or_showcase', label: 'Demo / Showcase' },
  { id: 'partnered', label: 'Partnered' },
  { id: 'closed_not_fit', label: 'Closed / Not Fit' },
]
const PARTNER_TYPE_OPTIONS: { id: string; label: string }[] = [
  { id: 'venue', label: 'Venue' },
  { id: 'planner', label: 'Planner' },
  { id: 'photographer', label: 'Photographer' },
  { id: 'hotel', label: 'Hotel' },
  { id: 'private_club', label: 'Private Club' },
  { id: 'florist', label: 'Florist' },
  { id: 'other', label: 'Other' },
]
const FIT_LEVEL_OPTIONS: { id: string; label: string }[] = [
  { id: 'high', label: 'High' },
  { id: 'medium', label: 'Medium' },
  { id: 'low', label: 'Low' },
]

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function normalize(s: string): string {
  return (s || '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

function matchOption(value: string, options: { id: string; label: string }[]): string | undefined {
  const n = normalize(value)
  if (!n) return undefined
  const hit = options.find((o) => normalize(o.id) === n || normalize(o.label) === n)
  return hit?.id
}

export interface ParsedSheet {
  headers: string[]
  rows: string[][]
}

/** Reads a .csv/.xlsx/.xls File into a header row + data rows using SheetJS. */
export async function parseSpreadsheetFile(file: File): Promise<ParsedSheet> {
  const isCsv = /\.csv$/i.test(file.name)
  let workbook: XLSX.WorkBook
  if (isCsv) {
    const text = await file.text()
    workbook = XLSX.read(text, { type: 'string' })
  } else {
    const buffer = await file.arrayBuffer()
    workbook = XLSX.read(buffer, { type: 'array' })
  }
  const sheetName = workbook.SheetNames[0]
  if (!sheetName) return { headers: [], rows: [] }
  const sheet = workbook.Sheets[sheetName]
  const grid = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: '', blankrows: false })
  const headers = (grid[0] ?? []).map((h) => String(h ?? '').trim())
  const rows = grid.slice(1).map((row) => headers.map((_, i) => String(row[i] ?? '').trim()))
  return { headers, rows }
}

const FIELD_KEYWORDS: { field: MappableField; exact: string[]; contains: string[] }[] = [
  { field: 'companyName', exact: ['companyname', 'company', 'venuename', 'venue', 'business', 'businessname', 'organization', 'org'], contains: ['company', 'venue', 'business'] },
  { field: 'email', exact: ['email', 'emailaddress', 'e-mail'.replace('-', '')], contains: ['email'] },
  { field: 'contactName', exact: ['contactname', 'contact', 'fullname', 'name'], contains: ['contact'] },
  { field: 'jobTitle', exact: ['jobtitle', 'title', 'role', 'position'], contains: ['title', 'role'] },
  { field: 'partnerType', exact: ['partnertype', 'type', 'category'], contains: ['type', 'category'] },
  { field: 'website', exact: ['website', 'site', 'url', 'web'], contains: ['website', 'url'] },
  { field: 'instagram', exact: ['instagram', 'ig', 'insta'], contains: ['instagram', 'insta'] },
  { field: 'city', exact: ['city'], contains: ['city'] },
  { field: 'region', exact: ['region', 'state', 'province'], contains: ['region', 'state'] },
  { field: 'fitLevel', exact: ['fitlevel', 'fit', 'priority'], contains: ['fit', 'priority'] },
  { field: 'stage', exact: ['stage', 'status', 'pipelinestage'], contains: ['stage', 'status'] },
  { field: 'notes', exact: ['notes', 'note', 'comments', 'comment', 'description'], contains: ['note', 'comment', 'description'] },
]

/** Best-guess column -> field mapping by header text. Always editable afterward. */
export function autoDetectMapping(headers: string[]): MappableField[] {
  const normalizedHeaders = headers.map(normalize)
  const mapping: MappableField[] = headers.map(() => '')
  const claimed = new Set<MappableField>()

  for (const { field, exact } of FIELD_KEYWORDS) {
    if (claimed.has(field)) continue
    const idx = normalizedHeaders.findIndex((h, i) => mapping[i] === '' && exact.includes(h))
    if (idx !== -1) {
      mapping[idx] = field
      claimed.add(field)
    }
  }
  for (const { field, contains } of FIELD_KEYWORDS) {
    if (claimed.has(field)) continue
    const idx = normalizedHeaders.findIndex((h, i) => mapping[i] === '' && contains.some((kw) => h.includes(kw)))
    if (idx !== -1) {
      mapping[idx] = field
      claimed.add(field)
    }
  }
  return mapping
}

export interface ImportRow {
  rowNumber: number // 1-based, matches spreadsheet row (header = row 1)
  companyName: string
  email: string
  partnerType?: string
  contactName?: string
  jobTitle?: string
  website?: string
  instagram?: string
  city?: string
  region?: string
  fitLevel?: string
  notes?: string
  stage?: string
  errors: string[]
  needsReview: string[]
  duplicateOfId?: string
  duplicateReason?: 'existing-contact' | 'in-file'
  duplicateRowNumber?: number
  possibleDuplicateOfId?: string
  include: boolean
}

/** Validates + classifies every row: required fields, email format, exact-email dedup (existing
 * contacts and within this same file), and a softer possible-duplicate check by company+city. */
export function buildImportRows(
  parsed: ParsedSheet,
  mapping: MappableField[],
  existingContacts: PartnershipContact[]
): ImportRow[] {
  const existingByEmail = new Map<string, string>()
  for (const c of existingContacts) existingByEmail.set(normalize(c.email), c.id)

  const existingByCompanyCity = new Map<string, string>()
  for (const c of existingContacts) {
    if (!c.companyName || !c.city) continue
    existingByCompanyCity.set(`${normalize(c.companyName)}|${normalize(c.city)}`, c.id)
  }

  const seenEmailsInFile = new Map<string, number>() // normalized email -> first row number seen

  return parsed.rows.map((cells, i) => {
    const rowNumber = i + 2 // +1 for header, +1 for 1-based
    const get = (field: MappableField): string => {
      const colIdx = mapping.findIndex((m) => m === field)
      return colIdx === -1 ? '' : (cells[colIdx] || '').trim()
    }

    const companyName = get('companyName')
    const email = get('email')
    const rawPartnerType = get('partnerType')
    const rawFitLevel = get('fitLevel')
    const rawStage = get('stage')

    const errors: string[] = []
    if (!companyName) errors.push('Missing company name')
    if (!email) errors.push('Missing email')
    else if (!EMAIL_RE.test(email)) errors.push('Invalid email format')

    const needsReview: string[] = []
    const partnerType = rawPartnerType ? matchOption(rawPartnerType, PARTNER_TYPE_OPTIONS) : undefined
    if (rawPartnerType && !partnerType) needsReview.push(`Unrecognized partner type "${rawPartnerType}"`)
    const fitLevel = rawFitLevel ? matchOption(rawFitLevel, FIT_LEVEL_OPTIONS) : undefined
    if (rawFitLevel && !fitLevel) needsReview.push(`Unrecognized fit level "${rawFitLevel}"`)
    const stage = rawStage ? matchOption(rawStage, STAGE_OPTIONS) : undefined
    if (rawStage && !stage) needsReview.push(`Unrecognized stage "${rawStage}" — will default to Not Contacted`)

    let duplicateOfId: string | undefined
    let duplicateReason: ImportRow['duplicateReason']
    let duplicateRowNumber: number | undefined
    let possibleDuplicateOfId: string | undefined

    const normEmail = normalize(email)
    if (normEmail) {
      const firstSeenRow = seenEmailsInFile.get(normEmail)
      if (firstSeenRow != null) {
        duplicateOfId = undefined
        duplicateReason = 'in-file'
        duplicateRowNumber = firstSeenRow
      } else {
        seenEmailsInFile.set(normEmail, rowNumber)
        const existingId = existingByEmail.get(normEmail)
        if (existingId) {
          duplicateOfId = existingId
          duplicateReason = 'existing-contact'
        }
      }
    }

    if (!duplicateReason && companyName && get('city')) {
      const key = `${normalize(companyName)}|${normalize(get('city'))}`
      const possibleId = existingByCompanyCity.get(key)
      if (possibleId) possibleDuplicateOfId = possibleId
    }

    return {
      rowNumber,
      companyName,
      email,
      partnerType,
      contactName: get('contactName') || undefined,
      jobTitle: get('jobTitle') || undefined,
      website: get('website') || undefined,
      instagram: get('instagram') || undefined,
      city: get('city') || undefined,
      region: get('region') || undefined,
      fitLevel,
      notes: get('notes') || undefined,
      stage,
      errors,
      needsReview,
      duplicateOfId,
      duplicateReason,
      duplicateRowNumber,
      possibleDuplicateOfId,
      include: errors.length === 0 && duplicateReason !== 'in-file',
    }
  })
}

/** Builds a downloadable CSV of rows that had validation errors or failed during import, with reasons. */
export function buildErrorCsv(rows: { row: ImportRow; reason: string }[]): string {
  const headers = ['Row', 'Company', 'Email', 'Contact Name', 'Reason']
  const escape = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
  const lines = [headers.join(',')]
  for (const { row, reason } of rows) {
    lines.push(
      [row.rowNumber, row.companyName, row.email, row.contactName || '', reason].map((v) => escape(String(v))).join(',')
    )
  }
  return lines.join('\n')
}

export function downloadTextFile(filename: string, content: string, mime = 'text/csv') {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
