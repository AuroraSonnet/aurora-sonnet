import { useMemo, useState, useEffect, useCallback, type CSSProperties } from 'react'
import { useApp } from '../context/AppContext'
import { apiCreatePartnerReferral, apiDeletePartnerReferral, apiUpdatePartnerReferral, apiAcceptPartnerReferralDecision, apiRejectPartnerReferralDecision, apiGeneratePartnerReferralCommissionStatement, apiRecordPartnerReferralCommissionStatementDelivery, partnerReferralCommissionStatementUrl, type PartnerReferral, type PartnerReferralExpenseLine } from '../api/db'
import { getInquiryApiBaseUrl } from '../utils/inquiryApiUrl'
import styles from './PartnerReferrals.module.css'

const LEGACY_COMMISSION_RATE = 0.05
const LEGACY_MIN_PAYOUT = 100

type TermsSnap = {
  termsKind?: string
  commissionRate?: number
  minPayoutAmount?: number | null
  useLegacyExpenseDeduction?: boolean
}

function parseTermsSnapshot(raw: unknown): TermsSnap | null {
  if (raw == null || raw === '') return null
  if (typeof raw === 'object') return raw as TermsSnap
  try {
    return JSON.parse(String(raw)) as TermsSnap
  } catch {
    return null
  }
}

function legacyExpenseMode(terms: TermsSnap | null): boolean {
  if (!terms) return true
  return terms.termsKind === 'legacy_default' || Boolean(terms.useLegacyExpenseDeduction)
}

function commissionRateFromTerms(terms: TermsSnap | null): number {
  if (terms?.termsKind === 'referral_partnership_mvp') {
    const rate = terms.commissionRate
    return Number.isFinite(rate) ? (rate as number) : 0.1
  }
  const rate = terms?.commissionRate
  return Number.isFinite(rate) ? (rate as number) : LEGACY_COMMISSION_RATE
}

function minPayoutFromTerms(terms: TermsSnap | null): number {
  if (terms?.termsKind === 'referral_partnership_mvp') return 0
  if (terms?.termsKind === 'legacy_default' || terms?.useLegacyExpenseDeduction) {
    const min = terms.minPayoutAmount
    return Number.isFinite(min) && min != null ? (min as number) : LEGACY_MIN_PAYOUT
  }
  if (terms?.minPayoutAmount == null) return 0
  return Number.isFinite(terms.minPayoutAmount) ? (terms.minPayoutAmount as number) : LEGACY_MIN_PAYOUT
}

function payoutFormulaLabel(terms: TermsSnap | null): string {
  const ratePct = Math.round(commissionRateFromTerms(terms) * 100)
  const min = minPayoutFromTerms(terms)
  if (min > 0) return `max(${ratePct}% of commissionable, $${min})`
  return `${ratePct}% of commissionable (no minimum)`
}

type EditorState = null | { type: 'new' } | { type: 'edit'; row: PartnerReferral }

/** Aligns with server `partnerReferralPayout.js` normalization. */
function normalizeReferralStatusKey(raw: string): string {
  let s = String(raw ?? '')
    .toLowerCase()
    .trim()
    .replace(/[\s-]+/g, '_')
  if (s === 'closedlost') s = 'closed_lost'
  return s
}

function referralStatusEligibleForBookingPayout(status: string): boolean {
  const key = normalizeReferralStatusKey(status)
  if (key === 'confirmed') return true
  if (key === 'booked' || key === 'paid') return true
  return false
}

const REFERRAL_STATUS_LABELS: Record<string, string> = {
  new: 'New',
  under_review: 'Under Review',
  contacted: 'Contacted',
  booked: 'Booked',
  closed_lost: 'Closed Lost',
  paid: 'Paid',
  pending: 'New (legacy)',
  confirmed: 'Booked (legacy)',
}

const REFERRAL_STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: 'new', label: 'New' },
  { value: 'under_review', label: 'Under Review' },
  { value: 'contacted', label: 'Contacted' },
  { value: 'booked', label: 'Booked' },
  { value: 'closed_lost', label: 'Closed Lost' },
  { value: 'pending', label: 'New (legacy)' },
  { value: 'confirmed', label: 'Booked (legacy)' },
]

const PAYOUT_STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: 'none', label: '—' },
  { value: 'pending', label: 'Pending' },
  { value: 'paid', label: 'Paid (legacy)' },
  { value: 'completed', label: 'Completed' },
]

const DECISION_STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  accepted: 'Accepted',
  rejected: 'Rejected',
  overdue: 'Overdue',
}

function requiresPartnershipDecision(terms: TermsSnap | null): boolean {
  return terms?.termsKind === 'referral_partnership_mvp'
}

function isReferralDecisionAccepted(row: PartnerReferral): boolean {
  return String(row.referralDecisionStatus || '').toLowerCase() === 'accepted'
}

function referralStatusLabel(status: string): string {
  const key = normalizeReferralStatusKey(status)
  return REFERRAL_STATUS_LABELS[key] ?? status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function referralStatusVariant(status: string): 'pipeline' | 'won' | 'lost' | 'paidout' {
  const key = normalizeReferralStatusKey(status)
  if (key === 'closed_lost') return 'lost'
  if (key === 'paid') return 'paidout'
  if (key === 'booked' || key === 'confirmed') return 'won'
  return 'pipeline'
}

const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
})

function formatUsd(n: number): string {
  return usd.format(Number.isFinite(n) ? n : 0)
}

function compareReferrals(a: PartnerReferral, b: PartnerReferral): number {
  const da = String(a.submissionDate || '').localeCompare(String(b.submissionDate || ''))
  if (da !== 0) return -da
  return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))
}

function partnerKeyForReferral(r: PartnerReferral): string {
  const email = String(r.partnerEmail ?? '')
    .trim()
    .toLowerCase()
  if (email) return `email:${email}`
  const name = String(r.partnerName ?? '')
    .trim()
    .toLowerCase()
  return `name:${name || 'unknown'}`
}

function hashHue(input: string): number {
  let h = 0
  for (let i = 0; i < input.length; i++) h = (h * 31 + input.charCodeAt(i)) >>> 0
  return h % 360
}

