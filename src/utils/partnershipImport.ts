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

// Kept in sync with PartnershipOutreach.tsx's STAGES/FIT_LEVELS constants (duplicated here on
// purpose to avoid a circular import between the page and this standalone lib module). Partner
// type is imported as free text from venue tracker spreadsheets.
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
  sheetName?: string
  headerRowIndex?: number // 0-based row index in the chosen worksheet
}

const SKIP_SHEET_NAME_RE =
  /dashboard|template|email\s*template|^lists?$|qa\s*check|clean[\s-]*up|instructions|readme|summary|lookup|reference|changelog|metadata/i

const HEADER_KEYWORDS = [
  'company',
  'venue',
  'business',
  'organization',
  'email',
  'contact',
  'phone',
  'website',
  'instagram',
  'city',
  'region',
  'borough',
  'neighborhood',
  'state',
  'status',
  'stage',
  'priority',
  'fit',
  'notes',
  'name',
  'type',
  'url',
]

const DASHBOARD_HEADER_RE = /^(metric|value|notes|check|result|details|action|count|date)$/i

function trimRow(row: unknown[]): string[] {
  return row.map((cell) => String(cell ?? '').trim())
}

function nonEmptyCount(row: string[]): number {
  return row.filter(Boolean).length
}

function isLikelyTitleRow(row: string[]): boolean {
  const filled = row.filter(Boolean)
  if (filled.length === 0) return false
  if (filled.length === 1 && filled[0].length > 24) return true
  if (filled.length <= 2 && filled.some((c) => /tracker|dashboard|template|summary|qa review|outreach tracker/i.test(c))) return true
  return false
}

function isLikelyDashboardHeaderRow(row: string[]): boolean {
  const cells = row.filter(Boolean)
  if (cells.length < 2) return false
  const normalized = cells.map((c) => c.toLowerCase())
  const dashboardHits = normalized.filter((c) => DASHBOARD_HEADER_RE.test(c)).length
  return dashboardHits >= 2
}

function scoreHeaderRow(row: string[]): number {
  if (isLikelyTitleRow(row) || isLikelyDashboardHeaderRow(row)) return -1
  const nonEmpty = nonEmptyCount(row)
  if (nonEmpty < 3) return -1

  let score = Math.min(nonEmpty, 12)
  const normalized = row.map(normalize)

  for (const cell of normalized) {
    if (!cell) continue
    for (const kw of HEADER_KEYWORDS) {
      if (cell === kw || cell.includes(kw)) score += 2
    }
  }

  const hasCompanyLike = normalized.some((c) => /company|venue|business|organization/.test(c))
  const hasEmailLike = normalized.some((c) => /email|contact|directemail/.test(c))
  if (hasCompanyLike && hasEmailLike) score += 12
  if (normalized.some((c) => c === 'venuename' || c === 'companyname')) score += 8
  if (normalized.some((c) => c.includes('email'))) score += 4

  return score
}

function detectHeaderRow(grid: string[][]): number {
  const scanLimit = Math.min(grid.length, 40)
  let bestIdx = -1
  let bestScore = 0
  for (let i = 0; i < scanLimit; i++) {
    const row = trimRow(grid[i] ?? [])
    const score = scoreHeaderRow(row)
    if (score > bestScore) {
      bestScore = score
      bestIdx = i
    }
  }
  return bestScore > 0 ? bestIdx : 0
}

function sheetNamePenalty(name: string): number {
  if (SKIP_SHEET_NAME_RE.test(name)) return 40
  if (/venue|contact|outreach|lead|partner|prospect|crm|pipeline|tracker/i.test(name)) return -8
  return 0
}

function scoreWorksheet(name: string, grid: string[][]): number {
  if (grid.length === 0) return -100
  let score = -sheetNamePenalty(name)
  const headerIdx = detectHeaderRow(grid)
  const headerScore = scoreHeaderRow(trimRow(grid[headerIdx] ?? []))
  if (headerScore <= 0) return score - 50
  score += headerScore

  const headers = trimRow(grid[headerIdx] ?? [])
  const dataRows = grid.slice(headerIdx + 1).map(trimRow).filter((row) => nonEmptyCount(row) >= 2)
  score += Math.min(dataRows.length, 100) * 0.5

  const emailColGuess = headers.findIndex((h) => /email|contact/i.test(h))
  if (emailColGuess !== -1) {
    const emailLike = dataRows.filter((row) => /@/.test(row[emailColGuess] || '')).length
    score += Math.min(emailLike, 40) * 2
  }

  return score
}

function selectWorksheet(workbook: XLSX.WorkBook): { sheetName: string; grid: string[][] } | null {
  let best: { sheetName: string; grid: string[][]; score: number } | null = null
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName]
    if (!sheet) continue
    const grid = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: '', blankrows: true })
    const score = scoreWorksheet(sheetName, grid)
    if (!best || score > best.score) best = { sheetName, grid, score }
  }
  if (!best || best.score < 0) return null
  return { sheetName: best.sheetName, grid: best.grid }
}

