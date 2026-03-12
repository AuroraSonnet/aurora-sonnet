import { useState, lazy, Suspense } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useApp } from '../context/AppContext'
import { useUndo } from '../context/UndoContext'
import {
  apiDeleteContract,
  apiUpdateContract,
  apiDeleteInvoice,
  apiCreateInvoice,
  apiUpdateInvoice,
  apiSignContractVendor,
  apiSendContractReminder,
  getContractFileUrl,
  apiUploadContractFile,
  fetchContractTemplateFileAsBase64,
  apiSyncContractForSign,
} from '../api/db'
import { mergeContractTemplate } from '../utils/mergeContractTemplate'
import { htmlToPdfBase64 } from '../utils/htmlToPdf'
import type { ContractStatus } from '../data/mock'
import { getPackageLabel } from '../data/packages'
import { getInquiryApiBaseUrl, DEFAULT_INQUIRY_API_URL } from '../utils/inquiryApiUrl'
const TemplatesSection = lazy(() => import('../components/TemplatesSection'))
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
  const contracts = state.contracts ?? []
  const projects = state.projects ?? []
  const contractTemplates = state.contractTemplates ?? []
  const clients = state.clients ?? []
  const invoices = state.invoices ?? []
  const [creatingFrom, setCreatingFrom] = useState<string | null>(null)
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('')
  const [signingContractId, setSigningContractId] = useState<string | null>(null)
  const [vendorSigningInProgress, setVendorSigningInProgress] = useState(false)
  const [vendorAgreed, setVendorAgreed] = useState(false)
  const [reminderSendingId, setReminderSendingId] = useState<string | null>(null)
  const [packageSendingId, setPackageSendingId] = useState<string | null>(null)
  const [generatePdfError, setGeneratePdfError] = useState<string | null>(null)

  const [searchParams] = useSearchParams()
  const projectIdFromUrl = searchParams.get('projectId')

  const projectById = (id: string) => projects.find((p) => p.id === id)
  const hasContract = (projectId: string) => contracts.some((c) => c.projectId === projectId)
  const rawClientBaseUrl =
    (state.config?.publicAppUrl || '').trim() || getInquiryApiBaseUrl() || (typeof window !== 'undefined' ? window.location.origin : '')
  const clientFacingBaseUrl =
    typeof window !== 'undefined' &&
    (rawClientBaseUrl.startsWith('http://localhost') || rawClientBaseUrl.startsWith('file:'))
      ? DEFAULT_INQUIRY_API_URL
      : rawClientBaseUrl || DEFAULT_INQUIRY_API_URL
  const contractReminderBaseUrl = clientFacingBaseUrl

  const getDepositInvoiceForProject = (projectId: string) =>
    invoices.find((i) => i.projectId === projectId && (i.type === 'deposit' || i.type === 'other' || !i.type)) ?? null

  const handleSendContractAndInvoice = async (contract: (typeof contracts)[0]) => {
    if (packageSendingId) return
    let project = projects.find((p) => p.id === contract.projectId)
    if (!project) {
      project = projects.find((p) => p.clientName === contract.clientName && p.title === contract.title)
      if (project) {
        await apiUpdateContract(contract.id, { projectId: project.id })
        actions.updateContract(contract.id, { projectId: project.id })
      }
    }
    if (!project) {
      alert('Project not found for this contract. Create a booking for this client first.')
      return
    }
    const client = clients.find((c) => c.id === project.clientId)
    const toEmail = (client?.email || '').trim()
    if (!toEmail) {
      alert('Add the client email first so the contract and invoice can be sent together.')
      return
    }

    setPackageSendingId(contract.id)
    try {
      let signToken = (contract as { signToken?: string }).signToken || randomToken()
      if (contract.status !== 'sent' || !(contract as { signToken?: string }).signToken) {
        const ok = await apiUpdateContract(contract.id, { status: 'sent', signToken })
        if (!ok) throw new Error('Could not prepare the contract for sending.')
        actions.updateContract(contract.id, { status: 'sent', signToken })
      }

      const retainer = Math.round(contract.value * 0.5)
      const packageLabel = getPackageLabel(contract.packageType) || project.title
      const lineItems = [{ description: `Retainer (50%) — ${packageLabel}`, quantity: 1, unitPrice: retainer }]
      let invoice = getDepositInvoiceForProject(project.id)
      if (!invoice) {
        const dueDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
        const invoiceId = `i-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
        const result = await apiCreateInvoice({
          id: invoiceId,
          projectId: project.id,
          clientName: contract.clientName,
          clientEmail: toEmail,
          projectTitle: `${project.title} — Retainer`,
          amount: retainer,
          status: 'sent',
          dueDate,
          type: 'deposit',
          lineItems,
        })
        if (!result.ok) throw new Error('Could not create the retainer invoice.')
        invoice = {
          id: invoiceId,
          projectId: project.id,
          clientName: contract.clientName,
          clientEmail: toEmail,
          projectTitle: `${project.title} — Retainer`,
          amount: retainer,
          status: 'sent',
          dueDate,
          type: 'deposit',
          lineItems,
        } as (typeof invoices)[0]
      } else if (!invoice.paidAt && (invoice.status !== 'sent' || invoice.amount !== retainer || invoice.clientEmail !== toEmail)) {
        const ok = await apiUpdateInvoice(invoice.id, {
          amount: retainer,
          clientEmail: toEmail,
          projectTitle: `${project.title} — Retainer`,
          lineItems,
          status: 'sent',
        })
        if (!ok) throw new Error('Could not prepare the retainer invoice.')
      }

      const template = contractTemplates.find((t) => t.id === (contract as { templateId?: string }).templateId) || contractTemplates[0]
      const d = btoa(JSON.stringify({
        n: contract.clientName, ti: contract.title, p: contract.projectId,
        v: contract.value, w: contract.weddingDate, ve: contract.venue,
        pk: contract.packageType, tm: template?.id,
        th: (template as { contentHtml?: string })?.contentHtml || null, tn: template?.name,
        ci: project.clientId, ce: client?.email,
      }))
      const signUrl = `${clientFacingBaseUrl.replace(/\/$/, '')}/sign/${contract.id}?token=${encodeURIComponent(signToken)}&d=${encodeURIComponent(d)}`

      void apiSyncContractForSign(clientFacingBaseUrl, contract.id).then((ok) => {
        if (ok) console.log('[ContractSync] Synced to Render')
        else console.warn('[ContractSync] Sync failed (link has fallback data)')
      })

      const invoiceUrl = `${clientFacingBaseUrl.replace(/\/$/, '')}/invoices/view/${invoice.id}`
      const firstName = (contract.clientName || '').split(/\s+/)[0] || 'there'
      const subject = `Your agreement and retainer — ${contract.title} | Aurora Sonnet`
      const body =
        `Hi ${firstName},\n\nThank you for moving forward with ${contract.title}. Please sign your agreement and pay your retainer to secure your date.\n\n` +
        `Sign your agreement: ${signUrl}\n\n` +
        `View and pay your retainer: ${invoiceUrl}\n\n` +
        `Best,\nAurora Sonnet`

      await actions.refreshState()
      window.location.href = `mailto:${encodeURIComponent(toEmail)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to prepare the contract and invoice.')
    } finally {
      setPackageSendingId(null)
    }
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
    const isSigned = Boolean((contract as { clientSignedAt?: string }).clientSignedAt || contract.signedAt)
    if (
      !confirm(
        isSigned
          ? 'Delete this signed contract? This permanently removes the contract and its PDF. This does not delete any related invoice. This cannot be undone.'
          : 'Delete this contract? This removes the contract and its PDF. This cannot be undone.'
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
          const client = clients.find((c) => c.id === p.clientId)
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

  const handleVendorSign = async (contractId: string, dataUrl: string) => {
    const contract = contracts.find((c) => c.id === contractId)
    if (!contract || vendorSigningInProgress) return
    setVendorSigningInProgress(true)
    try {
      await apiSignContractVendor(contractId, dataUrl)
      const signedAt = new Date().toISOString().slice(0, 10)
      actions.updateContract(contractId, { status: 'signed', signedAt })
      let newInvoiceId: string | null = null
      if (!invoices.some((i) => i.projectId === contract.projectId && i.type === 'deposit')) {
        const deposit = Math.round(contract.value * 0.5)
        const project = projects.find((p) => p.id === contract.projectId)
        const client = project ? clients.find((c) => c.id === project.clientId) : undefined
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

      <Suspense fallback={<p className={styles.subtitle}>Loading templates…</p>}>
        <TemplatesSection />
      </Suspense>

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
                          onClick={() => handleSendContractAndInvoice(c)}
                          disabled={packageSendingId !== null}
                        >
                          {packageSendingId === c.id ? 'Sending…' : 'Send contract + invoice'}
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
                                onClick={() => handleSendContractAndInvoice(c)}
                                disabled={packageSendingId !== null}
                              >
                                {packageSendingId === c.id ? 'Sending…' : 'Email package'}
                              </button>
                              <button
                                type="button"
                                className={styles.smallBtn}
                                onClick={() => {
                                  const token = (c as { signToken?: string }).signToken
                                  const base = contractReminderBaseUrl
                                  const proj = projectById(c.projectId)
                                  const cl = proj ? clients.find((x) => x.id === proj.clientId) : null
                                  const tmpl = contractTemplates.find((t) => t.id === (c as { templateId?: string }).templateId) || contractTemplates[0]
                                  const dParam = btoa(JSON.stringify({
                                    n: c.clientName, ti: c.title, p: c.projectId,
                                    v: c.value, w: c.weddingDate, ve: c.venue,
                                    pk: c.packageType, tm: tmpl?.id,
                                    th: (tmpl as { contentHtml?: string })?.contentHtml || null, tn: tmpl?.name,
                                    ci: proj?.clientId, ce: cl?.email,
                                  }))
                                  const link = base ? `${base.replace(/\/$/, '')}/sign/${c.id}?token=${encodeURIComponent(token || '')}&d=${encodeURIComponent(dParam)}` : ''
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
                      <button
                        type="button"
                        className={styles.smallBtn}
                        onClick={() => handleDeleteContractRow(c)}
                        title={c.status === 'signed' ? 'Permanently delete signed contract' : undefined}
                      >
                        Delete
                      </button>
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
        <strong>Tip:</strong> Send the contract and retainer together from here. Use <strong>Email package</strong> to resend both links together if needed. After the client signs, click <strong>Sign</strong> to add your signature.
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