function matchesPartnerSearch(r: PartnerReferral, q: string): boolean {
  const t = q.trim().toLowerCase()
  if (!t) return true
  const hay = [
    r.partnerName,
    r.partnerEmail,
    r.companyName,
    r.clientName,
    r.clientEmail,
    r.referralReference,
    r.id,
  ]
    .map((x) => String(x ?? '').toLowerCase())
    .join(' ')
  return hay.includes(t) || hay.indexOf(t) >= 0
}

function parseWholeUsd(raw: string): number {
  const n = Math.round(Number(String(raw).replace(/[^0-9.-]/g, '')))
  return Number.isFinite(n) ? Math.max(0, n) : 0
}

function optionalOverride(raw: string): number | null {
  const t = String(raw).trim()
  if (t === '') return null
  const n = Math.round(Number(t.replace(/[^0-9.-]/g, '')))
  return Number.isFinite(n) ? Math.max(0, n) : null
}

function referralStatusSelectValue(status: string): string {
  const k = normalizeReferralStatusKey(status)
  const allowed = new Set(REFERRAL_STATUS_OPTIONS.map((o) => o.value))
  if (allowed.has(k)) return k
  const raw = String(status ?? '').trim()
  return raw || 'new'
}

function toDateInputValue(iso?: string): string {
  const s = String(iso ?? '').trim()
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : ''
}

function newLineId(): string {
  try {
    return crypto.randomUUID()
  } catch {
    return `exp-${Date.now()}-${Math.random().toString(16).slice(2)}`
  }
}

type ExpenseLineDraft = { id: string; name: string; amountStr: string }

function newDraftLine(): ExpenseLineDraft {
  return { id: newLineId(), name: '', amountStr: '0' }
}

function draftLinesFromReferral(r: PartnerReferral): ExpenseLineDraft[] {
  const lines = r.expenseLineItems ?? []
  if (lines.length > 0) {
    return lines.map((l) => ({ id: l.id || newLineId(), name: l.name, amountStr: String(l.amount ?? 0) }))
  }
  const t = r.travelExpenseAmount ?? 0
  const h = r.hotelExpenseAmount ?? 0
  const out: ExpenseLineDraft[] = []
  if (t > 0) out.push({ id: newLineId(), name: 'Travel', amountStr: String(t) })
  if (h > 0) out.push({ id: newLineId(), name: 'Hotel', amountStr: String(h) })
  return out
}

function buildPayload(
  fields: {
    partnerName: string
    companyName: string
    partnerEmail: string
    clientName: string
    clientEmail: string
    clientPhone: string
    eventDate: string
    eventLocation: string
    notes: string
    referralStatus: string
    payoutStatus: string
    bookingAmount: string
    expenseLines: ExpenseLineDraft[]
    commissionableOverride: string
    payoutOverride: string
    venueId: string
    referringContactId: string
    linkedProjectId: string
  }
): Record<string, unknown> {
  const linesPayload: PartnerReferralExpenseLine[] = fields.expenseLines.map((l) => ({
    id: l.id,
    name: l.name.trim() || 'Expense',
    amount: parseWholeUsd(l.amountStr),
  }))
  return {
    partnerName: fields.partnerName.trim(),
    companyName: fields.companyName.trim() || null,
    partnerEmail: fields.partnerEmail.trim(),
    clientName: fields.clientName.trim(),
    clientEmail: fields.clientEmail.trim(),
    clientPhone: fields.clientPhone.trim() || null,
    eventDate: fields.eventDate.trim() || null,
    eventLocation: fields.eventLocation.trim() || null,
    notes: fields.notes.trim() || null,
    referralStatus: fields.referralStatus,
    bookingAmount: parseWholeUsd(fields.bookingAmount),
    expenseLineItems: linesPayload,
    travelExpenseAmount: 0,
    hotelExpenseAmount: 0,
    payoutStatus: fields.payoutStatus,
    commissionableOverrideAmount: optionalOverride(fields.commissionableOverride),
    payoutOverrideAmount: optionalOverride(fields.payoutOverride),
    venueId: fields.venueId.trim() || null,
    referringContactId: fields.referringContactId.trim() || null,
    linkedProjectId: fields.linkedProjectId.trim() || null,
  }
}

