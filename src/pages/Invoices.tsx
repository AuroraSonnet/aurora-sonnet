import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useApp } from '../context/AppContext'
import { useUndo } from '../context/UndoContext'
import { apiDeleteInvoice, apiUpdateInvoice, getInvoiceTemplateFileUrl } from '../api/db'
import { createCheckoutSession, getPaymentStatus, confirmPayment } from '../api/stripe'
import styles from './Invoices.module.css'

export default function Invoices() {
  const { state, actions } = useApp()
  const { pushUndo } = useUndo()
  const { invoices, projects, clients, invoiceTemplates } = state
  const [searchParams, setSearchParams] = useSearchParams()
  const [createFromProjectId, setCreateFromProjectId] = useState<string | null>(null)
  const [invoiceType, setInvoiceType] = useState<'deposit' | 'balance' | 'full'>('deposit')
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('')
  const [payingId, setPayingId] = useState<string | null>(null)
  const [paymentError, setPaymentError] = useState<string | null>(null)

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

  // When returning from Stripe Checkout with session_id, confirm payment then refresh
  useEffect(() => {
    if (!paymentSuccess || !sessionId) return
    confirmPayment(sessionId)
      .then(() => getPaymentStatus())
      .then((payments) => {
        Object.entries(payments).forEach(([invoiceId, paidAt]) => {
          actions.updateInvoice(invoiceId, { status: 'paid', paidAt })
        })
      })
      .catch(() => {})
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

  const totalOutstanding = invoices
    .filter((i) => i.status === 'sent' || i.status === 'overdue')
    .reduce((s, i) => s + i.amount, 0)

  const bookedOrCompleted = projects.filter((p) => p.stage === 'booked' || p.stage === 'completed')

  const clientEmailForProject = (clientId: string) => clients.find((c) => c.id === clientId)?.email

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

  const handleCreateFromBooking = (projectId: string) => {
    const p = projects.find((x) => x.id === projectId)
    if (!p) return
    const deposit = Math.round(p.value * 0.5)
    const balance = p.value - deposit
    const clientEmail = clientEmailForProject(p.clientId)
    const templateId = selectedTemplateId || undefined
    if (invoiceType === 'deposit') {
      const invoiceId = actions.addInvoice({
        projectId: p.id,
        clientName: p.clientName,
        clientEmail,
        projectTitle: `${p.title} — Deposit`,
        amount: deposit,
        status: 'draft',
        dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
        type: 'deposit',
        templateId,
      })
      pushInvoiceUndo(invoiceId, `${p.title} — Deposit`)
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
  }

  const handleMarkPaid = (invoiceId: string) => {
    const inv = invoices.find((i) => i.id === invoiceId)
    if (!inv) return
    const previous = { status: inv.status, paidAt: inv.paidAt }
    actions.updateInvoice(invoiceId, {
      status: 'paid',
      paidAt: new Date().toISOString().slice(0, 10),
    })
    pushUndo({
      id: `invoice-paid-${invoiceId}`,
      label: `Invoice marked paid`,
      undo: async () => {
        await apiUpdateInvoice(invoiceId, previous)
        await actions.refreshState()
      },
    })
  }

  const handleMarkSent = (invoiceId: string) => {
    const inv = invoices.find((i) => i.id === invoiceId)
    if (!inv) return
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
        <p className={styles.subtitle}>Track, send, and get paid. Create from a booking or from scratch.</p>
        <button
          type="button"
          className={styles.addBtn}
          onClick={() => setCreateFromProjectId(createFromProjectId ? null : 'new')}
        >
          {createFromProjectId ? 'Cancel' : 'Create from booking'}
        </button>
      </header>

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
              <option value="deposit">Deposit (50%)</option>
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

      {(paymentSuccess || paymentCancelled || paymentError) && (
        <div className={paymentError ? styles.alertError : styles.alert} role="alert">
          {paymentSuccess && 'Payment successful. Invoice will update to paid.'}
          {paymentCancelled && 'Payment was cancelled.'}
          {paymentError && paymentError}
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
              <th>Client / Project</th>
              <th>Amount</th>
              <th>Due</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {invoices.map((i) => (
              <tr key={i.id}>
                <td>
                  <strong>{i.clientName}</strong>
                  <span className={styles.project}>{i.projectTitle}</span>
                </td>
                <td>${i.amount.toLocaleString()}</td>
                <td>{i.dueDate}</td>
                <td>
                  <span className={styles.status} data-status={i.status}>
                    {i.status}
                  </span>
                </td>
                <td>
                  <div className={styles.cellActions}>
                    {i.templateId && (
                      <a
                        href={getInvoiceTemplateFileUrl(i.templateId)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={styles.viewPdfLink}
                      >
                        View PDF
                      </a>
                    )}
                    {i.status === 'draft' && (
                      <button
                        type="button"
                        className={styles.smallBtn}
                        onClick={() => handleMarkSent(i.id)}
                      >
                        Mark sent
                      </button>
                    )}
                    {(i.status === 'sent' || i.status === 'overdue') && (
                      <>
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
                    {i.status === 'paid' && i.paidAt && (
                      <span className={styles.paidDate}>Paid {i.paidAt}</span>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
