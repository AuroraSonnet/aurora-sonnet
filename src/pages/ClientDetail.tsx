import { useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { useApp } from '../context/AppContext'
import { useUndo } from '../context/UndoContext'
import { apiDeleteClient, apiRestoreClient } from '../api/db'
import { getPackageLabel } from '../data/packages'
import styles from './ClientDetail.module.css'

export default function ClientDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { state, actions } = useApp()
  const { pushUndo } = useUndo()
  const { clients, projects, invoices } = state
  const client = clients.find((c) => c.id === id)
  const clientProjects = projects.filter((p) => p.clientId === id)
  const clientInvoices = invoices.filter((i) => client && i.clientName.includes(client.name))
  const [deleting, setDeleting] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  if (!client) {
    return (
      <div className={styles.page}>
        <p>Client not found.</p>
        <Link to="/clients">← Back to clients</Link>
      </div>
    )
  }

  const getFirstName = (fullName: string) => {
    const trimmed = fullName.trim()
    const first = trimmed.split(/\s+/)[0]
    return first || trimmed
  }

  const handleReplyEmail = () => {
    if (!client.email) return
    const firstName = getFirstName(client.name)
    const subject = encodeURIComponent('Re: Your inquiry — Aurora Sonnet')
    const body = encodeURIComponent(`Hi ${firstName},\n\nThank you for your inquiry.\n\nBest regards`)
    window.location.href = `mailto:${encodeURIComponent(client.email)}?subject=${subject}&body=${body}`
  }

  const handleDelete = async () => {
    if (!id || !client) return
    const clientName = client.name
    setDeleting(true)
    try {
      const ok = await apiDeleteClient(id)
      if (ok) {
        setShowDeleteConfirm(false)
        pushUndo({
          id: `client-delete-${id}`,
          label: `"${clientName}" deleted`,
          undo: async () => {
            await apiRestoreClient(id)
            await actions.refreshState()
          },
        })
        await actions.refreshState()
        navigate('/clients')
      }
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className={styles.page}>
      <Link to="/clients" className={styles.back}>
        ← Clients
      </Link>

      <header className={styles.header}>
        <span className={styles.avatar}>{client.name.slice(0, 1)}</span>
        <div>
          <h1>{client.name}</h1>
          <p className={styles.meta}>
            {client.email}
            {client.phone && ` · ${client.phone}`}
            {client.partnerName && ` · With ${client.partnerName}`}
          </p>
        </div>
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.secBtn}
            onClick={handleReplyEmail}
            disabled={!client.email}
          >
            Reply via email
          </button>
          <button
            type="button"
            className={styles.primBtn}
            onClick={() => navigate('/bookings', { state: { openNewInquiryForClientId: client.id } })}
          >
            New booking
          </button>
          <button
            type="button"
            className={styles.dangerBtn}
            onClick={() => setShowDeleteConfirm(true)}
          >
            Delete client
          </button>
        </div>
      </header>

      {showDeleteConfirm && (
        <div className={styles.confirmOverlay} role="dialog" aria-modal="true" aria-labelledby="delete-confirm-title">
          <div className={styles.confirmModal}>
            <h2 id="delete-confirm-title" className={styles.confirmTitle}>Delete client?</h2>
            <p className={styles.confirmMessage}>
              {client.name} and their bookings will be removed from the list. You can undo this from the bar below if you change your mind.
            </p>
            <div className={styles.confirmActions}>
              <button type="button" className={styles.cancelBtn} onClick={() => setShowDeleteConfirm(false)} disabled={deleting}>
                Cancel
              </button>
              <button type="button" className={styles.dangerBtn} onClick={handleDelete} disabled={deleting}>
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className={styles.grid}>
        <section className={styles.card}>
          <h2>Bookings</h2>
          {clientProjects.length === 0 ? (
            <p className={styles.empty}>No bookings yet.</p>
          ) : (
            <ul className={styles.list}>
              {clientProjects.map((p) => (
                <li key={p.id}>
                  <Link to="/bookings" className={styles.listLink}>
                    <strong>{p.title}</strong>
                    {p.packageType && (
                      <span className={styles.package}>{getPackageLabel(p.packageType)}</span>
                    )}
                    <span className={styles.stage} data-stage={p.stage}>
                      {p.stage}
                    </span>
                  </Link>
                  <span className={styles.amount}>${p.value.toLocaleString()}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={styles.card}>
          <h2>Invoices</h2>
          {clientInvoices.length === 0 ? (
            <p className={styles.empty}>No invoices yet.</p>
          ) : (
            <ul className={styles.list}>
              {clientInvoices.map((i) => (
                <li key={i.id}>
                  <span>
                    <strong>{i.projectTitle}</strong>
                    <span className={styles.status} data-status={i.status}>
                      {i.status}
                    </span>
                  </span>
                  <span className={styles.amount}>${i.amount.toLocaleString()}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}
