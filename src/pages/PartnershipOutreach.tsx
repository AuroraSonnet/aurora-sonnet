import { useState, useMemo } from 'react'
import { useApp } from '../context/AppContext'
import {
  apiCreatePartnershipContact,
  apiUpdatePartnershipContact,
  apiDeletePartnershipContact,
  apiAddOutreachActivity,
  apiCreateEmailTemplate,
  apiUpdateEmailTemplate,
  apiDeleteEmailTemplate,
  apiSendPartnershipEmail,
  type PartnershipContact,
  type EmailTemplate,
} from '../api/db'
import PartnershipImportWizard from './PartnershipImportWizard'
import {
  FORM_CONTACT_STAGES,
  OUTREACH_METHOD_WEBSITE_FORM,
  canSendEmailToContact,
  contactEmailDisplay,
  contactFormVisitUrl,
  isPlaceholderFormEmail,
} from '../utils/partnershipImport'
import styles from './PartnershipOutreach.module.css'

const EMAIL_STAGES: { id: string; label: string }[] = [
  { id: 'not_contacted', label: 'Not Contacted' },
  { id: 'first_email_sent', label: 'First Email Sent' },
  { id: 'follow_up_1', label: 'Follow-up #1' },
  { id: 'follow_up_2', label: 'Follow-up #2' },
  { id: 'follow_up_3', label: 'Follow-up #3' },
  { id: 'replied', label: 'Replied' },
  { id: 'meeting_scheduled', label: 'Meeting Scheduled' },
  { id: 'partner', label: 'Partner' },
  { id: 'not_interested', label: 'Not Interested' },
  { id: 'archived_no_response', label: 'Archived (No Response)' },
]

const ALL_STAGES = [...EMAIL_STAGES, ...FORM_CONTACT_STAGES]

function stageLabel(id?: string): string {
  if (!id) return '—'
  return ALL_STAGES.find((s) => s.id === id)?.label ?? id
}

function isWebsiteFormContact(c: PartnershipContact): boolean {
  return c.outreachMethod === OUTREACH_METHOD_WEBSITE_FORM
}

const PARTNER_TYPES: { id: string; label: string }[] = [
  { id: 'venue', label: 'Venue' },
  { id: 'planner', label: 'Planner' },
  { id: 'photographer', label: 'Photographer' },
  { id: 'hotel', label: 'Hotel' },
  { id: 'private_club', label: 'Private Club' },
  { id: 'florist', label: 'Florist' },
  { id: 'other', label: 'Other' },
]

const FIT_LEVELS: { id: string; label: string }[] = [
  { id: 'high', label: 'High' },
  { id: 'medium', label: 'Medium' },
  { id: 'low', label: 'Low' },
]

const MANUAL_ACTIVITY_TYPES: { id: string; label: string }[] = [
  { id: 'note', label: 'Note' },
  { id: 'reply', label: 'Reply' },
  { id: 'meeting', label: 'Meeting' },
  { id: 'demo', label: 'Demo / Showcase' },
]

function partnerTypeLabel(id?: string): string {
  if (!id) return '—'
  return PARTNER_TYPES.find((t) => t.id === id)?.label ?? id
}

function fitLevelLabel(id?: string): string {
  if (!id) return '—'
  return FIT_LEVELS.find((f) => f.id === id)?.label ?? id
}

function activityTypeLabel(type: string): string {
  switch (type) {
    case 'email_sent':
      return 'Email sent'
    case 'stage_change':
      return 'Stage change'
    case 'note':
      return 'Note'
    case 'reply':
      return 'Reply'
    case 'meeting':
      return 'Meeting'
    case 'demo':
      return 'Demo / Showcase'
    default:
      return type
  }
}

// Merge tags available in email templates. Fields with no natural fallback (companyName) are required
// on every contact so they're never blank; contactName/firstName fall back to "there" so a greeting
// never renders as "Hi ,". Everything else falls back to an empty string so a missing detail just
// disappears from the sentence instead of showing a broken token.
const MERGE_TAGS: { tag: string; label: string }[] = [
  { tag: '{{companyName}}', label: 'Company name' },
  { tag: '{{contactName}}', label: 'Contact name' },
  { tag: '{{firstName}}', label: 'First name' },
  { tag: '{{jobTitle}}', label: 'Job title' },
  { tag: '{{city}}', label: 'City' },
  { tag: '{{region}}', label: 'Region' },
  { tag: '{{partnerType}}', label: 'Partner type' },
]

function mergeTemplateText(text: string, contact: PartnershipContact): string {
  const firstName = (contact.contactName || '').trim().split(/\s+/)[0] || 'there'
  const values: Record<string, string> = {
    companyName: contact.companyName || '',
    contactName: contact.contactName || 'there',
    firstName,
    jobTitle: contact.jobTitle || '',
    city: contact.city || '',
    region: contact.region || '',
    partnerType: contact.partnerType ? partnerTypeLabel(contact.partnerType) : '',
  }
  return text.replace(/\{\{(\w+)\}\}/g, (match, key: string) => (key in values ? values[key] : match))
}

/** Skips weekends. Used for the default follow-up reminder date so it never lands on a Sat/Sun. */
function addBusinessDays(from: Date, days: number): Date {
  const d = new Date(from)
  let remaining = days
  while (remaining > 0) {
    d.setDate(d.getDate() + 1)
    const dow = d.getDay()
    if (dow !== 0 && dow !== 6) remaining -= 1
  }
  return d
}

function toDateInputValue(d: Date): string {
  return d.toISOString().slice(0, 10)
}

