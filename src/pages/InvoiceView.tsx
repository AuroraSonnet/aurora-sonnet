import { useState, useRef, useEffect } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useApp } from '../context/AppContext'
import { createCheckoutSession } from '../api/stripe'
import styles from './InvoiceView.module.css'

export default function InvoiceView() {
  const { id } = useParams<{ id: string }>()
  const { state } = useApp()
  const invoices = state.invoices ?? []
  const [fetchedInvoice, setFetchedInvoice] = useState<typeof invoices[0] | null>(null)
  const invoice = invoices.find((i) => i.id === id) ?? fetchedInvoice

  useEffect(() => {
    if (!id || invoices.some((i) => i.id === id)) return
    fetch(`/api/invoices/${id}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => data && setFetchedInvoice(data))
      .catch(() => {})
  }, [id, invoices])

  const isClientView = typeof window !== 'undefined' && !['localhost', '127.0.0.1'].includes(window.location.hostname)
  const cardRef = useRef<HTMLDivElement>(null)
  const [payLoading, setPayLoading] = useState(false)
  const [payError, setPayError] = useState<string | null>(null)
  const [pdfLoading, setPdfLoading] = useState(false)
  const [pdfError, setPdfError] = useState<string | null>(null)

  const handleDownloadPdf = async () => {
    if (!invoice || !cardRef.current) return
    setPdfError(null)
    setPdfLoading(true)
    try {
      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
        import('html2canvas'),
        import('jspdf'),
      ])
      const canvas = await html2canvas(cardRef.current, {
        scale: 2,
        backgroundColor: '#ffffff',
        logging: false,
        useCORS: true,
      })
      const imgW = canvas.width
      const imgH = canvas.height
      if (!imgW || !imgH) {
        setPdfError('Could not capture invoice; try again.')
        return
      }
      const imgData = canvas.toDataURL('image/png')
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
      const pageW = pdf.internal.pageSize.getWidth()
      const pageH = pdf.internal.pageSize.getHeight()
      const ratio = Math.min(pageW / imgW, pageH / imgH) * 0.95
      const w = imgW * ratio
      const h = imgH * ratio
      pdf.addImage(imgData, 'PNG', (pageW - w) / 2, (pageH - h) / 2, w, h)
      const base = (invoice.invoiceNumber || invoice.id.slice(0, 8)).replace(/[/\\?*:|"]/g, '-')
      pdf.save(`Invoice-${base}.pdf`)
    } catch (err) {
      setPdfError(err instanceof Error ? err.message : 'Failed to generate PDF')
    } finally {
      setPdfLoading(false)
    }
  }

  const handlePayWithCard = async () => {
    if (!invoice || invoice.status === 'paid') return
    setPayError(null)
    setPayLoading(true)
    try {
      const { url } = await createCheckoutSession({
        invoiceId: invoice.id,
        amount: invoice.amount,
        clientEmail: invoice.clientEmail,
        description: invoice.projectTitle,
      })
      if (url) window.location.href = url
    } catch (err) {
      setPayError(err instanceof Error ? err.message : 'Payment link failed')
    } finally {
      setPayLoading(false)
    }
  }

  if (!invoice) {
    const maybeLoading = id && invoices.length === 0 && !fetchedInvoice
    return (
      <div className={styles.page}>
        <div className={styles.card}>
          <div className={styles.notFound}>
            {maybeLoading ? (
              <>
                <h1>Loading…</h1>
                <p>Opening your invoice.</p>
              </>
            ) : (
              <>
                <h1>Invoice not found</h1>
                <p>This invoice may have been removed or the link is invalid.</p>
                {!isClientView && <Link to="/invoices" className={styles.backLink}>← Back to Invoices</Link>}
              </>
            )}
          </div>
        </div>
      </div>
    )
  }

  const canPay = invoice.status !== 'paid' && !payLoading

  return (
    <div className={styles.page}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1rem' }}>
        {!isClientView && <Link to="/invoices" className={styles.backLink}>← Back to Invoices</Link>}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginLeft: 'auto' }}>
          {pdfError && <span className={styles.payHint} style={{ color: 'var(--warning, #9a7b4f)', fontSize: '0.875rem' }}>{pdfError}</span>}
          <button
            type="button"
            className={styles.downloadBtn}
            onClick={handleDownloadPdf}
            disabled={pdfLoading}
          >
            {pdfLoading ? 'Generating…' : 'Download PDF'}
          </button>
        </div>
      </div>
      <div className={styles.card} ref={cardRef}>
        <header className={styles.header}>
          <h1 className={styles.brand}>Aurora Sonnet</h1>
        </header>
        <h2 className={styles.invoiceTitle}>Invoice {invoice.invoiceNumber ? `#${invoice.invoiceNumber}` : ''}</h2>
        <div className={styles.body}>
          <div className={styles.row}>
            <span className={styles.label}>Client</span>
            <span className={styles.value}>{invoice.clientName}</span>
          </div>
          {invoice.lineItems && invoice.lineItems.length > 0 ? (
            <>
              <div className={styles.row}>
                <span className={styles.label}>Project</span>
                <span className={styles.value}>{invoice.projectTitle}</span>
              </div>
              <div className={styles.row}>
                <span className={styles.label}>Due date</span>
                <span className={styles.value}>{invoice.dueDate}</span>
              </div>
              <table className={styles.itemsTable}>
                <thead>
                  <tr>
                    <th className={styles.itemsDesc}>Description</th>
                    <th className={styles.itemsQty}>Qty</th>
                    <th className={styles.itemsPrice}>Unit price</th>
                    <th className={styles.itemsTotal}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {invoice.lineItems.map((li, idx) => {
                    const qty = Number(li.quantity) || 0
                    const price = Number(li.unitPrice) || 0
                    return (
                      <tr key={idx}>
                        <td className={styles.itemsDesc}>{li.description}</td>
                        <td className={styles.itemsQty}>{qty}</td>
                        <td className={styles.itemsPrice}>${price.toLocaleString()}</td>
                        <td className={styles.itemsTotal}>${(qty * price).toLocaleString()}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              <div className={`${styles.row} ${styles.amountRow}`}>
                <span className={styles.label}>Total due</span>
                <span className={styles.value}>${invoice.amount.toLocaleString()}</span>
              </div>
            </>
          ) : (
            <>
              <div className={styles.row}>
                <span className={styles.label}>Project / Description</span>
                <span className={styles.value}>{invoice.projectTitle}</span>
              </div>
              <div className={styles.row}>
                <span className={styles.label}>Due date</span>
                <span className={styles.value}>{invoice.dueDate}</span>
              </div>
              <div className={`${styles.row} ${styles.amountRow}`}>
                <span className={styles.label}>Amount due</span>
                <span className={styles.value}>${invoice.amount.toLocaleString()}</span>
              </div>
            </>
          )}

          {invoice.status === 'paid' && invoice.paidAt && (
            <div className={styles.paySection}>
              <p className={styles.payTitle}>Paid</p>
              <p className={styles.payHint}>Thank you. This invoice was paid on {invoice.paidAt}.</p>
            </div>
          )}
          {canPay && (
            <div className={styles.paySection}>
              <p className={styles.payTitle}>Pay with card</p>
              <p className={styles.payHint}>Secured by Stripe. You’ll be redirected to complete payment.</p>
              {payError && <p className={styles.payHint} style={{ color: 'var(--warning, #9a7b4f)' }}>{payError}</p>}
              <button
                type="button"
                className={styles.payBtn}
                onClick={handlePayWithCard}
                disabled={payLoading}
              >
                {payLoading ? 'Redirecting…' : 'Pay now'}
              </button>
            </div>
          )}
        </div>
        <footer className={styles.footer}>
          Aurora Sonnet · {invoice.invoiceNumber ? `Invoice #${invoice.invoiceNumber}` : `Invoice ${invoice.id.slice(0, 8)}`}
        </footer>
      </div>
    </div>
  )
}