function isDuplicateHeaderRow(row: string[], headers: string[]): boolean {
  const headerCells = headers.filter(Boolean)
  if (headerCells.length < 3) return false
  let matches = 0
  let compared = 0
  for (let i = 0; i < headers.length; i++) {
    const header = headers[i]
    const cell = row[i]
    if (!header) continue
    compared++
    if (cell && normalize(cell) === normalize(header)) matches++
  }
  return compared >= 3 && matches >= Math.ceil(compared * 0.6)
}

function isLikelyNonDataRow(row: string[], headers: string[]): boolean {
  if (nonEmptyCount(row) === 0) return true
  if (isLikelyTitleRow(row) || isLikelyDashboardHeaderRow(row)) return true
  if (isDuplicateHeaderRow(row, headers)) return true
  return false
}

/** Parses an already-loaded SheetJS workbook into headers + data rows. */
export function parseWorkbook(workbook: XLSX.WorkBook): ParsedSheet {
  const selected = selectWorksheet(workbook)
  if (!selected) return { headers: [], rows: [] }

  const { sheetName, grid } = selected
  const headerRowIndex = detectHeaderRow(grid)
  const headerRow = trimRow(grid[headerRowIndex] ?? [])
  const width = Math.max(headerRow.length, ...grid.slice(headerRowIndex + 1).map((r) => (r ?? []).length))
  const headers = Array.from({ length: width }, (_, i) => headerRow[i] ?? '')

  const rows = grid
    .slice(headerRowIndex + 1)
    .map((row) => Array.from({ length: width }, (_, i) => String(row?.[i] ?? '').trim()))
    .filter((row) => !isLikelyNonDataRow(row, headers))

  return { headers, rows, sheetName, headerRowIndex }
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
  if (workbook.SheetNames.length === 1) {
    const sheetName = workbook.SheetNames[0]
    const sheet = workbook.Sheets[sheetName]
    const grid = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: '', blankrows: true })
    const headerRowIndex = detectHeaderRow(grid)
    const headerRow = trimRow(grid[headerRowIndex] ?? [])
    const width = Math.max(headerRow.length, ...grid.slice(headerRowIndex + 1).map((r) => (r ?? []).length))
    const headers = Array.from({ length: width }, (_, i) => headerRow[i] ?? '')
    const rows = grid
      .slice(headerRowIndex + 1)
      .map((row) => Array.from({ length: width }, (_, i) => String(row?.[i] ?? '').trim()))
      .filter((row) => !isLikelyNonDataRow(row, headers))
    return { headers, rows, sheetName, headerRowIndex }
  }
  return parseWorkbook(workbook)
}

const FIELD_KEYWORDS: { field: MappableField; exact: string[]; contains: string[] }[] = [
  { field: 'companyName', exact: ['companyname', 'company', 'venuename', 'business', 'businessname', 'organization', 'org'], contains: ['company', 'venuename', 'business'] },
  { field: 'email', exact: ['email', 'emailaddress', 'emailcontact', 'directemail', 'contactemail'], contains: ['email'] },
  { field: 'contactName', exact: ['contactname', 'contactperson', 'fullname'], contains: ['contactname'] },
  { field: 'jobTitle', exact: ['jobtitle', 'contacttitle', 'title', 'role', 'position'], contains: ['jobtitle', 'contacttitle'] },
  { field: 'partnerType', exact: ['partnertype', 'venuetype', 'category'], contains: ['partnertype', 'venuetype'] },
  { field: 'website', exact: ['website', 'site', 'web'], contains: ['website'] },
  { field: 'instagram', exact: ['instagram', 'ig', 'insta'], contains: ['instagram', 'insta'] },
  { field: 'city', exact: ['city', 'neighborhood'], contains: ['city', 'neighborhood'] },
  { field: 'region', exact: ['region', 'state', 'province', 'borough'], contains: ['region', 'state', 'borough'] },
  { field: 'fitLevel', exact: ['fitlevel', 'priority'], contains: ['fitlevel', 'priority'] },
  { field: 'stage', exact: ['stage', 'status', 'pipelinestage', 'outreachstatus'], contains: ['stage', 'status'] },
  { field: 'notes', exact: ['notes', 'note', 'fitnotes', 'researchnotes', 'responsenotes', 'comments', 'comment', 'description'], contains: ['fitnotes', 'researchnotes', 'responsenotes'] },
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

  const headerRowNumber = (parsed.headerRowIndex ?? 0) + 1

  return parsed.rows.map((cells, i) => {
    const rowNumber = headerRowNumber + i + 1
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
    const partnerType = rawPartnerType || undefined
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
