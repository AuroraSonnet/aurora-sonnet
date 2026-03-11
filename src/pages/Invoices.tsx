import { useState, useEffect } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useApp } from '../context/AppContext'
import { useUndo } from '../context/UndoContext'
import { apiCreateInvoice, apiDeleteInvoice, apiUpdateInvoice, apiSendInvoiceReminder, getInvoiceTemplateFileUrl } from '../api/db'
import { createCheckoutSession, getPaymentStatus, confirmPayment } from '../api/stripe'
import { appendSignature } from '../utils/emailSignature'
import { getInquiryApiBaseUrl } from '../utils/inquiryApiUrl'
import type { InvoiceLineItem } from '../data/mock'
import { DEFAULT_INVOICE_EXPERIENCES } from '../data/packages'
import styles from './Invoices.module.css'

const emptyLineItem = (): InvoiceLineItem => ({ description: '', quantity: 1, unitPrice: 0 })
const lineItemsTotal = (items: InvoiceLineItem[]) => items.reduce((s, li) => s + (Number(li.quantity) || 0) * (Number(li.unitPrice) || 0), 0)

/** Initial line items for "from scratch": all 6 experiences (Solo + Duo) with prices; user can edit or add more. */
const defaultScratchLineItems = (): InvoiceLineItem[] =>
  DEFAULT_INVOICE_EXPERIENCES.map((p) => ({ description: p.description, quantity: p.quantity, unitPrice: p.unitPrice }))