type SortBy = 'recent' | 'name-az' | 'name-za'
type Tab = 'pipeline' | 'templates'
type View = 'kanban' | 'list'
type PipelineMode = 'email' | 'website_contact_form'

const emptyTemplateForm = { name: '', subject: '', body: '', category: '' }

const emptyAddForm = {
  companyName: '',
  email: '',
  partnerType: '',
  contactName: '',
  jobTitle: '',
  website: '',
  contactFormUrl: '',
  instagram: '',
  city: '',
  region: '',
  fitLevel: '',
  notes: '',
}

export default function PartnershipOutreach() {
  const { state, actions } = useApp()
  const contacts = state.partnershipContacts ?? []
  const activity = state.outreachActivity ?? []
  const templates = state.emailTemplates ?? []

  const [tab, setTab] = useState<Tab>('pipeline')
  const [view, setView] = useState<View>('kanban')
  const [pipelineMode, setPipelineMode] = useState<PipelineMode>('email')
  const [showImport, setShowImport] = useState(false)

  const [search, setSearch] = useState('')
  const [filterPartnerType, setFilterPartnerType] = useState('')
  const [filterFitLevel, setFilterFitLevel] = useState('')
  const [sortBy, setSortBy] = useState<SortBy>('recent')

  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set())
  const [bulkStage, setBulkStage] = useState('')
  const [bulkBusy, setBulkBusy] = useState(false)

  const [showAdd, setShowAdd] = useState(false)
  const [addForm, setAddForm] = useState(emptyAddForm)
  const [addError, setAddError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState(emptyAddForm)
  const [editStage, setEditStage] = useState('not_contacted')
  const [editError, setEditError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const [activityType, setActivityType] = useState<'note' | 'reply' | 'meeting' | 'demo'>('note')
  const [activitySubject, setActivitySubject] = useState('')
  const [activityBody, setActivityBody] = useState('')
  const [activityError, setActivityError] = useState<string | null>(null)
  const [loggingActivity, setLoggingActivity] = useState(false)

  // Send Email panel (single contact only in this phase)
  const [sendTemplateId, setSendTemplateId] = useState('')
  const [sendSubject, setSendSubject] = useState('')
  const [sendBody, setSendBody] = useState('')
  const [sendError, setSendError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [sendResult, setSendResult] = useState<string | null>(null)
  const [reminderEnabled, setReminderEnabled] = useState(true)
  const [reminderDate, setReminderDate] = useState('')
  const [reminderNote, setReminderNote] = useState('')

  // Templates tab
  const [templateForm, setTemplateForm] = useState(emptyTemplateForm)
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null)
  const [templateError, setTemplateError] = useState<string | null>(null)
  const [savingTemplate, setSavingTemplate] = useState(false)
  const [showTemplateForm, setShowTemplateForm] = useState(false)

  const [toast, setToast] = useState<string | null>(null)

  const selectedContact = useMemo(
    () => contacts.find((c) => c.id === selectedId) ?? null,
    [contacts, selectedId]
  )
  const selectedActivity = useMemo(
    () =>
      activity
        .filter((a) => a.partnershipContactId === selectedId)
        .slice()
        .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')),
    [activity, selectedId]
  )

  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }

  const activeStages = pipelineMode === 'website_contact_form' ? FORM_CONTACT_STAGES : EMAIL_STAGES

  const filteredContacts = useMemo(() => {
    const q = search.trim().toLowerCase()
    let list = contacts.filter((c) =>
      pipelineMode === 'website_contact_form' ? isWebsiteFormContact(c) : !isWebsiteFormContact(c)
    )
    if (q) {
      list = list.filter(
        (c) =>
          (c.companyName || '').toLowerCase().includes(q) ||
          (c.contactName || '').toLowerCase().includes(q) ||
          (c.email || '').toLowerCase().includes(q) ||
          (c.city || '').toLowerCase().includes(q) ||
          (c.region || '').toLowerCase().includes(q)
      )
    }
    if (filterPartnerType) list = list.filter((c) => c.partnerType === filterPartnerType)
    if (filterFitLevel) list = list.filter((c) => c.fitLevel === filterFitLevel)
    const byId = (a: PartnershipContact, b: PartnershipContact) => a.id.localeCompare(b.id)
    if (sortBy === 'name-az') list.sort((a, b) => (a.companyName || '').localeCompare(b.companyName || '', undefined, { sensitivity: 'base' }) || byId(a, b))
    else if (sortBy === 'name-za') list.sort((a, b) => (b.companyName || '').localeCompare(a.companyName || '', undefined, { sensitivity: 'base' }) || byId(a, b))
    else list.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || '') || byId(a, b))
    return list
  }, [contacts, search, filterPartnerType, filterFitLevel, sortBy, pipelineMode])

  const byStage = useMemo(() => {
    const grouped: Record<string, PartnershipContact[]> = {}
    for (const c of filteredContacts) {
      if (!grouped[c.stage]) grouped[c.stage] = []
      grouped[c.stage].push(c)
    }
    return grouped
  }, [filteredContacts])

  const toggleChecked = (id: string) => {
    setCheckedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleCheckAll = (checked: boolean) => {
    setCheckedIds(checked ? new Set(filteredContacts.map((c) => c.id)) : new Set())
  }

  const handleBulkStageChange = async () => {
    if (!bulkStage || checkedIds.size === 0) return
    setBulkBusy(true)
    try {
      let failed = 0
      for (const id of checkedIds) {
        const result = await apiUpdatePartnershipContact(id, { stage: bulkStage })
        if (!result.ok) failed += 1
      }
      await actions.refreshState()
      const succeeded = checkedIds.size - failed
      if (failed > 0) {
        showToast(`Updated ${succeeded} contact${succeeded === 1 ? '' : 's'} — ${failed} failed. Try again for the rest.`)
      } else {
        showToast(`Updated stage for ${succeeded} contact${succeeded === 1 ? '' : 's'}.`)
      }
      setCheckedIds(new Set())
      setBulkStage('')
    } finally {
      setBulkBusy(false)
    }
  }

  const handleBulkDelete = async () => {
    if (checkedIds.size === 0) return
    const count = checkedIds.size
    if (!window.confirm(`Remove ${count} contact${count === 1 ? '' : 's'} from Partnership Outreach? This can't be undone.`)) return
    setBulkBusy(true)
    try {
      let failed = 0
      for (const id of checkedIds) {
        const ok = await apiDeletePartnershipContact(id)
        if (!ok) failed += 1
      }
      await actions.refreshState()
      const succeeded = count - failed
      showToast(failed > 0 ? `Removed ${succeeded} contact${succeeded === 1 ? '' : 's'} — ${failed} failed.` : 'Contacts removed.')
      setCheckedIds(new Set())
    } finally {
      setBulkBusy(false)
    }
  }

  const resetAddForm = () => {
    setAddForm(emptyAddForm)
    setAddError(null)
  }

  const handleAddContact = async (e: React.FormEvent) => {
    e.preventDefault()
    setAddError(null)
    setAdding(true)
    try {
      const result = await apiCreatePartnershipContact({
        companyName: addForm.companyName.trim(),
        email: addForm.email.trim(),
        partnerType: addForm.partnerType || undefined,
        contactName: addForm.contactName.trim() || undefined,
        jobTitle: addForm.jobTitle.trim() || undefined,
        website: addForm.website.trim() || undefined,
        instagram: addForm.instagram.trim() || undefined,
        city: addForm.city.trim() || undefined,
        region: addForm.region.trim() || undefined,
        fitLevel: addForm.fitLevel || undefined,
        notes: addForm.notes.trim() || undefined,
      })
      if (!result.ok) {
        setAddError(result.error)
        return
      }
      await actions.refreshState()
      setShowAdd(false)
      resetAddForm()
      showToast(`${addForm.companyName.trim()} added.`)
    } finally {
      setAdding(false)
    }
  }

  const openContact = (c: PartnershipContact) => {
    setSelectedId(c.id)
    setEditForm({
      companyName: c.companyName || '',
      email: isPlaceholderFormEmail(c.email) ? '' : (c.email || ''),
      partnerType: c.partnerType || '',
      contactName: c.contactName || '',
      jobTitle: c.jobTitle || '',
      website: c.website || '',
      contactFormUrl: c.contactFormUrl || '',
      instagram: c.instagram || '',
      city: c.city || '',
      region: c.region || '',
      fitLevel: c.fitLevel || '',
      notes: c.notes || '',
    })
    setEditStage(c.stage)
    setEditError(null)
    setActivityType('note')
    setActivitySubject('')
    setActivityBody('')
    setActivityError(null)

    setSendTemplateId('')
    setSendSubject('')
    setSendBody('')
    setSendError(null)
    setSendResult(null)
    setReminderEnabled(true)
    const offsetDays = c.firstEmailSentAt ? 7 : 5
    setReminderDate(toDateInputValue(addBusinessDays(new Date(), offsetDays)))
    setReminderNote('')
  }

  const closeDrawer = () => {
    setSelectedId(null)
  }

  const handleSelectTemplate = (templateId: string) => {
    setSendTemplateId(templateId)
    setSendResult(null)
    if (!templateId || !selectedContact) {
      setSendSubject('')
      setSendBody('')
      return
    }
    const tpl = templates.find((t) => t.id === templateId)
    if (!tpl) return
    setSendSubject(mergeTemplateText(tpl.subject, selectedContact))
    setSendBody(mergeTemplateText(tpl.body, selectedContact))
  }

  const handleSendEmail = async () => {
    if (!selectedContact) return
    setSendError(null)
    setSendResult(null)
    if (!sendSubject.trim() || !sendBody.trim()) {
      setSendError('Choose a template (or write a subject and message) before sending.')
      return
    }
    setSending(true)
    try {
      const result = await apiSendPartnershipEmail(selectedContact.id, {
        templateId: sendTemplateId || undefined,
        subject: sendSubject.trim(),
        body: sendBody.trim(),
        reminder: reminderEnabled && reminderDate
          ? { date: reminderDate, notes: reminderNote.trim() || undefined }
          : null,
      })
      if (!result.ok) {
        setSendError(result.error)
        return
      }
      await actions.refreshState()
      setEditStage(result.contact.stage)
      setSendResult(
        result.reminder
          ? `Email sent. Follow-up reminder set for ${new Date(result.reminder.date).toLocaleDateString()}.`
          : 'Email sent.'
      )
      showToast(`Email sent to ${selectedContact.companyName}.`)
    } finally {
      setSending(false)
    }
  }

  const handleSaveEdit = async () => {
    if (!selectedContact) return
    setEditError(null)
    setSaving(true)
    try {
      const result = await apiUpdatePartnershipContact(selectedContact.id, {
        companyName: editForm.companyName.trim(),
        email: editForm.email.trim() || selectedContact.email,
        partnerType: editForm.partnerType || undefined,
        contactName: editForm.contactName.trim() || undefined,
        jobTitle: editForm.jobTitle.trim() || undefined,
        website: editForm.website.trim() || undefined,
        contactFormUrl: editForm.contactFormUrl.trim() || undefined,
        instagram: editForm.instagram.trim() || undefined,
        city: editForm.city.trim() || undefined,
        region: editForm.region.trim() || undefined,
        fitLevel: editForm.fitLevel || undefined,
        notes: editForm.notes.trim() || undefined,
        stage: editStage,
      })
      if (!result.ok) {
        setEditError(result.error)
        return
      }
      await actions.refreshState()
      showToast('Saved.')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!selectedContact) return
    if (!window.confirm(`Remove "${selectedContact.companyName}" from Partnership Outreach? This can't be undone.`)) return
    setDeleting(true)
    try {
      const ok = await apiDeletePartnershipContact(selectedContact.id)
      if (!ok) {
        window.alert('Could not delete this contact. Try again.')
        return
      }
      await actions.refreshState()
      closeDrawer()
      showToast('Contact removed.')
    } finally {
      setDeleting(false)
    }
  }

  const handleLogActivity = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedContact) return
    setActivityError(null)
    if (!activitySubject.trim() && !activityBody.trim()) {
      setActivityError('Add a subject or a note before logging this.')
      return
    }
    setLoggingActivity(true)
    try {
      const result = await apiAddOutreachActivity(selectedContact.id, {
        type: activityType,
        subject: activitySubject.trim() || undefined,
        body: activityBody.trim() || undefined,
      })
      if (!result.ok) {
        setActivityError(result.error)
        return
      }
      await actions.refreshState()
      setActivitySubject('')
      setActivityBody('')
    } finally {
      setLoggingActivity(false)
    }
  }

  const resetTemplateForm = () => {
    setTemplateForm(emptyTemplateForm)
    setEditingTemplateId(null)
    setTemplateError(null)
  }

  const startEditTemplate = (t: EmailTemplate) => {
    setTemplateForm({ name: t.name, subject: t.subject, body: t.body, category: t.category || '' })
    setEditingTemplateId(t.id)
    setTemplateError(null)
    setShowTemplateForm(true)
  }

  const insertMergeTag = (tag: string, field: 'subject' | 'body') => {
    setTemplateForm((f) => ({ ...f, [field]: `${f[field]}${f[field] && !f[field].endsWith(' ') ? ' ' : ''}${tag}` }))
  }

  const handleSaveTemplate = async (e: React.FormEvent) => {
    e.preventDefault()
    setTemplateError(null)
    const name = templateForm.name.trim()
    const subject = templateForm.subject.trim()
    const body = templateForm.body.trim()
    if (!name || !subject || !body) {
      setTemplateError('Name, subject, and message are all required.')
      return
    }
    setSavingTemplate(true)
    try {
      const payload = { name, subject, body, category: templateForm.category.trim() || undefined }
      const result = editingTemplateId
        ? await apiUpdateEmailTemplate(editingTemplateId, payload)
        : await apiCreateEmailTemplate(payload)
      if (!result.ok) {
        setTemplateError(result.error)
        return
      }
      await actions.refreshState()
      setShowTemplateForm(false)
      resetTemplateForm()
      showToast(editingTemplateId ? 'Template updated.' : 'Template created.')
    } finally {
      setSavingTemplate(false)
    }
  }

  const handleDeleteTemplate = async (t: EmailTemplate) => {
    if (!window.confirm(`Delete template "${t.name}"? This can't be undone.`)) return
    const ok = await apiDeleteEmailTemplate(t.id)
    if (!ok) {
      window.alert('Could not delete this template. Try again.')
      return
    }
    await actions.refreshState()
    if (editingTemplateId === t.id) resetTemplateForm()
    showToast('Template deleted.')
  }

  return (
    <div className={styles.page}>
      {toast && <p className={styles.toast} role="status">{toast}</p>}
      <header className={styles.header}>
        <h1>Partnership Outreach</h1>
        <p className={styles.subtitle}>Cold outreach pipeline for referral partners — venues, planners, photographers, and more.</p>
        {tab === 'pipeline' ? (
          <div style={{ display: 'flex', gap: '0.6rem' }}>
            <button type="button" className={styles.importBtn} onClick={() => setShowImport(true)}>
              Import contacts
            </button>
            <button type="button" className={styles.addBtn} onClick={() => { resetAddForm(); setShowAdd(true) }}>
              Add contact
            </button>
          </div>
        ) : (
          <button type="button" className={styles.addBtn} onClick={() => { resetTemplateForm(); setShowTemplateForm(true) }}>
            New template
          </button>
        )}
      </header>

      <div className={styles.tabs} role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'pipeline'}
          className={styles.tabBtn}
          data-active={tab === 'pipeline'}
          onClick={() => setTab('pipeline')}
        >
          Pipeline
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'templates'}
          className={styles.tabBtn}
          data-active={tab === 'templates'}
          onClick={() => setTab('templates')}
        >
          Templates
        </button>
      </div>

      {tab === 'templates' ? (
        <section className={styles.templatesTab}>
          {showTemplateForm && (
            <section className={styles.modal}>
              <form onSubmit={handleSaveTemplate} className={styles.form}>
                <h2>{editingTemplateId ? 'Edit template' : 'New template'}</h2>
                {templateError && <p className={styles.error} role="alert">{templateError}</p>}
                <label>
                  Name *
                  <input
                    type="text"
                    value={templateForm.name}
                    onChange={(e) => setTemplateForm((f) => ({ ...f, name: e.target.value }))}
                    placeholder="e.g. First Outreach"
                    className={styles.input}
                    required
                  />
                </label>
                <label>
                  Category
                  <input
                    type="text"
                    value={templateForm.category}
                    onChange={(e) => setTemplateForm((f) => ({ ...f, category: e.target.value }))}
                    placeholder="e.g. cold, follow_up"
                    className={styles.input}
                  />
                </label>
                <label>
                  Subject *
                  <input
                    type="text"
                    value={templateForm.subject}
                    onChange={(e) => setTemplateForm((f) => ({ ...f, subject: e.target.value }))}
                    placeholder="e.g. Partnering with Aurora Sonnet"
                    className={styles.input}
                    required
                  />
                </label>
                <div className={styles.mergeTagRow}>
                  {MERGE_TAGS.map((m) => (
                    <button
                      key={`subject-${m.tag}`}
                      type="button"
                      className={styles.mergeTagChip}
                      onClick={() => insertMergeTag(m.tag, 'subject')}
                      title={`Insert ${m.label} into subject`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
                <label>
                  Message *
                  <textarea
                    value={templateForm.body}
                    onChange={(e) => setTemplateForm((f) => ({ ...f, body: e.target.value }))}
                    className={styles.textarea}
                    rows={8}
                    required
                  />
                </label>
                <div className={styles.mergeTagRow}>
                  {MERGE_TAGS.map((m) => (
                    <button
                      key={`body-${m.tag}`}
                      type="button"
                      className={styles.mergeTagChip}
                      onClick={() => insertMergeTag(m.tag, 'body')}
                      title={`Insert ${m.label} into message`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
                <div className={styles.formActions}>
                  <button type="button" className={styles.cancelBtn} onClick={() => { setShowTemplateForm(false); resetTemplateForm() }}>
                    Cancel
                  </button>
                  <button type="submit" className={styles.submitBtn} disabled={savingTemplate}>
                    {savingTemplate ? 'Saving…' : editingTemplateId ? 'Save changes' : 'Create template'}
                  </button>
                </div>
              </form>
            </section>
          )}

          {templates.length === 0 ? (
            <p className={styles.empty}>No email templates yet. Click &quot;New template&quot; to write your first outreach email.</p>
          ) : (
            <ul className={styles.templateList}>
              {templates.map((t) => (
                <li key={t.id} className={styles.templateCard}>
                  <div className={styles.templateCardHead}>
                    <strong>{t.name}</strong>
                    {t.category && <span className={styles.templateCategory}>{t.category}</span>}
                  </div>
                  <p className={styles.templateSubjectPreview}>{t.subject}</p>
                  <p className={styles.templateBodyPreview}>{t.body}</p>
                  <div className={styles.templateCardActions}>
                    <button type="button" className={styles.cancelBtn} onClick={() => startEditTemplate(t)}>
                      Edit
                    </button>
                    <button type="button" className={styles.deleteBtn} onClick={() => handleDeleteTemplate(t)}>
                      Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : (
      <>

      {showAdd && (
        <section className={styles.modal}>
          <form onSubmit={handleAddContact} className={styles.form}>
            <h2>Add partnership contact</h2>
            {addError && <p className={styles.error} role="alert">{addError}</p>}
            <div className={styles.formGrid}>
              <label>
                Company name *
                <input
                  type="text"
                  value={addForm.companyName}
                  onChange={(e) => setAddForm((f) => ({ ...f, companyName: e.target.value }))}
                  placeholder="e.g. Garden Estate Vineyard"
                  className={styles.input}
                  required
                />
              </label>
              <label>
                Email *
                <input
                  type="email"
                  value={addForm.email}
                  onChange={(e) => setAddForm((f) => ({ ...f, email: e.target.value }))}
                  placeholder="hello@venue.com"
                  className={styles.input}
                  required
                />
              </label>
              <label>
                Partner type
                <select
                  value={addForm.partnerType}
                  onChange={(e) => setAddForm((f) => ({ ...f, partnerType: e.target.value }))}
                  className={styles.select}
                >
                  <option value="">Select type</option>
                  {PARTNER_TYPES.map((t) => (
                    <option key={t.id} value={t.id}>{t.label}</option>
                  ))}
                </select>
              </label>
              <label>
                Fit level
                <select
                  value={addForm.fitLevel}
                  onChange={(e) => setAddForm((f) => ({ ...f, fitLevel: e.target.value }))}
                  className={styles.select}
                >
                  <option value="">Select fit</option>
                  {FIT_LEVELS.map((fl) => (
                    <option key={fl.id} value={fl.id}>{fl.label}</option>
                  ))}
                </select>
              </label>
              <label>
                Contact name
                <input
                  type="text"
                  value={addForm.contactName}
                  onChange={(e) => setAddForm((f) => ({ ...f, contactName: e.target.value }))}
                  placeholder="e.g. Jane Doe"
                  className={styles.input}
                />
              </label>
              <label>
                Job title
                <input
                  type="text"
                  value={addForm.jobTitle}
                  onChange={(e) => setAddForm((f) => ({ ...f, jobTitle: e.target.value }))}
                  placeholder="e.g. Events Manager"
                  className={styles.input}
                />
              </label>
              <label>
                Website
                <input
                  type="text"
                  value={addForm.website}
                  onChange={(e) => setAddForm((f) => ({ ...f, website: e.target.value }))}
                  placeholder="https://..."
                  className={styles.input}
                />
              </label>
              <label>
                Instagram
                <input
                  type="text"
                  value={addForm.instagram}
                  onChange={(e) => setAddForm((f) => ({ ...f, instagram: e.target.value }))}
                  placeholder="@handle"
                  className={styles.input}
                />
              </label>
              <label>
                City
                <input
                  type="text"
                  value={addForm.city}
                  onChange={(e) => setAddForm((f) => ({ ...f, city: e.target.value }))}
                  className={styles.input}
                />
              </label>
              <label>
                Region
                <input
                  type="text"
                  value={addForm.region}
                  onChange={(e) => setAddForm((f) => ({ ...f, region: e.target.value }))}
                  className={styles.input}
                />
              </label>
              <label className={styles.fullWidth}>
                Notes
                <textarea
                  value={addForm.notes}
                  onChange={(e) => setAddForm((f) => ({ ...f, notes: e.target.value }))}
                  className={styles.textarea}
                  rows={2}
                />
              </label>
            </div>
            <div className={styles.formActions}>
              <button type="button" className={styles.cancelBtn} onClick={() => { setShowAdd(false); resetAddForm() }}>
                Cancel
              </button>
              <button type="submit" className={styles.submitBtn} disabled={adding}>
                {adding ? 'Adding…' : 'Add contact'}
              </button>
            </div>
          </form>
        </section>
      )}

      <div className={styles.toolbar}>
        <input
          type="search"
          placeholder="Search company, contact, email, city…"
          className={styles.search}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search partnership contacts"
        />
        <select
          className={styles.select}
          aria-label="Filter by partner type"
          value={filterPartnerType}
          onChange={(e) => setFilterPartnerType(e.target.value)}
        >
          <option value="">All types</option>
          {PARTNER_TYPES.map((t) => (
            <option key={t.id} value={t.id}>{t.label}</option>
          ))}
        </select>
        <select
          className={styles.select}
          aria-label="Filter by fit level"
          value={filterFitLevel}
          onChange={(e) => setFilterFitLevel(e.target.value)}
        >
          <option value="">All fit levels</option>
          {FIT_LEVELS.map((fl) => (
            <option key={fl.id} value={fl.id}>{fl.label} fit</option>
          ))}
        </select>
        <select
          className={styles.select}
          aria-label="Sort"
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as SortBy)}
        >
          <option value="recent">Recently updated</option>
          <option value="name-az">Company A–Z</option>
          <option value="name-za">Company Z–A</option>
        </select>
        <div className={styles.viewToggle} role="tablist" aria-label="Outreach pipeline">
          <button type="button" className={styles.viewToggleBtn} data-active={pipelineMode === 'email'} onClick={() => setPipelineMode('email')}>
            Email outreach
          </button>
          <button type="button" className={styles.viewToggleBtn} data-active={pipelineMode === 'website_contact_form'} onClick={() => setPipelineMode('website_contact_form')}>
            Website Contact Form
          </button>
        </div>
        <div className={styles.viewToggle} role="tablist" aria-label="Pipeline view">
          <button type="button" className={styles.viewToggleBtn} data-active={view === 'kanban'} onClick={() => setView('kanban')}>
            Kanban
          </button>
          <button type="button" className={styles.viewToggleBtn} data-active={view === 'list'} onClick={() => setView('list')}>
            List
          </button>
        </div>
      </div>

      {view === 'list' && checkedIds.size > 0 && (
        <div className={styles.bulkBar}>
          <span>{checkedIds.size} selected</span>
          <select className={styles.select} value={bulkStage} onChange={(e) => setBulkStage(e.target.value)} aria-label="Bulk set stage">
            <option value="">Set stage…</option>
            {activeStages.map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
          <button type="button" className={styles.cancelBtn} disabled={!bulkStage || bulkBusy} onClick={handleBulkStageChange}>
            Apply
          </button>
          <button type="button" className={styles.deleteBtn} disabled={bulkBusy} onClick={handleBulkDelete}>
            Delete selected
          </button>
          <button type="button" className={styles.cancelBtn} disabled={bulkBusy} onClick={() => setCheckedIds(new Set())}>
            Clear selection
          </button>
        </div>
      )}

      {contacts.length === 0 ? (
        <p className={styles.empty}>No partnership contacts yet. Click &quot;Add contact&quot; to start building your outreach list, or &quot;Import contacts&quot; to bring in a spreadsheet.</p>
      ) : view === 'list' ? (
        <div className={styles.listWrap}>
          <table className={styles.listTable}>
            <thead>
              <tr>
                <th><input type="checkbox" aria-label="Select all" checked={filteredContacts.length > 0 && checkedIds.size === filteredContacts.length} onChange={(e) => toggleCheckAll(e.target.checked)} /></th>
                <th>Company</th>
                <th>Contact</th>
                <th>Email</th>
                <th>Type</th>
                <th>Location</th>
                <th>Fit</th>
                <th>Stage</th>
              </tr>
            </thead>
            <tbody>
              {filteredContacts.length === 0 && (
                <tr>
                  <td colSpan={8} className={styles.empty}>No contacts match your search or filters.</td>
                </tr>
              )}
              {filteredContacts.map((c) => (
                <tr key={c.id} data-selected={checkedIds.has(c.id)} onClick={() => openContact(c)}>
                  <td onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={checkedIds.has(c.id)} onChange={() => toggleChecked(c.id)} aria-label={`Select ${c.companyName}`} />
                  </td>
                  <td>{c.companyName}</td>
                  <td>{c.contactName || '—'}</td>
                  <td>{contactEmailDisplay(c)}</td>
                  <td>{partnerTypeLabel(c.partnerType)}</td>
                  <td>{[c.city, c.region].filter(Boolean).join(', ') || '—'}</td>
                  <td>{fitLevelLabel(c.fitLevel)}</td>
                  <td><span className={styles.stagePill}>{stageLabel(c.stage)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className={styles.pipeline}>
          {activeStages.map((stage) => (
            <div key={stage.id} className={styles.column}>
              <div className={styles.columnHeader}>
                <h2>{stage.label}</h2>
                <span className={styles.count}>{(byStage[stage.id] ?? []).length}</span>
              </div>
              <ul className={styles.cards}>
                {(byStage[stage.id] ?? []).map((c) => (
                  <li
                    key={c.id}
                    className={styles.card}
                    role="button"
                    tabIndex={0}
                    onClick={() => openContact(c)}
                    onKeyDown={(e) => e.key === 'Enter' && openContact(c)}
                  >
                    <strong>{c.companyName}</strong>
                    {c.partnerType && <span className={styles.partnerType}>{partnerTypeLabel(c.partnerType)}</span>}
                    {c.contactName && <span className={styles.contactName}>{c.contactName}</span>}
                    <span className={styles.email}>{contactEmailDisplay(c)}</span>
                    {(c.city || c.region) && (
                      <span className={styles.location}>{[c.city, c.region].filter(Boolean).join(', ')}</span>
                    )}
                    {c.fitLevel && (
                      <span className={styles.fit} data-fit={c.fitLevel}>{fitLevelLabel(c.fitLevel)} fit</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {selectedContact && (
        <div className={styles.drawerOverlay} onClick={closeDrawer} role="dialog" aria-modal="true" aria-label="Partnership contact detail">
          <div className={styles.drawer} onClick={(e) => e.stopPropagation()}>
            <div className={styles.drawerHeader}>
              <div>
                <h2>{selectedContact.companyName}</h2>
                {isWebsiteFormContact(selectedContact) && (
                  <span className={styles.outreachMethodBadge}>Website Contact Form</span>
                )}
              </div>
              <button type="button" className={styles.closeBtn} onClick={closeDrawer} aria-label="Close">
                ×
              </button>
            </div>

            {isWebsiteFormContact(selectedContact) && contactFormVisitUrl(selectedContact) && (
              <div className={styles.visitFormRow}>
                <a
                  href={contactFormVisitUrl(selectedContact)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.visitFormBtn}
                >
                  Visit Contact Form
                </a>
              </div>
            )}

            {editError && <p className={styles.error} role="alert">{editError}</p>}

            <div className={styles.drawerGrid}>
              <label>
                Company name
                <input
                  type="text"
                  value={editForm.companyName}
                  onChange={(e) => setEditForm((f) => ({ ...f, companyName: e.target.value }))}
                  className={styles.input}
                />
              </label>
              <label>
                Email
                <input
                  type="email"
                  value={editForm.email}
                  onChange={(e) => setEditForm((f) => ({ ...f, email: e.target.value }))}
                  className={styles.input}
                  placeholder={isWebsiteFormContact(selectedContact) ? 'Add email when you have one' : undefined}
                />
              </label>
              {isWebsiteFormContact(selectedContact) && (
                <label>
                  Contact form URL
                  <input
                    type="url"
                    value={editForm.contactFormUrl}
                    onChange={(e) => setEditForm((f) => ({ ...f, contactFormUrl: e.target.value }))}
                    className={styles.input}
                    placeholder="https://…"
                  />
                </label>
              )}
              <label>
                Stage
                <select value={editStage} onChange={(e) => setEditStage(e.target.value)} className={styles.select}>
                  {(isWebsiteFormContact(selectedContact) ? FORM_CONTACT_STAGES : EMAIL_STAGES).map((s) => (
                    <option key={s.id} value={s.id}>{s.label}</option>
                  ))}
                </select>
              </label>
              <label>
                Partner type
                <select
                  value={editForm.partnerType}
                  onChange={(e) => setEditForm((f) => ({ ...f, partnerType: e.target.value }))}
                  className={styles.select}
                >
                  <option value="">None</option>
                  {PARTNER_TYPES.map((t) => (
                    <option key={t.id} value={t.id}>{t.label}</option>
                  ))}
                </select>
              </label>
              <label>
                Fit level
                <select
                  value={editForm.fitLevel}
                  onChange={(e) => setEditForm((f) => ({ ...f, fitLevel: e.target.value }))}
                  className={styles.select}
                >
                  <option value="">None</option>
                  {FIT_LEVELS.map((fl) => (
                    <option key={fl.id} value={fl.id}>{fl.label}</option>
                  ))}
                </select>
              </label>
              <label>
                Contact name
                <input
                  type="text"
                  value={editForm.contactName}
                  onChange={(e) => setEditForm((f) => ({ ...f, contactName: e.target.value }))}
                  className={styles.input}
                />
              </label>
              <label>
                Job title
                <input
                  type="text"
                  value={editForm.jobTitle}
                  onChange={(e) => setEditForm((f) => ({ ...f, jobTitle: e.target.value }))}
                  className={styles.input}
                />
              </label>
              <label>
                Website
                <input
                  type="text"
                  value={editForm.website}
                  onChange={(e) => setEditForm((f) => ({ ...f, website: e.target.value }))}
                  className={styles.input}
                />
              </label>
              <label>
                Instagram
                <input
                  type="text"
                  value={editForm.instagram}
                  onChange={(e) => setEditForm((f) => ({ ...f, instagram: e.target.value }))}
                  className={styles.input}
                />
              </label>
              <label>
                City
                <input
                  type="text"
                  value={editForm.city}
                  onChange={(e) => setEditForm((f) => ({ ...f, city: e.target.value }))}
                  className={styles.input}
                />
              </label>
              <label>
                Region
                <input
                  type="text"
                  value={editForm.region}
                  onChange={(e) => setEditForm((f) => ({ ...f, region: e.target.value }))}
                  className={styles.input}
                />
              </label>
              <label className={styles.fullWidth}>
                Notes
                <textarea
                  value={editForm.notes}
                  onChange={(e) => setEditForm((f) => ({ ...f, notes: e.target.value }))}
                  className={styles.textarea}
                  rows={3}
                />
              </label>
            </div>

            <div className={styles.drawerActions}>
              <button type="button" className={styles.deleteBtn} onClick={handleDelete} disabled={deleting}>
                {deleting ? 'Removing…' : 'Delete'}
              </button>
              <button type="button" className={styles.submitBtn} onClick={handleSaveEdit} disabled={saving}>
                {saving ? 'Saving…' : 'Save changes'}
              </button>
            </div>

            <section className={styles.sendSection} aria-disabled={!canSendEmailToContact(selectedContact)}>
              <h3>Send email</h3>
              {!canSendEmailToContact(selectedContact) && (
                <p className={styles.hint}>
                  {isWebsiteFormContact(selectedContact)
                    ? 'Send email is disabled until you add a valid email address for this contact.'
                    : 'This contact needs a valid email address before you can send.'}
                </p>
              )}
              {sendError && <p className={styles.error} role="alert">{sendError}</p>}
              {sendResult && <p className={styles.sendSuccess} role="status">{sendResult}</p>}
              <label>
                Template
                <select
                  value={sendTemplateId}
                  onChange={(e) => handleSelectTemplate(e.target.value)}
                  className={styles.select}
                  aria-label="Email template"
                  disabled={!canSendEmailToContact(selectedContact)}
                >
                  <option value="">Select a template…</option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </label>
              {templates.length === 0 && (
                <p className={styles.hint}>No templates yet — create one in the Templates tab first.</p>
              )}
              <label>
                Subject
                <input
                  type="text"
                  value={sendSubject}
                  onChange={(e) => setSendSubject(e.target.value)}
                  className={styles.input}
                  placeholder="Select a template to fill this in, then edit as needed"
                  disabled={!canSendEmailToContact(selectedContact)}
                />
              </label>
              <label>
                Message
                <textarea
                  value={sendBody}
                  onChange={(e) => setSendBody(e.target.value)}
                  className={styles.textarea}
                  rows={7}
                  placeholder="Select a template to fill this in, then edit as needed"
                  disabled={!canSendEmailToContact(selectedContact)}
                />
              </label>
              <label className={styles.reminderCheckboxRow}>
                <input
                  type="checkbox"
                  checked={reminderEnabled}
                  onChange={(e) => setReminderEnabled(e.target.checked)}
                />
                Create a follow-up reminder for this contact
              </label>
              {reminderEnabled && (
                <div className={styles.reminderFields}>
                  <label>
                    Follow up on
                    <input
                      type="date"
                      value={reminderDate}
                      onChange={(e) => setReminderDate(e.target.value)}
                      className={styles.input}
                    />
                  </label>
                  <label>
                    Reminder note (optional)
                    <input
                      type="text"
                      value={reminderNote}
                      onChange={(e) => setReminderNote(e.target.value)}
                      className={styles.input}
                      placeholder="e.g. mention the summer showcase"
                    />
                  </label>
                </div>
              )}
              <div className={styles.formActions}>
                <button type="button" className={styles.submitBtn} onClick={handleSendEmail} disabled={sending || !canSendEmailToContact(selectedContact)}>
                  {sending ? 'Sending…' : 'Send email'}
                </button>
              </div>
            </section>

            <section className={styles.activitySection}>
              <h3>Log activity</h3>
              <form onSubmit={handleLogActivity} className={styles.activityForm}>
                {activityError && <p className={styles.error} role="alert">{activityError}</p>}
                <div className={styles.activityFormRow}>
                  <select
                    value={activityType}
                    onChange={(e) => setActivityType(e.target.value as typeof activityType)}
                    className={styles.select}
                    aria-label="Activity type"
                  >
                    {MANUAL_ACTIVITY_TYPES.map((t) => (
                      <option key={t.id} value={t.id}>{t.label}</option>
                    ))}
                  </select>
                  <input
                    type="text"
                    placeholder="Subject (optional)"
                    value={activitySubject}
                    onChange={(e) => setActivitySubject(e.target.value)}
                    className={styles.input}
                  />
                </div>
                <textarea
                  placeholder="What happened?"
                  value={activityBody}
                  onChange={(e) => setActivityBody(e.target.value)}
                  className={styles.textarea}
                  rows={2}
                />
                <div className={styles.activityFormActions}>
                  <button type="submit" className={styles.submitBtn} disabled={loggingActivity}>
                    {loggingActivity ? 'Logging…' : 'Log activity'}
                  </button>
                </div>
              </form>

              <h3>Timeline</h3>
              {selectedActivity.length === 0 ? (
                <p className={styles.empty}>No activity logged yet.</p>
              ) : (
                <ul className={styles.timeline}>
                  {selectedActivity.map((a) => (
                    <li key={a.id} className={styles.timelineItem}>
                      <div className={styles.timelineHead}>
                        <span className={styles.timelineType} data-type={a.type}>{activityTypeLabel(a.type)}</span>
                        <span className={styles.timelineDate}>{new Date(a.createdAt).toLocaleString()}</span>
                      </div>
                      {a.subject && <strong className={styles.timelineSubject}>{a.subject}</strong>}
                      {a.body && <p className={styles.timelineBody}>{a.body}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </div>
      )}

      {showImport && <PartnershipImportWizard onClose={() => setShowImport(false)} />}
      </>
      )}
    </div>
  )
}
