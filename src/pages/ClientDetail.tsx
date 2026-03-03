import { useState, useEffect } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { useApp } from '../context/AppContext'
import { getPackageLabel } from '../data/packages'
import { getInquiryReplyBody } from '../utils/emailSignature'
import styles from './ClientDetail.module.css'

export default function ClientDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { state, actions } = useApp()
  const { clients, projects, invoices, musicSelections } = state
  const client = clients.find((c) => c.id === id)
  const clientProjects = projects.filter((p) => p.clientId === id)
  const clientInvoices = invoices.filter((i) => client && i.clientName.includes(client.name))
  const clientMusicSelections = (musicSelections ?? []).filter((m) => m.clientId === id)

  const [showEdit, setShowEdit] = useState(false)
  const [editForm, setEditForm] = useState({ name: '', email: '', phone: '', partnerName: '' })
  const [editError, setEditError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (client) setEditForm({ name: client.name, email: client.email || '', phone: client.phone || '', partnerName: client.partnerName || '' })
  }, [client])

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!id || !client) return
    setEditError(null)
    setSaving(true)
    try {
      await actions.updateClient(id, {
        name: editForm.name.trim(),
        email: editForm.email.trim(),
        phone: editForm.phone.trim() || undefined,
        partnerName: editForm.partnerName.trim() || undefined,
      })
      setShowEdit(false)
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Could not save')
    } finally {
      setSaving(false)
    }
  }

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
    const bodyText = getInquiryReplyBody(firstName)
    window.location.href = `mailto:${encodeURIComponent(client.email)}?subject=${subject}&body=${encodeURIComponent(bodyText)}`
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
            className={styles.secBtn}
            onClick={() => navigate('/calendar', { state: { preselectedClientId: client.id, openAddModal: true } })}
          >
            Add to calendar
          </button>
          <button type="button" className={styles.secBtn} onClick={() => { setEditError(null); setShowEdit(true) }}>
            Edit contact
          </button>
        </div>
      </header>

      {showEdit && (
        <div className={styles.confirmOverlay} role="dialog" aria-modal="true" aria-labelledby="edit-contact-title">
          <div className={styles.confirmModal}>
            <h2 id="edit-contact-title" className={styles.confirmTitle}>Edit contact</h2>
            <form onSubmit={handleSaveEdit} className={styles.editForm}>
              <label>
                Name *
                <input
                  type="text"
                  value={editForm.name}
                  onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                  className={styles.input}
                  required
                />
              </label>
              <label>
                Email *
                <input
                  type="email"
                  value={editForm.email}
                  onChange={(e) => setEditForm((f) => ({ ...f, email: e.target.value }))}
                  className={styles.input}
                  required
                />
              </label>
              <label>
                Phone
                <input
                  type="tel"
                  value={editForm.phone}
                  onChange={(e) => setEditForm((f) => ({ ...f, phone: e.target.value }))}
                  className={styles.input}
                />
              </label>
              <label>
                Partner name
                <input
                  type="text"
                  value={editForm.partnerName}
                  onChange={(e) => setEditForm((f) => ({ ...f, partnerName: e.target.value }))}
                  className={styles.input}
                  placeholder="e.g. James Walsh"
                />
              </label>
              {editError && <p className={styles.error} role="alert">{editError}</p>}
              <div className={styles.confirmActions}>
                <button type="button" className={styles.cancelBtn} onClick={() => setShowEdit(false)} disabled={saving}>
                  Cancel
                </button>
                <button type="submit" className={styles.primBtn} disabled={saving}>
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </form>
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
          <h2>Music selections</h2>
          {clientMusicSelections.length === 0 ? (
            <p className={styles.empty}>No music selections yet.</p>
          ) : (
            <ul className={styles.list}>
              {clientMusicSelections.map((m) => (
                <li key={m.id}>
                  <span>
                    <strong>{m.label || 'Wedding music'}</strong>
                    {m.songsText && <span className={styles.meta}> — {m.songsText}</span>}
                  </span>
                  <span className={styles.meta}>{new Date(m.createdAt).toLocaleDateString()}</span>
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