export default function PartnerReferrals() {
  const { state, actions } = useApp()
  const rows = useMemo(() => [...(state.partnerReferrals ?? [])].sort(compareReferrals), [state.partnerReferrals])
  const venuesById = useMemo(() => {
    const m: Record<string, { companyName: string }> = {}
    for (const v of state.venues ?? []) m[v.id] = v
    return m
  }, [state.venues])
  const contactsById = useMemo(() => {
    const m: Record<string, { name?: string; email?: string }> = {}
    for (const c of state.venueContacts ?? []) m[c.id] = c
    return m
  }, [state.venueContacts])
  const agreementsById = useMemo(() => {
    const m: Record<string, { version: number; status: string }> = {}
    for (const a of state.referralPartnershipAgreements ?? []) m[a.id] = a
    return m
  }, [state.referralPartnershipAgreements])

  const [listQuery, setListQuery] = useState('')
  const [listRefreshing, setListRefreshing] = useState(false)
  const filteredRows = useMemo(() => rows.filter((r) => matchesPartnerSearch(r, listQuery)), [rows, listQuery])

  const partnerKeyCounts = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of filteredRows) {
      const k = partnerKeyForReferral(r)
      m.set(k, (m.get(k) ?? 0) + 1)
    }
    return m
  }, [filteredRows])

  type VendorSummary = {
    key: string
    label: string
    subtitle?: string
    referrals: number
    booked: number
    pendingPayoutSum: number
    paidPayoutSum: number
  }

  const vendorSummaries = useMemo(() => {
    const m = new Map<
      string,
      { label: string; subtitle?: string; referrals: number; booked: number; pendingPayoutSum: number; paidPayoutSum: number }
    >()
    for (const r of filteredRows) {
      const key = partnerKeyForReferral(r)
      const cur =
        m.get(key) ?? {
          label: String(r.partnerName ?? '').trim() || 'Partner',
          subtitle: (() => {
            const email = String(r.partnerEmail ?? '').trim()
            const co = String(r.companyName ?? '').trim()
            if (email && co) return `${email} · ${co}`
            return email || co || undefined
          })(),
          referrals: 0,
          booked: 0,
          pendingPayoutSum: 0,
          paidPayoutSum: 0,
        }
      cur.referrals += 1
      if (referralStatusEligibleForBookingPayout(r.referralStatus)) cur.booked += 1
      const ps = String(r.payoutStatus || 'none').toLowerCase()
      const payout = Number.isFinite(r.payoutAmount) ? r.payoutAmount : 0
      if (ps === 'paid') cur.paidPayoutSum += payout
      else if (ps === 'pending' && payout > 0) cur.pendingPayoutSum += payout
      m.set(key, cur)
    }
    const out: VendorSummary[] = Array.from(m.entries()).map(([key, v]) => ({ key, ...v }))
    out.sort((a, b) => b.referrals - a.referrals || a.label.localeCompare(b.label))
    return out
  }, [filteredRows])

  const refreshReferralsList = useCallback(async () => {
    if (listRefreshing) return
    setListRefreshing(true)
    try {
      await actions.refreshPartnerReferralsRemote()
    } finally {
      setListRefreshing(false)
    }
  }, [actions, listRefreshing])

  useEffect(() => {
    void actions.refreshPartnerReferralsRemote()
  }, [actions])

  const debugSave = useMemo(() => {
    try {
      return typeof window !== 'undefined' && localStorage.getItem('pr_debug_save') === '1'
    } catch {
      return false
    }
  }, [])
  const dlog = useCallback(
    (...args: unknown[]) => {
      if (!debugSave) return
      // eslint-disable-next-line no-console
      console.log('[PartnerReferrals:save]', ...args)
    },
    [debugSave]
  )

  const [editor, setEditor] = useState<EditorState>(null)
  const [partnerName, setPartnerName] = useState('')
  const [companyName, setCompanyName] = useState('')
  const [partnerEmail, setPartnerEmail] = useState('')
  const [clientName, setClientName] = useState('')
  const [clientEmail, setClientEmail] = useState('')
  const [clientPhone, setClientPhone] = useState('')
  const [eventDate, setEventDate] = useState('')
  const [eventLocation, setEventLocation] = useState('')
  const [notes, setNotes] = useState('')
  const [referralStatus, setReferralStatus] = useState('new')
  const [bookingAmount, setBookingAmount] = useState('0')
  const [expenseLines, setExpenseLines] = useState<ExpenseLineDraft[]>([])
  const [payoutStatus, setPayoutStatus] = useState('none')
  const [commissionableOverride, setCommissionableOverride] = useState('')
  const [payoutOverride, setPayoutOverride] = useState('')
  const [venueId, setVenueId] = useState('')
  const [referringContactId, setReferringContactId] = useState('')
  const [linkedProjectId, setLinkedProjectId] = useState('')
  const [statementPaymentDate, setStatementPaymentDate] = useState('')
  const [statementPaymentMethod, setStatementPaymentMethod] = useState('')
  const [statementPaymentReference, setStatementPaymentReference] = useState('')
  const [statementDeliveryMethod, setStatementDeliveryMethod] = useState('')
  const [statementDeliveryReference, setStatementDeliveryReference] = useState('')
  const [decisionBusy, setDecisionBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  useEffect(() => {
    if (!editor) return
    if (editor.type === 'new') {
      setPartnerName('')
      setCompanyName('')
      setPartnerEmail('')
      setClientName('')
      setClientEmail('')
      setClientPhone('')
      setEventDate('')
      setEventLocation('')
      setNotes('')
      setReferralStatus('new')
      setBookingAmount('0')
      setExpenseLines([])
      setPayoutStatus('none')
      setCommissionableOverride('')
      setPayoutOverride('')
      setVenueId('')
      setReferringContactId('')
      setLinkedProjectId('')
      setFormError('')
      return
    }
    const r = editor.row
    setPartnerName(r.partnerName)
    setCompanyName(r.companyName ?? '')
    setPartnerEmail(r.partnerEmail)
    setClientName(r.clientName)
    setClientEmail(r.clientEmail)
    setClientPhone(r.clientPhone ?? '')
    setEventDate(toDateInputValue(r.eventDate))
    setEventLocation(r.eventLocation ?? '')
    setNotes(r.notes ?? '')
    setReferralStatus(referralStatusSelectValue(r.referralStatus))
    setBookingAmount(String(r.bookingAmount ?? 0))
    setExpenseLines(draftLinesFromReferral(r))
    setPayoutStatus(String(r.payoutStatus || 'none').toLowerCase())
    setCommissionableOverride(r.commissionableOverrideAmount != null ? String(r.commissionableOverrideAmount) : '')
    setPayoutOverride(r.payoutOverrideAmount != null ? String(r.payoutOverrideAmount) : '')
    setVenueId(r.venueId ?? '')
    setReferringContactId(r.referringContactId ?? '')
    setLinkedProjectId(r.linkedProjectId ?? r.linkedLeadId ?? '')
    setFormError('')
  }, [editor])

  const previewTerms = useMemo((): TermsSnap => {
    if (editor?.type === 'edit') {
      return (
        parseTermsSnapshot(editor.row.agreementTermsSnapshot) ?? {
          termsKind: 'legacy_default',
          commissionRate: LEGACY_COMMISSION_RATE,
          minPayoutAmount: LEGACY_MIN_PAYOUT,
          useLegacyExpenseDeduction: true,
        }
      )
    }
    if (venueId) {
      const partnership = (state.referralPartnerships ?? []).find((p) => p.venueId === venueId && p.status === 'active')
      if (partnership?.activeAgreementId) {
        const agreement = (state.referralPartnershipAgreements ?? []).find((a) => a.id === partnership.activeAgreementId)
        if (agreement?.termsJson) {
          const parsed = parseTermsSnapshot(agreement.termsJson)
          if (parsed) return parsed
        }
      }
    }
    return {
      termsKind: 'legacy_default',
      commissionRate: LEGACY_COMMISSION_RATE,
      minPayoutAmount: LEGACY_MIN_PAYOUT,
      useLegacyExpenseDeduction: true,
    }
  }, [editor, venueId, state.referralPartnerships, state.referralPartnershipAgreements])

  const preview = useMemo(() => {
    const booking = parseWholeUsd(bookingAmount)
    const totalExpenses = expenseLines.reduce((s, l) => s + parseWholeUsd(l.amountStr), 0)
    const co = optionalOverride(commissionableOverride)
    const deductExpenses = legacyExpenseMode(previewTerms)
    const commissionable =
      co != null ? co : deductExpenses ? Math.max(0, booking - totalExpenses) : Math.max(0, booking)
    const po = optionalOverride(payoutOverride)
    const rate = commissionRateFromTerms(previewTerms)
    const minPayout = minPayoutFromTerms(previewTerms)
    const pctPayout = Math.round(commissionable * rate)
    const formulaPayout = minPayout > 0 ? Math.max(pctPayout, minPayout) : pctPayout
    /** What the formula would pay once status qualifies (same rule as server for Booked/Paid). */
    const estimatedPayout = po != null ? po : formulaPayout
    /** Stored rule: $0 until Booked/Paid unless payout override is set. */
    let currentPayout: number
    if (po != null) {
      currentPayout = po
    } else if (!referralStatusEligibleForBookingPayout(referralStatus)) {
      currentPayout = 0
    } else if (
      requiresPartnershipDecision(previewTerms) &&
      editor?.type === 'edit' &&
      !isReferralDecisionAccepted(editor.row)
    ) {
      currentPayout = 0
    } else {
      currentPayout = formulaPayout
    }
    const hasPayoutOverride = po != null
    const payoutPreviewDiffers = currentPayout !== estimatedPayout
    return {
      booking,
      totalExpenses,
      commissionable,
      referralPayout: currentPayout,
      estimatedPayout,
      hasPayoutOverride,
      payoutPreviewDiffers,
      formulaLabel: payoutFormulaLabel(previewTerms),
    }
  }, [bookingAmount, expenseLines, commissionableOverride, payoutOverride, referralStatus, previewTerms])

  const closeModal = useCallback(() => {
    if (saving) return
    setEditor(null)
    setFormError('')
  }, [saving])

  const addExpenseLine = useCallback(() => {
    setExpenseLines((prev) => [...prev, newDraftLine()])
  }, [])

  const removeExpenseLine = useCallback((id: string) => {
    setExpenseLines((prev) => prev.filter((l) => l.id !== id))
  }, [])

  const updateExpenseLine = useCallback((id: string, patch: Partial<Pick<ExpenseLineDraft, 'name' | 'amountStr'>>) => {
    setExpenseLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)))
  }, [])

  const validateForm = useCallback((): string | null => {
    const pn = partnerName.trim()
    const pe = partnerEmail.trim()
    const cn = clientName.trim()
    const ce = clientEmail.trim()
    if (!pn || !pe || !cn || !ce) {
      return 'Partner name, partner email, client name, and client email are required.'
    }
    if (!pe.includes('@') || !ce.includes('@')) {
      return 'Enter valid email addresses for partner and client.'
    }
    return null
  }, [partnerName, partnerEmail, clientName, clientEmail])

  const handleSave = useCallback(async () => {
    dlog('handler:enter', { editorType: editor?.type, saving })
    if (!editor) return
    const err = validateForm()
    if (err) {
      dlog('validation:blocked', err)
      setFormError(err)
      return
    }
    setFormError('')
    setSaving(true)
    try {
      const payload = buildPayload({
        partnerName,
        companyName,
        partnerEmail,
        clientName,
        clientEmail,
        clientPhone,
        eventDate,
        eventLocation,
        notes,
        referralStatus,
        payoutStatus,
        bookingAmount,
        expenseLines,
        commissionableOverride,
        payoutOverride,
        venueId,
        referringContactId,
        linkedProjectId,
      })
      if (editor.type === 'new') {
        dlog('request:start', { op: 'create' })
        const result = await apiCreatePartnerReferral({
          ...payload,
          referralSource: 'crm',
          skipPartnerConfirmation: true,
        })
        dlog('request:done', { op: 'create', ok: result.ok, result })
        if (!result.ok) {
          setFormError(result.error)
          return
        }
        setEditor(null)
        dlog('modal:close', { op: 'create' })
        void actions.refreshState().catch(() => {})
        return
      }
      dlog('request:start', { op: 'update', id: editor.row.id })
      const result = await apiUpdatePartnerReferral(editor.row.id, payload)
      dlog('request:done', { op: 'update', ok: result.ok, result })
      if (!result.ok) {
        setFormError(result.error)
        return
      }
      setEditor(null)
      dlog('modal:close', { op: 'update' })
      void actions.refreshState().catch(() => {})
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Save failed'
      dlog('exception', e)
      setFormError(msg || 'Save failed')
    } finally {
      setSaving(false)
      dlog('handler:finally', { saving: false })
    }
  }, [
    editor,
    validateForm,
    partnerName,
    companyName,
    partnerEmail,
    clientName,
    clientEmail,
    clientPhone,
    eventDate,
    eventLocation,
    notes,
    referralStatus,
    payoutStatus,
    bookingAmount,
    expenseLines,
    commissionableOverride,
    payoutOverride,
    venueId,
    referringContactId,
    linkedProjectId,
    actions,
    dlog,
    saving,
  ])

  const handleDelete = useCallback(
    (r: PartnerReferral) => {
      const ref = r.referralReference?.trim() || r.id
      const msg = `Delete this referral record?\n\nOnly this referral row will be removed. The client, booking, partnership and agreement are kept.\nThis cannot be undone.\n${r.clientName} · ${ref}`
      if (!window.confirm(msg)) return
      void (async () => {
        const res = await apiDeletePartnerReferral(r.id)
        if (!res.ok) {
          window.alert(`Could not delete referral.\n\n${res.error}`)
          return
        }
        actions.removePartnerReferralLocally(r.id)
        setEditor((cur) => (cur?.type === 'edit' && cur.row.id === r.id ? null : cur))
        await actions.refreshState()
      })()
    },
    [actions]
  )

  const isEdit = editor?.type === 'edit'
  const editRow = editor?.type === 'edit' ? editor.row : null

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerMain}>
          <h1>Partner Referrals</h1>
          <p className={styles.subtitle}>Partner-sourced bookings and payout tracking.</p>
        </div>
        <div className={styles.headerActions}>
          {getInquiryApiBaseUrl().startsWith('http') ? (
            <button
              type="button"
              className={styles.refreshListBtn}
              onClick={() => void refreshReferralsList()}
              disabled={listRefreshing}
              title="Pull latest partner referrals from your Inquiry/Render server"
            >
              {listRefreshing ? 'Refreshing…' : 'Refresh list'}
            </button>
          ) : null}
          <button type="button" className={styles.addReferralBtn} onClick={() => setEditor({ type: 'new' })}>
            Add referral
          </button>
        </div>
      </header>

      <div className={styles.listToolbar} aria-label="Search and partner summaries">
        <label className={styles.searchField}>
          <span className={styles.searchLabel}>Search</span>
          <input
            className={styles.searchInput}
            type="search"
            value={listQuery}
            onChange={(e) => setListQuery(e.target.value)}
            placeholder="Partner name, email, company, client, or reference…"
            autoComplete="off"
          />
        </label>
        <div className={styles.toolbarMeta}>
          Showing <strong>{filteredRows.length}</strong> of <strong>{rows.length}</strong>
        </div>
      </div>

      {vendorSummaries.length > 0 ? (
        <div className={styles.vendorSummaryStrip} aria-label="Vendor summaries for visible referrals">
          {vendorSummaries.slice(0, 14).map((v) => {
            const hue = hashHue(v.key)
            return (
              <div key={v.key} className={styles.vendorChip} style={{ ['--vendor-hue' as string]: String(hue) }}>
                <div className={styles.vendorChipTitle}>{v.label}</div>
                {v.subtitle ? <div className={styles.vendorChipSub}>{v.subtitle}</div> : null}
                <div className={styles.vendorChipStats}>
                  <span>
                    <span className={styles.vendorChipK}>Refs</span> {v.referrals}
                  </span>
                  <span>
                    <span className={styles.vendorChipK}>Booked</span> {v.booked}
                  </span>
                  <span>
                    <span className={styles.vendorChipK}>Pending payouts</span> {formatUsd(v.pendingPayoutSum)}
                  </span>
                  <span>
                    <span className={styles.vendorChipK}>Payout paid</span> {formatUsd(v.paidPayoutSum)}
                  </span>
                </div>
              </div>
            )
          })}
          {vendorSummaries.length > 14 ? (
            <div className={styles.vendorChipMore}>+{vendorSummaries.length - 14} more partners in this view</div>
          ) : null}
        </div>
      ) : null}

      <div className={`${styles.tableWrap} ${styles.desktopTable}`}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.colRef}>Reference</th>
              <th className={styles.colPartner}>Partner</th>
              <th className={styles.colClient}>Client</th>
              <th className={styles.colVenue}>Venue</th>
              <th className={styles.colStatus}>Decision</th>
              <th className={styles.colStatus}>Status</th>
              <th className={styles.colMoney}>Booking</th>
              <th className={styles.colMoney}>Payout</th>
              <th className={styles.colActions}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={9} className={styles.emptyCell}>
                  No partner referrals yet. Use Add referral or the website form to create one.
                </td>
              </tr>
            ) : filteredRows.length === 0 ? (
              <tr>
                <td colSpan={9} className={styles.emptyCell}>
                  No referrals match your search. Clear the search box to see all referrals.
                </td>
              </tr>
            ) : (
              filteredRows.map((r) => {
                const pk = partnerKeyForReferral(r)
                const dup = (partnerKeyCounts.get(pk) ?? 0) > 1
                const hue = hashHue(pk)
                return (
                  <tr
                    key={r.id}
                    className={dup ? styles.partnerDupRow : undefined}
                    style={dup ? ({ ['--partner-hue' as string]: String(hue) } as CSSProperties) : undefined}
                  >
                  <td
                    className={r.referralReference?.trim() ? styles.refCode : styles.refCell}
                    title={r.referralReference?.trim() ? String(r.referralReference) : `Record id: ${r.id}`}
                  >
                    {r.referralReference?.trim() || r.id}
                  </td>
                  <td className={styles.partnerCell}>
                    <div className={styles.partnerNameRow}>
                      <span className={styles.strong}>{r.partnerName}</span>
                      {dup ? <span className={styles.partnerDupBadge}>Same partner</span> : null}
                    </div>
                    <div className={styles.partnerEmail} title={r.partnerEmail}>
                      {r.partnerEmail}
                    </div>
                    {r.companyName?.trim() ? (
                      <div className={styles.partnerCompany} title={r.companyName}>
                        {r.companyName}
                      </div>
                    ) : null}
                  </td>
                  <td className={styles.colClient} title={r.clientName}>
                    {r.clientName}
                  </td>
                  <td className={styles.colVenue} title={r.venueId || ''}>
                    {r.venueId ? venuesById[r.venueId]?.companyName || r.venueId : '—'}
                    {r.referringContactId ? (
                      <div className={styles.partnerEmail}>
                        {contactsById[r.referringContactId]?.name || contactsById[r.referringContactId]?.email || 'Contact linked'}
                      </div>
                    ) : null}
                    {r.agreementSnapshotKind ? (
                      <div className={styles.partnerCompany}>
                        {r.agreementSnapshotKind === 'legacy_default'
                          ? 'Legacy default terms'
                          : `Agreement v${agreementsById[r.agreementId || '']?.version ?? '?'}`}
                      </div>
                    ) : null}
                  </td>
                  <td className={styles.colStatus}>
                    {r.referralDecisionStatus ? (
                      <span className={styles.statusPill} data-referral-status={r.referralDecisionStatus === 'accepted' ? 'won' : r.referralDecisionStatus === 'rejected' ? 'lost' : 'pipeline'}>
                        {DECISION_STATUS_LABELS[r.referralDecisionStatus] || r.referralDecisionStatus}
                      </span>
                    ) : (
                      '—'
                    )}
                    {r.referralDecisionDeadline ? (
                      <div className={styles.partnerEmail}>Due {r.referralDecisionDeadline}</div>
                    ) : null}
                  </td>
                  <td className={styles.colStatus}>
                    <span
                      className={styles.statusPill}
                      data-referral-status={referralStatusVariant(r.referralStatus)}
                    >
                      {referralStatusLabel(r.referralStatus)}
                    </span>
                  </td>
                  <td className={styles.money}>{formatUsd(r.bookingAmount)}</td>
                  <td className={styles.money}>{formatUsd(r.payoutAmount)}</td>
                  <td className={styles.actionsCell}>
                    <button
                      type="button"
                      className={styles.rowActionEdit}
                      onClick={() => setEditor({ type: 'edit', row: r })}
                    >
                      <span className={styles.rowActionEditIcon} aria-hidden>
                        ✎
                      </span>
                      Edit
                    </button>
                  </td>
                </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      <div className={styles.mobileCards} aria-label="Partner referrals list">
        {rows.length === 0 ? (
          <div className={styles.emptyCard}>No partner referrals yet. Use Add referral or the website form.</div>
        ) : filteredRows.length === 0 ? (
          <div className={styles.emptyCard}>No referrals match your search.</div>
        ) : (
          filteredRows.map((r) => {
            const pk = partnerKeyForReferral(r)
            const dup = (partnerKeyCounts.get(pk) ?? 0) > 1
            const hue = hashHue(pk)
            return (
            <article
              key={r.id}
              className={`${styles.card}${dup ? ` ${styles.partnerDupCard}` : ''}`}
              style={dup ? ({ ['--partner-hue' as string]: String(hue) } as CSSProperties) : undefined}
            >
              <div className={styles.cardTitle}>{r.clientName}</div>
              <div className={styles.cardMeta}>
                <span className={styles.strong}>{r.partnerName}</span>
                {dup ? <span className={styles.partnerDupBadge}>Same partner</span> : null}
                <div className={styles.cardPartnerEmail}>{r.partnerEmail}</div>
                {r.companyName?.trim() ? <div className={styles.cardPartnerCompany}>{r.companyName}</div> : null}
              </div>
              <dl className={styles.cardDl}>
                <div>
                  <dt>Reference</dt>
                  <dd className={r.referralReference?.trim() ? styles.refCode : styles.refCell}>
                    {r.referralReference?.trim() || r.id}
                  </dd>
                </div>
                <div>
                  <dt>Booking</dt>
                  <dd>{formatUsd(r.bookingAmount)}</dd>
                </div>
                <div>
                  <dt>Status</dt>
                  <dd>
                    <span
                      className={styles.statusPill}
                      data-referral-status={referralStatusVariant(r.referralStatus)}
                    >
                      {referralStatusLabel(r.referralStatus)}
                    </span>
                  </dd>
                </div>
                <div>
                  <dt>Payout</dt>
                  <dd>{formatUsd(r.payoutAmount)}</dd>
                </div>
              </dl>
              <div className={styles.cardActions}>
                <button type="button" className={styles.rowActionEdit} onClick={() => setEditor({ type: 'edit', row: r })}>
                  <span className={styles.rowActionEditIcon} aria-hidden>
                    ✎
                  </span>
                  Edit
                </button>
              </div>
            </article>
            )
          })
        )}
      </div>

      {editor ? (
        <div
          className={styles.modalOverlay}
          onClick={closeModal}
          role="dialog"
          aria-modal="true"
          aria-labelledby="pr-edit-title"
        >
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h2 id="pr-edit-title" className={styles.modalTitle}>
              {isEdit ? 'Edit referral' : 'New referral'}
            </h2>
            <p className={styles.modalMeta}>
              {isEdit && editRow
                ? `${editRow.referralReference?.trim() ? `${editRow.referralReference} · ` : ''}${editRow.id}`
                : 'Enter details below, then save.'}
            </p>
            <form
              className={styles.editForm}
              onSubmit={(e) => {
                e.preventDefault()
                dlog('ui:submit')
                void handleSave()
              }}
            >
              {formError ? <p className={styles.error}>{formError}</p> : null}

              <p className={styles.formSectionLabel}>Partner</p>
              <div className={styles.formGrid}>
                <label className={styles.formField}>
                  Partner name <span className={styles.req}>*</span>
                  <input
                    className={styles.input}
                    type="text"
                    value={partnerName}
                    onChange={(e) => setPartnerName(e.target.value)}
                    autoComplete="organization"
                  />
                </label>
                <label className={styles.formField}>
                  Company name
                  <input
                    className={styles.input}
                    type="text"
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    autoComplete="off"
                  />
                </label>
                <label className={styles.formField}>
                  Partner email <span className={styles.req}>*</span>
                  <input
                    className={styles.input}
                    type="email"
                    value={partnerEmail}
                    onChange={(e) => setPartnerEmail(e.target.value)}
                    autoComplete="email"
                  />
                </label>
              </div>

              <p className={styles.formSectionLabel}>Client and event</p>
              <div className={styles.formGrid}>
                <label className={styles.formField}>
                  Client name <span className={styles.req}>*</span>
                  <input
                    className={styles.input}
                    type="text"
                    value={clientName}
                    onChange={(e) => setClientName(e.target.value)}
                    autoComplete="name"
                  />
                </label>
                <label className={styles.formField}>
                  Client email <span className={styles.req}>*</span>
                  <input
                    className={styles.input}
                    type="email"
                    value={clientEmail}
                    onChange={(e) => setClientEmail(e.target.value)}
                    autoComplete="email"
                  />
                </label>
                <label className={styles.formField}>
                  Client phone
                  <input
                    className={styles.input}
                    type="tel"
                    value={clientPhone}
                    onChange={(e) => setClientPhone(e.target.value)}
                    autoComplete="tel"
                  />
                </label>
                <label className={styles.formField}>
                  Event date
                  <input
                    className={styles.input}
                    type="date"
                    value={eventDate}
                    onChange={(e) => setEventDate(e.target.value)}
                  />
                </label>
                <label className={`${styles.formField} ${styles.formFieldSpan2}`}>
                  Event location
                  <input
                    className={styles.input}
                    type="text"
                    value={eventLocation}
                    onChange={(e) => setEventLocation(e.target.value)}
                    autoComplete="off"
                  />
                </label>
              </div>

              <label>
                Notes
                <textarea
                  className={styles.textarea}
                  rows={3}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Internal notes…"
                />
              </label>

              <p className={styles.formSectionLabel}>CRM links (optional)</p>
              <div className={styles.formGrid}>
                <label className={styles.formField}>
                  Venue
                  <select className={styles.select} value={venueId} onChange={(e) => setVenueId(e.target.value)}>
                    <option value="">Unlinked</option>
                    {(state.venues ?? []).map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.companyName}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={styles.formField}>
                  Referring contact
                  <select
                    className={styles.select}
                    value={referringContactId}
                    onChange={(e) => setReferringContactId(e.target.value)}
                  >
                    <option value="">None</option>
                    {(state.venueContacts ?? [])
                      .filter((c) => !venueId || c.venueId === venueId)
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name || c.email || c.id}
                        </option>
                      ))}
                  </select>
                </label>
                <label className={styles.formField}>
                  Linked project id
                  <input
                    className={styles.input}
                    value={linkedProjectId}
                    onChange={(e) => setLinkedProjectId(e.target.value)}
                    placeholder="e.g. p12"
                  />
                </label>
              </div>
              {isEdit && editRow ? (
                <p className={styles.summaryFoot}>
                  Submitted as: {editRow.partnerName} · {editRow.partnerEmail}
                  {editRow.companyName ? ` · ${editRow.companyName}` : ''}. Terms snapshot:{' '}
                  {editRow.agreementSnapshotKind === 'legacy_default' ? 'Legacy default' : 'Agreement-based'} (immutable).
                </p>
              ) : null}

              {isEdit && editRow && requiresPartnershipDecision(previewTerms) ? (
                <>
                  <p className={styles.formSectionLabel}>Referral acceptance decision</p>
                  <p className={styles.sectionHint}>
                    Status: {DECISION_STATUS_LABELS[editRow.referralDecisionStatus || 'pending'] || editRow.referralDecisionStatus || 'Pending'}
                    {editRow.referralDecisionDeadline ? ` · Deadline ${editRow.referralDecisionDeadline}` : ''}
                    {editRow.referralDecisionStatus !== 'accepted' ? ' · Commission requires explicit acceptance.' : ''}
                  </p>
                  {editRow.referralDecisionStatus !== 'accepted' && editRow.referralDecisionStatus !== 'rejected' ? (
                    <div className={styles.formGrid}>
                      <button
                        type="button"
                        className={styles.addLineBtn}
                        disabled={decisionBusy || saving}
                        onClick={async () => {
                          setDecisionBusy(true)
                          const res = await apiAcceptPartnerReferralDecision(editRow.id)
                          setDecisionBusy(false)
                          if (res.ok) {
                            setEditor({ type: 'edit', row: res.data })
                            void actions.refreshPartnerReferralsRemote?.()
                          } else setFormError(res.error)
                        }}
                      >
                        Accept referral
                      </button>
                      <button
                        type="button"
                        className={styles.removeLineBtn}
                        disabled={decisionBusy || saving}
                        onClick={async () => {
                          const notes = window.prompt('Rejection notes (required):')
                          if (!notes?.trim()) return
                          setDecisionBusy(true)
                          const res = await apiRejectPartnerReferralDecision(editRow.id, notes.trim())
                          setDecisionBusy(false)
                          if (res.ok) {
                            setEditor({ type: 'edit', row: res.data })
                            void actions.refreshPartnerReferralsRemote?.()
                          } else setFormError(res.error)
                        }}
                      >
                        Reject referral
                      </button>
                    </div>
                  ) : null}
                </>
              ) : null}

              {isEdit && editRow ? (
                <>
                  <p className={styles.formSectionLabel}>Commission statement</p>
                  <p className={styles.sectionHint}>
                    {editRow.hasCommissionStatement
                      ? `Generated ${editRow.commissionStatementGeneratedAt?.slice(0, 10) || ''}${editRow.commissionStatementDeliveredAt ? ` · Delivered ${editRow.commissionStatementDeliveredAt.slice(0, 10)}` : ' · Delivery not recorded'}`
                      : 'Generate statement before marking payout Completed or Paid.'}
                  </p>
                  <div className={styles.formGrid}>
                    <label className={styles.formField}>
                      Payment date
                      <input className={styles.input} type="date" value={statementPaymentDate} onChange={(e) => setStatementPaymentDate(e.target.value)} />
                    </label>
                    <label className={styles.formField}>
                      Payment method
                      <input className={styles.input} value={statementPaymentMethod} onChange={(e) => setStatementPaymentMethod(e.target.value)} placeholder="ACH, check, …" />
                    </label>
                    <label className={styles.formField}>
                      Payment reference
                      <input className={styles.input} value={statementPaymentReference} onChange={(e) => setStatementPaymentReference(e.target.value)} />
                    </label>
                  </div>
                  <div className={styles.formGrid}>
                    <button
                      type="button"
                      className={styles.addLineBtn}
                      disabled={decisionBusy || saving}
                      onClick={async () => {
                        setDecisionBusy(true)
                        const res = await apiGeneratePartnerReferralCommissionStatement(editRow.id, {
                          paymentDate: statementPaymentDate || undefined,
                          paymentMethod: statementPaymentMethod || undefined,
                          paymentReference: statementPaymentReference || undefined,
                        })
                        setDecisionBusy(false)
                        if (res.ok) {
                          setEditor({ type: 'edit', row: res.data })
                          void actions.refreshPartnerReferralsRemote?.()
                        } else setFormError(res.error)
                      }}
                    >
                      Generate statement PDF
                    </button>
                    {editRow.hasCommissionStatement ? (
                      <a className={styles.addLineBtn} href={partnerReferralCommissionStatementUrl(editRow.id)} target="_blank" rel="noreferrer">
                        Download statement
                      </a>
                    ) : null}
                  </div>
                  {editRow.hasCommissionStatement && !editRow.commissionStatementDeliveredAt ? (
                    <div className={styles.formGrid}>
                      <label className={styles.formField}>
                        Delivery method
                        <input className={styles.input} value={statementDeliveryMethod} onChange={(e) => setStatementDeliveryMethod(e.target.value)} placeholder="Email to partner" />
                      </label>
                      <label className={styles.formField}>
                        Delivery reference
                        <input className={styles.input} value={statementDeliveryReference} onChange={(e) => setStatementDeliveryReference(e.target.value)} />
                      </label>
                      <button
                        type="button"
                        className={styles.addLineBtn}
                        disabled={decisionBusy || saving || !statementDeliveryMethod.trim()}
                        onClick={async () => {
                          setDecisionBusy(true)
                          const res = await apiRecordPartnerReferralCommissionStatementDelivery(editRow.id, {
                            method: statementDeliveryMethod.trim(),
                            reference: statementDeliveryReference.trim() || undefined,
                          })
                          setDecisionBusy(false)
                          if (res.ok) {
                            setEditor({ type: 'edit', row: res.data })
                            void actions.refreshPartnerReferralsRemote?.()
                          } else setFormError(res.error)
                        }}
                      >
                        Record delivery
                      </button>
                    </div>
                  ) : null}
                </>
              ) : null}

              <p className={styles.formSectionLabel}>Status and amounts</p>
              <div className={styles.formGrid}>
                <label className={styles.formField}>
                  Referral status
                  <select
                    className={styles.select}
                    value={referralStatus}
                    onChange={(e) => setReferralStatus(e.target.value)}
                  >
                    {REFERRAL_STATUS_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                    {!REFERRAL_STATUS_OPTIONS.some((o) => o.value === referralStatus) && referralStatus ? (
                      <option value={referralStatus}>{referralStatus}</option>
                    ) : null}
                  </select>
                </label>
                <label className={styles.formField}>
                  Payout status
                  <select
                    className={styles.select}
                    value={payoutStatus}
                    onChange={(e) => setPayoutStatus(e.target.value)}
                  >
                    {PAYOUT_STATUS_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  {(payoutStatus === 'pending' || payoutStatus === 'paid' || payoutStatus === 'completed') && (
                    <span className={styles.hint}>
                      Requires explicit referral acceptance (MVP), event completed, client paid, and commission statement generated + delivery recorded for Completed/Paid.
                    </span>
                  )}
                </label>
                <label className={styles.formField}>
                  Booking amount (USD, whole dollars)
                  <input
                    className={styles.input}
                    type="text"
                    inputMode="numeric"
                    value={bookingAmount}
                    onChange={(e) => setBookingAmount(e.target.value)}
                    autoComplete="off"
                  />
                </label>
              </div>

              <div className={styles.expenseSection}>
                <div className={styles.sectionLabel}>Expenses</div>
                <p className={styles.sectionHint}>Deduct from booking before commission. Add as many lines as you need.</p>
                <div className={styles.expenseToolbar}>
                  <button type="button" className={styles.addLineBtn} disabled={saving} onClick={addExpenseLine}>
                    + Add expense line
                  </button>
                </div>
                {expenseLines.length === 0 ? (
                  <p className={styles.expenseEmpty}>No expense lines yet.</p>
                ) : (
                  <ul className={styles.expenseList}>
                    {expenseLines.map((line) => (
                      <li key={line.id} className={styles.expenseRow}>
                        <input
                          className={styles.input}
                          type="text"
                          aria-label="Expense name"
                          placeholder="Name"
                          value={line.name}
                          onChange={(e) => updateExpenseLine(line.id, { name: e.target.value })}
                          autoComplete="off"
                        />
                        <input
                          className={styles.input}
                          type="text"
                          inputMode="numeric"
                          aria-label="Amount USD"
                          placeholder="Amount"
                          value={line.amountStr}
                          onChange={(e) => updateExpenseLine(line.id, { amountStr: e.target.value })}
                          autoComplete="off"
                        />
                        <button
                          type="button"
                          className={styles.removeLineBtn}
                          onClick={() => removeExpenseLine(line.id)}
                        >
                          Remove
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {expenseLines.length > 0 ? (
                  <div className={styles.expenseToolbarFooter}>
                    <button type="button" className={styles.addLineBtn} disabled={saving} onClick={addExpenseLine}>
                      + Add another expense line
                    </button>
                  </div>
                ) : null}
              </div>

              <div className={styles.summaryBox}>
                <div className={styles.summaryRow}>
                  <span>Booking amount</span>
                  <span className={styles.summaryValue}>{formatUsd(preview.booking)}</span>
                </div>
                <div className={styles.summaryRow}>
                  <span>Total expenses</span>
                  <span className={styles.summaryValue}>{formatUsd(preview.totalExpenses)}</span>
                </div>
                <div className={styles.summaryRow}>
                  <span>Commissionable amount</span>
                  <span className={styles.summaryValue}>{formatUsd(preview.commissionable)}</span>
                </div>
                <div className={styles.summaryRow}>
                  <span>Payout (current status)</span>
                  <span className={styles.summaryValue}>{formatUsd(preview.referralPayout)}</span>
                </div>
                <div className={`${styles.summaryRow} ${styles.summaryRowEstimate}`}>
                  <span>Estimated when Booked/Paid</span>
                  <span className={styles.summaryValue}>{formatUsd(preview.estimatedPayout)}</span>
                </div>
                <p className={styles.summaryFoot}>
                  {preview.hasPayoutOverride
                    ? 'Payout override is set; both amounts use that value (same rule as when saved).'
                    : preview.payoutPreviewDiffers
                      ? `Stored payout stays $0 until status is Booked or Paid. The estimate is ${preview.formulaLabel} using booking − expenses above (when applicable).`
                      : `With status Booked or Paid, the stored payout matches this estimate: ${preview.formulaLabel}.`}
                </p>
                <p className={styles.summaryFoot}>
                  New agreements: 10% with no minimum. Legacy (pre-agreement): 5% with $100 minimum. New pays less below $1,000 commissionable, equal at $1,000, more above. Historical referrals unchanged.
                </p>
              </div>

              <div className={styles.formGrid}>
                <label className={styles.formField}>
                  Commissionable override (optional)
                  <input
                    className={styles.input}
                    type="text"
                    inputMode="numeric"
                    value={commissionableOverride}
                    onChange={(e) => setCommissionableOverride(e.target.value)}
                    placeholder="Leave blank for auto"
                    autoComplete="off"
                  />
                  <span className={styles.hint}>Blank = booking − total expenses.</span>
                </label>
                <label className={styles.formField}>
                  Payout override (optional)
                  <input
                    className={styles.input}
                    type="text"
                    inputMode="numeric"
                    value={payoutOverride}
                    onChange={(e) => setPayoutOverride(e.target.value)}
                    placeholder="Leave blank for formula"
                    autoComplete="off"
                  />
                  <span className={styles.hint}>Blank = {preview.formulaLabel} when Booked/Paid.</span>
                </label>
              </div>

              <div className={styles.modalActions}>
                {isEdit && editRow ? (
                  <button
                    type="button"
                    className={styles.modalDeleteBtn}
                    disabled={saving}
                    onClick={() => handleDelete(editRow)}
                  >
                    Delete referral…
                  </button>
                ) : (
                  <span />
                )}
                <span className={styles.modalActionsRight}>
                  <button type="button" className={styles.cancelBtn} onClick={closeModal} disabled={saving}>
                    Cancel
                  </button>
                  <button type="submit" className={styles.saveBtn} disabled={saving}>
                    {saving ? 'Saving…' : 'Save'}
                  </button>
                </span>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  )
}
