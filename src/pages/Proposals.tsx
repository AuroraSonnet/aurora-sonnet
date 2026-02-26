import { useState, useRef, useEffect, Fragment } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { useApp } from '../context/AppContext'
import { useUndo } from '../context/UndoContext'
import { apiDeleteProposal, apiCreateProposal } from '../api/db'
import { ALL_PACKAGES, getPackageOrDuoPrice } from '../data/packages'
import type { Proposal, Invoice } from '../data/mock'
import { EMAIL_SIGNATURE } from '../utils/emailSignature'
import styles from './Proposals.module.css'

const DEFAULT_EMAIL_BODY = `Dear [Client],

It is our pleasure to present your curated proposal for {{title}}.

We have attached an invoice with the full details and amount. Please review and reply to this email to confirm your booking.

We have crafted this offering with your celebration in mind and look forward to the honour of being part of your day.`

function getDefaultEmailBody(title: string, clientName?: string): string {
  const greeting = clientName ? `Dear ${clientName},` : 'Dear [Name],'
  return DEFAULT_EMAIL_BODY.replace('Dear [Client],', greeting).replace('{{title}}', title)
}

export default function Proposals() {
  const { state, actions } = useApp()
  const { pushUndo } = useUndo()
  const { proposals, projects, clients, invoices } = state
  const [showCreate, setShowCreate] = useState(false)
  const [selectedPackage, setSelectedPackage] = useState<Record<string, string>>({})
  const [customPackageByProject, setCustomPackageByProject] = useState<
    Record<string, { name: string; details: string; breakdown: string; total: number }>
  >({})
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState({
    title: '',
    value: 0,
    status: 'draft' as Proposal['status'],
    emailBody: '',
    customPackageName: '',
    customPackageDetails: '',
    customPriceBreakdown: '',
  })
  const [sendModal, setSendModal] = useState<{
    proposal: Proposal
    subject: string
    body: string
    toEmail: string
    selectedInvoiceIds: string[]
    markAsSentOnSend: boolean
  } | null>(null)
  const [showCreateInvoiceInModal, setShowCreateInvoiceInModal] = useState(false)
  const [createInvoiceForm, setCreateInvoiceForm] = useState({ projectTitle: '', amount: 0, dueDate: '' })
  const [duplicateSource, setDuplicateSource] = useState<Proposal | null>(null)
  const [duplicateProjectId, setDuplicateProjectId] = useState<string>('')
  const [toast, setToast] = useState<string | null>(null)
  const [savingProposalId, setSavingProposalId] = useState<string | null>(null)
  const [duplicateCreating, setDuplicateCreating] = useState(false)
  const [menuTriggerRect, setMenuTriggerRect] = useState<{
    top: number
    left: number
    height: number
    width: number
    openUp: boolean
  } | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuTriggerRef = useRef<HTMLButtonElement | null>(null)
  const dropdownPortalRef = useRef<HTMLDivElement | null>(null)

  const showToast = (message: string) => {
    setToast(message)
  }

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 2500)
    return () => clearTimeout(t)
  }, [toast])

  const projectsWithProposal = new Set(proposals.map((p) => p.projectId))
  const projectsWithoutProposal = projects.filter((p) => !projectsWithProposal.has(p.id))

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node
      const inTrigger = menuTriggerRef.current?.contains(target)
      const inDropdown = dropdownPortalRef.current?.contains(target)
      if (menuOpenId && !inTrigger && !inDropdown) {
        setMenuOpenId(null)
        setMenuTriggerRect(null)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [menuOpenId])

  const getClientForProposal = (proposal: Proposal) => {
    const project = projects.find((x) => x.id === proposal.projectId)
    if (!project) return null
    const client = clients.find((c) => c.id === project.clientId)
    return { project, client: client ?? null }
  }

  const getClientEmailForProposal = (proposal: Proposal): string => {
    const pair = getClientForProposal(proposal)
    return pair?.client?.email ?? ''
  }

  const openSendModal = (p: Proposal) => {
    const clientName = getClientForProposal(p)?.client?.name
    const defaultBody = getDefaultEmailBody(p.title, clientName)
    const savedBody = p.emailBody?.trim()
    const body = savedBody || defaultBody
    const toEmail = getClientEmailForProposal(p)
    const relevantInvoices = invoices.filter(
      (i) => i.projectId === p.projectId || (clientName && i.clientName === clientName)
    )
    const unpaid = relevantInvoices.filter((i) => i.status !== 'paid')
    const defaultInvoiceIds =
      unpaid.length > 0 ? [unpaid[0].id] : relevantInvoices.length > 0 ? [relevantInvoices[0].id] : []
    setSendModal({
      proposal: p,
      subject: `Your Curated Proposal — ${p.title} | Aurora Sonnet`,
      body,
      toEmail: toEmail || '',
      selectedInvoiceIds: defaultInvoiceIds,
      markAsSentOnSend: true,
    })
    setMenuOpenId(null)
    setMenuTriggerRect(null)
  }

  const closeSendModal = () => {
    setSendModal(null)
    setShowCreateInvoiceInModal(false)
  }

  const doSendProposalEmail = async () => {
    if (!sendModal) return
    const { proposal: p, subject, body, selectedInvoiceIds, toEmail, markAsSentOnSend } = sendModal
    const email = (toEmail || '').trim()
    const signatureAppended = body.includes('Lisa Dubocquet')
    let finalBody = signatureAppended ? body : `${body}\n\n${EMAIL_SIGNATURE}`
    if (selectedInvoiceIds.length > 0) {
      const selectedInvoices: Invoice[] = selectedInvoiceIds
        .map((id) => invoices.find((i) => i.id === id))
        .filter((i): i is Invoice => Boolean(i))
      if (selectedInvoices.length > 0) {
        const lines = selectedInvoices.map(
          (i) => `• ${i.projectTitle}: $${i.amount.toLocaleString()} (due ${i.dueDate})${i.status === 'paid' ? ' — paid' : ''}`
        )
        finalBody += `\n\n---\nInvoice(s) included:\n${lines.join('\n')}\n\nWe'll send a payment link separately, or you can pay when you're ready.`
      }
    }
    if (markAsSentOnSend && p.status === 'draft') {
      await actions.updateProposal(p.id, { status: 'sent', sentAt: new Date().toISOString().slice(0, 10) })
      showToast('Marked as sent')
    }
    closeSendModal()
    if (email) {
      const pair = getClientForProposal(p)
      if (pair?.client && email !== pair.client.email) {
        actions.updateClient(pair.client.id, { email })
      }
      window.location.href = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(finalBody)}`
      showToast('Opening your email app…')
    } else {
      showToast('Add a contact email above to send the proposal.')
    }
  }

  const startEdit = (p: Proposal) => {
    setEditingId(p.id)
    const defaultBody = getDefaultEmailBody(p.title, getClientForProposal(p)?.client?.name)
    setEditForm({
      title: p.title,
      value: p.value,
      status: p.status as Proposal['status'],
      emailBody: p.emailBody?.trim() || defaultBody,
      customPackageName: p.customPackageName ?? '',
      customPackageDetails: p.customPackageDetails ?? '',
      customPriceBreakdown: p.customPriceBreakdown ?? '',
    })
    setMenuOpenId(null)
    setMenuTriggerRect(null)
  }

  const cancelEdit = () => {
    setEditingId(null)
  }

  const saveEdit = async () => {
    if (!editingId) return
    const current = proposals.find((pr) => pr.id === editingId)
    const title = editForm.title.trim()
    setSavingProposalId(editingId)
    await actions.updateProposal(editingId, {
      title: title || (current?.title ?? ''),
      value: editForm.value,
      status: editForm.status,
      emailBody: editForm.emailBody.trim() || undefined,
      customPackageName: editForm.customPackageName.trim() || undefined,
      customPackageDetails: editForm.customPackageDetails.trim() || undefined,
      customPriceBreakdown: editForm.customPriceBreakdown.trim() || undefined,
    })
    setSavingProposalId(null)
    setEditingId(null)
    showToast('Changes saved')
  }

  const markAsSent = async (p: Proposal) => {
    setMenuOpenId(null)
    setMenuTriggerRect(null)
    setSavingProposalId(p.id)
    await actions.updateProposal(p.id, { status: 'sent', sentAt: new Date().toISOString().slice(0, 10) })
    setSavingProposalId(null)
    showToast('Marked as sent')
  }

  const markAsAccepted = async (p: Proposal) => {
    setMenuOpenId(null)
    setMenuTriggerRect(null)
    setSavingProposalId(p.id)
    await actions.updateProposal(p.id, { status: 'accepted' })
    const project = projects.find((x) => x.id === p.projectId)
    if (project) actions.updateProject(project.id, { stage: 'booked' })
    setSavingProposalId(null)
    showToast('Marked as accepted')
  }

  const openDuplicateModal = (p: Proposal) => {
    setDuplicateSource(p)
    setDuplicateProjectId('')
    setMenuOpenId(null)
    setMenuTriggerRect(null)
  }

  const closeDuplicateModal = () => {
    setDuplicateSource(null)
    setDuplicateProjectId('')
  }

  const doDuplicate = async () => {
    if (!duplicateSource || !duplicateProjectId) return
    const targetProject = projects.find((x) => x.id === duplicateProjectId)
    if (!targetProject) return
    setDuplicateCreating(true)
    const proposalId = await actions.addProposal({
      projectId: targetProject.id,
      clientName: targetProject.clientName,
      title: duplicateSource.title,
      status: 'draft',
      value: duplicateSource.value,
      emailBody: duplicateSource.emailBody,
    })
    pushUndo({
      id: `proposal-${proposalId}`,
      label: `Proposal "${duplicateSource.title}" duplicated`,
      undo: async () => {
        await apiDeleteProposal(proposalId)
        await actions.refreshState()
      },
    })
    setDuplicateCreating(false)
    closeDuplicateModal()
    showToast('Proposal duplicated')
  }

  const handleDelete = async (p: Proposal) => {
    if (!window.confirm(`Delete proposal "${p.title}"?`)) return
    setMenuOpenId(null)
    setMenuTriggerRect(null)
    const deleted = { ...p }
    const ok = await apiDeleteProposal(p.id)
    if (ok) {
      pushUndo({
        id: `proposal-delete-${p.id}`,
        label: `Proposal "${p.title}" deleted`,
        undo: async () => {
          await apiCreateProposal(deleted as Record<string, unknown>)
          await actions.refreshState()
        },
      })
      await actions.refreshState()
    }
  }

  const handleCreateFromBooking = async (projectId: string) => {
    const p = projects.find((x) => x.id === projectId)
    if (!p) return
    const pkgId = (selectedPackage[p.id] ?? p.packageType) || undefined
    const isCustom = !pkgId || pkgId === ''
    const custom = customPackageByProject[p.id]
    const value = isCustom && custom ? custom.total : (getPackageOrDuoPrice(pkgId) ?? p.value)
    const proposalId = await actions.addProposal({
      projectId: p.id,
      clientName: p.clientName,
      title: p.title,
      status: 'draft',
      value,
      ...(isCustom && custom && {
        customPackageName: custom.name.trim() || undefined,
        customPackageDetails: custom.details.trim() || undefined,
        customPriceBreakdown: custom.breakdown.trim() || undefined,
      }),
    })
    pushUndo({
      id: `proposal-${proposalId}`,
      label: `Proposal "${p.title}" created`,
      undo: async () => {
        await apiDeleteProposal(proposalId)
        await actions.refreshState()
      },
    })
    if (p.stage === 'inquiry') {
      const updates: { stage: 'proposal'; value?: number; packageType?: string } = { stage: 'proposal' }
      if (pkgId && (!p.packageType || p.value !== value)) {
        updates.value = value
        updates.packageType = pkgId
      }
      actions.updateProject(p.id, updates)
    }
    setSelectedPackage((s) => ({ ...s, [projectId]: '' }))
    setCustomPackageByProject((s) => {
      const next = { ...s }
      delete next[projectId]
      return next
    })
    setShowCreate(false)
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1>Proposals</h1>
        <p className={styles.subtitle}>
          Create and track proposals. Send by email with an invoice attached; clients confirm by reply.
        </p>
        <button
          type="button"
          className={styles.addBtn}
          onClick={() => setShowCreate(!showCreate)}
        >
          {showCreate ? 'Cancel' : 'New proposal'}
        </button>
      </header>

      {showCreate && (
        <section className={styles.card}>
          <h2>Create proposal from booking</h2>
          <p className={styles.cardDesc}>
            Pick a project to create a proposal. Send it by email with an invoice attached.
          </p>
          {projectsWithoutProposal.length === 0 ? (
            <p className={styles.emptyText}>Every project already has a proposal.</p>
          ) : (
            <ul className={styles.bookingList}>
              {projectsWithoutProposal.map((p) => {
                const pkgId = (selectedPackage[p.id] ?? p.packageType) ?? ''
                const isCustom = !pkgId
                const custom = customPackageByProject[p.id]
                const customState = custom ?? { name: '', details: '', breakdown: '', total: p.value }
                const value = isCustom ? (custom?.total ?? p.value) : (getPackageOrDuoPrice(pkgId) ?? p.value)
                return (
                  <li key={p.id} className={styles.bookingItem}>
                    <div>
                      <strong>{p.title}</strong>
                      <span className={styles.muted}>
                        {p.clientName} · {p.weddingDate}
                        {p.venue && ` · ${p.venue}`}
                      </span>
                    </div>
                    <div className={styles.proposalCreateRow}>
                      <select
                        value={pkgId}
                        onChange={(e) =>
                          setSelectedPackage((s) => ({
                            ...s,
                            [p.id]: e.target.value || '',
                          }))
                        }
                        className={styles.packageSelect}
                        aria-label="Select package"
                      >
                        <option value="">
                          Custom package
                        </option>
                        {ALL_PACKAGES.map((pk) => (
                          <option key={pk.id} value={pk.id}>
                            {pk.shortName} — ${pk.fromPrice.toLocaleString()}
                          </option>
                        ))}
                      </select>
                      <span className={styles.value}>${value.toLocaleString()}</span>
                      <button
                        type="button"
                        className={styles.primaryBtn}
                        onClick={() => handleCreateFromBooking(p.id)}
                      >
                        Create proposal
                      </button>
                    </div>
                    {isCustom && (
                      <div className={styles.customPackageForm}>
                        <label className={styles.customPackageLabel}>Package name</label>
                        <input
                          type="text"
                          className={styles.modalInput}
                          value={customState.name}
                          onChange={(e) =>
                            setCustomPackageByProject((s) => ({
                              ...s,
                              [p.id]: { ...(s[p.id] ?? customState), name: e.target.value },
                            }))
                          }
                          placeholder="e.g. Custom Celebration Package"
                        />
                        <label className={styles.customPackageLabel}>Details</label>
                        <textarea
                          className={styles.customPackageTextarea}
                          value={customState.details}
                          onChange={(e) =>
                            setCustomPackageByProject((s) => ({
                              ...s,
                              [p.id]: { ...(s[p.id] ?? customState), details: e.target.value },
                            }))
                          }
                          placeholder="Describe what’s included (bullets or paragraph)"
                          rows={3}
                        />
                        <label className={styles.customPackageLabel}>Price breakdown</label>
                        <textarea
                          className={styles.customPackageTextarea}
                          value={customState.breakdown}
                          onChange={(e) =>
                            setCustomPackageByProject((s) => ({
                              ...s,
                              [p.id]: { ...(s[p.id] ?? customState), breakdown: e.target.value },
                            }))
                          }
                          placeholder="e.g. Ceremony — $1,500
Reception — $2,000
Total — $3,500"
                          rows={3}
                        />
                        <label className={styles.customPackageLabel}>Total ($)</label>
                        <input
                          type="number"
                          className={styles.inlineInput}
                          value={customState.total || ''}
                          onChange={(e) =>
                            setCustomPackageByProject((s) => ({
                              ...s,
                              [p.id]: { ...(s[p.id] ?? customState), total: Number(e.target.value) || 0 },
                            }))
                          }
                          min={0}
                          step={50}
                          placeholder="0"
                        />
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      )}

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Project</th>
              <th>Client</th>
              <th>Value</th>
              <th>Status</th>
              <th>Actions</th>
              <th aria-hidden />
            </tr>
          </thead>
          <tbody>
            {proposals.map((p) => (
              <Fragment key={p.id}>
                <tr>
                  {editingId === p.id ? (
                    <>
                      <td>
                        <input
                          type="text"
                          className={styles.inlineInput}
                          value={editForm.title}
                          onChange={(e) => setEditForm((f) => ({ ...f, title: e.target.value }))}
                          placeholder="Project title"
                        />
                      </td>
                      <td>{p.clientName}</td>
                      <td>
                        <input
                          type="number"
                          className={styles.inlineInput}
                          value={editForm.value || ''}
                          onChange={(e) => setEditForm((f) => ({ ...f, value: Number(e.target.value) || 0 }))}
                          min={0}
                          step={50}
                        />
                      </td>
                      <td>
                        <select
                          className={styles.inlineSelect}
                          value={editForm.status}
                          onChange={(e) => setEditForm((f) => ({ ...f, status: e.target.value as Proposal['status'] }))}
                        >
                          <option value="draft">Draft</option>
                          <option value="sent">Sent</option>
                          <option value="accepted">Accepted</option>
                          <option value="declined">Declined</option>
                        </select>
                      </td>
                      <td colSpan={2}>
                        <div className={styles.inlineEditActions}>
                          <button
                            type="button"
                            className={styles.primaryBtn}
                            onClick={saveEdit}
                            disabled={savingProposalId === editingId}
                          >
                            {savingProposalId === editingId ? 'Saving…' : 'Save'}
                          </button>
                          <button type="button" className={styles.linkBtn} onClick={cancelEdit}>
                            Cancel
                          </button>
                        </div>
                      </td>
                    </>
                  ) : (
                  <>
                    <td>
                      <strong>{p.title}</strong>
                    </td>
                    <td>
                      {getClientForProposal(p)?.client ? (
                        <Link to={`/clients/${getClientForProposal(p)!.client!.id}`} className={styles.clientLink}>
                          {p.clientName}
                        </Link>
                      ) : (
                        p.clientName
                      )}
                    </td>
                    <td>${p.value.toLocaleString()}</td>
                    <td>
                      <div className={styles.statusCell}>
                        <span className={styles.status} data-status={p.status}>
                          {p.status}
                        </span>
                        {p.status === 'draft' && (
                          <button
                            type="button"
                            className={styles.quickStatusBtn}
                            onClick={() => markAsSent(p)}
                            disabled={savingProposalId === p.id}
                          >
                            {savingProposalId === p.id ? 'Saving…' : 'Mark as Sent'}
                          </button>
                        )}
                        {p.status === 'sent' && (
                          <button
                            type="button"
                            className={styles.quickStatusBtn}
                            onClick={() => markAsAccepted(p)}
                            disabled={savingProposalId === p.id}
                          >
                            {savingProposalId === p.id ? 'Saving…' : 'Mark as Accepted'}
                          </button>
                        )}
                      </div>
                    </td>
                    <td>
                      <div className={styles.actionsCell}>
                        <button
                          type="button"
                          className={styles.linkBtn}
                          onClick={() => startEdit(p)}
                          title="Edit proposal details"
                        >
                          Edit proposal
                        </button>
                        <button
                          type="button"
                          className={styles.primaryBtn}
                          onClick={() => openSendModal(p)}
                          title="Send proposal by email"
                        >
                          Send by email
                        </button>
                      </div>
                    </td>
                    <td>
                      <div className={styles.menuWrap} ref={menuOpenId === p.id ? menuRef : undefined}>
                        <button
                          ref={menuOpenId === p.id ? menuTriggerRef : undefined}
                          type="button"
                          className={styles.menuBtn}
                          aria-label="More actions"
                          aria-expanded={menuOpenId === p.id}
                          aria-haspopup="true"
                          onClick={(e) => {
                            e.stopPropagation()
                            if (menuOpenId === p.id) {
                              setMenuOpenId(null)
                              setMenuTriggerRect(null)
                            } else {
                              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                              setMenuTriggerRect({
                                top: rect.top,
                                left: rect.left,
                                width: rect.width,
                                height: rect.height,
                                openUp: rect.bottom + 220 > window.innerHeight,
                              })
                              setMenuOpenId(p.id)
                            }
                          }}
                        >
                          ⋮
                        </button>
                      </div>
                    </td>
                  </>
                  )}
                </tr>
                {editingId === p.id && (
                  <tr key={`${p.id}-custom`}>
                    <td colSpan={6} className={styles.editEmailCell}>
                      <div className={styles.customPackageEditSection}>
                        <span className={styles.editEmailLabel}>Custom package (optional)</span>
                        <label className={styles.customPackageLabel}>Package name</label>
                        <input
                          type="text"
                          className={styles.inlineInput}
                          value={editForm.customPackageName}
                          onChange={(e) => setEditForm((f) => ({ ...f, customPackageName: e.target.value }))}
                          placeholder="e.g. Custom Celebration Package"
                        />
                        <label className={styles.customPackageLabel}>Details</label>
                        <textarea
                          className={styles.editEmailTextarea}
                          value={editForm.customPackageDetails}
                          onChange={(e) => setEditForm((f) => ({ ...f, customPackageDetails: e.target.value }))}
                          placeholder="What’s included"
                          rows={2}
                        />
                        <label className={styles.customPackageLabel}>Price breakdown</label>
                        <textarea
                          className={styles.editEmailTextarea}
                          value={editForm.customPriceBreakdown}
                          onChange={(e) => setEditForm((f) => ({ ...f, customPriceBreakdown: e.target.value }))}
                          placeholder="e.g. Ceremony — $1,500"
                          rows={2}
                        />
                      </div>
                    </td>
                  </tr>
                )}
                {editingId === p.id && (
                  <tr key={`${p.id}-email`}>
                    <td colSpan={6} className={styles.editEmailCell}>
                      <label className={styles.editEmailLabel}>Email message (used when you send the proposal)</label>
                      <textarea
                        className={styles.editEmailTextarea}
                        value={editForm.emailBody}
                        onChange={(e) => setEditForm((f) => ({ ...f, emailBody: e.target.value }))}
                        placeholder={getDefaultEmailBody(p.title, getClientForProposal(p)?.client?.name)}
                        rows={6}
                      />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {menuOpenId && menuTriggerRect && (() => {
        const p = proposals.find((pr) => pr.id === menuOpenId)
        if (!p) return null
        const { left, top, height, width, openUp } = menuTriggerRect
        const menuWidth = 180
        const style: React.CSSProperties = {
          position: 'fixed',
          left: Math.max(8, left + width - menuWidth),
          top: openUp ? undefined : top + height + 2,
          bottom: openUp ? window.innerHeight - top + 2 : undefined,
          minWidth: 140,
          width: menuWidth,
          zIndex: 1000,
        }
        return createPortal(
          <div
            ref={dropdownPortalRef}
            className={`${styles.dropdown} ${styles.dropdownPortal} ${openUp ? styles.dropdownOpenUp : ''}`}
            style={style}
            role="menu"
          >
            <button type="button" role="menuitem" onClick={() => startEdit(p)}>Edit</button>
            <button type="button" role="menuitem" onClick={() => openSendModal(p)}>Send email</button>
            <button type="button" role="menuitem" onClick={() => openDuplicateModal(p)}>Duplicate</button>
            <button type="button" role="menuitem" className={styles.dropdownDanger} onClick={() => handleDelete(p)}>Delete</button>
          </div>,
          document.body
        )
      })()}

      {proposals.length === 0 && !showCreate && (
        <div className={styles.empty}>
          <p>No proposals yet. Create one from a booking to get started.</p>
          <button
            type="button"
            className={styles.addBtn}
            onClick={() => setShowCreate(true)}
          >
            New proposal
          </button>
        </div>
      )}

      {sendModal && (() => {
        const pair = getClientForProposal(sendModal.proposal)
        return (
        <div className={styles.modalOverlay} onClick={closeSendModal} role="dialog" aria-modal="true" aria-labelledby="send-proposal-title">
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h2 id="send-proposal-title" className={styles.modalTitle}>Send proposal by email</h2>
            <div className={styles.modalField}>
              <label>Contact</label>
              <select
                className={styles.modalInput}
                value={clients.find((c) => (c.email || '').trim() === sendModal.toEmail.trim())?.id ?? ''}
                onChange={(e) => {
                  const clientId = e.target.value
                  const client = clients.find((c) => c.id === clientId)
                  setSendModal((s) => s && { ...s, toEmail: client?.email?.trim() ?? '' })
                }}
                aria-label="Select contact"
              >
                <option value="">— Select a contact —</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {(c.email || '').trim() ? ` — ${c.email.trim()}` : ' (no email)'}
                  </option>
                ))}
              </select>
            </div>
            <div className={styles.modalField}>
              <label>To (client email)</label>
              <input
                type="email"
                className={styles.modalInput}
                value={sendModal.toEmail}
                onChange={(e) => setSendModal((s) => s && { ...s, toEmail: e.target.value })}
                placeholder="Enter or paste email address"
              />
              {pair?.client && (
                <span className={styles.modalHint}>
                  <Link to={`/clients/${pair.client.id}`} className={styles.modalLink} onClick={closeSendModal}>
                    Edit client contact info →
                  </Link>
                </span>
              )}
              {pair?.client && !sendModal.toEmail.trim() && (
                <p className={styles.modalHint}>
                  No email on file. Add it in{' '}
                  <Link to={`/clients/${pair.client.id}`} className={styles.modalLink} onClick={closeSendModal}>
                    Edit client →
                  </Link>{' '}
                  so it&apos;s here next time.
                </p>
              )}
            </div>
            <div className={styles.modalField}>
              <label>Subject</label>
              <input
                type="text"
                className={styles.modalInput}
                value={sendModal.subject}
                onChange={(e) => setSendModal((s) => s && { ...s, subject: e.target.value })}
              />
            </div>
            <div className={styles.modalField}>
              <label>Message</label>
              <textarea
                className={styles.modalTextarea}
                value={sendModal.body}
                onChange={(e) => setSendModal((s) => s && { ...s, body: e.target.value })}
                rows={8}
              />
              <div className={styles.emailSignatureBlock} aria-label="Signature">
                {EMAIL_SIGNATURE.split('\n').map((line, i) => (
                  <span key={i}>{line || '\u00A0'}</span>
                ))}
              </div>
            </div>
            <div className={styles.modalField}>
              <label>Include invoice(s) in email</label>
              <span className={styles.modalHint}>Select one or more saved invoices to add their details to the email.</span>
              {(() => {
                const proposalClientName = getClientForProposal(sendModal.proposal)?.client?.name
                const relevantInvoices = invoices.filter(
                  (i) =>
                    i.projectId === sendModal.proposal.projectId ||
                    (proposalClientName && i.clientName === proposalClientName)
                )
                return (
                  <>
                    {relevantInvoices.length === 0 && !showCreateInvoiceInModal ? (
                      <p className={styles.modalHint}>No invoices for this project or client yet. Create one below or add one on the Invoices page.</p>
                    ) : (
                      <div className={styles.invoiceCheckboxList}>
                        {relevantInvoices.map((inv) => (
                          <label key={inv.id} className={styles.modalCheckLabel}>
                            <input
                              type="checkbox"
                              checked={sendModal.selectedInvoiceIds.includes(inv.id)}
                              onChange={(e) => {
                                const checked = e.target.checked
                                setSendModal((s) =>
                                  s
                                    ? {
                                        ...s,
                                        selectedInvoiceIds: checked
                                          ? [...s.selectedInvoiceIds, inv.id]
                                          : s.selectedInvoiceIds.filter((id) => id !== inv.id),
                                      }
                                    : null
                                )
                              }}
                            />
                            {' '}
                            {inv.projectTitle}: ${inv.amount.toLocaleString()} (due {inv.dueDate})
                            {inv.status === 'paid' ? ' — paid' : ''}
                          </label>
                        ))}
                      </div>
                    )}
                    {!showCreateInvoiceInModal ? (
                      <button
                        type="button"
                        className={styles.createInvoiceBtn}
                        onClick={() => {
                          const defaultDue = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
                          setCreateInvoiceForm({
                            projectTitle: sendModal.proposal.title,
                            amount: 0,
                            dueDate: defaultDue,
                          })
                          setShowCreateInvoiceInModal(true)
                        }}
                      >
                        Create new invoice
                      </button>
                    ) : (
                      <div className={styles.createInvoiceForm}>
                        <label className={styles.createInvoiceLabel}>Title</label>
                        <input
                          type="text"
                          className={styles.modalInput}
                          value={createInvoiceForm.projectTitle}
                          onChange={(e) => setCreateInvoiceForm((f) => ({ ...f, projectTitle: e.target.value }))}
                          placeholder="e.g. Deposit"
                        />
                        <label className={styles.createInvoiceLabel}>Amount ($)</label>
                        <input
                          type="number"
                          min={0}
                          step={1}
                          className={styles.modalInput}
                          value={createInvoiceForm.amount || ''}
                          onChange={(e) => setCreateInvoiceForm((f) => ({ ...f, amount: Number(e.target.value) || 0 }))}
                        />
                        <label className={styles.createInvoiceLabel}>Due date</label>
                        <input
                          type="date"
                          className={styles.modalInput}
                          value={createInvoiceForm.dueDate}
                          onChange={(e) => setCreateInvoiceForm((f) => ({ ...f, dueDate: e.target.value }))}
                        />
                        <div className={styles.createInvoiceActions}>
                          <button
                            type="button"
                            className={styles.primaryBtn}
                            onClick={() => {
                              if (!sendModal) return
                              const dueDate = (createInvoiceForm.dueDate || '').trim()
                              if (!dueDate) {
                                showToast('Please set a due date.')
                                return
                              }
                              const pair = getClientForProposal(sendModal.proposal)
                              const clientName = pair?.client?.name ?? sendModal.proposal.title
                              const clientEmail = pair?.client?.email
                              const amount = Number(createInvoiceForm.amount)
                              const newId = actions.addInvoice({
                                projectId: sendModal.proposal.projectId,
                                clientName,
                                clientEmail,
                                projectTitle: createInvoiceForm.projectTitle.trim() || sendModal.proposal.title,
                                amount: Number.isFinite(amount) ? amount : 0,
                                status: 'draft',
                                dueDate,
                                type: 'other',
                              })
                              setSendModal((s) =>
                                s ? { ...s, selectedInvoiceIds: [...s.selectedInvoiceIds, newId] } : null
                              )
                              setShowCreateInvoiceInModal(false)
                              showToast('Invoice created and selected for email.')
                            }}
                          >
                            Save invoice
                          </button>
                          <button
                            type="button"
                            className={styles.linkBtn}
                            onClick={() => setShowCreateInvoiceInModal(false)}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                )
              })()}
            </div>
            <div className={styles.modalField}>
              <label className={styles.modalCheckLabel}>
                <input
                  type="checkbox"
                  checked={sendModal.markAsSentOnSend}
                  onChange={(e) => setSendModal((s) => s && { ...s, markAsSentOnSend: e.target.checked })}
                />
                {' '}
                Mark proposal as Sent when I click Send email
              </label>
            </div>
            <div className={styles.modalActions}>
              <button type="button" className={styles.primaryBtn} onClick={() => doSendProposalEmail()}>
                Send email
              </button>
              <button type="button" className={styles.linkBtn} onClick={closeSendModal}>
                Cancel
              </button>
            </div>
          </div>
        </div>
        )
      })()}

      {duplicateSource && (
        <div className={styles.modalOverlay} onClick={closeDuplicateModal} role="dialog" aria-modal="true" aria-labelledby="duplicate-proposal-title">
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h2 id="duplicate-proposal-title" className={styles.modalTitle}>Duplicate proposal</h2>
            <p className={styles.modalDesc}>
              Create a copy of &quot;{duplicateSource.title}&quot; for another booking. Select which project to attach it to.
            </p>
            <div className={styles.modalField}>
              <label>Booking</label>
              <select
                className={styles.modalInput}
                value={duplicateProjectId}
                onChange={(e) => setDuplicateProjectId(e.target.value)}
                aria-label="Select booking"
              >
                <option value="">Select a booking…</option>
                {projectsWithoutProposal.map((proj) => (
                  <option key={proj.id} value={proj.id}>
                    {proj.title} — {proj.clientName}
                  </option>
                ))}
              </select>
            </div>
            {projectsWithoutProposal.length === 0 && (
              <p className={styles.modalHint}>Every other booking already has a proposal.</p>
            )}
            <div className={styles.modalActions}>
              <button
                type="button"
                className={styles.primaryBtn}
                onClick={doDuplicate}
                disabled={!duplicateProjectId || projectsWithoutProposal.length === 0 || duplicateCreating}
              >
                {duplicateCreating ? 'Creating…' : 'Create copy'}
              </button>
              <button type="button" className={styles.linkBtn} onClick={closeDuplicateModal}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className={styles.toast} role="status" aria-live="polite">
          {toast}
        </div>
      )}
    </div>
  )
}
