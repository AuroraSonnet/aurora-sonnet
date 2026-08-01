import { useCallback, useMemo, useState } from 'react'
import { useApp } from '../context/AppContext'
import {
  apiCreateVenue,
  apiCreateVenueContact,
  apiCreateVisit,
  apiReorderVisits,
  apiSaveVisitDebrief,
  apiSendVisitSameDayEmail,
  apiUpdateOutreachSettings,
  apiUpdateVenue,
  apiUpdateVisit,
  type Venue,
  type Visit,
} from '../api/db'
import PartnershipOutreachSequencePanel from './PartnershipOutreachSequencePanel'
import {
  OBJECTION_TAGS,
  OBJECTION_TAG_LABELS,
  PARTNERSHIP_CONFIDENCE_LABELS,
  PARTNERSHIP_CONFIDENCE_VALUES,
  RELATIONSHIP_STRENGTH_LABELS,
  RELATIONSHIP_STRENGTH_VALUES,
  VENUE_STAGES,
  VISIT_CLOSED_STATUSES,
  VISIT_CLOSED_STATUS_LABELS,
  VISIT_NEXT_ACTIONS,
  VISIT_NEXT_ACTION_LABELS,
  VISIT_NEXT_ACTIONS_REQUIRING_DUE_DATE,
  VISIT_OUTCOMES,
  VISIT_OUTCOME_LABELS,
  venueStageLabel,
} from '../utils/venuePipeline'
import {
  VENUE_MERGE_TAGS,
  mergeVenueTemplateText,
  pickPostVisitSameDayTemplate,
} from '../utils/partnershipEmailTemplates'
import styles from './OutreachToday.module.css'

function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function addDaysStr(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  dt.setDate(dt.getDate() + days)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}

function formatDateNice(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  return dt.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
}

type DebriefForm = {
  outcomes: string[]
  partnershipConfidenceScore: number
  contactsMetIds: string[]
  nextAction: string
  nextActionDueDate: string
  nextActionOtherNote: string
  closedStatus: string
  noFurtherActionReason: string
  whatWentWell: string
  whatCouldGoBetter: string
  objectionTag: string
  objectionNotes: string
  whatLearned: string
  whatDoDifferently: string
  whatWouldChangeOverall: string
  whatInterestedThem: string
  generalNotes: string
  materialsLeft: string
  permissionToFollowUp: boolean
  agreedNextStep: string
}

const emptyDebrief: DebriefForm = {
  outcomes: [],
  partnershipConfidenceScore: 0,
  contactsMetIds: [],
  nextAction: '',
  nextActionDueDate: '',
  nextActionOtherNote: '',
  closedStatus: '',
  noFurtherActionReason: '',
  whatWentWell: '',
  whatCouldGoBetter: '',
  objectionTag: '',
  objectionNotes: '',
  whatLearned: '',
  whatDoDifferently: '',
  whatWouldChangeOverall: '',
  whatInterestedThem: '',
  generalNotes: '',
  materialsLeft: '',
  permissionToFollowUp: false,
  agreedNextStep: '',
}

