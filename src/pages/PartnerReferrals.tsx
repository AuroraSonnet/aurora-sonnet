import { useMemo, useState, useEffect, useCallback } from 'react'
import { useApp } from '../context/AppContext'
import { apiCreatePartnerReferral, apiDeletePartnerReferral, apiUpdatePartnerReferral, apiAcceptPartnerReferralDecision, apiRejectPartnerReferralDecision, apiGeneratePartnerReferralCommissionStatement, apiRecordPartnerReferralCommissionStatementDelivery, apiListReferralProjects, partnerReferralCommissionStatementUrl, type PartnerReferral, type PartnerReferralExpenseLine, type ReferralProjectLink, type ReferralProjectReviewItem } from '../api/db'
import { bookingStatusLabel } from '../utils/bookingStatusLabel.js'
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

const LEGACY_COMMISSION_PAYLOAD_KEYS = [
  'bookingAmount',
  'expenseLineItems',
  'travelExpenseAmount',
  'hotelExpenseAmount',
  'payoutStatus',
  'commissionableOverrideAmount',
  'payoutOverrideAmount',
]

function signedPartnerAccountOptions(state: {
  referralPartnerships?: { id: string; status: string; activeAgreementId?: string; partnerName?: string; companyName?: string }[]
  referralPartnershipAgreements?: { id: string; partnershipId: string; status: string; termsJson?: Record<string, unknown> }[]
}) {
  const agreements = state.referralPartnershipAgreements ?? []
  return (state.referralPartnerships ?? [])
    .filter((partnership) => {
      const agreement = agreements.find((item) => item.id === partnership.activeAgreementId)
      return (
        agreement &&
        agreement.partnershipId === partnership.id &&
        agreement.status === 'fully_executed' &&
        agreement.termsJson?.termsKind === 'public_partner_agreement'
      )
    })
    .map((partnership) => ({
      id: partnership.id,
      label: [partnership.partnerName, partnership.companyName].filter(Boolean).join(' · ') || partnership.id,
    }))
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }))
}

const LINK_STATE_LABELS: Record<string, string> = { pending: 'Pending', earned: 'Earned', paid: 'Paid' }
const LINK_PAYOUT_LABELS: Record<string, string> = { none: 'Not paid', pending: 'Payment scheduled', completed: 'Paid' }

