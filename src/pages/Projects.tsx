import { useState, useEffect, useMemo } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useApp } from '../context/AppContext'
import { useUndo } from '../context/UndoContext'
import {
  apiDeleteProject,
  apiUpdateProject,
  apiUpdateClient,
  apiCreatePipelineStage,
  apiUpdatePipelineStage,
  apiDeletePipelineStage,
} from '../api/db'
import type { Project } from '../data/mock'
import { ALL_PACKAGES, getPackageOrDuoPrice } from '../data/packages'
import { getInquiryReplyBody } from '../utils/emailSignature'
import styles from './Projects.module.css'

const defaultStages = [
  { id: 'inquiry', label: 'Inquiry', sortOrder: 1 },
  { id: 'proposal', label: 'Proposal', sortOrder: 2 },
  { id: 'booked', label: 'Booked', sortOrder: 3 },
  { id: 'completed', label: 'Completed', sortOrder: 4 },
  { id: 'lost', label: 'Lost', sortOrder: 5 },
]

type SortBy = 'recent' | 'name-az' | 'name-za' | 'date-asc' | 'date-desc' | 'value-asc' | 'value-desc'

function compareProjects(sortBy: SortBy, a: Project, b: Project): number {
  const byId = a.id.localeCompare(b.id)
  switch (sortBy) {
    case 'name-az':
      return (a.clientName || '').localeCompare(b.clientName || '', undefined, { sensitivity: 'base' }) || byId
    case 'name-za':
      return (b.clientName || '').localeCompare(a.clientName || '', undefined, { sensitivity: 'base' }) || byId
    case 'date-asc':
      return (a.weddingDate || '').localeCompare(b.weddingDate || '') || byId
    case 'date-desc':
      return (b.weddingDate || '').localeCompare(a.weddingDate || '') || byId
    case 'value-asc':
      return a.value - b.value || byId
    case 'value-desc':
      return b.value - a.value || byId
    default:
      return (b.createdAt || '').localeCompare(a.createdAt || '') || byId
  }
}