export default function OutreachToday() {
  const { state, actions } = useApp()
  const venues = state.venues ?? []
  const venueContacts = state.venueContacts ?? []
  const visits = state.visits ?? []
  const visitDebriefs = state.visitDebriefs ?? []
  const templates = state.emailTemplates ?? []
  const dailyVisitTarget = state.outreachSettings?.dailyVisitTarget ?? 5

  const [toast, setToast] = useState<string | null>(null)
  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }

  const [selectedDate, setSelectedDate] = useState(todayStr())

  const [targetEditing, setTargetEditing] = useState(false)
  const [targetInput, setTargetInput] = useState(String(dailyVisitTarget))
  const [savingTarget, setSavingTarget] = useState(false)

  const [showAddVisit, setShowAddVisit] = useState(false)
  const [venueQuery, setVenueQuery] = useState('')
  const [selectedVenueForAdd, setSelectedVenueForAdd] = useState<Venue | null>(null)
  const [addVisitTime, setAddVisitTime] = useState('')
  const [addVisitError, setAddVisitError] = useState<string | null>(null)
  const [addingVisit, setAddingVisit] = useState(false)

  const [debriefVisitId, setDebriefVisitId] = useState<string | null>(null)
  const [debriefForm, setDebriefForm] = useState<DebriefForm>(emptyDebrief)
  const [debriefError, setDebriefError] = useState<string | null>(null)
  const [savingDebrief, setSavingDebrief] = useState(false)

  const [emailVisitId, setEmailVisitId] = useState<string | null>(null)
  const [emailContactId, setEmailContactId] = useState('')
  const [emailTo, setEmailTo] = useState('')
  const [emailSubject, setEmailSubject] = useState('')
  const [emailBody, setEmailBody] = useState('')
  const [emailStartSequence, setEmailStartSequence] = useState(true)
  const [emailError, setEmailError] = useState<string | null>(null)
  const [emailResult, setEmailResult] = useState<string | null>(null)
  const [sendingEmail, setSendingEmail] = useState(false)

  const [drawerVenueId, setDrawerVenueId] = useState<string | null>(null)

  const venuesById = useMemo(() => {
    const map: Record<string, Venue> = {}
    for (const v of venues) map[v.id] = v
    return map
  }, [venues])

  const debriefsByVisitId = useMemo(() => {
    const map: Record<string, (typeof visitDebriefs)[number]> = {}
    for (const d of visitDebriefs) map[d.visitId] = d
    return map
  }, [visitDebriefs])

  const visitsForDate = useMemo(
    () =>
      visits
        .filter((v) => v.plannedDate === selectedDate)
        .slice()
        .sort((a, b) => a.orderIndex - b.orderIndex),
    [visits, selectedDate]
  )

  const completedToday = visitsForDate.filter((v) => v.status === 'completed').length
  const activeToday = visitsForDate.filter((v) => v.status === 'planned' || v.status === 'completed').length
  const progressPct = dailyVisitTarget > 0 ? Math.min(100, Math.round((completedToday / dailyVisitTarget) * 100)) : 0

  const followUps = useMemo(() => {
    const today = todayStr()
    const items: { visit: Visit; venue: Venue; dueDate: string; nextAction: string }[] = []
    for (const visit of visits) {
      if (visit.status !== 'completed') continue
      const debrief = debriefsByVisitId[visit.id]
      if (!debrief?.nextActionDueDate) continue
      const venue = venuesById[visit.venueId]
      if (!venue || venue.deletedAt) continue
      items.push({ visit, venue, dueDate: debrief.nextActionDueDate, nextAction: debrief.nextAction })
    }
    return items.filter((i) => i.dueDate <= addDaysStr(today, 3)).sort((a, b) => a.dueDate.localeCompare(b.dueDate))
  }, [visits, debriefsByVisitId, venuesById])

  const matchedVenues = useMemo(() => {
    const q = venueQuery.trim().toLowerCase()
    if (!q) return []
    return venues.filter((v) => !v.deletedAt && v.companyName.toLowerCase().includes(q)).slice(0, 8)
  }, [venues, venueQuery])

  const handleSaveTarget = async () => {
    const n = Number(targetInput)
    if (!Number.isFinite(n) || n <= 0) return
    setSavingTarget(true)
    try {
      const result = await apiUpdateOutreachSettings({ dailyVisitTarget: Math.round(n) })
      if (result.ok) {
        await actions.refreshState()
        setTargetEditing(false)
        showToast('Daily visit target updated.')
      }
    } finally {
      setSavingTarget(false)
    }
  }

  const resetAddVisitForm = () => {
    setVenueQuery('')
    setSelectedVenueForAdd(null)
    setAddVisitTime('')
    setAddVisitError(null)
  }

  const handleAddVisit = async () => {
    setAddVisitError(null)
    const companyName = venueQuery.trim()
    if (!selectedVenueForAdd && !companyName) {
      setAddVisitError('Choose an existing venue or type a name to create one.')
      return
    }
    setAddingVisit(true)
    try {
      let venueId = selectedVenueForAdd?.id
      if (!venueId) {
        const created = await apiCreateVenue({ companyName })
        if (!created.ok) {
          setAddVisitError(created.error)
          return
        }
        venueId = created.data.id
      }
      const result = await apiCreateVisit(venueId, selectedDate, addVisitTime || undefined)
      if (!result.ok) {
        setAddVisitError(result.error)
        return
      }
      await actions.refreshState()
      setShowAddVisit(false)
      resetAddVisitForm()
      showToast('Visit added.')
    } finally {
      setAddingVisit(false)
    }
  }

  const moveVisit = async (visitId: string, direction: -1 | 1) => {
    const idx = visitsForDate.findIndex((v) => v.id === visitId)
    if (idx < 0) return
    const swapWith = idx + direction
    if (swapWith < 0 || swapWith >= visitsForDate.length) return
    const ordered = visitsForDate.map((v) => v.id)
    const tmp = ordered[idx]
    ordered[idx] = ordered[swapWith]
    ordered[swapWith] = tmp
    const result = await apiReorderVisits(selectedDate, ordered)
    if (result.ok) await actions.refreshState()
  }

  const handleSkipVisit = async (visit: Visit) => {
    const result = await apiUpdateVisit(visit.id, { status: 'skipped' })
    if (result.ok) {
      await actions.refreshState()
      showToast('Visit marked skipped.')
    }
  }

  const handleTimeBlur = async (visit: Visit, value: string) => {
    if (value === (visit.visitTime || '')) return
    const result = await apiUpdateVisit(visit.id, { visitTime: value || null })
    if (result.ok) await actions.refreshState()
  }

  const handleReschedule = async (visit: Visit, newDate: string) => {
    if (!newDate || newDate === visit.plannedDate) return
    const result = await apiUpdateVisit(visit.id, { plannedDate: newDate })
    if (result.ok) {
      await actions.refreshState()
      showToast('Visit rescheduled.')
    }
  }

  const openDebrief = (visit: Visit) => {
    setDebriefVisitId(visit.id)
    setDebriefForm(emptyDebrief)
    setDebriefError(null)
  }

  const closeDebrief = () => {
    setDebriefVisitId(null)
    setDebriefForm(emptyDebrief)
    setDebriefError(null)
  }

  const toggleOutcome = (outcome: string) => {
    setDebriefForm((f) => ({
      ...f,
      outcomes: f.outcomes.includes(outcome) ? f.outcomes.filter((o) => o !== outcome) : [...f.outcomes, outcome],
    }))
  }

  const toggleContactMet = (contactId: string) => {
    setDebriefForm((f) => ({
      ...f,
      contactsMetIds: f.contactsMetIds.includes(contactId)
        ? f.contactsMetIds.filter((c) => c !== contactId)
        : [...f.contactsMetIds, contactId],
    }))
  }

  const debriefVisit = debriefVisitId ? visits.find((v) => v.id === debriefVisitId) ?? null : null
  const debriefVenue = debriefVisit ? venuesById[debriefVisit.venueId] ?? null : null
  const debriefVenueContacts = useMemo(
    () => (debriefVenue ? venueContacts.filter((c) => c.venueId === debriefVenue.id && !c.deletedAt) : []),
    [venueContacts, debriefVenue]
  )

  const openEmail = useCallback(
    (visit: Visit) => {
      const venue = venuesById[visit.venueId]
      if (!venue) return
      const contacts = venueContacts.filter((c) => c.venueId === venue.id && c.email)
      const defaultContact = contacts[0]
      setEmailVisitId(visit.id)
      setEmailContactId(defaultContact?.id || '')
      setEmailTo('')
      const tpl = pickPostVisitSameDayTemplate(templates)
      setEmailSubject(tpl ? mergeVenueTemplateText(tpl.subject, venue, defaultContact) : `Great meeting you today — ${venue.companyName}`)
      setEmailBody(tpl ? mergeVenueTemplateText(tpl.body, venue, defaultContact) : '')
      setEmailStartSequence(true)
      setEmailError(null)
      setEmailResult(null)
    },
    [venuesById, venueContacts, templates]
  )

  const closeEmail = () => {
    setEmailVisitId(null)
    setEmailError(null)
    setEmailResult(null)
  }

  const emailVisit = emailVisitId ? visits.find((v) => v.id === emailVisitId) ?? null : null
  const emailVenue = emailVisit ? venuesById[emailVisit.venueId] ?? null : null
  const emailVenueContacts = useMemo(
    () => (emailVenue ? venueContacts.filter((c) => c.venueId === emailVenue.id) : []),
    [venueContacts, emailVenue]
  )

  const handleEmailContactChange = (contactId: string) => {
    setEmailContactId(contactId)
    if (!emailVenue) return
    const contact = emailVenueContacts.find((c) => c.id === contactId)
    const tpl = pickPostVisitSameDayTemplate(templates)
    if (tpl) {
      setEmailSubject(mergeVenueTemplateText(tpl.subject, emailVenue, contact))
      setEmailBody(mergeVenueTemplateText(tpl.body, emailVenue, contact))
    }
  }

  const insertMergeTag = (tag: string, field: 'subject' | 'body') => {
    if (field === 'subject') setEmailSubject((s) => `${s}${s && !s.endsWith(' ') ? ' ' : ''}${tag}`)
    else setEmailBody((s) => `${s}${s && !s.endsWith(' ') ? ' ' : ''}${tag}`)
  }

  const handleSubmitDebrief = async () => {
    setDebriefError(null)
    if (debriefForm.outcomes.length === 0) {
      setDebriefError('Choose at least one visit outcome.')
      return
    }
    if (!PARTNERSHIP_CONFIDENCE_VALUES.includes(debriefForm.partnershipConfidenceScore)) {
      setDebriefError('Set a partnership-confidence score (1-5).')
      return
    }
    if (!VISIT_NEXT_ACTIONS.includes(debriefForm.nextAction as (typeof VISIT_NEXT_ACTIONS)[number])) {
      setDebriefError('Choose a next action.')
      return
    }
    const payload: Record<string, unknown> = {
      outcomes: debriefForm.outcomes,
      partnershipConfidenceScore: debriefForm.partnershipConfidenceScore,
      contactsMetIds: debriefForm.contactsMetIds,
      nextAction: debriefForm.nextAction,
      whatWentWell: debriefForm.whatWentWell.trim() || undefined,
      whatCouldGoBetter: debriefForm.whatCouldGoBetter.trim() || undefined,
      objectionTag: debriefForm.objectionTag || undefined,
      objectionNotes: debriefForm.objectionNotes.trim() || undefined,
      whatLearned: debriefForm.whatLearned.trim() || undefined,
      whatDoDifferently: debriefForm.whatDoDifferently.trim() || undefined,
      whatWouldChangeOverall: debriefForm.whatWouldChangeOverall.trim() || undefined,
      whatInterestedThem: debriefForm.whatInterestedThem.trim() || undefined,
      generalNotes: debriefForm.generalNotes.trim() || undefined,
      materialsLeft: debriefForm.materialsLeft.trim() || undefined,
      permissionToFollowUp: debriefForm.permissionToFollowUp,
      agreedNextStep: debriefForm.agreedNextStep.trim() || undefined,
    }
    if (debriefForm.nextAction === 'no_further_action') {
      if (!VISIT_CLOSED_STATUSES.includes(debriefForm.closedStatus)) {
        setDebriefError('Choose a closed status for "No further action".')
        return
      }
      if (!debriefForm.noFurtherActionReason.trim()) {
        setDebriefError('A reason is required when there is no further action.')
        return
      }
      payload.closedStatus = debriefForm.closedStatus
      payload.noFurtherActionReason = debriefForm.noFurtherActionReason.trim()
    } else {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(debriefForm.nextActionDueDate)) {
        setDebriefError('A due date is required for this next action.')
        return
      }
      payload.nextActionDueDate = debriefForm.nextActionDueDate
      if (debriefForm.nextAction === 'other') payload.nextActionOtherNote = debriefForm.nextActionOtherNote.trim() || undefined
    }

    if (!debriefVisitId) return
    setSavingDebrief(true)
    try {
      const result = await apiSaveVisitDebrief(debriefVisitId, payload)
      if (!result.ok) {
        setDebriefError(result.error)
        return
      }
      await actions.refreshState()
      const finishedVisit = debriefVisit
      const wantsEmail = debriefForm.nextAction === 'send_email_today'
      closeDebrief()
      showToast('Debrief saved.')
      if (wantsEmail && finishedVisit) openEmail(finishedVisit)
    } finally {
      setSavingDebrief(false)
    }
  }

  const handleSendEmail = async () => {
    if (!emailVisitId) return
    setEmailError(null)
    setEmailResult(null)
    const contact = emailVenueContacts.find((c) => c.id === emailContactId)
    const to = (contact?.email || emailTo).trim()
    if (!to) {
      setEmailError('Pick a contact with an email, or enter a recipient email.')
      return
    }
    if (!emailSubject.trim() || !emailBody.trim()) {
      setEmailError('Subject and message are required.')
      return
    }
    setSendingEmail(true)
    try {
      const result = await apiSendVisitSameDayEmail(emailVisitId, {
        contactId: emailContactId || undefined,
        to: emailContactId ? undefined : to,
        subject: emailSubject.trim(),
        body: emailBody.trim(),
        startSequence: emailStartSequence,
      })
      if (!result.ok) {
        setEmailError(result.error)
        return
      }
      await actions.refreshState()
      setEmailResult(
        result.data.sequenceEnrollment?.enrolled
          ? 'Email sent. Automatic 3-email follow-up sequence started.'
          : 'Email sent.'
      )
      showToast('Same-day email sent.')
    } finally {
      setSendingEmail(false)
    }
  }

  const drawerVenue = drawerVenueId ? venuesById[drawerVenueId] ?? null : null

  return (
    <div className={styles.page}>
      {toast && <p className={styles.toast} role="status">{toast}</p>}
      <header className={styles.header}>
        <h1>Outreach Today</h1>
        <p className={styles.subtitle}>Plan visits, debrief right after, and send the personalized follow-up — the daily engine of the partnership playbook.</p>
      </header>

      <div className={styles.dateNav}>
        <button type="button" className={styles.dateNavBtn} onClick={() => setSelectedDate((d) => addDaysStr(d, -1))}>
          ← Prev
        </button>
        <input
          type="date"
          className={styles.dateInput}
          value={selectedDate}
          onChange={(e) => setSelectedDate(e.target.value)}
        />
        <button type="button" className={styles.dateNavBtn} onClick={() => setSelectedDate(todayStr())}>
          Today
        </button>
        <button type="button" className={styles.dateNavBtn} onClick={() => setSelectedDate((d) => addDaysStr(d, 1))}>
          Next →
        </button>
        <strong>{formatDateNice(selectedDate)}</strong>
      </div>

      <div className={styles.targetBar}>
        <span className={styles.targetLabel}>Daily visit target</span>
        {targetEditing ? (
          <>
            <input
              type="number"
              min={1}
              className={styles.targetInput}
              value={targetInput}
              onChange={(e) => setTargetInput(e.target.value)}
            />
            <button type="button" className={styles.smallBtnPrimary} onClick={handleSaveTarget} disabled={savingTarget}>
              {savingTarget ? 'Saving…' : 'Save'}
            </button>
            <button type="button" className={styles.smallBtn} onClick={() => { setTargetEditing(false); setTargetInput(String(dailyVisitTarget)) }}>
              Cancel
            </button>
          </>
        ) : (
          <button type="button" className={styles.smallBtn} onClick={() => setTargetEditing(true)}>
            {dailyVisitTarget} visits/day — edit
          </button>
        )}
        <div className={styles.progressWrap}>
          <div className={styles.progressBar}>
            <div className={styles.progressFill} style={{ width: `${progressPct}%` }} />
          </div>
          <span className={styles.progressText}>
            {completedToday} of {dailyVisitTarget} completed{activeToday !== completedToday ? ` · ${activeToday} planned` : ''}
          </span>
        </div>
      </div>

      <div className={styles.sectionHead}>
        <h2>Visits — {formatDateNice(selectedDate)}</h2>
        <button type="button" className={styles.addBtn} onClick={() => { setShowAddVisit(true); resetAddVisitForm() }}>
          + Add visit
        </button>
      </div>

      {showAddVisit && (
        <section className={styles.card}>
          <h2>Add a visit</h2>
          {addVisitError && <p className={styles.error} role="alert">{addVisitError}</p>}
          {selectedVenueForAdd ? (
            <span className={styles.selectedVenueTag}>
              {selectedVenueForAdd.companyName}
              <button type="button" onClick={() => setSelectedVenueForAdd(null)} aria-label="Clear venue">×</button>
            </span>
          ) : (
            <div className={styles.formStack}>
              <label>
                Venue name (search existing or type a new one)
                <input
                  type="text"
                  className={styles.input}
                  value={venueQuery}
                  onChange={(e) => setVenueQuery(e.target.value)}
                  placeholder="e.g. Garden Estate Vineyard"
                  autoFocus
                />
              </label>
              {matchedVenues.length > 0 && (
                <div className={styles.venueSearchResults}>
                  {matchedVenues.map((v) => (
                    <button
                      key={v.id}
                      type="button"
                      className={styles.venueSearchResult}
                      onClick={() => { setSelectedVenueForAdd(v); setVenueQuery('') }}
                    >
                      {v.companyName} {v.city ? `— ${v.city}` : ''}
                    </button>
                  ))}
                </div>
              )}
              {venueQuery.trim() && matchedVenues.length === 0 && (
                <p className={styles.hint}>No match — this will create a new venue named &quot;{venueQuery.trim()}&quot;.</p>
              )}
            </div>
          )}
          <label style={{ marginTop: '0.75rem', display: 'block' }}>
            Visit time (optional)
            <input
              type="time"
              className={styles.input}
              value={addVisitTime}
              onChange={(e) => setAddVisitTime(e.target.value)}
              style={{ maxWidth: '160px' }}
            />
          </label>
          <div className={styles.formActions}>
            <button type="button" className={styles.cancelBtn} onClick={() => { setShowAddVisit(false); resetAddVisitForm() }}>
              Cancel
            </button>
            <button type="button" className={styles.submitBtn} onClick={handleAddVisit} disabled={addingVisit}>
              {addingVisit ? 'Adding…' : 'Add visit'}
            </button>
          </div>
        </section>
      )}

      {visitsForDate.length === 0 ? (
        <p className={styles.empty}>No visits planned for this day yet.</p>
      ) : (
        <div className={styles.visitList}>
          {visitsForDate.map((visit, idx) => {
            const venue = venuesById[visit.venueId]
            const debrief = debriefsByVisitId[visit.id]
            if (!venue) return null
            return (
              <div key={visit.id} className={styles.visitCard} data-status={visit.status}>
                <div className={styles.visitTop}>
                  <div className={styles.reorderCol}>
                    <button type="button" className={styles.reorderBtn} onClick={() => moveVisit(visit.id, -1)} disabled={idx === 0} aria-label="Move up">▲</button>
                    <button type="button" className={styles.reorderBtn} onClick={() => moveVisit(visit.id, 1)} disabled={idx === visitsForDate.length - 1} aria-label="Move down">▼</button>
                  </div>
                  <div className={styles.visitVenue} style={{ flex: 1 }}>
                    <button type="button" className={styles.visitVenueName} onClick={() => setDrawerVenueId(venue.id)}>
                      {venue.companyName}
                    </button>
                    <span className={styles.visitMeta}>
                      {[venue.neighborhood || venue.city, venue.regionRaw].filter(Boolean).join(' · ') || '—'}
                    </span>
                    <div className={styles.visitBadges}>
                      <input
                        type="time"
                        className={styles.timeInput}
                        defaultValue={visit.visitTime || ''}
                        onBlur={(e) => handleTimeBlur(visit, e.target.value)}
                        aria-label="Visit time"
                      />
                      <span className={styles.pill} data-stage={venue.stage}>{venueStageLabel(venue.stage)}</span>
                      <span className={`${styles.pill} ${styles.statusPill}`} data-status={visit.status}>{visit.status}</span>
                    </div>
                  </div>
                </div>

                {debrief && (
                  <div className={styles.debriefSummary}>
                    <span><strong>Outcome:</strong> {debrief.outcomes.map((o) => VISIT_OUTCOME_LABELS[o] ?? o).join(', ')}</span>
                    <span><strong>Confidence:</strong> {debrief.partnershipConfidenceScore}/5 — {PARTNERSHIP_CONFIDENCE_LABELS[debrief.partnershipConfidenceScore]}</span>
                    <span><strong>Next:</strong> {VISIT_NEXT_ACTION_LABELS[debrief.nextAction] ?? debrief.nextAction}{debrief.nextActionDueDate ? ` by ${debrief.nextActionDueDate}` : ''}</span>
                  </div>
                )}

                <div className={styles.visitActions}>
                  {visit.status === 'planned' && (
                    <>
                      <button type="button" className={styles.smallBtnPrimary} onClick={() => openDebrief(visit)}>
                        Complete visit
                      </button>
                      <button type="button" className={styles.smallBtn} onClick={() => handleSkipVisit(visit)}>
                        Skip
                      </button>
                      <input
                        type="date"
                        className={styles.timeInput}
                        style={{ width: '130px' }}
                        defaultValue={visit.plannedDate}
                        onBlur={(e) => handleReschedule(visit, e.target.value)}
                        aria-label="Reschedule visit"
                      />
                    </>
                  )}
                  {visit.status === 'completed' && !visit.sameDayEmailSentAt && (
                    <button type="button" className={styles.smallBtnPrimary} onClick={() => openEmail(visit)}>
                      Send same-day email
                    </button>
                  )}
                  {visit.sameDayEmailSentAt && (
                    <span className={styles.hint} style={{ margin: 0 }}>
                      Emailed {new Date(visit.sameDayEmailSentAt).toLocaleString()}
                      {visit.sequenceStartedAt ? ' · sequence started' : ''}
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      <div className={styles.sectionHead}>
        <h2>Follow-ups due (next 3 days)</h2>
      </div>
      {followUps.length === 0 ? (
        <p className={styles.empty}>Nothing due. You&apos;re caught up.</p>
      ) : (
        <div className={styles.followUpList}>
          {followUps.map(({ visit, venue, dueDate, nextAction }) => (
            <div key={visit.id} className={styles.followUpItem}>
              <div className={styles.followUpMain}>
                <button type="button" className={styles.linkBtn} onClick={() => setDrawerVenueId(venue.id)}>
                  {venue.companyName}
                </button>
                <span className={styles.visitMeta}>{VISIT_NEXT_ACTION_LABELS[nextAction] ?? nextAction}</span>
              </div>
              <span className={styles.followUpDue} data-overdue={dueDate < todayStr()}>
                {dueDate === todayStr() ? 'Due today' : dueDate < todayStr() ? `Overdue · ${dueDate}` : dueDate}
              </span>
            </div>
          ))}
        </div>
      )}

      {debriefVisit && debriefVenue && (
        <div className={styles.modalOverlay} onClick={closeDebrief} role="dialog" aria-modal="true" aria-label="Visit debrief">
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <div>
                <h2>Debrief — {debriefVenue.companyName}</h2>
                <p className={styles.modalHeaderSub}>Required to mark this visit complete. Be specific — this is what the playbook learns from.</p>
              </div>
              <button type="button" className={styles.closeBtn} onClick={closeDebrief} aria-label="Close">×</button>
            </div>

            {debriefError && <p className={styles.error} role="alert">{debriefError}</p>}

            <p className={styles.fieldLabel}>What happened? (choose at least one) *</p>
            <div className={styles.chipGroup}>
              {VISIT_OUTCOMES.map((o) => (
                <button
                  key={o}
                  type="button"
                  className={styles.chip}
                  data-selected={debriefForm.outcomes.includes(o)}
                  onClick={() => toggleOutcome(o)}
                >
                  {VISIT_OUTCOME_LABELS[o]}
                </button>
              ))}
            </div>

            <p className={styles.fieldLabel}>Partnership confidence — how likely are they to refer couples? *</p>
            <div className={styles.scaleGroup}>
              {PARTNERSHIP_CONFIDENCE_VALUES.map((n) => (
                <button
                  key={n}
                  type="button"
                  className={styles.scaleBtn}
                  data-selected={debriefForm.partnershipConfidenceScore === n}
                  onClick={() => setDebriefForm((f) => ({ ...f, partnershipConfidenceScore: n }))}
                  title={PARTNERSHIP_CONFIDENCE_LABELS[n]}
                >
                  {n}
                </button>
              ))}
            </div>

            {debriefVenueContacts.length > 0 && (
              <>
                <p className={styles.fieldLabel}>Who did you meet?</p>
                <div className={styles.chipGroup}>
                  {debriefVenueContacts.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      className={styles.chip}
                      data-selected={debriefForm.contactsMetIds.includes(c.id)}
                      onClick={() => toggleContactMet(c.id)}
                    >
                      {c.name || c.email || 'Unnamed contact'}
                    </button>
                  ))}
                </div>
              </>
            )}

            <p className={styles.fieldLabel}>Next action *</p>
            <select
              className={styles.select}
              value={debriefForm.nextAction}
              onChange={(e) => setDebriefForm((f) => ({ ...f, nextAction: e.target.value }))}
            >
              <option value="">Choose next action…</option>
              {VISIT_NEXT_ACTIONS.map((a) => (
                <option key={a} value={a}>{VISIT_NEXT_ACTION_LABELS[a]}</option>
              ))}
            </select>

            {debriefForm.nextAction && debriefForm.nextAction !== 'no_further_action' && VISIT_NEXT_ACTIONS_REQUIRING_DUE_DATE.has(debriefForm.nextAction) && (
              <label style={{ display: 'block', marginTop: '0.6rem' }}>
                Due date *
                <input
                  type="date"
                  className={styles.input}
                  value={debriefForm.nextActionDueDate}
                  onChange={(e) => setDebriefForm((f) => ({ ...f, nextActionDueDate: e.target.value }))}
                />
              </label>
            )}

            {debriefForm.nextAction === 'other' && (
              <label style={{ display: 'block', marginTop: '0.6rem' }}>
                What&apos;s the other action?
                <input
                  type="text"
                  className={styles.input}
                  value={debriefForm.nextActionOtherNote}
                  onChange={(e) => setDebriefForm((f) => ({ ...f, nextActionOtherNote: e.target.value }))}
                />
              </label>
            )}

            {debriefForm.nextAction === 'no_further_action' && (
              <div className={styles.formStack} style={{ marginTop: '0.6rem' }}>
                <label>
                  Closed status *
                  <select
                    className={styles.select}
                    value={debriefForm.closedStatus}
                    onChange={(e) => setDebriefForm((f) => ({ ...f, closedStatus: e.target.value }))}
                  >
                    <option value="">Choose…</option>
                    {VISIT_CLOSED_STATUSES.map((s) => (
                      <option key={s} value={s}>{VISIT_CLOSED_STATUS_LABELS[s]}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Why no further action? *
                  <textarea
                    className={styles.textarea}
                    rows={2}
                    value={debriefForm.noFurtherActionReason}
                    onChange={(e) => setDebriefForm((f) => ({ ...f, noFurtherActionReason: e.target.value }))}
                  />
                </label>
              </div>
            )}

            <p className={styles.fieldLabel}>Reflection</p>
            <div className={styles.formStack}>
              <label>
                What went well?
                <textarea className={styles.textarea} rows={2} value={debriefForm.whatWentWell} onChange={(e) => setDebriefForm((f) => ({ ...f, whatWentWell: e.target.value }))} />
              </label>
              <label>
                What could go better?
                <textarea className={styles.textarea} rows={2} value={debriefForm.whatCouldGoBetter} onChange={(e) => setDebriefForm((f) => ({ ...f, whatCouldGoBetter: e.target.value }))} />
              </label>
              <div className={styles.formGrid}>
                <label>
                  Objection heard
                  <select className={styles.select} value={debriefForm.objectionTag} onChange={(e) => setDebriefForm((f) => ({ ...f, objectionTag: e.target.value }))}>
                    <option value="">None</option>
                    {OBJECTION_TAGS.map((t) => (
                      <option key={t} value={t}>{OBJECTION_TAG_LABELS[t]}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Objection notes
                  <input type="text" className={styles.input} value={debriefForm.objectionNotes} onChange={(e) => setDebriefForm((f) => ({ ...f, objectionNotes: e.target.value }))} />
                </label>
              </div>
              <label>
                What did you learn?
                <textarea className={styles.textarea} rows={2} value={debriefForm.whatLearned} onChange={(e) => setDebriefForm((f) => ({ ...f, whatLearned: e.target.value }))} />
              </label>
              <label>
                What would you do differently?
                <textarea className={styles.textarea} rows={2} value={debriefForm.whatDoDifferently} onChange={(e) => setDebriefForm((f) => ({ ...f, whatDoDifferently: e.target.value }))} />
              </label>
              <label>
                What interested them about Aurora Sonnet?
                <textarea className={styles.textarea} rows={2} value={debriefForm.whatInterestedThem} onChange={(e) => setDebriefForm((f) => ({ ...f, whatInterestedThem: e.target.value }))} />
              </label>
              <label>
                Agreed next step (said out loud to them)
                <input type="text" className={styles.input} value={debriefForm.agreedNextStep} onChange={(e) => setDebriefForm((f) => ({ ...f, agreedNextStep: e.target.value }))} />
              </label>
              <label>
                Materials left behind
                <input type="text" className={styles.input} value={debriefForm.materialsLeft} onChange={(e) => setDebriefForm((f) => ({ ...f, materialsLeft: e.target.value }))} />
              </label>
              <label>
                General notes
                <textarea className={styles.textarea} rows={2} value={debriefForm.generalNotes} onChange={(e) => setDebriefForm((f) => ({ ...f, generalNotes: e.target.value }))} />
              </label>
              <label className={styles.checkboxRow}>
                <input type="checkbox" checked={debriefForm.permissionToFollowUp} onChange={(e) => setDebriefForm((f) => ({ ...f, permissionToFollowUp: e.target.checked }))} />
                They gave permission to follow up
              </label>
            </div>

            <div className={styles.formActions}>
              <button type="button" className={styles.cancelBtn} onClick={closeDebrief}>Cancel</button>
              <button type="button" className={styles.submitBtn} onClick={handleSubmitDebrief} disabled={savingDebrief}>
                {savingDebrief ? 'Saving…' : 'Save debrief'}
              </button>
            </div>
          </div>
        </div>
      )}

      {emailVisit && emailVenue && (
        <div className={styles.modalOverlay} onClick={closeEmail} role="dialog" aria-modal="true" aria-label="Send same-day email">
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <div>
                <h2>Same-day email — {emailVenue.companyName}</h2>
                <p className={styles.modalHeaderSub}>Personalize before sending — this is never sent automatically.</p>
              </div>
              <button type="button" className={styles.closeBtn} onClick={closeEmail} aria-label="Close">×</button>
            </div>

            {emailError && <p className={styles.error} role="alert">{emailError}</p>}
            {emailResult && <p className={styles.hint} role="status">{emailResult}</p>}

            <label style={{ display: 'block', marginBottom: '0.6rem' }}>
              Recipient
              {emailVenueContacts.length > 0 ? (
                <select className={styles.select} value={emailContactId} onChange={(e) => handleEmailContactChange(e.target.value)}>
                  <option value="">Choose a contact…</option>
                  {emailVenueContacts.map((c) => (
                    <option key={c.id} value={c.id} disabled={!c.email}>
                      {c.name || 'Unnamed'} {c.email ? `<${c.email}>` : '(no email)'}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="email"
                  className={styles.input}
                  placeholder="recipient@venue.com"
                  value={emailTo}
                  onChange={(e) => setEmailTo(e.target.value)}
                />
              )}
            </label>

            <label>
              Subject
              <input type="text" className={styles.input} value={emailSubject} onChange={(e) => setEmailSubject(e.target.value)} />
            </label>
            <div className={styles.mergeTagRow}>
              {VENUE_MERGE_TAGS.map((m) => (
                <button key={`s-${m.tag}`} type="button" className={styles.mergeTagChip} onClick={() => insertMergeTag(m.tag, 'subject')}>{m.label}</button>
              ))}
            </div>

            <label>
              Message
              <textarea className={styles.textarea} rows={9} value={emailBody} onChange={(e) => setEmailBody(e.target.value)} />
            </label>
            <div className={styles.mergeTagRow}>
              {VENUE_MERGE_TAGS.map((m) => (
                <button key={`b-${m.tag}`} type="button" className={styles.mergeTagChip} onClick={() => insertMergeTag(m.tag, 'body')}>{m.label}</button>
              ))}
            </div>

            <label className={styles.checkboxRow} style={{ marginTop: '0.75rem' }}>
              <input type="checkbox" checked={emailStartSequence} onChange={(e) => setEmailStartSequence(e.target.checked)} />
              Start the automatic 3-email follow-up sequence after this sends
            </label>

            <div className={styles.formActions}>
              <button type="button" className={styles.cancelBtn} onClick={closeEmail}>Cancel</button>
              <button type="button" className={styles.submitBtn} onClick={handleSendEmail} disabled={sendingEmail}>
                {sendingEmail ? 'Sending…' : 'Send email'}
              </button>
            </div>
          </div>
        </div>
      )}

      {drawerVenue && (
        <VenueDrawer
          venue={drawerVenue}
          onClose={() => setDrawerVenueId(null)}
          onToast={showToast}
        />
      )}
    </div>
  )
}

function VenueDrawer({
  venue,
  onClose,
  onToast,
}: {
  venue: Venue
  onClose: () => void
  onToast: (msg: string) => void
}) {
  const { state, actions } = useApp()
  const [form, setForm] = useState({
    companyName: venue.companyName || '',
    phone: venue.phone || '',
    website: venue.website || '',
    address: venue.address || '',
    city: venue.city || '',
    regionId: venue.regionId || '',
    fitLevel: venue.fitLevel || '',
    notes: venue.notes || '',
    stage: venue.stage,
    relationshipStrength: venue.relationshipStrength || 0,
    doNotContact: Boolean(venue.doNotContact),
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [contactForm, setContactForm] = useState({ name: '', email: '', phone: '', jobTitle: '' })
  const [addingContact, setAddingContact] = useState(false)

  const contacts = (state.venueContacts ?? []).filter((c) => c.venueId === venue.id && !c.deletedAt)
  const venueVisits = (state.visits ?? [])
    .filter((v) => v.venueId === venue.id)
    .slice()
    .sort((a, b) => b.plannedDate.localeCompare(a.plannedDate))
  const debriefsByVisitId: Record<string, (typeof state.visitDebriefs)[number]> = {}
  for (const d of state.visitDebriefs ?? []) debriefsByVisitId[d.visitId] = d
  const regions = state.outreachRegions ?? []

  const handleSave = async () => {
    setError(null)
    setSaving(true)
    try {
      const result = await apiUpdateVenue(venue.id, {
        companyName: form.companyName.trim(),
        phone: form.phone.trim() || undefined,
        website: form.website.trim() || undefined,
        address: form.address.trim() || undefined,
        city: form.city.trim() || undefined,
        regionId: form.regionId || undefined,
        fitLevel: form.fitLevel || undefined,
        notes: form.notes.trim() || undefined,
        stage: form.stage,
        relationshipStrength: form.relationshipStrength || null,
        doNotContact: form.doNotContact,
      })
      if (!result.ok) {
        setError(result.error)
        return
      }
      await actions.refreshState()
      onToast('Venue updated.')
    } finally {
      setSaving(false)
    }
  }

  const handleAddContact = async () => {
    if (!contactForm.name.trim() && !contactForm.email.trim()) return
    setAddingContact(true)
    try {
      const result = await apiCreateVenueContact(venue.id, {
        name: contactForm.name.trim() || undefined,
        email: contactForm.email.trim() || undefined,
        phone: contactForm.phone.trim() || undefined,
        jobTitle: contactForm.jobTitle.trim() || undefined,
      })
      if (result.ok) {
        await actions.refreshState()
        setContactForm({ name: '', email: '', phone: '', jobTitle: '' })
      }
    } finally {
      setAddingContact(false)
    }
  }

  return (
    <div className={styles.modalOverlay} onClick={onClose} role="dialog" aria-modal="true" aria-label="Venue details">
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <h2>{venue.companyName}</h2>
          <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Close">×</button>
        </div>

        {error && <p className={styles.error} role="alert">{error}</p>}

        <div className={styles.formGrid}>
          <label>
            Name
            <input type="text" className={styles.input} value={form.companyName} onChange={(e) => setForm((f) => ({ ...f, companyName: e.target.value }))} />
          </label>
          <label>
            Stage
            <select className={styles.select} value={form.stage} onChange={(e) => setForm((f) => ({ ...f, stage: e.target.value }))}>
              {VENUE_STAGES.map((s) => (
                <option key={s} value={s}>{venueStageLabel(s)}</option>
              ))}
            </select>
          </label>
          <label>
            Phone
            <input type="text" className={styles.input} value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
          </label>
          <label>
            Website
            <input type="text" className={styles.input} value={form.website} onChange={(e) => setForm((f) => ({ ...f, website: e.target.value }))} />
          </label>
          <label>
            Address
            <input type="text" className={styles.input} value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} />
          </label>
          <label>
            City
            <input type="text" className={styles.input} value={form.city} onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))} />
          </label>
          <label>
            Region
            <select className={styles.select} value={form.regionId} onChange={(e) => setForm((f) => ({ ...f, regionId: e.target.value }))}>
              <option value="">Unset</option>
              {regions.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          </label>
          <label>
            Relationship strength
            <select className={styles.select} value={form.relationshipStrength} onChange={(e) => setForm((f) => ({ ...f, relationshipStrength: Number(e.target.value) }))}>
              <option value={0}>Unset</option>
              {RELATIONSHIP_STRENGTH_VALUES.map((n) => (
                <option key={n} value={n}>{n} — {RELATIONSHIP_STRENGTH_LABELS[n]}</option>
              ))}
            </select>
          </label>
          <label className={styles.fullWidth}>
            Notes
            <textarea className={styles.textarea} rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
          </label>
          <label className={styles.checkboxRow}>
            <input type="checkbox" checked={form.doNotContact} onChange={(e) => setForm((f) => ({ ...f, doNotContact: e.target.checked }))} />
            Do not contact
          </label>
        </div>
        <div className={styles.formActions}>
          <button type="button" className={styles.submitBtn} onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save venue'}
          </button>
        </div>

        <p className={styles.fieldLabel}>Contacts</p>
        {contacts.length === 0 ? (
          <p className={styles.empty}>No contacts yet.</p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 0.5rem', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
            {contacts.map((c) => (
              <li key={c.id} className={styles.visitMeta}>
                <strong>{c.name || 'Unnamed'}</strong>{c.jobTitle ? ` — ${c.jobTitle}` : ''}{c.email ? ` · ${c.email}` : ''}{c.phone ? ` · ${c.phone}` : ''}
              </li>
            ))}
          </ul>
        )}
        <div className={styles.formGrid}>
          <input type="text" className={styles.input} placeholder="Name" value={contactForm.name} onChange={(e) => setContactForm((f) => ({ ...f, name: e.target.value }))} />
          <input type="text" className={styles.input} placeholder="Job title" value={contactForm.jobTitle} onChange={(e) => setContactForm((f) => ({ ...f, jobTitle: e.target.value }))} />
          <input type="email" className={styles.input} placeholder="Email" value={contactForm.email} onChange={(e) => setContactForm((f) => ({ ...f, email: e.target.value }))} />
          <input type="text" className={styles.input} placeholder="Phone" value={contactForm.phone} onChange={(e) => setContactForm((f) => ({ ...f, phone: e.target.value }))} />
        </div>
        <div className={styles.formActions}>
          <button type="button" className={styles.smallBtn} onClick={handleAddContact} disabled={addingContact}>
            {addingContact ? 'Adding…' : '+ Add contact'}
          </button>
        </div>

        {venue.linkedPartnershipContactId && (
          <>
            <p className={styles.fieldLabel}>Automatic email sequence</p>
            <PartnershipOutreachSequencePanel
              contactId={venue.linkedPartnershipContactId}
              companyName={venue.companyName}
              isVenueEmailContact
              onRefreshAppState={actions.refreshState}
              onToast={onToast}
            />
          </>
        )}

        <p className={styles.fieldLabel}>Visit history</p>
        {venueVisits.length === 0 ? (
          <p className={styles.empty}>No visits yet.</p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {venueVisits.map((v) => {
              const debrief = debriefsByVisitId[v.id]
              return (
                <li key={v.id} className={styles.visitMeta}>
                  <strong>{v.plannedDate}</strong> — {v.status}
                  {debrief ? ` — confidence ${debrief.partnershipConfidenceScore}/5, next: ${VISIT_NEXT_ACTION_LABELS[debrief.nextAction] ?? debrief.nextAction}` : ''}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