export default function PartnerReferrals() {
  const { state, actions } = useApp()
  const rows = useMemo(() => [...(state.partnerReferrals ?? [])].sort(compareReferrals), [state.partnerReferrals])
  const bookingLinks = state.partnerReferralProjects ?? []

  const [listQuery, setListQuery] = useState('')
  const [listRefreshing, setListRefreshing] = useState(false)
  const filteredRows = useMemo(() => rows.filter((r) => matchesPartnerSearch(r, listQuery)), [rows, listQuery])

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
  const [assignedPartnershipId, setAssignedPartnershipId] = useState('')
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
  const [projectLinks, setProjectLinks] = useState<ReferralProjectLink[]>([])
  const [linkReview, setLinkReview] = useState<ReferralProjectReviewItem[]>([])

  const loadProjectLinks = useCallback(() => {
    void apiListReferralProjects().then((res) => {
      if (!res.ok) return
      setProjectLinks(res.data.links)
      setLinkReview(res.data.review)
    })
  }, [])

  useEffect(() => {
    loadProjectLinks()
  }, [loadProjectLinks, state.partnerReferrals])

  const projectsById = useMemo(() => {
    const m: Record<string, { title: string; weddingDate?: string }> = {}
    for (const p of state.projects ?? []) m[p.id] = p
    return m
  }, [state.projects])

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
      setAssignedPartnershipId('')
      setVenueId('')
      setReferringContactId('')
      setLinkedProjectId('')
      setStatementPaymentDate('')
      setStatementPaymentMethod('')
      setStatementPaymentReference('')
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
    setAssignedPartnershipId(r.partnershipId ?? '')
    setVenueId(r.venueId ?? '')
    setReferringContactId(r.referringContactId ?? '')
    setLinkedProjectId(r.linkedProjectId ?? r.linkedLeadId ?? '')
    setStatementPaymentDate(r.commissionPaymentDate ?? '')
    setStatementPaymentMethod(r.commissionPaymentMethod ?? '')
    setStatementPaymentReference(r.commissionPaymentReference ?? '')
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

  const editLinks = useMemo(
    () => (editor?.type === 'edit' ? projectLinks.filter((l) => l.referralId === editor.row.id) : []),
    [editor, projectLinks]
  )
  const paidRecordLocked =
    editor?.type === 'edit' && ['paid', 'completed'].includes(String(editor.row.payoutStatus || '').toLowerCase())
  const legacyLocked = editLinks.length > 0 || paidRecordLocked

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
      if (legacyLocked) {
        for (const k of LEGACY_COMMISSION_PAYLOAD_KEYS) delete payload[k]
      }
      const signedAccountIds = new Set(signedPartnerAccountOptions(state).map((account) => account.id))
      const selectedAccount = assignedPartnershipId.trim()
      const currentAccount = editor.type === 'edit' ? editor.row.partnershipId || '' : ''
      if (selectedAccount && signedAccountIds.has(selectedAccount)) {
        payload.partnershipId = selectedAccount
      } else if (!selectedAccount && editor.type === 'edit' && signedAccountIds.has(currentAccount)) {
        payload.partnershipId = null
      }
      if (editor.type === 'edit' && !paidRecordLocked) {
        payload.commissionPaymentDate = statementPaymentDate.trim() || null
        payload.commissionPaymentMethod = statementPaymentMethod.trim() || null
        payload.commissionPaymentReference = statementPaymentReference.trim() || null
      }
      if (editor.type === 'new') {
        dlog('request:start', { op: 'create' })
        const { linkedProjectId: _omitProjectId, ...createPayload } = payload
        const result = await apiCreatePartnerReferral({
          ...createPayload,
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
    assignedPartnershipId,
    state.referralPartnerships,
    state.referralPartnershipAgreements,
    legacyLocked,
    paidRecordLocked,
    statementPaymentDate,
    statementPaymentMethod,
    statementPaymentReference,
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

      {linkReview.length > 0 ? (
        <details className={styles.sectionHint} style={{ marginBottom: '1rem' }}>
          <summary>
            {linkReview.length} referral{linkReview.length === 1 ? '' : 's'} need review for booking links or earlier commission records
          </summary>
          <ul>
            {linkReview.map((item) => (
              <li key={item.referralId}>
                <strong>{item.referralReference || item.referralId}</strong> · {item.clientName} · {item.partnerName}
                <ul>
                  {item.reasons.map((r) => (
                    <li key={r.code}>{r.detail}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <div className={styles.listToolbar} aria-label="Search referrals">
        <label className={styles.searchField}>
          <span className={styles.searchLabel}>Search</span>
          <input
            className={styles.searchInput}
            type="search"
            value={listQuery}
            onChange={(e) => setListQuery(e.target.value)}
            placeholder="Partner, couple, or reference…"
            autoComplete="off"
          />
        </label>
        <div className={styles.toolbarMeta}>
          Showing <strong>{filteredRows.length}</strong> of <strong>{rows.length}</strong>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className={styles.emptyState}>
          <p className={styles.emptyTitle}>No referrals yet</p>
          <p className={styles.emptyCopy}>Partner referrals will show up here. Add one, or they will arrive from the website form.</p>
        </div>
      ) : filteredRows.length === 0 ? (
        <div className={styles.emptyState}>
          <p className={styles.emptyTitle}>No matches</p>
          <p className={styles.emptyCopy}>Nothing in this list matches that search.</p>
        </div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.colRef}>Reference</th>
                <th className={styles.colClient}>Couple</th>
                <th className={styles.colPartner}>Referring Partner</th>
                <th className={styles.colStatus}>Record / booking</th>
                <th className={styles.colActions}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((r) => (
                <tr key={r.id}>
                  <td data-label="Reference" className={r.referralReference?.trim() ? styles.refCode : styles.refCell}>
                    {r.referralReference?.trim() || r.id}
                  </td>
                  <td data-label="Couple" className={styles.colClient}>
                    {r.clientName}
                  </td>
                  <td data-label="Referring Partner" className={styles.partnerCell}>
                    <span className={styles.strong}>{r.partnerName}</span>
                  </td>
                  <td data-label="Record / booking" className={styles.colStatus}>
                    <span className={styles.statusFacts}>
                      <span>
                        <span>Record</span> {referralStatusLabel(r.referralStatus)}
                      </span>
                      <span>
                        <span>Booking</span>{' '}
                        {bookingStatusLabel(
                          r,
                          bookingLinks.filter((link) => link.referralId === r.id)
                        )}
                      </span>
                    </span>
                  </td>
                  <td data-label="Actions" className={styles.actionsCell}>
                    <button type="button" className={styles.rowActionEdit} onClick={() => setEditor({ type: 'edit', row: r })}>
                      <span className={styles.rowActionEditIcon} aria-hidden>
                        ✎
                      </span>
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

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
              <label className={styles.formField}>
                Partner account
                <select
                  className={styles.select}
                  value={signedPartnerAccountOptions(state).some((account) => account.id === assignedPartnershipId) ? assignedPartnershipId : ''}
                  onChange={(e) => setAssignedPartnershipId(e.target.value)}
                >
                  <option value="">Unassigned</option>
                  {signedPartnerAccountOptions(state).map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.label}
                    </option>
                  ))}
                </select>
                <span className={styles.hint}>Only a chosen account is linked. The name and email alone do not assign it.</span>
              </label>
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
                {isEdit ? (
                  <label className={styles.formField}>
                    Original inquiry project id
                    <input
                      className={styles.input}
                      value={linkedProjectId}
                      onChange={(e) => setLinkedProjectId(e.target.value)}
                      placeholder="e.g. p12"
                    />
                    <span className={styles.hint}>Record only. Link bookings for commission from each booking’s edit screen.</span>
                  </label>
                ) : null}
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
                  <p className={styles.formSectionLabel}>Commission statement (original referral record)</p>
                  <p className={styles.sectionHint}>
                    {editRow.hasCommissionStatement
                      ? `Generated ${editRow.commissionStatementGeneratedAt?.slice(0, 10) || ''}${editRow.commissionStatementDeliveredAt ? ` · Delivered ${editRow.commissionStatementDeliveredAt.slice(0, 10)}` : ' · Delivery not recorded'}`
                      : 'Generate statement before marking payout Completed or Paid.'}
                  </p>
                  <div className={styles.formGrid}>
                    <label className={styles.formField}>
                      Payment date
                      <input className={styles.input} type="date" value={statementPaymentDate} readOnly={paidRecordLocked} disabled={paidRecordLocked} onChange={(e) => setStatementPaymentDate(e.target.value)} />
                    </label>
                    <label className={styles.formField}>
                      Payment method
                      <input className={styles.input} value={statementPaymentMethod} readOnly={paidRecordLocked} disabled={paidRecordLocked} onChange={(e) => setStatementPaymentMethod(e.target.value)} placeholder={paidRecordLocked ? 'Not recorded' : 'ACH, check, …'} />
                    </label>
                    <label className={styles.formField}>
                      Payment reference
                      <input className={styles.input} value={statementPaymentReference} readOnly={paidRecordLocked} disabled={paidRecordLocked} onChange={(e) => setStatementPaymentReference(e.target.value)} placeholder={paidRecordLocked ? 'Not recorded' : undefined} />
                    </label>
                  </div>
                  <p className={styles.sectionHint}>
                    {paidRecordLocked
                      ? 'Payment details are locked because this payout is marked Paid or Completed.'
                      : 'Payment details save with the referral, including when you mark the payout Paid or Completed. They lock once it is.'}
                  </p>
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

              {isEdit && editRow ? (
                <>
                  <p className={styles.formSectionLabel}>Linked bookings (commission per booking)</p>
                  {editLinks.length === 0 ? (
                    <p className={styles.sectionHint}>
                      No bookings linked. This referral cannot earn a commission until a booking is linked from that booking’s edit screen.
                    </p>
                  ) : (
                    <ul className={styles.sectionHint}>
                      {editLinks.map((l) => {
                        const p = projectsById[l.projectId]
                        return (
                          <li key={l.id}>
                            {p ? `${p.title}${p.weddingDate ? ` · ${p.weddingDate.slice(0, 10)}` : ''}` : `${l.projectId} (deleted)`}
                            {' · '}
                            {l.bookedConfirmedAt ? 'Booked' : 'Booking not confirmed'}
                            {' · '}Eligible {l.eligibleAmount != null ? formatUsd(l.eligibleAmount) : '—'}
                            {' · '}Commission {formatUsd(l.commissionAmount)}
                            {l.commissionState ? ` (${LINK_STATE_LABELS[l.commissionState]})` : ''}
                            {' · '}
                            {LINK_PAYOUT_LABELS[l.payoutStatus] || l.payoutStatus}
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </>
              ) : null}

              <p className={styles.formSectionLabel}>
                Original referral record: status, amounts and payout (not current per-booking commission)
              </p>
              <p className={styles.sectionHint}>
                {paidRecordLocked
                  ? 'This original payout is marked Paid or Completed. Its amounts and payout are locked exactly as recorded; status and contact details can still be edited.'
                  : legacyLocked
                  ? 'Commission is tracked per linked booking above. These original-record amounts and payout are read-only history.'
                  : 'Current commission is tracked per linked booking. These original-record amounts are kept for history and do not create or pay a commission.'}
              </p>
              {editRow?.legacyPaidProjectId ? (
                <p className={styles.sectionHint}>
                  Original paid commission covered booking {editRow.legacyPaidProjectId}. That booking can never earn a second commission.
                </p>
              ) : null}
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
                  Original record payout status
                  <select
                    className={styles.select}
                    value={payoutStatus}
                    disabled={legacyLocked}
                    onChange={(e) => setPayoutStatus(e.target.value)}
                  >
                    {PAYOUT_STATUS_OPTIONS.filter((o) => isEdit || (o.value !== 'paid' && o.value !== 'completed')).map((o) => (
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
                  Original record booking amount (USD, whole dollars)
                  <input
                    className={styles.input}
                    type="text"
                    inputMode="numeric"
                    value={bookingAmount}
                    disabled={legacyLocked}
                    onChange={(e) => setBookingAmount(e.target.value)}
                    autoComplete="off"
                  />
                </label>
              </div>

              <fieldset disabled={legacyLocked} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
              <div className={styles.expenseSection}>
                <div className={styles.sectionLabel}>Original record expenses</div>
                <p className={styles.sectionHint}>Deducted from the original record booking amount only. Add as many lines as you need.</p>
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
                  <span>Original record booking amount</span>
                  <span className={styles.summaryValue}>{formatUsd(preview.booking)}</span>
                </div>
                <div className={styles.summaryRow}>
                  <span>Original record total expenses</span>
                  <span className={styles.summaryValue}>{formatUsd(preview.totalExpenses)}</span>
                </div>
                <div className={styles.summaryRow}>
                  <span>Original record commissionable amount</span>
                  <span className={styles.summaryValue}>
                    {formatUsd(paidRecordLocked && editRow ? editRow.commissionableAmount : preview.commissionable)}
                  </span>
                </div>
                <div className={styles.summaryRow}>
                  <span>{paidRecordLocked ? 'Original record payout (paid, locked)' : 'Original record payout (at its status)'}</span>
                  <span className={styles.summaryValue}>
                    {formatUsd(paidRecordLocked && editRow ? editRow.payoutAmount : preview.referralPayout)}
                  </span>
                </div>
                {paidRecordLocked ? null : (
                  <div className={`${styles.summaryRow} ${styles.summaryRowEstimate}`}>
                    <span>Original record estimate when Booked/Paid</span>
                    <span className={styles.summaryValue}>{formatUsd(preview.estimatedPayout)}</span>
                  </div>
                )}
                <p className={styles.summaryFoot}>
                  {paidRecordLocked
                    ? 'Recorded when the payout was marked Paid or Completed. Changing the referral status does not recalculate it.'
                    : preview.hasPayoutOverride
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
                  Original record commissionable override (optional)
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
                  Original record payout override (optional)
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
              </fieldset>

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
