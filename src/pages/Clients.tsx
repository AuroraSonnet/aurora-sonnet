import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useApp } from '../context/AppContext'
import { useUndo } from '../context/UndoContext'
import { apiDeleteClient, apiRestoreClient } from '../api/db'
import styles from './Clients.module.css'

export default function Clients() {
  const navigate = useNavigate()
  const { state, actions } = useApp()
  const { pushUndo } = useUndo()
  const { clients } = state
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    partnerName: '',
  })

  const handleDeleteClient = async (clientId: string, clientName: string) => {
    if (!window.confirm(`Delete ${clientName}? Their bookings will be hidden and can be restored with Undo.`)) return
    const ok = await apiDeleteClient(clientId)
    if (ok) {
      pushUndo({
        id: `client-delete-${clientId}`,
        label: `"${clientName}" deleted`,
        undo: async () => {
          await apiRestoreClient(clientId)
          await actions.refreshState()
        },
      })
      await actions.refreshState()
    }
  }

  const handleAddClient = (e: React.FormEvent) => {
    e.preventDefault()
    const clientId = actions.addClient({
      name: form.name.trim(),
      email: form.email.trim(),
      phone: form.phone.trim() || undefined,
      partnerName: form.partnerName.trim() || undefined,
      createdAt: new Date().toISOString().slice(0, 10),
    })
    pushUndo({
      id: `client-${clientId}`,
      label: `Client "${form.name.trim()}" added`,
      undo: async () => {
        await apiDeleteClient(clientId)
        await actions.refreshState()
      },
    })
    setShowAdd(false)
    setForm({ name: '', email: '', phone: '', partnerName: '' })
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1>Clients</h1>
        <p className={styles.subtitle}>Manage your client relationships.</p>
        <button
          type="button"
          className={styles.addBtn}
          onClick={() => setShowAdd(true)}
        >
          Add client
        </button>
      </header>

      {showAdd && (
        <section className={styles.modal}>
          <form onSubmit={handleAddClient} className={styles.form}>
            <h2>Add client</h2>
            <div className={styles.formGrid}>
              <label>
                Name *
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))}
                  placeholder="e.g. Emma Walsh"
                  className={styles.input}
                  required
                />
              </label>
              <label>
                Email *
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm((s) => ({ ...s, email: e.target.value }))}
                  placeholder="emma@example.com"
                  className={styles.input}
                  required
                />
              </label>
              <label>
                Phone
                <input
                  type="tel"
                  value={form.phone}
                  onChange={(e) => setForm((s) => ({ ...s, phone: e.target.value }))}
                  placeholder="(555) 123-4567"
                  className={styles.input}
                />
              </label>
              <label>
                Partner name
                <input
                  type="text"
                  value={form.partnerName}
                  onChange={(e) => setForm((s) => ({ ...s, partnerName: e.target.value }))}
                  placeholder="e.g. James Walsh"
                  className={styles.input}
                />
              </label>
            </div>
            <div className={styles.formActions}>
              <button type="button" className={styles.cancelBtn} onClick={() => setShowAdd(false)}>
                Cancel
              </button>
              <button type="submit" className={styles.submitBtn}>
                Add client
              </button>
            </div>
          </form>
        </section>
      )}

      <div className={styles.toolbar}>
        <input
          type="search"
          placeholder="Search clients..."
          className={styles.search}
        />
        <select className={styles.select} aria-label="Sort">
          <option>Name A–Z</option>
          <option>Name Z–A</option>
          <option>Recently added</option>
        </select>
      </div>

      <ul className={styles.list}>
        {clients.map((c) => (
          <li key={c.id} className={styles.row}>
            <Link to={`/clients/${c.id}`} className={styles.rowLink}>
              <span className={styles.avatar}>{c.name.slice(0, 1)}</span>
              <div className={styles.info}>
                <strong>{c.name}</strong>
                <span>{c.partnerName ? `${c.name} & ${c.partnerName}` : c.email}</span>
              </div>
            </Link>
            <span className={styles.email}>{c.email}</span>
            <div className={styles.rowActions}>
              <button
                type="button"
                className={styles.deleteBtn}
                aria-label={`Delete ${c.name}`}
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleDeleteClient(c.id, c.name); }}
              >
                Delete
              </button>
              <button
                type="button"
                className={styles.menuBtn}
                aria-label="View client"
                onClick={() => navigate(`/clients/${c.id}`)}
              >
                ⋮
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
