import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useApp } from '../context/AppContext'
import { useUndo } from '../context/UndoContext'
import {
  apiDeleteContract,
  apiUpdateContract,
  apiDeleteInvoice,
  apiSignContractVendor,
  apiSendContractReminder,
  getContractFileUrl,
  apiUploadContractFile,
  fetchContractTemplateFileAsBase64,
} from '../api/db'
import { mergeContractTemplate } from '../utils/mergeContractTemplate'
import { htmlToPdfBase64 } from '../utils/htmlToPdf'
import type { ContractStatus } from '../data/mock'
import { getPackageLabel } from '../data/packages'
import { getInquiryApiBaseUrl } from '../utils/inquiryApiUrl'
import TemplatesSection from '../components/TemplatesSection'
import SignaturePad from '../components/SignaturePad'
import styles from './Contracts.module.css'

function randomToken() {
  return Math.random().toString(36).slice(2, 15) + Math.random().toString(36).slice(2, 15)
}

const statusLabels: Record<ContractStatus, string> = {
  draft: 'Draft',
  sent: 'Sent',
  signed: 'Signed',
}

export default function Contracts() {
  const { state, actions } = useApp()
  const { pushUndo } = useUndo()
  const { contracts, projects, contractTemplates } = state
  const [creatingFrom, setCreatingFrom] = useState<string | null>(null)
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('')
  const [signingContractId, setSigningContractId] = useState<string | null>(null)
  const [vendorSigningInProgress, setVendorSigningInProgress] = useState(false)
  const [vendorAgreed, setVendorAgreed] = useState(false)
  const [reminderSendingId, setReminderSendingId] = useState<string | null>(null)
  const [generatePdfError, setGeneratePdfError] = useState<string | null>(null)

  const [searchParams] = useSearchParams()
  const projectIdFromUrl = searchParams.get('projectId')

  const projectById = (id: string) => projects.find((p) => p.id === id)
  const hasContract = (projectId: string) => contracts.some((c) => c.projectId === projectId)
  const contractReminderBaseUrl =
    (state.config?.publicAppUrl || '').trim() || getInquiryApiBaseUrl() || (typeof window !== 'undefined' ? window.location.origin : '')

  const canDeleteContract = (contract: (typeof contracts)[0]) => {
    // Allow delete when there are no signatures yet (draft, or sent but unsigned)
    const hasAnySignature = Boolean((contract as { clientSignedAt?: string }).clientSignedAt || contract.signedAt)
    return !hasAnySignature
  }

  const handleSendContractReminder = async (contract: (typeof contracts)[0]) => {
    if (reminderSendingId) return
    setReminderSendingId(contract.id)
    const result = await apiSendContractReminder(contract.id, contractReminderBaseUrl || undefined)
    setReminderSendingId(null)
    if (result.ok) {
      await actions.refreshState()
      alert('Reminder email sent.')
    } else {
      alert(result.error)
    }
  }

  const handleDeleteContractRow = async (contract: (typeof contracts)[0]) => {
    if (!canDeleteContract(contract)) return
    if (
      !confirm(
        'Delete this contract? This removes the contract and its PDF. This cannot be undone (existing signed copies will be lost).'
      )
    ) {
      return
    }
    const ok = await apiDeleteContract(contract.id)
    if (!ok) {
      alert('Failed to delete contract. Check your connection and try again.')
      return
    }
    await actions.refreshState()
  }

  const handleCreateFromBooking = async (projectId: string) => {
    const p = projectById(projectId)
    if (!p) return
    setCreatingFrom(projectId)
    setGeneratePdfError(null)
    try {
      const templateId = selectedTemplateId || undefined
      const contractId = actions.addContract({
        projectId: p.id,
        clientName: p.clientName,
        title: p.title,
        status: 'draft',
        value: p.value,
        weddingDate: p.weddingDate,
        venue: p.venue,
        packageType: p.packageType ?? undefined,
        createdAt: new Date().toISOString().slice(0, 10),
        templateId,
      })
      pushUndo({
        id: `contract-${contractId}`,
        label: `Contract "${p.title}" created`,
        undo: async () => {
          await apiDeleteContract(contractId)
          await actions.refreshState()
        },
      })

      const template = templateId ? (contractTemplates ?? []).find((t) => t.id === templateId) : null
      const contentHtml = template && 'contentHtml' in template ? (template as { contentHtml?: string }).contentHtml : undefined
      const editorTemplate = contentHtml != null && contentHtml !== ''

      if (editorTemplate && contentHtml) {
        try {
          const client = state.clients.find((c) => c.id === p.clientId)
          const merged = mergeContractTemplate(contentHtml, {
            clientName: p.clientName,
            weddingDate: p.weddingDate,
            venue: p.venue,
            packageType: p.packageType,
            value: p.value,
            title: p.title,
            clientEmail: client?.email,
            clientPhone: client?.phone,
          })
          const base64 = await htmlToPdfBase64(merged)
          await apiUploadContractFile(contractId, base64)
        } catch (err) {
          setGeneratePdfError(err instanceof Error ? err.message : 'Failed to generate PDF')
        }
      } else if (template && (template as { fileName?: string }).fileName) {
        // File-based template: copy PDF into contract so template edits don't change this contract
        try {
          const base64 = await fetchContractTemplateFileAsBase64(template.id)
          await apiUploadContractFile(contractId, base64)
        } catch (err) {
          setGeneratePdfError(err instanceof Error ? err.message : 'Failed to copy template PDF for contract')
        }
      }

      await actions.refreshState()
    } finally {
      setCreatingFrom(null)
    }
  }

  const handleStatusChange = (contract: (typeof contracts)[0], status: ContractStatus) => {
    const previous = {
      status: contract.status,
      signedAt: contract.signedAt,
      signToken: (contract as { signToken?: string }).signToken,
    }
    if (status === 'sent') {
      const signToken = randomToken()
      actions.updateContract(contract.id, { status: 'sent', signToken })
      pushUndo({
        id: `contract-sent-${contract.id}`,
        label: `Contract "${contract.title}" marked sent`,
        undo: async () => {
          await apiUpdateContract(contract.id, previous)
          await actions.refreshState()
        },
      })
    } else {
      actions.updateContract(contract.id, { status })
      pushUndo({
        id: `contract-status-${contract.id}`,
        label: `Contract status changed to ${status}`,
        undo: async () => {
          await apiUpdateContract(contract.id, previous)
          await actions.refreshState()
        },
      })
    }
  }

  const handleVendorSign = async (contractId: string, dataUrl: string) => {
    const contract = contracts.find((c) => c.id === contractId)
    if (!contract || vendorSigningInProgress) return
    setVendorSigningInProgress(true)
    try {
      await apiSignContractVendor(contractId, dataUrl)
      const signedAt = new Date().toISOString().slice(0, 10)
      actions.updateContract(contractId, { status: 'signed', signedAt })
      let newInvoiceId: string | null = null
      if (!state.invoices.some((i) => i.projectId === contract.projectId && i.type === 'deposit')) {
        const deposit = Math.round(contract.value * 0.5)
        const project = state.projects.find((p) => p.id === contract.projectId)
        const client = project ? state.clients.find((c) => c.id === project.clientId) : undefined
        newInvoiceId = actions.addInvoice({
          projectId: contract.projectId,
          clientName: contract.clientName,
          clientEmail: client?.email,
          projectTitle: `${contract.title} — Deposit`,
          amount: deposit,
          status: 'draft',
          dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
          type: 'deposit',
        })
      }
      pushUndo({
        id: `contract-signed-${contractId}`,
        label: `Contract "${contract.title}" signed`,
        undo: async () => {
          await apiUpdateContract(contractId, { status: 'sent', signedAt: undefined })
          if (newInvoiceId) await apiDeleteInvoice(newInvoiceId)
          await actions.refreshState()
        },
      })
      setSigningContractId(null)
      await actions.refreshState()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to sign')
    } finally {
      setVendorSigningInProgress(false)
    }
  }

  const bookedOrProposalProjects = projects.filter(
    (p) =>
      !p.archivedAt &&
      (p.stage === 'booked' || p.stage === 'proposal') &&
      !hasContract(p.id)
  )

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1>Contracts</h1>
        <p className={styles.subtitle}>
          Wedding performance agreements. Create from a booking, send for eSign, track when signed.
        </p>
      </header>

      <TemplatesSection />

      <section className={styles.card}>
        <h2>Create from booking</h2>
        <p className={styles.cardDesc}>
          Bookings without a contract yet. Optionally choose a template; the contract will use that PDF.
        </p>
        {((contractTemplates?.length) ?? 0) > 0 && (
          <div className={styles.templateRow}>
            <label htmlFor="contract-template" className={styles.templateLabel}>
              Template (optional):
            </label>
            <select
              id="contract-template"
              className={styles.templateSelect}
              value={selectedTemplateId}
              onChange={(e) => {
                setSelectedTemplateId(e.target.value)
                setGeneratePdfError(null)
              }}
              aria-label="Contract template"
            >
              <option value="">None</option>
              {(contractTemplates ?? []).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
        )}
        {generatePdfError && (
          <p className={styles.error} role="alert">
            {generatePdfError}
          </p>
        )}
        {bookedOrProposalProjects.length === 0 ? (
          <p className={styles.empty}>All relevant bookings have a contract.</p>
        ) : (
          <ul className={styles.bookingList}>
            {bookedOrProposalProjects.map((p) => (
              <li key={p.id} className={styles.bookingItem}>
                <div>
                  <strong>{p.title}</strong>
                  <span className={styles.muted}>{p.clientName} · {p.weddingDate}</span>
                </div>
                <button
                  type="button"
                  className={styles.smallBtn}
                  onClick={() => handleCreateFromBooking(p.id)}
                  disabled={creatingFrom === p.id}
                >
                  Create contract
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={styles.card}>
        <h2>All contracts</h2>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Event</th>
                <th>Client</th>
                <th>Value</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {contracts.map((c) => (
                <tr
                  key={c.id}
                  className={projectIdFromUrl && c.projectId === projectIdFromUrl ? styles.rowHighlight : undefined}
                >
                  <td>
                    <strong>{c.title}</strong>
                    {c.venue && <span className={styles.muted}> · {c.venue}</span>}
                    {c.packageType && (
                      <span className={styles.muted}> · {getPackageLabel(c.packageType)}</span>
                    )}
                  </td>
                  <td>{c.clientName}</td>
                  <td>${c.value.toLocaleString()}</td>
                  <td>
                    <span className={styles.status} data-status={c.status}>
                      {statusLabels[c.status]}
                    </span>
                  </td>
                  <td>
                    <div className={styles.actions}>
                      {c.templateId && (
                        <a
                          href={getContractFileUrl(c.id)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={styles.viewPdfLink}
                        >
                          View PDF
                        </a>
                      )}
                      {c.status === 'draft' && (
                        <button
                          type="button"
                          className={styles.smallBtn}
                          onClick={() => handleStatusChange(c, 'sent')}
                        >
                          Mark sent
                        </button>
                      )}
                      {c.status === 'sent' && (
                        <>
                          {(c as { clientSignedAt?: string }).clientSignedAt ? (
                            <button
                              type="button"
                              className={styles.primaryBtn}
                              onClick={() => setSigningContractId(c.id)}
                            >
                              Sign
                            </button>
                          ) : (
                            <>
                              <button
                                type="button"
                                className={styles.smallBtn}
                                onClick={() => {
                                  const token = (c as { signToken?: string }).signToken
                                  const base = contractReminderBaseUrl
                                  const link = base ? `${base.replace(/\/$/, '')}/sign/${c.id}?token=${encodeURIComponent(token || '')}` : ''
                                  if (!link) {
                                    alert('Set Public URL or Inquiry API URL in Settings so the signing link works for clients.')
                                    return
                                  }
                                  if (navigator.clipboard?.writeText) {
                                    navigator.clipboard.writeText(link).then(
                                      () => alert('Signing link copied to clipboard. Send this to your client.'),
                                      () => alert(`Copy this link and send it to your client:\n\n${link}`)
                                    )
                                  } else {
                                    alert(`Copy this link and send it to your client:\n\n${link}`)
                                  }
                                }}
                              >
                                Copy link
                              </button>
                              <button
                                type="button"
                                className={styles.smallBtn}
                                onClick={() => handleSendContractReminder(c)}
                                disabled={reminderSendingId !== null}
                                title="Send a “please sign” email to the client (throttled to every 3 days)"
                              >
                                {reminderSendingId === c.id ? 'Sending…' : 'Send reminder'}
                              </button>
                            </>
                          )}
                        </>
                      )}
                      {c.status === 'signed' && c.signedAt && (
                        <span className={styles.signedDate}>Signed {c.signedAt}</span>
                      )}
                      {canDeleteContract(c) ? (
                        <button
                          type="button"
                          className={styles.smallBtn}
                          onClick={() => handleDeleteContractRow(c)}
                        >
                          Delete
                        </button>
                      ) : (
                        <span className={styles.muted}>Delete</span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {contracts.length === 0 && (
          <p className={styles.empty}>No contracts yet. Create one from a booking above.</p>
        )}
      </section>

      <p className={styles.tip}>
        <strong>Tip:</strong> Mark sent to get a signing link. Send the link to your client; they sign first. After they sign, click Sign to add your signature. A deposit invoice is created when both have signed.
      </p>

      {signingContractId && (
        <div
          className={styles.signingOverlay}
          onClick={() => { setSigningContractId(null); setVendorSigningInProgress(false); setVendorAgreed(false) }}
        >
          <div className={styles.signingModal} onClick={(e) => e.stopPropagation()}>
            <h3>Sign contract</h3>
            <label className={styles.agreeLabel}>
              <input type="checkbox" checked={vendorAgreed} onChange={(e) => setVendorAgreed(e.target.checked)} />
              <span>I have read and agree to the contract.</span>
            </label>
            <SignaturePad
              label="Your signature"
              onCapture={(dataUrl) => handleVendorSign(signingContractId, dataUrl)}
              onCancel={() => { setSigningContractId(null); setVendorSigningInProgress(false); setVendorAgreed(false) }}
              disabled={vendorSigningInProgress || !vendorAgreed}
            />
          </div>
        </div>
      )}
    </div>
  )
}