export default function Invoices() {
  const { state, actions } = useApp()
  const { pushUndo } = useUndo()
  const { invoices, projects, clients, invoiceTemplates, contracts } = state
  const [searchParams, setSearchParams] = useSearchParams()
  const [createFromProjectId, setCreateFromProjectId] = useState<string | null>(null)
  const [createFromScratch, setCreateFromScratch] = useState(false)
  const [scratchForm, setScratchForm] = useState({ clientName: '', clientEmail: '', projectTitle: '', amount: 0, dueDate: new Date().toISOString().slice(0, 10), templateId: '', lineItems: defaultScratchLineItems() })
  const [scratchError, setScratchError] = useState<string | null>(null)
  const [savingScratch, setSavingScratch] = useState(false)
  const [invoiceType, setInvoiceType] = useState<'deposit' | 'balance' | 'full'>('deposit')
  const RETAINER_PERCENT = 0.5 // 50%; change to 0.4 for 40% retainer
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('')
  const [payingId, setPayingId] = useState<string | null>(null)
  const [paymentError, setPaymentError] = useState<string | null>(null)
  const [editingInvoice, setEditingInvoice] = useState<(typeof invoices)[0] | null>(null)
  const [editForm, setEditForm] = useState<{ clientName: string; clientEmail: string; projectTitle: string; amount: number; dueDate: string; status: 'draft' | 'sent' | 'paid' | 'overdue'; templateId: string; lineItems: InvoiceLineItem[] }>({ clientName: '', clientEmail: '', projectTitle: '', amount: 0, dueDate: '', status: 'draft', templateId: '', lineItems: [] })
  const [editError, setEditError] = useState<string | null>(null)
  const [savingEdit, setSavingEdit] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [paymentConfirmError, setPaymentConfirmError] = useState<string | null>(null)
  const [sendModal, setSendModal] = useState<{
    invoice: (typeof invoices)[0]
    toEmail: string
    subject: string
    body: string
    markAsSentOnSend: boolean
    isReminder?: boolean
  } | null>(null)
  const [sendError, setSendError] = useState<string | null>(null)
  const [sendLinkCopied, setSendLinkCopied] = useState(false)
  const [sendingReminder, setSendingReminder] = useState(false)
  const [reminderSentAt, setReminderSentAt] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  // Sync payment status from server (webhook or confirm-payment)
  useEffect(() => {
    getPaymentStatus().then((payments) => {
      Object.entries(payments).forEach(([invoiceId, paidAt]) => {
        actions.updateInvoice(invoiceId, { status: 'paid', paidAt })
      })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const paymentSuccess = searchParams.get('payment_success') === '1'
  const paymentCancelled = searchParams.get('payment_cancelled') === '1'
  const sessionId = searchParams.get('session_id')

  // When returning from Stripe Checkout with session_id, confirm payment (server updates DB) then refresh state
  useEffect(() => {
    if (!paymentSuccess || !sessionId) return
    setPaymentConfirmError(null)
    confirmPayment(sessionId)
      .then(() => actions.refreshState())
      .catch((err) => {
        setPaymentConfirmError(err instanceof Error ? err.message : 'Could not confirm payment. Invoice may still update when Stripe notifies.')
      })
      .finally(() => setSearchParams({ payment_success: '1' }, { replace: true }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paymentSuccess, sessionId])

  // Clear payment_success / payment_cancelled from URL after showing message
  useEffect(() => {
    if (paymentSuccess || paymentCancelled) {
      const t = setTimeout(() => setSearchParams({}, { replace: true }), 5000)
      return () => clearTimeout(t)
    }
  }, [paymentSuccess, paymentCancelled, setSearchParams])

  const todayStr = new Date().toISOString().slice(0, 10)

  // When arriving with ?projectId= (e.g. from Proposals "Edit invoice"), open that project's invoice for editing
  const projectIdFromUrl = searchParams.get('projectId')
  useEffect(() => {
    if (!projectIdFromUrl) return
    const inv =
      invoices.find((i) => i.projectId === projectIdFromUrl && (i.type === 'deposit' || i.type === 'other')) ??
      invoices.find((i) => i.projectId === projectIdFromUrl)
    if (inv) setEditingInvoice(inv)
    setSearchParams((p) => {
      const next = new URLSearchParams(p)
      next.delete('projectId')
      return next
    }, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectIdFromUrl])

  // Open reminder modal when arriving from Dashboard with ?remind=invoiceId
  const remindId = searchParams.get('remind')
  useEffect(() => {
    if (!remindId) return
    const inv = invoices.find((i) => i.id === remindId)
    const isOverdue = inv && (inv.status === 'sent' || inv.status === 'overdue') && inv.dueDate < todayStr
    if (isOverdue && !sendModal) {
      openReminderModal(inv!)
      setSearchParams((p) => {
        const next = new URLSearchParams(p)
        next.delete('remind')
        return next
      }, { replace: true })
    } else if (remindId && !isOverdue) {
      // Clear stuck param when invoice not found or not overdue
      setSearchParams((p) => {
        const next = new URLSearchParams(p)
        next.delete('remind')
        return next
      }, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remindId, invoices, todayStr])
  const effectiveStatus = (i: (typeof invoices)[0]) => (i.status === 'sent' && i.dueDate < todayStr ? 'overdue' : i.status)
  const totalOutstanding = invoices
    .filter((i) => i.status === 'sent')
    .reduce((s, i) => s + i.amount, 0)

  const bookedOrCompleted = projects.filter((p) => p.stage === 'booked' || p.stage === 'completed')

  const clientEmailForProject = (clientId: string) => clients.find((c) => c.id === clientId)?.email
  const linkedContractForInvoice = (invoice: (typeof invoices)[0]) =>
    invoice.projectId ? (contracts ?? []).find((c) => c.projectId === invoice.projectId) ?? null : null
  const mustSendWithContract = (invoice: (typeof invoices)[0]) =>
    invoice.type === 'deposit' && !!linkedContractForInvoice(invoice) && linkedContractForInvoice(invoice)!.status !== 'signed'

  const pushInvoiceUndo = (invoiceId: string, title: string) => {
    pushUndo({
      id: `invoice-${invoiceId}`,
      label: `Invoice "${title}" created`,
      undo: async () => {
        await apiDeleteInvoice(invoiceId)
        await actions.refreshState()
      },
    })
  }

  useEffect(() => {
    if (editingInvoice) {
      setEditForm({
        clientName: editingInvoice.clientName,
        clientEmail: editingInvoice.clientEmail ?? '',
        projectTitle: editingInvoice.projectTitle,
        amount: editingInvoice.amount,
        dueDate: editingInvoice.dueDate,
        status: editingInvoice.status,
        templateId: editingInvoice.templateId ?? '',
        lineItems: editingInvoice.lineItems?.length ? [...editingInvoice.lineItems] : [],
      })
      setEditError(null)
    }
  }, [editingInvoice])

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingInvoice) return
    setEditError(null)
    const clientName = editForm.clientName.trim()
    const projectTitle = editForm.projectTitle.trim()
    if (!clientName || !projectTitle) {
      setEditError('Client name and Project / title are required')
      return
    }
    const useLineItems = editForm.lineItems.length > 0
    let amount: number
    if (useLineItems) {
      const invalid = editForm.lineItems.some((li) => !String(li.description).trim() || (Number(li.quantity) || 0) < 0 || (Number(li.unitPrice) || 0) < 0)
      if (invalid) {
        setEditError('Line items need a description and non-negative quantity and unit price.')
        return
      }
      amount = Math.round(lineItemsTotal(editForm.lineItems))
      if (amount <= 0) {
        setEditError('Line items total must be greater than 0.')
        return
      }
    } else {
      amount = Number(editForm.amount)
      if (Number.isNaN(amount) || amount < 0) {
        setEditError('Amount must be a positive number')
        return
      }
    }
    setSavingEdit(true)
    try {
      const templateIdTrimmed = editForm.templateId.trim()
      const templateExists = templateIdTrimmed && (invoiceTemplates ?? []).some((t) => t.id === templateIdTrimmed)
      const updates: Record<string, unknown> = {
        clientName,
        clientEmail: editForm.clientEmail.trim() || undefined,
        projectTitle,
        amount,
        dueDate: editForm.dueDate,
        status: editForm.status,
        templateId: templateExists ? templateIdTrimmed : undefined,
        lineItems: useLineItems ? editForm.lineItems : [],
      }
      const ok = await apiUpdateInvoice(editingInvoice.id, updates)
      if (!ok) {
        setEditError('Could not save. Check connection and try again.')
        return
      }
      actions.updateInvoice(editingInvoice.id, updates)
      setEditingInvoice(null)
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Could not save')
    } finally {
      setSavingEdit(false)
    }
  }

  const handleDeleteConfirm = async () => {
    if (!deletingId) return
    setDeleteError(null)
    setDeleting(true)
    try {
      const ok = await apiDeleteInvoice(deletingId)
      if (!ok) {
        setDeleteError('Could not delete. Check connection and try again.')
        return
      }
      await actions.refreshState()
      setDeletingId(null)
    } catch {
      setDeleteError('Could not delete. Try again.')
    } finally {
      setDeleting(false)
    }
  }

  const handleCreateFromScratch = async (e: React.FormEvent) => {
    e.preventDefault()
    setScratchError(null)
    const clientName = scratchForm.clientName.trim()
    const projectTitle = scratchForm.projectTitle.trim()
    if (!clientName || !projectTitle) {
      setScratchError('Client name and Project / title are required')
      return
    }
    const useLineItems = scratchForm.lineItems.length > 0
    let amount: number
    if (useLineItems) {
      const invalid = scratchForm.lineItems.some((li) => !String(li.description).trim() || (Number(li.quantity) || 0) < 0 || (Number(li.unitPrice) || 0) < 0)
      if (invalid) {
        setScratchError('Line items need a description and non-negative quantity and unit price.')
        return
      }
      amount = Math.round(lineItemsTotal(scratchForm.lineItems))
      if (amount <= 0) {
        setScratchError('Line items total must be greater than 0.')
        return
      }
    } else {
      amount = Number(scratchForm.amount)
      if (Number.isNaN(amount) || amount < 0) {
        setScratchError('Amount must be 0 or more')
        return
      }
    }
    setSavingScratch(true)
    try {
      const templateId = scratchForm.templateId.trim() || undefined
      const invoiceId = `i-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
      const invoice = {
        id: invoiceId,
        clientName,
        clientEmail: scratchForm.clientEmail.trim() || undefined,
        projectTitle,
        amount,
        status: 'draft' as const,
        dueDate: scratchForm.dueDate,
        templateId,
        ...(useLineItems ? { lineItems: scratchForm.lineItems } : {}),
      }
      const result = await apiCreateInvoice(invoice)
      if (!result.ok) {
        setScratchError('Could not create invoice. Check connection and try again.')
        return
      }
      await actions.refreshState()
      pushInvoiceUndo(invoiceId, projectTitle)
      setCreateFromScratch(false)
      setScratchForm({ clientName: '', clientEmail: '', projectTitle: '', amount: 0, dueDate: new Date().toISOString().slice(0, 10), templateId: '', lineItems: defaultScratchLineItems() })
    } catch (err) {
      setScratchError(err instanceof Error ? err.message : 'Could not create invoice')
    } finally {
      setSavingScratch(false)
    }
  }

  const handleCreateFromBooking = (projectId: string) => {
    const p = projects.find((x) => x.id === projectId)
    if (!p) return
    const retainerAmount = Math.round(p.value * RETAINER_PERCENT)
    const balance = p.value - retainerAmount
    const clientEmail = clientEmailForProject(p.clientId)
    const templateId = selectedTemplateId || undefined
    if (invoiceType === 'deposit') {
      const invoiceId = actions.addInvoice({
        projectId: p.id,
        clientName: p.clientName,
        clientEmail,
        projectTitle: `${p.title} — Retainer`,
        amount: retainerAmount,
        status: 'draft',
        dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
        type: 'deposit',
        templateId,
      })
      pushInvoiceUndo(invoiceId, `${p.title} — Retainer`)
    } else if (invoiceType === 'balance') {
      const hasDeposit = invoices.some((i) => i.projectId === p.id && i.type === 'deposit')
      const invoiceId = actions.addInvoice({
        projectId: p.id,
        clientName: p.clientName,
        clientEmail,
        projectTitle: `${p.title} — Balance`,
        amount: hasDeposit ? balance : p.value,
        status: 'draft',
        dueDate: p.weddingDate,
        type: 'balance',
        templateId,
      })
      pushInvoiceUndo(invoiceId, `${p.title} — Balance`)
    } else {
      const invoiceId = actions.addInvoice({
        projectId: p.id,
        clientName: p.clientName,
        clientEmail,
        projectTitle: p.title,
        amount: p.value,
        status: 'draft',
        dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
        type: 'full',
        templateId,
      })
      pushInvoiceUndo(invoiceId, p.title)
    }
    setCreateFromProjectId(null)
    void actions.refreshState() // pull invoiceNumber from server
  }

  const handleMarkPaid = async (invoiceId: string) => {
    const inv = invoices.find((i) => i.id === invoiceId)
    if (!inv) return
    setActionError(null)
    const paidAt = new Date().toISOString().slice(0, 10)
    const ok = await apiUpdateInvoice(invoiceId, { status: 'paid', paidAt })
    if (!ok) {
      setActionError('Could not mark as paid. Check connection and try again.')
      return
    }
    const previous = { status: inv.status, paidAt: inv.paidAt }
    actions.updateInvoice(invoiceId, { status: 'paid', paidAt })
    pushUndo({
      id: `invoice-paid-${invoiceId}`,
      label: `Invoice marked paid`,
      undo: async () => {
        await apiUpdateInvoice(invoiceId, previous)
        await actions.refreshState()
      },
    })
  }

  const handleMarkSent = async (invoiceId: string) => {
    const inv = invoices.find((i) => i.id === invoiceId)
    if (!inv) return
    setActionError(null)
    const ok = await apiUpdateInvoice(invoiceId, { status: 'sent' })
    if (!ok) {
      setActionError('Could not mark as sent. Check connection and try again.')
      return
    }
    const previous = { status: inv.status }
    actions.updateInvoice(invoiceId, { status: 'sent' })
    pushUndo({
      id: `invoice-sent-${invoiceId}`,
      label: `Invoice marked sent`,
      undo: async () => {
        await apiUpdateInvoice(invoiceId, previous)
        await actions.refreshState()
      },
    })
  }

  const invoiceViewBaseUrl = (state.config?.publicAppUrl || '').trim() || getInquiryApiBaseUrl() || (typeof window !== 'undefined' ? window.location.origin : '')

  const openSendModal = (invoice: (typeof invoices)[0]) => {
    setSendError(null)
    setSendLinkCopied(false)
    const toEmail = (invoice.clientEmail || clients.find((c) => (c.name || '').trim() === (invoice.clientName || '').trim())?.email || '').trim()
    const viewUrl = invoiceViewBaseUrl ? `${invoiceViewBaseUrl.replace(/\/$/, '')}/invoices/view/${invoice.id}` : ''
    const subject = `Invoice: ${invoice.projectTitle}`
    const body = appendSignature(
      `Hi${invoice.clientName ? ` ${invoice.clientName.split(/\s+/)[0]}` : ''},\n\n` +
        `Please find your invoice below.\n\n` +
        `Invoice: ${invoice.projectTitle}\nAmount: $${invoice.amount.toLocaleString()}\nDue date: ${invoice.dueDate}\n\n` +
        (viewUrl ? `Pay with card (view invoice and pay securely):\n${viewUrl}\n\n` : '') +
        `Thank you.`
    )
    setSendModal({ invoice, toEmail, subject, body, markAsSentOnSend: invoice.status === 'draft' })
  }

  const openReminderModal = (invoice: (typeof invoices)[0]) => {
    setSendError(null)
    setSendLinkCopied(false)
    setReminderSentAt(null)
    const toEmail = (invoice.clientEmail || clients.find((c) => (c.name || '').trim() === (invoice.clientName || '').trim())?.email || '').trim()
    const viewUrl = invoiceViewBaseUrl ? `${invoiceViewBaseUrl.replace(/\/$/, '')}/invoices/view/${invoice.id}` : ''
    const subject = `Friendly reminder: Invoice for ${invoice.projectTitle} is past due`
    const body = appendSignature(
      `Hi${invoice.clientName ? ` ${invoice.clientName.split(/\s+/)[0]}` : ''},\n\nThis is a friendly reminder that the following invoice is past due:\n\n` +
        `Invoice: ${invoice.projectTitle}\nAmount: $${invoice.amount.toLocaleString()}\nDue date: ${invoice.dueDate}\n\n` +
        `You can view and pay online here: ${viewUrl}\n\nIf you've already paid, please disregard this message. Thank you!`
    )
    setSendModal({ invoice, toEmail, subject, body, markAsSentOnSend: false, isReminder: true })
  }

  const handleSendReminderNow = async () => {
    if (!sendModal?.isReminder || !sendModal.invoice.clientEmail?.trim()) return
    setSendError(null)
    setSendingReminder(true)
    const result = await apiSendInvoiceReminder(sendModal.invoice.id, invoiceViewBaseUrl || undefined)
    setSendingReminder(false)
    if (result.ok) {
      setReminderSentAt(result.sentAt)
      await actions.refreshState()
      setSendModal((s) => s ? { ...s, invoice: { ...s.invoice, lastReminderSentAt: result.sentAt } } : null)
    } else {
      setSendError(result.error)
    }
  }

  const handleSendInvoice = async () => {
    if (!sendModal) return
    const email = sendModal.toEmail.trim()
    if (!email) return
    setSendError(null)
    if (!sendModal.isReminder && sendModal.markAsSentOnSend && sendModal.invoice.status === 'draft') {
      const ok = await apiUpdateInvoice(sendModal.invoice.id, { status: 'sent' })
      if (!ok) {
        setSendError('Could not mark invoice as sent. Check connection and try again.')
        return
      }
      actions.updateInvoice(sendModal.invoice.id, { status: 'sent' })
    }
    const subject = encodeURIComponent(sendModal.subject)
    const body = encodeURIComponent(sendModal.body)
    window.location.href = `mailto:${encodeURIComponent(email)}?subject=${subject}&body=${body}`
    setSendModal(null)
  }

  const handlePayWithCard = async (invoice: (typeof invoices)[0]) => {
    setPaymentError(null)
    setPayingId(invoice.id)
    try {
      const { url } = await createCheckoutSession({
        invoiceId: invoice.id,
        amount: invoice.amount,
        clientEmail: invoice.clientEmail,
        description: invoice.projectTitle,
      })
      if (url) window.location.href = url
    } catch (err) {
      setPaymentError(err instanceof Error ? err.message : 'Payment link failed')
      setPayingId(null)
    }
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1>Invoices</h1>
        <p className={styles.subtitle}>Track, send, and get paid.</p>
        <div className={styles.headerActions}>
          <button
            type="button"
            className={styles.addBtn}
            onClick={() => { setCreateFromProjectId(createFromProjectId ? null : 'new'); setCreateFromScratch(false) }}
          >
            {createFromProjectId ? 'Cancel' : 'From booking'}
          </button>
          <button
            type="button"
            className={styles.secBtn}
            onClick={() => { setCreateFromScratch(!createFromScratch); setCreateFromProjectId(null) }}
          >
            {createFromScratch ? 'Cancel' : 'From scratch'}
          </button>
        </div>
      </header>

      <section className={styles.howItWorks}>
        <strong>How it works:</strong> Create an invoice (from a <strong>booked</strong> project on Bookings, or <strong>from scratch</strong>). It starts as <em>draft</em>. Use <strong>Edit</strong> to fix details, then <strong>Mark sent</strong> when you send it to the client. They can <strong>Pay with card</strong> (Stripe) or you can <strong>Mark paid</strong> when they pay another way.
      </section>

      {createFromScratch && (
        <section className={styles.card}>
          <h2>New invoice (from scratch)</h2>
          <form onSubmit={handleCreateFromScratch} className={styles.editForm}>
            <label>Client name *<input type="text" className={styles.input} value={scratchForm.clientName} onChange={(e) => setScratchForm((f) => ({ ...f, clientName: e.target.value }))} required /></label>
            <label>Client email<input type="email" className={styles.input} value={scratchForm.clientEmail} onChange={(e) => setScratchForm((f) => ({ ...f, clientEmail: e.target.value }))} /></label>
            <label>Project / title *<input type="text" className={styles.input} value={scratchForm.projectTitle} onChange={(e) => setScratchForm((f) => ({ ...f, projectTitle: e.target.value }))} placeholder="e.g. Wedding — Retainer" required /></label>
            {scratchForm.lineItems.length === 0 ? (
              <label>Amount ($) *<input type="number" min={0} step={0.01} className={styles.input} value={scratchForm.amount || ''} onChange={(e) => setScratchForm((f) => ({ ...f, amount: Number(e.target.value) || 0 }))} required /></label>
            ) : (
              <div className={styles.lineItemsSection}>
                <div className={styles.lineItemsHeader}>
                  <strong>Line items</strong>
                  <button type="button" className={styles.smallBtn} onClick={() => setScratchForm((f) => ({ ...f, lineItems: [...f.lineItems, emptyLineItem()] }))}>Add line</button>
                </div>
                <table className={styles.lineItemsTable}>
                  <thead><tr><th>Description</th><th>Qty</th><th>Unit $</th><th></th></tr></thead>
                  <tbody>
                    {scratchForm.lineItems.map((li, idx) => (
                      <tr key={idx}>
                        <td><input type="text" className={styles.input} value={li.description} onChange={(e) => setScratchForm((f) => ({ ...f, lineItems: f.lineItems.map((item, i) => i === idx ? { ...item, description: e.target.value } : item) }))} placeholder="Service or item" /></td>
                        <td><input type="number" min={0} step={1} className={styles.input} style={{ width: '4rem' }} value={li.quantity} onChange={(e) => setScratchForm((f) => ({ ...f, lineItems: f.lineItems.map((item, i) => i === idx ? { ...item, quantity: Number(e.target.value) || 0 } : item) }))} /></td>
                        <td><input type="number" min={0} step={0.01} className={styles.input} style={{ width: '5rem' }} value={li.unitPrice} onChange={(e) => setScratchForm((f) => ({ ...f, lineItems: f.lineItems.map((item, i) => i === idx ? { ...item, unitPrice: Number(e.target.value) || 0 } : item) }))} /></td>
                        <td><button type="button" className={styles.smallBtn} onClick={() => setScratchForm((f) => ({ ...f, lineItems: f.lineItems.filter((_, i) => i !== idx) }))} aria-label="Remove line">Remove</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className={styles.subtotal}>Subtotal: ${lineItemsTotal(scratchForm.lineItems).toLocaleString()}</p>
                <button type="button" className={styles.smallBtn} onClick={() => setScratchForm((f) => ({ ...f, lineItems: [] }))}>Use single amount instead</button>
              </div>
            )}
            {scratchForm.lineItems.length === 0 && (
              <button type="button" className={styles.smallBtn} onClick={() => setScratchForm((f) => ({ ...f, lineItems: defaultScratchLineItems() }))}>Add line items (experiences)</button>
            )}
            <label>Due date *<input type="date" className={styles.input} value={scratchForm.dueDate} onChange={(e) => setScratchForm((f) => ({ ...f, dueDate: e.target.value }))} required /></label>
            {(invoiceTemplates?.length ?? 0) > 0 && (
              <label>Template (optional)<select className={styles.input} value={scratchForm.templateId} onChange={(e) => setScratchForm((f) => ({ ...f, templateId: e.target.value }))}><option value="">None</option>{(invoiceTemplates ?? []).map((t) => (<option key={t.id} value={t.id}>{t.name}</option>))}</select></label>
            )}
            {scratchError && <p className={styles.error} role="alert">{scratchError}</p>}
            <div className={styles.modalActions}>
              <button type="button" className={styles.cancelBtn} onClick={() => setCreateFromScratch(false)} disabled={savingScratch}>Cancel</button>
              <button type="submit" className={styles.primBtn} disabled={savingScratch}>{savingScratch ? 'Creating…' : 'Create invoice'}</button>
            </div>
          </form>
        </section>
      )}

      {createFromProjectId && (
        <section className={styles.card}>
          <h2>New invoice from booking</h2>
          <div className={styles.createRow}>
            <select
              className={styles.select}
              value={invoiceType}
              onChange={(e) => setInvoiceType(e.target.value as 'deposit' | 'balance' | 'full')}
              aria-label="Invoice type"
            >
              <option value="deposit">Retainer ({Math.round(RETAINER_PERCENT * 100)}%)</option>
              <option value="balance">Balance due</option>
              <option value="full">Full amount</option>
            </select>
            {((invoiceTemplates?.length) ?? 0) > 0 && (
              <div className={styles.templateChunk}>
                <span className={styles.label}>Template (optional):</span>
                <select
                  className={styles.select}
                  value={selectedTemplateId}
                  onChange={(e) => setSelectedTemplateId(e.target.value)}
                  aria-label="Invoice template"
                >
                  <option value="">None</option>
                  {(invoiceTemplates ?? []).map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className={styles.bookingChunk}>
              {bookedOrCompleted.length === 0 ? (
                <p className={styles.muted}>No booked or completed projects yet.</p>
              ) : (
                <>
                  <span className={styles.label}>Booking:</span>
                  {bookedOrCompleted.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className={styles.bookingBtn}
                      onClick={() => handleCreateFromBooking(p.id)}
                    >
                      {p.title} — {p.clientName} (${p.value.toLocaleString()})
                    </button>
                  ))}
                </>
              )}
            </div>
          </div>
        </section>
      )}

      {(paymentSuccess || paymentCancelled || paymentError || paymentConfirmError || actionError) && (
        <div className={paymentError || paymentConfirmError || actionError ? styles.alertError : styles.alert} role="alert">
          {paymentSuccess && !paymentConfirmError && 'Payment successful. Invoice updated to paid.'}
          {paymentConfirmError && paymentConfirmError}
          {paymentCancelled && 'Payment was cancelled.'}
          {paymentError && paymentError}
          {actionError && actionError}
        </div>
      )}

      <div className={styles.metric}>
        <span className={styles.metricLabel}>Outstanding</span>
        <span className={styles.metricValue}>${totalOutstanding.toLocaleString()}</span>
      </div>

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>#</th>
              <th>Client / Project</th>
              <th>Amount</th>
              <th>Due</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {invoices.map((i) => {
              const status = effectiveStatus(i)
              const canPay = status === 'sent' || status === 'overdue'
              const sendWithContract = mustSendWithContract(i)
              return (
              <tr key={i.id}>
                <td className={styles.invoiceNum}>{i.invoiceNumber ?? '—'}</td>
                <td>
                  <strong>{i.clientName}</strong>
                  <span className={styles.project}>{i.projectTitle}</span>
                </td>
                <td>${i.amount.toLocaleString()}</td>
                <td>{i.dueDate}</td>
                <td>
                  <span className={styles.status} data-status={status}>
                    {status}
                  </span>
                </td>
                <td>
                  <div className={styles.cellActions}>
                    <Link to={`/invoices/view/${i.id}`} className={styles.smallBtn} aria-label="View invoice">View</Link>
                    <button
                      type="button"
                      className={styles.smallBtn}
                      onClick={() => { setActionError(null); setEditingInvoice(i) }}
                      aria-label="Edit invoice"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className={styles.smallBtn}
                      onClick={() => { setActionError(null); setDeletingId(i.id) }}
                      aria-label="Delete invoice"
                    >
                      Delete
                    </button>
                    {sendWithContract ? (
                      <Link
                        to={`/contracts?projectId=${i.projectId}`}
                        className={styles.smallBtn}
                        aria-label="Send contract and invoice together"
                      >
                        Send with contract
                      </Link>
                    ) : (
                      <button
                        type="button"
                        className={styles.smallBtn}
                        onClick={() => { setActionError(null); openSendModal(i) }}
                        aria-label="Send invoice by email"
                      >
                        Send
                      </button>
                    )}
                    {i.templateId && (invoiceTemplates ?? []).some((t) => t.id === i.templateId) && (
                      <a
                        href={getInvoiceTemplateFileUrl(i.templateId!)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={styles.viewPdfLink}
                      >
                        View PDF
                      </a>
                    )}
                    {i.status === 'draft' && !sendWithContract && (
                      <button
                        type="button"
                        className={styles.smallBtn}
                        onClick={() => handleMarkSent(i.id)}
                      >
                        Mark sent
                      </button>
                    )}
                    {canPay && (
                      <>
                        <button
                          type="button"
                          className={styles.smallBtn}
                          onClick={() => { setActionError(null); openReminderModal(i) }}
                          aria-label="Send overdue reminder"
                        >
                          Remind
                        </button>
                        <button
                          type="button"
                          className={styles.stripeBtn}
                          onClick={() => handlePayWithCard(i)}
                          disabled={payingId !== null}
                        >
                          {payingId === i.id ? 'Redirecting…' : 'Pay with card'}
                        </button>
                        <button
                          type="button"
                          className={styles.smallBtn}
                          onClick={() => handleMarkPaid(i.id)}
                        >
                          Mark paid
                        </button>
                      </>
                    )}
                    {status === 'paid' && i.paidAt && (
                      <span className={styles.paidDate}>Paid {i.paidAt}</span>
                    )}
                  </div>
                </td>
              </tr>
            );})}
          </tbody>
        </table>
      </div>

      {editingInvoice && (
        <div className={styles.modalOverlay} role="dialog" aria-modal="true" aria-labelledby="edit-invoice-title">
          <div className={styles.modal}>
            <h2 id="edit-invoice-title" className={styles.modalTitle}>Edit invoice</h2>
            <form onSubmit={handleSaveEdit} className={styles.editForm}>
              {editingInvoice.invoiceNumber && <p className={styles.muted}>Invoice # {editingInvoice.invoiceNumber}</p>}
              <label>Client name *<input type="text" className={styles.input} value={editForm.clientName} onChange={(e) => setEditForm((f) => ({ ...f, clientName: e.target.value }))} required /></label>
              <label>Client email<input type="email" className={styles.input} value={editForm.clientEmail} onChange={(e) => setEditForm((f) => ({ ...f, clientEmail: e.target.value }))} /></label>
              <label>Project / title *<input type="text" className={styles.input} value={editForm.projectTitle} onChange={(e) => setEditForm((f) => ({ ...f, projectTitle: e.target.value }))} required /></label>
              {editForm.lineItems.length === 0 ? (
                <label>Amount ($) *<input type="number" min={0} step={0.01} className={styles.input} value={editForm.amount} onChange={(e) => setEditForm((f) => ({ ...f, amount: Number(e.target.value) || 0 }))} required /></label>
              ) : (
                <div className={styles.lineItemsSection}>
                  <div className={styles.lineItemsHeader}>
                    <strong>Line items</strong>
                    <button type="button" className={styles.smallBtn} onClick={() => setEditForm((f) => ({ ...f, lineItems: [...f.lineItems, emptyLineItem()] }))}>Add line</button>
                  </div>
                  <table className={styles.lineItemsTable}>
                    <thead><tr><th>Description</th><th>Qty</th><th>Unit $</th><th></th></tr></thead>
                    <tbody>
                      {editForm.lineItems.map((li, idx) => (
                        <tr key={idx}>
                          <td><input type="text" className={styles.input} value={li.description} onChange={(e) => setEditForm((f) => ({ ...f, lineItems: f.lineItems.map((item, i) => i === idx ? { ...item, description: e.target.value } : item) }))} placeholder="Service or item" /></td>
                          <td><input type="number" min={0} step={1} className={styles.input} style={{ width: '4rem' }} value={li.quantity} onChange={(e) => setEditForm((f) => ({ ...f, lineItems: f.lineItems.map((item, i) => i === idx ? { ...item, quantity: Number(e.target.value) || 0 } : item) }))} /></td>
                          <td><input type="number" min={0} step={0.01} className={styles.input} style={{ width: '5rem' }} value={li.unitPrice} onChange={(e) => setEditForm((f) => ({ ...f, lineItems: f.lineItems.map((item, i) => i === idx ? { ...item, unitPrice: Number(e.target.value) || 0 } : item) }))} /></td>
                          <td><button type="button" className={styles.smallBtn} onClick={() => setEditForm((f) => ({ ...f, lineItems: f.lineItems.filter((_, i) => i !== idx) }))} aria-label="Remove line">Remove</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className={styles.subtotal}>Subtotal: ${lineItemsTotal(editForm.lineItems).toLocaleString()}</p>
                  <button type="button" className={styles.smallBtn} onClick={() => setEditForm((f) => ({ ...f, lineItems: [] }))}>Use single amount instead</button>
                </div>
              )}
              {editForm.lineItems.length === 0 && (
                <button type="button" className={styles.smallBtn} onClick={() => setEditForm((f) => ({ ...f, lineItems: [emptyLineItem()] }))}>Add line items (itemized)</button>
              )}
              <label>Due date *<input type="date" className={styles.input} value={editForm.dueDate} onChange={(e) => setEditForm((f) => ({ ...f, dueDate: e.target.value }))} required /></label>
              <label>Status<select className={styles.input} value={editForm.status} onChange={(e) => setEditForm((f) => ({ ...f, status: e.target.value as 'draft' | 'sent' | 'paid' | 'overdue' }))}><option value="draft">draft</option><option value="sent">sent</option><option value="paid">paid</option><option value="overdue">overdue</option></select></label>
              <label>Template<select className={styles.input} value={editForm.templateId} onChange={(e) => setEditForm((f) => ({ ...f, templateId: e.target.value }))} aria-label="Invoice template"><option value="">None</option>{(invoiceTemplates ?? []).map((t) => (<option key={t.id} value={t.id}>{t.name}</option>))}{editForm.templateId && !(invoiceTemplates ?? []).some((t) => t.id === editForm.templateId) && (<option value={editForm.templateId}>(template removed)</option>)}</select></label>
              {editError && <p className={styles.error} role="alert">{editError}</p>}
              <div className={styles.modalActions}>
                <button type="button" className={styles.cancelBtn} onClick={() => setEditingInvoice(null)} disabled={savingEdit}>Cancel</button>
                <button type="submit" className={styles.primBtn} disabled={savingEdit}>{savingEdit ? 'Saving…' : 'Save'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {deletingId && (
        <div className={styles.modalOverlay} role="dialog" aria-modal="true" aria-labelledby="delete-invoice-title">
          <div className={styles.modal}>
            <h2 id="delete-invoice-title" className={styles.modalTitle}>Delete invoice</h2>
            <p className={styles.confirmMessage}>This invoice will be removed. This cannot be undone.</p>
            {deleteError && <p className={styles.error} role="alert">{deleteError}</p>}
            <div className={styles.modalActions}>
              <button type="button" className={styles.cancelBtn} onClick={() => { setDeletingId(null); setDeleteError(null) }} disabled={deleting}>Cancel</button>
              <button type="button" className={styles.dangerBtn} onClick={handleDeleteConfirm} disabled={deleting}>{deleting ? 'Deleting…' : 'Delete'}</button>
            </div>
          </div>
        </div>
      )}

      {sendModal && (
        <div className={styles.modalOverlay} role="dialog" aria-modal="true" aria-labelledby="send-invoice-title" onClick={() => setSendModal(null)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()} style={{ maxWidth: '520px' }}>
            <h2 id="send-invoice-title" className={styles.modalTitle}>{sendModal.isReminder ? 'Send overdue reminder' : 'Send invoice to contact'}</h2>
            <p className={styles.confirmMessage}>{sendModal.isReminder ? 'Send a friendly "please pay" reminder to the client. Use Send email now (if SMTP is set up) or Open in email to use your mail app.' : 'The message below includes a link to your branded invoice. When your client opens the link, they’ll see the invoice and can click Pay with card. Your email app will open with this message ready to send.'}</p>
            {sendModal.isReminder && sendModal.invoice.lastReminderSentAt && (
              <p className={styles.muted} style={{ fontSize: '0.9rem', marginBottom: '0.5rem' }}>Last reminder sent: {new Date(sendModal.invoice.lastReminderSentAt).toLocaleString()}</p>
            )}
            {sendModal.isReminder && reminderSentAt && (
              <p className={styles.muted} style={{ color: 'var(--success, #2d7a3e)', marginBottom: '0.5rem' }}>Sent! The client will receive the email shortly.</p>
            )}
            <div className={styles.editForm}>
              <label>Contact<select className={styles.input} value={clients.find((c) => (c.email || '').trim() === sendModal.toEmail.trim())?.id ?? ''} onChange={(e) => { const c = clients.find((x) => x.id === e.target.value); setSendModal((s) => s ? { ...s, toEmail: c?.email?.trim() ?? '' } : null) }} aria-label="Select contact"><option value="">— Select a contact —</option>{clients.map((c) => (<option key={c.id} value={c.id}>{c.name}{(c.email || '').trim() ? ` — ${c.email.trim()}` : ' (no email)'}</option>))}</select></label>
              <label>To (email)<input type="email" className={styles.input} value={sendModal.toEmail} onChange={(e) => setSendModal((s) => s ? { ...s, toEmail: e.target.value } : null)} placeholder="Enter or paste email address" /></label>
              <label>Subject<input type="text" className={styles.input} value={sendModal.subject} onChange={(e) => setSendModal((s) => s ? { ...s, subject: e.target.value } : null)} /></label>
              <label>Message<textarea className={styles.input} value={sendModal.body} onChange={(e) => setSendModal((s) => s ? { ...s, body: e.target.value } : null)} rows={6} style={{ resize: 'vertical', minHeight: '100px' }} /></label>
              {!sendModal.isReminder && <label className={styles.checkboxLabel}><input type="checkbox" checked={sendModal.markAsSentOnSend} onChange={(e) => setSendModal((s) => s ? { ...s, markAsSentOnSend: e.target.checked } : null)} /> Mark invoice as Sent when I click Open in email</label>}
              {sendError && <p className={styles.error} role="alert">{sendError}</p>}
              <p className={styles.muted} style={{ marginTop: '0.5rem', fontSize: '0.85rem' }}>
                The link is already in the message above. Your client opens it to see the invoice and use Pay with card.
              </p>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <input type="text" readOnly className={styles.input} value={invoiceViewBaseUrl ? `${invoiceViewBaseUrl.replace(/\/$/, '')}/invoices/view/${sendModal.invoice.id}` : ''} style={{ flex: 1, minWidth: 0 }} aria-label="Invoice view link" />
                <button type="button" className={styles.smallBtn} onClick={() => { const url = invoiceViewBaseUrl ? `${invoiceViewBaseUrl.replace(/\/$/, '')}/invoices/view/${sendModal.invoice.id}` : ''; if (url) void navigator.clipboard.writeText(url).then(() => { setSendLinkCopied(true); setTimeout(() => setSendLinkCopied(false), 2000) }) }}>{sendLinkCopied ? 'Copied' : 'Copy link'}</button>
              </div>
            </div>
            <div className={styles.modalActions}>
              <button type="button" className={styles.cancelBtn} onClick={() => { setSendModal(null); setSendError(null); setReminderSentAt(null) }}>Cancel</button>
              {sendModal.isReminder && (
                <button type="button" className={styles.primBtn} onClick={handleSendReminderNow} disabled={!sendModal.invoice.clientEmail?.trim() || sendingReminder}>
                  {sendingReminder ? 'Sending…' : 'Send email now'}
                </button>
              )}
              <button type="button" className={styles.primBtn} onClick={handleSendInvoice} disabled={!sendModal.toEmail.trim()}>Open in email</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