export default function Projects() {
  const location = useLocation()
  const navigate = useNavigate()
  const { state, actions } = useApp()
  const { pushUndo } = useUndo()
  const projects = state.projects ?? []
  const clients = state.clients ?? []
  const stateStages = state.pipelineStages
  const stages = (stateStages && stateStages.length > 0 ? stateStages : defaultStages).slice().sort((a, b) => a.sortOrder - b.sortOrder)
  const firstStageId = stages[0]?.id ?? 'inquiry'
  const lastStageId = stages.length > 0 ? stages[stages.length - 1].id : undefined
  const activeProjects = useMemo(() => projects.filter((p) => !p.archivedAt), [projects])
  const archivedProjects = useMemo(() => projects.filter((p) => p.archivedAt).sort((a, b) => (b.archivedAt || '').localeCompare(a.archivedAt || '')), [projects])

  const [showNewInquiry, setShowNewInquiry] = useState(false)
  const [showManagePipelines, setShowManagePipelines] = useState(false)
  const [newStageLabel, setNewStageLabel] = useState('')
  const [editingStageId, setEditingStageId] = useState<string | null>(null)
  const [editingStageLabel, setEditingStageLabel] = useState('')
  const [editingProject, setEditingProject] = useState<Project | null>(null)
  const [editForm, setEditForm] = useState({
    clientName: '',
    clientEmail: '',
    clientPhone: '',
    title: '',
    venue: '',
    weddingDate: '',
    packageId: '',
    stage: 'inquiry',
    value: 0,
    notes: '',
  })
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    clientId: '',
    packageId: '',
    weddingDate: new Date().toISOString().slice(0, 10),
    venue: '',
    title: '',
  })

  const [sortBy, setSortBy] = useState<SortBy>('recent')
  const [showArchiveView, setShowArchiveView] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  const clientIdFromState = (location.state as { openNewInquiryForClientId?: string } | null)?.openNewInquiryForClientId
  useEffect(() => {
    if (clientIdFromState) {
      setShowNewInquiry(true)
      setForm((f) => ({ ...f, clientId: clientIdFromState }))
      navigate(location.pathname, { replace: true, state: {} })
    }
  }, [clientIdFromState, location.pathname, navigate])

  // Pull latest website inquiries when user opens Bookings so new submissions show up
  useEffect(() => {
    actions.syncInquiriesFromWebsite()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run only on mount when opening Bookings
  }, [])

  const handleNewInquiry = (e: React.FormEvent) => {
    e.preventDefault()
    const client = clients.find((c) => c.id === form.clientId)
    if (!client) return
    const clientName = client.partnerName ? `${client.name} & ${client.partnerName}` : client.name
    const fromPrice = getPackageOrDuoPrice(form.packageId)
    if (fromPrice == null && form.packageId) return
    const title = form.title.trim() || (form.venue ? `${form.venue} Wedding` : 'Wedding inquiry')
    const projectId = actions.addProject({
      clientId: client.id,
      clientName,
      title,
      stage: firstStageId,
      value: fromPrice ?? 0,
      weddingDate: form.weddingDate,
      venue: form.venue.trim() || undefined,
      packageType: form.packageId || undefined,
      dueDate: form.weddingDate,
    })
    pushUndo({
      id: `project-${projectId}`,
      label: `Booking "${title}" added`,
      undo: async () => {
        await apiDeleteProject(projectId)
        await actions.refreshState()
      },
    })
    setShowNewInquiry(false)
    setForm({
      clientId: '',
      packageId: '',
      weddingDate: new Date().toISOString().slice(0, 10),
      venue: '',
      title: '',
    })
    setToast('Inquiry added.')
  }

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3000)
    return () => clearTimeout(t)
  }, [toast])

  const sortedByStage = useMemo(() => {
    const grouped: Record<string, Project[]> = {}
    for (const p of activeProjects) {
      const key = p.stage
      if (!grouped[key]) grouped[key] = []
      grouped[key].push(p)
    }
    const out: Record<string, Project[]> = {}
    const cmp = (a: Project, b: Project) => compareProjects(sortBy, a, b)
    for (const stage of stages) {
      const list = grouped[stage.id] ?? []
      list.sort(cmp)
      out[stage.id] = list
    }
    return out
  }, [activeProjects, sortBy, stages])

  const byStage = (stageId: string) => sortedByStage[stageId] ?? []

  const openEdit = (p: Project) => {
    const client = clients.find((c) => c.id === p.clientId)
    setEditingProject(p)
    setEditForm({
      clientName: p.clientName,
      clientEmail: client?.email ?? '',
      clientPhone: client?.phone ?? '',
      title: p.title,
      venue: p.venue ?? '',
      weddingDate: p.weddingDate,
      packageId: p.packageType ?? '',
      stage: p.stage,
      value: p.value,
      notes: p.notes ?? '',
    })
  }

  const getFirstName = (fullName: string) => {
    const trimmed = fullName.trim()
    const first = trimmed.split(/\s+/)[0]
    return first || trimmed
  }

  const handleReply = () => {
    const email = editForm.clientEmail?.trim()
    if (!email) return
    const firstName = getFirstName(editForm.clientName)
    const subject = encodeURIComponent('Re: Your inquiry — Aurora Sonnet')
    const bodyText = getInquiryReplyBody(firstName, editForm.notes ?? undefined)
    window.location.href = `mailto:${encodeURIComponent(email)}?subject=${subject}&body=${encodeURIComponent(bodyText)}`
  }

  const handleAddStage = async () => {
    const label = newStageLabel.trim()
    if (!label) return
    const created = await apiCreatePipelineStage(label)
    if (created) {
      setNewStageLabel('')
      await actions.refreshState()
    }
  }

  const startEditStage = (id: string, label: string) => {
    setEditingStageId(id)
    setEditingStageLabel(label)
  }

  const handleSaveStageEdit = async () => {
    if (!editingStageId) return
    const label = editingStageLabel.trim()
    if (!label) return
    const ok = await apiUpdatePipelineStage(editingStageId, { label })
    if (ok) {
      setEditingStageId(null)
      setEditingStageLabel('')
      await actions.refreshState()
    }
  }

  const handleDeleteStage = async (id: string) => {
    if (stages.length <= 1) return
    const ok = await apiDeletePipelineStage(id)
    if (ok) {
      if (editingStageId === id) setEditingStageId(null)
      await actions.refreshState()
    }
  }

  const handleSaveEdit = async () => {
    if (!editingProject) return
    setSaving(true)
    try {
      const client = clients.find((c) => c.id === editingProject.clientId)
      if (client) {
        const clientResult = await apiUpdateClient(editingProject.clientId, {
          name: editForm.clientName.trim(),
          email: editForm.clientEmail.trim(),
          phone: editForm.clientPhone.trim() || undefined,
        })
        if (!clientResult.ok) {
          window.alert(clientResult.error)
          return
        }
      }
      const ok = await apiUpdateProject(editingProject.id, {
        clientName: editForm.clientName.trim(),
        title: editForm.title.trim(),
        venue: editForm.venue.trim() || undefined,
        weddingDate: editForm.weddingDate,
        packageType: editForm.packageId || undefined,
        stage: editForm.stage,
        value: editForm.value,
        notes: editForm.notes.trim() || undefined,
      })
      if (!ok) {
        window.alert('Could not save. The stage may have been removed—try choosing another stage and save again.')
        return
      }
      await actions.refreshState()
      setEditingProject(null)
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteBooking = async () => {
    if (!editingProject) return
    if (!confirm(`Delete "${editingProject.title}"? This will remove the booking from the pipeline. This can't be undone.`)) return
    setSaving(true)
    try {
      const ok = await apiDeleteProject(editingProject.id)
      if (ok) {
        await actions.refreshState()
        setEditingProject(null)
      }
    } finally {
      setSaving(false)
    }
  }

  const handleArchive = async () => {
    if (!editingProject) return
    if (!confirm(`Archive "${editingProject.title}"? It will be hidden from the pipeline but you can restore it from View Archive.`)) return
    setSaving(true)
    try {
      actions.updateProject(editingProject.id, { archivedAt: new Date().toISOString() })
      await actions.refreshState()
      setEditingProject(null)
    } finally {
      setSaving(false)
    }
  }

  const handleRestore = async (p: Project) => {
    actions.updateProject(p.id, { archivedAt: null } as unknown as Partial<Project>)
    await actions.refreshState()
  }

  return (
    <div className={styles.page}>
      {toast && <p className={styles.toast} role="status">{toast}</p>}
      <header className={styles.header}>
        <h1>Bookings</h1>
        <p className={styles.subtitle}>{showArchiveView ? 'Archived bookings' : 'Pipeline of weddings and events.'}</p>
        {showArchiveView ? (
          <button type="button" className={styles.secondaryBtn} onClick={() => setShowArchiveView(false)}>
            Back to pipeline
          </button>
        ) : (
          <>
            <button
              type="button"
              className={styles.secondaryBtn}
              onClick={() => { setShowArchiveView(true); setShowManagePipelines(false); setShowNewInquiry(false) }}
            >
              View Archive
            </button>
            <button
              type="button"
              className={styles.secondaryBtn}
              onClick={() => setShowManagePipelines((v) => !v)}
            >
              {showManagePipelines ? 'Hide pipelines' : 'Manage pipelines'}
            </button>
            <button
              type="button"
              className={styles.addBtn}
              onClick={() => setShowNewInquiry(true)}
            >
              New inquiry
            </button>
          </>
        )}
      </header>

      {showManagePipelines && (
        <section className={styles.managePipelines}>
          <h2 className={styles.managePipelinesTitle}>Pipeline stages</h2>
          <p className={styles.managePipelinesHint}>Add stages like &quot;Deposit sent&quot;, edit names, or delete. Bookings in a deleted stage move to another stage.</p>
          <ul className={styles.stageList}>
            {stages.map((s) => (
              <li key={s.id} className={styles.stageRow}>
                {editingStageId === s.id ? (
                  <>
                    <input
                      type="text"
                      value={editingStageLabel}
                      onChange={(e) => setEditingStageLabel(e.target.value)}
                      className={styles.input}
                      autoFocus
                      onKeyDown={(e) => e.key === 'Enter' && handleSaveStageEdit()}
                    />
                    <button type="button" className={styles.smallBtn} onClick={handleSaveStageEdit}>
                      Save
                    </button>
                    <button type="button" className={styles.smallBtn} onClick={() => setEditingStageId(null)}>
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <span className={styles.stageLabel}>{s.label}</span>
                    <button type="button" className={styles.smallBtn} onClick={() => startEditStage(s.id, s.label)}>
                      Edit
                    </button>
                    <button
                      type="button"
                      className={styles.smallBtnDanger}
                      onClick={() => handleDeleteStage(s.id)}
                      disabled={stages.length <= 1}
                      title={stages.length <= 1 ? 'Keep at least one stage' : 'Delete stage'}
                    >
                      Delete
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
          <div className={styles.addStageRow}>
            <input
              type="text"
              value={newStageLabel}
              onChange={(e) => setNewStageLabel(e.target.value)}
              placeholder="e.g. Deposit sent"
              className={styles.input}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddStage())}
            />
            <button type="button" className={styles.addBtn} onClick={handleAddStage} disabled={!newStageLabel.trim()}>
              Add stage
            </button>
          </div>
        </section>
      )}

      {showNewInquiry && (
        <section className={styles.modal}>
          <form onSubmit={handleNewInquiry} className={styles.form}>
            <h2>New inquiry</h2>
            <div className={styles.formGrid}>
              <label>
                Client *
                <select
                  value={form.clientId}
                  onChange={(e) => setForm((s) => ({ ...s, clientId: e.target.value }))}
                  className={styles.select}
                  required
                >
                  <option value="">Select client</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.partnerName ? `${c.name} & ${c.partnerName}` : c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Package *
                <select
                  value={form.packageId}
                  onChange={(e) =>
                    setForm((s) => ({
                      ...s,
                      packageId: e.target.value,
                    }))
                  }
                  className={styles.select}
                  required
                >
                  <option value="">Select package</option>
                  {ALL_PACKAGES.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.shortName} — ${p.fromPrice.toLocaleString()}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Wedding date *
                <input
                  type="date"
                  value={form.weddingDate}
                  onChange={(e) => setForm((s) => ({ ...s, weddingDate: e.target.value }))}
                  className={styles.input}
                />
              </label>
              <label>
                Venue
                <input
                  type="text"
                  value={form.venue}
                  onChange={(e) => setForm((s) => ({ ...s, venue: e.target.value }))}
                  placeholder="e.g. Garden Estate Vineyard"
                  className={styles.input}
                />
              </label>
              <label className={styles.fullWidth}>
                Title
                <input
                  type="text"
                  value={form.title}
                  onChange={(e) => setForm((s) => ({ ...s, title: e.target.value }))}
                  placeholder="e.g. Walsh Wedding (optional)"
                  className={styles.input}
                />
              </label>
            </div>
            <div className={styles.formActions}>
              <button type="button" className={styles.cancelBtn} onClick={() => setShowNewInquiry(false)}>
                Cancel
              </button>
              <button type="submit" className={styles.submitBtn}>
                Add inquiry
              </button>
            </div>
          </form>
        </section>
      )}

      {showArchiveView ? (
        <section className={styles.archiveSection}>
          <p className={styles.archiveHint}>
            {archivedProjects.length === 0
              ? 'No archived bookings. Archive a booking from the pipeline when it’s in the final stage (e.g. Completed).'
              : `${archivedProjects.length} archived booking${archivedProjects.length === 1 ? '' : 's'}. Restore to bring back to the pipeline.`}
          </p>
          <ul className={styles.archiveList}>
            {archivedProjects.map((p) => (
              <li key={p.id} className={styles.archiveCard}>
                <div className={styles.archiveCardMain}>
                  <strong>{p.title}</strong>
                  {p.venue && <span className={styles.venue}>{p.venue}</span>}
                  <span className={styles.client}>
                    <Link to={`/clients/${p.clientId}`} className={styles.cardClientLink} onClick={(e) => e.stopPropagation()}>
                      {p.clientName}
                    </Link>
                  </span>
                  <span className={styles.weddingDate}>{p.title === 'General inquiry' ? 'Inquiry date: ' : 'Wedding: '}{p.weddingDate}</span>
                  <span className={styles.value}>${p.value.toLocaleString()}</span>
                </div>
                <button type="button" className={styles.smallBtn} onClick={() => handleRestore(p)}>
                  Restore
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <>
      <div className={styles.toolbar}>
        <label className={styles.sortLabel} htmlFor="bookings-sort">
          Sort by
        </label>
        <select
          id="bookings-sort"
          className={styles.sortSelect}
          aria-label="Sort bookings"
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as SortBy)}
        >
          <option value="recent">Most recent first</option>
          <option value="name-az">Name A–Z</option>
          <option value="name-za">Name Z–A</option>
          <option value="date-asc">Wedding date (earliest)</option>
          <option value="date-desc">Wedding date (latest)</option>
          <option value="value-asc">Value (low → high)</option>
          <option value="value-desc">Value (high → low)</option>
        </select>
      </div>

      <div className={styles.pipeline}>
        {stages.map((stage) => (
          <div key={stage.id} className={styles.column}>
            <div className={styles.columnHeader}>
              <h2>{stage.label}</h2>
              <span className={styles.count}>{byStage(stage.id).length}</span>
            </div>
            <ul className={styles.cards}>
              {byStage(stage.id).map((p) => (
                <li
                  key={p.id}
                  className={styles.card}
                  role="button"
                  tabIndex={0}
                  onClick={() => openEdit(p)}
                  onKeyDown={(e) => e.key === 'Enter' && openEdit(p)}
                >
                  <strong>{p.title}</strong>
                  {p.venue && <span className={styles.venue}>{p.venue}</span>}
                  <span className={styles.client}>
                    <Link to={`/clients/${p.clientId}`} className={styles.cardClientLink} onClick={(e) => e.stopPropagation()}>
                      {p.clientName}
                    </Link>
                  </span>
                  <span className={styles.weddingDate}>{p.title === 'General inquiry' ? 'Inquiry date: ' : 'Wedding: '}{p.weddingDate}</span>
                  <span className={styles.value}>${p.value.toLocaleString()}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
        </>
      )}

      {editingProject && (
        <div className={styles.editOverlay} onClick={() => setEditingProject(null)} role="dialog" aria-modal="true" aria-label="Edit booking">
          <div className={styles.editModal} onClick={(e) => e.stopPropagation()}>
            <h2 className={styles.editPanelTitle}>Edit booking</h2>
            {editForm.notes && (
              <div className={styles.inquiryMessage}>
                <strong>Inquiry message</strong>
                <p>{editForm.notes}</p>
                <button type="button" className={styles.replyBtn} onClick={handleReply} disabled={!editForm.clientEmail?.trim()}>
                  Reply via email
                </button>
              </div>
            )}
            <div className={styles.editGrid}>
                <label>
                  Client name
                  <input
                    type="text"
                    value={editForm.clientName}
                    onChange={(e) => setEditForm((f) => ({ ...f, clientName: e.target.value }))}
                    className={styles.input}
                  />
                </label>
                <label>
                  Email
                  <input
                    type="email"
                    value={editForm.clientEmail}
                    onChange={(e) => setEditForm((f) => ({ ...f, clientEmail: e.target.value }))}
                    className={styles.input}
                  />
                </label>
                <label>
                  Phone
                  <input
                    type="tel"
                    value={editForm.clientPhone}
                    onChange={(e) => setEditForm((f) => ({ ...f, clientPhone: e.target.value }))}
                    className={styles.input}
                  />
                </label>
                <label>
                  Event title
                  <input
                    type="text"
                    value={editForm.title}
                    onChange={(e) => setEditForm((f) => ({ ...f, title: e.target.value }))}
                    className={styles.input}
                  />
                </label>
                <label>
                  Venue
                  <input
                    type="text"
                    value={editForm.venue}
                    onChange={(e) => setEditForm((f) => ({ ...f, venue: e.target.value }))}
                    className={styles.input}
                  />
                </label>
                <label>
                  {editForm.title === 'General inquiry' ? 'Inquiry date' : 'Wedding date'}
                  <input
                    type="date"
                    value={editForm.weddingDate}
                    onChange={(e) => setEditForm((f) => ({ ...f, weddingDate: e.target.value }))}
                    className={styles.input}
                  />
                </label>
                <label>
                  Stage
                  <select
                    value={editForm.stage}
                    onChange={(e) => setEditForm((f) => ({ ...f, stage: e.target.value }))}
                    className={styles.select}
                  >
                    {stages.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Package
                  <select
                    value={editForm.packageId}
                    onChange={(e) => setEditForm((f) => ({ ...f, packageId: e.target.value }))}
                    className={styles.select}
                  >
                    <option value="">None</option>
                    {ALL_PACKAGES.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.shortName}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Value ($)
                  <input
                    type="number"
                    min={0}
                    value={editForm.value}
                    onChange={(e) => setEditForm((f) => ({ ...f, value: Number(e.target.value) || 0 }))}
                    className={styles.input}
                  />
                </label>
                <label>
                  Notes / inquiry message
                  <textarea
                    value={editForm.notes}
                    onChange={(e) => setEditForm((f) => ({ ...f, notes: e.target.value }))}
                    className={styles.textarea}
                    rows={3}
                    placeholder="Message from contact form or your notes"
                  />
                </label>
              </div>
            <nav className={styles.editLinks} aria-label="Related pages">
              <Link to={`/clients/${editingProject.clientId}`} className={styles.editLink} onClick={() => setEditingProject(null)}>
                View client
              </Link>
              <Link to="/proposals" className={styles.editLink} onClick={() => setEditingProject(null)}>
                Proposals
              </Link>
              <Link to="/invoices" className={styles.editLink} onClick={() => setEditingProject(null)}>
                Invoices
              </Link>
              <Link to="/contracts" className={styles.editLink} onClick={() => setEditingProject(null)}>
                Contracts
              </Link>
            </nav>
            {!editForm.notes && editForm.clientEmail && (
              <div className={styles.replyRow}>
                <button type="button" className={styles.replyBtn} onClick={handleReply}>
                  Reply via email
                </button>
              </div>
            )}
            <div className={styles.formActions}>
              <button type="button" className={styles.cancelBtn} onClick={() => setEditingProject(null)}>
                Close
              </button>
              {lastStageId && editingProject.stage === lastStageId && !editingProject.archivedAt && (
                <button
                  type="button"
                  className={styles.secondaryBtn}
                  onClick={handleArchive}
                  disabled={saving}
                  title="Archive this booking (hide from pipeline; restore from View Archive)"
                >
                  {saving ? '…' : 'Archive'}
                </button>
              )}
              <button
                type="button"
                className={styles.deleteBtn}
                onClick={handleDeleteBooking}
                disabled={saving}
                title="Remove this booking from the pipeline"
              >
                {saving ? '…' : 'Delete'}
              </button>
              <button type="button" className={styles.submitBtn} onClick={handleSaveEdit} disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
