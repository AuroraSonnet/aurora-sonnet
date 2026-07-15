import { useMemo, useRef, useState } from 'react'
import { useApp } from '../context/AppContext'
import { apiCreatePartnershipContact, apiUpdatePartnershipContact, apiAddOutreachActivity } from '../api/db'
import {
  parseSpreadsheetFile,
  autoDetectMapping,
  buildImportRows,
  buildErrorCsv,
  downloadTextFile,
  contactEmailDisplay,
  MAPPABLE_FIELDS,
  type MappableField,
  type ParsedSheet,
  type ImportRow,
} from '../utils/partnershipImport'
import styles from './PartnershipOutreach.module.css'

type Step = 'upload' | 'mapping' | 'preview' | 'importing' | 'summary'
type DuplicateMode = 'skip' | 'update' | 'new'

interface ImportSummary {
  total: number
  created: number
  updated: number
  skipped: number
  failed: number
  needsReview: number
  errorRows: { row: ImportRow; reason: string }[]
}

const ACCEPTED_EXT = /\.(csv|xlsx|xls)$/i
const MAX_FILE_SIZE_BYTES = 15 * 1024 * 1024 // 15MB — generous for a contacts spreadsheet, guards against an accidental huge/wrong file freezing the tab

export default function PartnershipImportWizard({ onClose }: { onClose: () => void }) {
  const { state, actions } = useApp()
  const existingContacts = state.partnershipContacts ?? []

  const [step, setStep] = useState<Step>('upload')
  const [dragActive, setDragActive] = useState(false)
  const [fileError, setFileError] = useState<string | null>(null)
  const [fileName, setFileName] = useState('')
  const [parsed, setParsed] = useState<ParsedSheet | null>(null)
  const [mapping, setMapping] = useState<MappableField[]>([])

  const [importRows, setImportRows] = useState<ImportRow[]>([])
  const [rowIncluded, setRowIncluded] = useState<boolean[]>([])
  const [dupMode, setDupMode] = useState<DuplicateMode>('skip')

  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [summary, setSummary] = useState<ImportSummary | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)

  const mappedRequired = useMemo(() => {
    const has = (f: MappableField) => mapping.includes(f)
    return has('companyName') && has('email')
  }, [mapping])

  const counts = useMemo(() => {
    const included = importRows.filter((_, i) => rowIncluded[i])
    const selectable = importRows.filter((r) => r.errors.length === 0 && r.duplicateReason !== 'in-file')
    return {
      total: importRows.length,
      included: included.length,
      selectable: selectable.length,
      errors: importRows.filter((r) => r.errors.length > 0).length,
      duplicates: importRows.filter((r) => r.duplicateReason === 'existing-contact').length,
      inFileDupes: importRows.filter((r) => r.duplicateReason === 'in-file').length,
      possibleDuplicates: importRows.filter((r) => r.possibleDuplicateOfId).length,
      needsReview: importRows.filter((r) => r.needsReview.length > 0).length,
    }
  }, [importRows, rowIncluded])

  // Warn (non-blocking) if two spreadsheet columns were mapped to the same field — only the first
  // mapped column is actually read, so a second one would otherwise be silently ignored.
  const duplicateMappings = useMemo(() => {
    const seen = new Map<MappableField, number>()
    const dupes = new Set<MappableField>()
    mapping.forEach((m) => {
      if (!m) return
      if (seen.has(m)) dupes.add(m)
      else seen.set(m, 1)
    })
    return dupes
  }, [mapping])

  async function handleFile(file: File) {
    setFileError(null)
    if (!ACCEPTED_EXT.test(file.name)) {
      setFileError('Please choose a .csv, .xlsx, or .xls file.')
      return
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      setFileError(`This file is too large (${(file.size / (1024 * 1024)).toFixed(1)}MB). Please split it into smaller files, under 15MB each.`)
      return
    }
    try {
      const result = await parseSpreadsheetFile(file)
      if (result.headers.length === 0) {
        setFileError('Could not find a header row in this file.')
        return
      }
      if (result.rows.length === 0) {
        setFileError('This file has headers but no data rows.')
        return
      }
      setFileName(file.name)
      setParsed(result)
      setMapping(autoDetectMapping(result.headers))
      setStep('mapping')
    } catch (err) {
      setFileError(err instanceof Error ? `Could not read this file: ${err.message}` : 'Could not read this file.')
    }
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragActive(false)
    const file = e.dataTransfer.files?.[0]
    if (file) void handleFile(file)
  }

  const proceedToPreview = () => {
    if (!parsed) return
    const rows = buildImportRows(parsed, mapping, existingContacts)
    setImportRows(rows)
    setRowIncluded(rows.map((r) => r.include))
    setStep('preview')
  }

  const toggleRow = (i: number) => {
    setRowIncluded((prev) => prev.map((v, idx) => (idx === i ? !v : v)))
  }

  const toggleAll = (checked: boolean) => {
    setRowIncluded(importRows.map((r) => checked && r.errors.length === 0 && r.duplicateReason !== 'in-file'))
  }

  function buildCreatePayload(row: ImportRow): Record<string, unknown> {
    return {
      companyName: row.companyName,
      email: row.email,
      outreachMethod: row.outreachMethod || 'email',
      contactFormUrl: row.contactFormUrl,
      partnerType: row.partnerType || undefined,
      contactName: row.contactName,
      jobTitle: row.jobTitle,
      website: row.website,
      instagram: row.instagram,
      city: row.city,
      region: row.region,
      fitLevel: row.fitLevel || undefined,
      notes: row.notes,
      stage: row.stage || undefined,
      source: 'import',
    }
  }

  function buildUpdatePayload(row: ImportRow): Record<string, unknown> {
    const updates: Record<string, unknown> = {}
    if (row.companyName) updates.companyName = row.companyName
    if (row.partnerType) updates.partnerType = row.partnerType
    if (row.contactName) updates.contactName = row.contactName
    if (row.jobTitle) updates.jobTitle = row.jobTitle
    if (row.website) updates.website = row.website
    if (row.contactFormUrl) updates.contactFormUrl = row.contactFormUrl
    if (row.instagram) updates.instagram = row.instagram
    if (row.city) updates.city = row.city
    if (row.region) updates.region = row.region
    if (row.fitLevel) updates.fitLevel = row.fitLevel
    if (row.notes) updates.notes = row.notes
    if (row.stage) updates.stage = row.stage
    if (row.outreachMethod) updates.outreachMethod = row.outreachMethod
    return updates
  }

  const runImport = async () => {
    const included = importRows
      .map((row, i) => ({ row, i }))
      .filter(({ i }) => rowIncluded[i])

    setStep('importing')
    setProgress({ done: 0, total: included.length })

    let created = 0
    let updated = 0
    let skipped = 0
    let failed = 0
    let needsReview = 0
    const errorRows: { row: ImportRow; reason: string }[] = []

    for (const { row } of included) {
      if (row.needsReview.length > 0 || row.possibleDuplicateOfId) needsReview += 1

      try {
        if (row.duplicateReason === 'in-file') {
          skipped += 1
        } else if (row.duplicateReason === 'existing-contact' && row.duplicateOfId) {
          if (dupMode === 'skip') {
            skipped += 1
          } else if (dupMode === 'update') {
            const result = await apiUpdatePartnershipContact(row.duplicateOfId, buildUpdatePayload(row))
            if (result.ok) {
              updated += 1
              await apiAddOutreachActivity(row.duplicateOfId, {
                type: 'note',
                body: `Imported from ${fileName} (row ${row.rowNumber}) — updated existing contact.`,
              })
            } else {
              failed += 1
              errorRows.push({ row, reason: result.error })
            }
          } else {
            const result = await apiCreatePartnershipContact(buildCreatePayload(row))
            if (result.ok) {
              created += 1
              await apiAddOutreachActivity(result.id, {
                type: 'note',
                body: `Imported from ${fileName} (row ${row.rowNumber}).`,
              })
            } else {
              failed += 1
              errorRows.push({ row, reason: `${result.error} (email already exists — cannot import as new)` })
            }
          }
        } else {
          const result = await apiCreatePartnershipContact(buildCreatePayload(row))
          if (result.ok) {
            created += 1
            await apiAddOutreachActivity(result.id, {
              type: 'note',
              body: `Imported from ${fileName} (row ${row.rowNumber}).`,
            })
          } else {
            failed += 1
            errorRows.push({ row, reason: result.error })
          }
        }
      } catch {
        failed += 1
        errorRows.push({ row, reason: 'Network error while importing this row' })
      }
      setProgress((p) => ({ ...p, done: p.done + 1 }))
    }

    // Pre-import validation errors were never attempted above (their checkbox is disabled) —
    // include them in the downloadable error file too so it accounts for every problem row.
    importRows.forEach((row, i) => {
      if (!rowIncluded[i] && row.errors.length > 0) {
        errorRows.push({ row, reason: row.errors.join('; ') })
      }
    })

    // In-file duplicates are excluded from `included` by default (their checkbox is disabled), so
    // they never reach the loop above — count them as skipped here so the summary total reconciles
    // with the row count shown in the preview step instead of silently dropping them from every bucket.
    importRows.forEach((row, i) => {
      if (!rowIncluded[i] && row.errors.length === 0 && row.duplicateReason === 'in-file') {
        skipped += 1
      }
    })

    await actions.refreshState()
    setSummary({
      total: importRows.length,
      created,
      updated,
      skipped,
      failed,
      needsReview,
      errorRows,
    })
    setStep('summary')
  }

  const downloadErrors = () => {
    if (!summary || summary.errorRows.length === 0) return
    downloadTextFile(`import-errors-${fileName.replace(/\.[^.]+$/, '')}.csv`, buildErrorCsv(summary.errorRows))
  }

  const canClose = step !== 'importing'

  return (
    <div className={styles.drawerOverlay} onClick={() => canClose && onClose()} role="dialog" aria-modal="true" aria-label="Import partnership contacts">
      <div className={styles.importModal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.drawerHeader}>
          <h2>Import contacts</h2>
          {canClose && (
            <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Close">
              ×
            </button>
          )}
        </div>

        {step === 'upload' && (
          <div className={styles.importUploadStep}>
            {fileError && <p className={styles.error} role="alert">{fileError}</p>}
            <div
              className={styles.dropzone}
              data-active={dragActive}
              onDragOver={(e) => { e.preventDefault(); setDragActive(true) }}
              onDragLeave={() => setDragActive(false)}
              onDrop={onDrop}
            >
              <p>Drag a .csv or .xlsx file here</p>
              <p className={styles.hint}>or</p>
              <button type="button" className={styles.submitBtn} onClick={() => fileInputRef.current?.click()}>
                Browse files
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.xlsx,.xls"
                className={styles.visuallyHidden}
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) void handleFile(file)
                  e.target.value = ''
                }}
              />
            </div>
          </div>
        )}

        {step === 'mapping' && parsed && (
          <div className={styles.importStep}>
            <p className={styles.hint}>
              {fileName} — {parsed.rows.length} row{parsed.rows.length === 1 ? '' : 's'} detected. Map each column to a field, or ignore it.
            </p>
            {!mappedRequired && <p className={styles.error} role="alert">Company name and Email must both be mapped to continue.</p>}
            {duplicateMappings.size > 0 && (
              <p className={styles.error} role="alert">
                {Array.from(duplicateMappings).map((f) => MAPPABLE_FIELDS.find((mf) => mf.id === f)?.label ?? f).join(', ')} {duplicateMappings.size === 1 ? 'is' : 'are'} mapped to more than one column — only the first will be used. Set the extra column(s) to &quot;Ignore this column&quot;.
              </p>
            )}
            <div className={styles.mappingTableWrap}>
              <table className={styles.importTable}>
                <thead>
                  <tr>
                    <th>Column</th>
                    <th>Sample value</th>
                    <th>Maps to</th>
                  </tr>
                </thead>
                <tbody>
                  {parsed.headers.map((header, i) => (
                    <tr key={i}>
                      <td>{header || <em>(untitled)</em>}</td>
                      <td className={styles.sampleCell}>{parsed.rows[0]?.[i] || <span className={styles.hint}>—</span>}</td>
                      <td>
                        <select
                          className={styles.select}
                          value={mapping[i] || ''}
                          onChange={(e) => setMapping((m) => m.map((v, idx) => (idx === i ? (e.target.value as MappableField) : v)))}
                        >
                          {MAPPABLE_FIELDS.map((f) => (
                            <option key={f.id || 'ignore'} value={f.id}>{f.label}</option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className={styles.formActions}>
              <button type="button" className={styles.cancelBtn} onClick={() => setStep('upload')}>Back</button>
              <button type="button" className={styles.submitBtn} disabled={!mappedRequired} onClick={proceedToPreview}>
                Continue
              </button>
            </div>
          </div>
        )}

        {step === 'preview' && (
          <div className={styles.importStep}>
            <div className={styles.importSummaryBar}>
              <span>{counts.total} rows</span>
              <span>{counts.included} will be imported</span>
              {counts.errors > 0 && <span className={styles.reviewCount}>{counts.errors} with errors</span>}
              {counts.duplicates > 0 && <span className={styles.dupeCount}>{counts.duplicates} match existing contacts</span>}
              {counts.inFileDupes > 0 && <span className={styles.dupeCount}>{counts.inFileDupes} duplicated within this file</span>}
              {counts.possibleDuplicates > 0 && <span className={styles.reviewCount}>{counts.possibleDuplicates} possible duplicates</span>}
              {counts.needsReview > 0 && <span className={styles.reviewCount}>{counts.needsReview} need review</span>}
            </div>

            {counts.duplicates > 0 && (
              <div className={styles.dupModeRow}>
                <span>For rows matching an existing contact by email:</span>
                <label><input type="radio" name="dupMode" checked={dupMode === 'skip'} onChange={() => setDupMode('skip')} /> Skip duplicates</label>
                <label><input type="radio" name="dupMode" checked={dupMode === 'update'} onChange={() => setDupMode('update')} /> Update existing contacts</label>
                <label><input type="radio" name="dupMode" checked={dupMode === 'new'} onChange={() => setDupMode('new')} /> Import as new (will fail — email must be unique)</label>
              </div>
            )}

            <div className={styles.mappingTableWrap}>
              <table className={styles.importTable}>
                <thead>
                  <tr>
                    <th>
                      <input
                        type="checkbox"
                        aria-label="Select all"
                        checked={counts.selectable > 0 && counts.included === counts.selectable}
                        onChange={(e) => toggleAll(e.target.checked)}
                      />
                    </th>
                    <th>Row</th>
                    <th>Company</th>
                    <th>Email</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {importRows.map((row, i) => (
                    <tr key={i} data-error={row.errors.length > 0}>
                      <td>
                        <input
                          type="checkbox"
                          checked={rowIncluded[i]}
                          disabled={row.errors.length > 0 || row.duplicateReason === 'in-file'}
                          onChange={() => toggleRow(i)}
                        />
                      </td>
                      <td>{row.rowNumber}</td>
                      <td>{row.companyName || <em>—</em>}</td>
                      <td>{contactEmailDisplay({ email: row.email, outreachMethod: row.outreachMethod }) || <em>—</em>}</td>
                      <td className={styles.statusCell}>
                        {row.errors.length > 0 && (
                          <span className={styles.badgeError} title={row.errors.join('; ')}>Error: {row.errors[0]}</span>
                        )}
                        {row.duplicateReason === 'existing-contact' && (
                          <span className={styles.badgeDupe}>Existing contact ({dupMode === 'skip' ? 'will skip' : dupMode === 'update' ? 'will update' : 'will fail'})</span>
                        )}
                        {row.duplicateReason === 'in-file' && (
                          <span className={styles.badgeDupe}>Duplicate of row {row.duplicateRowNumber} in this file — will skip</span>
                        )}
                        {row.possibleDuplicateOfId && (
                          <span className={styles.badgeReview}>Possible duplicate (same company + city)</span>
                        )}
                        {row.needsReview.map((r, ri) => (
                          <span key={ri} className={styles.badgeReview} title={r}>{r}</span>
                        ))}
                        {row.errors.length === 0 && !row.duplicateReason && !row.possibleDuplicateOfId && row.needsReview.length === 0 && (
                          <span className={styles.badgeOk}>Ready</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className={styles.formActions}>
              <button type="button" className={styles.cancelBtn} onClick={() => setStep('mapping')}>Back</button>
              <button type="button" className={styles.submitBtn} disabled={counts.included === 0} onClick={runImport}>
                Import {counts.included} contact{counts.included === 1 ? '' : 's'}
              </button>
            </div>
          </div>
        )}

        {step === 'importing' && (
          <div className={styles.importStep}>
            <p className={styles.hint}>Importing {progress.done} of {progress.total}…</p>
            <div className={styles.progressTrack}>
              <div className={styles.progressFill} style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} />
            </div>
          </div>
        )}

        {step === 'summary' && summary && (
          <div className={styles.importStep}>
            <div className={styles.summaryGrid}>
              <div className={styles.summaryStat}><strong>{summary.created}</strong><span>Created</span></div>
              <div className={styles.summaryStat}><strong>{summary.updated}</strong><span>Updated</span></div>
              <div className={styles.summaryStat}><strong>{summary.skipped}</strong><span>Skipped</span></div>
              <div className={styles.summaryStat} data-warn={summary.failed > 0}><strong>{summary.failed}</strong><span>Failed</span></div>
            </div>
            {summary.needsReview > 0 && (
              <p className={styles.hint}>{summary.needsReview} imported row{summary.needsReview === 1 ? '' : 's'} were flagged as possible duplicates or had unrecognized values — worth a look in the pipeline.</p>
            )}
            {summary.errorRows.length > 0 && (
              <button type="button" className={styles.cancelBtn} onClick={downloadErrors}>
                Download error rows (CSV)
              </button>
            )}
            <div className={styles.formActions}>
              <button type="button" className={styles.submitBtn} onClick={onClose}>Done</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
