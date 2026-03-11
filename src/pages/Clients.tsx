import { useState, useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useApp } from '../context/AppContext'
import { useUndo } from '../context/UndoContext'
import { apiDeleteClient, apiDeleteClientOnRemote, apiDeleteAllClients, apiDeleteAllClientsOnRemote, apiRestoreAllClients, apiRestoreAllClientsOnRemote } from '../api/db'
import { getInquiryApiBaseUrl } from '../utils/inquiryApiUrl'
import { addDeletedClientId, addDeletedClientIds, clearDeletedClientIds } from '../utils/syncFilters'
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
  const [addError, setAddError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState<'name-az' | 'name-za' | 'recent'>('name-az')
  const [deletingAll, setDeletingAll] = useState(false)
  const [restoringAll, setRestoringAll] = useState(false)

  const filteredClients = useMemo(() => {
    const q = search.trim().toLowerCase()
    const list = q
      ? clients.filter(
          (c) =>
            (c.name || '').toLowerCase().includes(q) ||
            (c.email || '').toLowerCase().includes(q) ||
            (c.partnerName || '').toLowerCase().includes(q)
        )
      : clients.slice()
    const byId = (a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id)
    if (sortBy === 'name-az') list.sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' }) || byId(a, b))
    else if (sortBy === 'name-za') list.sort((a, b) => (b.name || '').localeCompare(a.name || '', undefined, { sensitivity: 'base' }) || byId(a, b))
    else if (sortBy === 'recent') list.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '') || byId(a, b))
    return list
  }, [clients, search, sortBy])

  const handleAddClient = async (e: React.FormEvent) => {
    e.preventDefault()
    setAddError(null)
    try {
      const clientId = await actions.addClient({
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
          const ok = await apiDeleteClient(clientId)
          if (ok) {
            const base = getInquiryApiBaseUrl()
            if (base) await apiDeleteClientOnRemote(base, clientId)
            addDeletedClientId(clientId)
            actions.removeClientLocally(clientId)
          }
        },
      })
      setShowAdd(false)
      setForm({ name: '', email: '', phone: '', partnerName: '' })
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'Could not add client')
    }
  }

  const handleDeleteAllClients = async () => {
    if (clients.length === 0) return
    const msg =
      clients.length === 1
        ? 'Delete this client and their projects? This cannot be undone.'
        : `Delete all ${clients.length} clients and their projects? This cannot be undone.`
    if (!window.confirm(msg)) return
    setDeletingAll(true)
    try {
      const base = getInquiryApiBaseUrl()
      let ok = false
      let reason: string | undefined
      // Always delete on local server first
      const localResult = await apiDeleteAllClients()
      ok = localResult.ok
      // Also delete on remote (Render) so sync doesn't bring them back
      if (base) {
        try {
          const remoteResult = await apiDeleteAllClientsOnRemote(base)
          if (!remoteResult.ok) reason = remoteResult.reason
        } catch {
          // Remote delete failed but local succeeded — localStorage blocklist will prevent re-sync
        }
      }
      if (!ok) {
        setDeletingAll(false)
        const hint =
          reason === 'waking_up'
            ? 'Server is waking up (Render cold start). Wait 30–60 seconds and try again.'
            : reason === 'network'
              ? 'Cannot reach the server. Check Settings → Inquiry API URL and your internet connection. If using Render free tier, the server may be sleeping — wait a minute and try again.'
              : 'Delete failed. Check Settings → Inquiry API URL (e.g. https://aurora-sonnet-1.onrender.com) and that the server is reachable.'
        window.alert(hint)
        return
      }
      addDeletedClientIds(clients.map((c) => c.id))
      for (const c of clients) actions.removeClientLocally(c.id)
    } finally {
      setDeletingAll(false)
    }
  }

  const handleRestoreAllClients = async () => {
    if (!window.confirm('Restore all deleted clients and their bookings from the server?')) return
    setRestoringAll(true)
    try {
      const base = getInquiryApiBaseUrl()
      const localResult = await apiRestoreAllClients()
      let restored = localResult.restored ?? 0
      if (base) {
        try {
          const remoteResult = await apiRestoreAllClientsOnRemote(base)
          if (remoteResult.restored && remoteResult.restored > restored) restored = remoteResult.restored
        } catch { /* remote restore is best-effort */ }
      }
      if (!localResult.ok) {
        window.alert('Restore failed. Is the server URL correct in Settings?')
        return
      }
      clearDeletedClientIds()
      await actions.refreshState()
      if (restored > 0) window.alert(`Restored ${restored} client(s).`)
    } finally {
      setRestoringAll(false)
    }
  }

  const handleExportEmails = () => {
    const seen = new Set<string>()
    const rows: string[] = ['Name,Email']
    for (const c of clients) {
      const email = (c.email || '').trim()
      if (!email) continue
      const key = email.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      const name = (c.name || '').replace(/"/g, '""')
      const safeEmail = email.replace(/"/g, '""')
      rows.push(`"${name}","${safeEmail}"`)
    }
    if (rows.length === 1) {
      window.alert('No client emails to export yet.')
      return
    }
    const csv = rows.join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `aurora-sonnet-client-emails-${new Date().toISOString().slice(0, 10)}.csv`
    link.click()
    URL.revokeObjectURL(link.href)
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1>Clients</h1>
        <p className={styles.subtitle}>Manage your client relationships.</p>
        <button
          type="button"
          className={styles.addBtn}
          onClick={() => { setAddError(null); setShowAdd(true) }}
        >
          Add client
        </button>
      </header>

      {showAdd && (
        <section className={styles.modal}>
          <form onSubmit={handleAddClient} className={styles.form}>
            <h2>Add client</h2>
            {addError && <p className={styles.error} role="alert">{addError}</p>}
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
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search clients"
        />
        <select
          className={styles.select}
          aria-label="Sort"
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as 'name-az' | 'name-za' | 'recent')}
        >
          <option value="name-az">Name A–Z</option>
          <option value="name-za">Name Z–A</option>
          <option value="recent">Recently added</option>
        </select>
        <button type="button" className={styles.exportBtn} onClick={handleExportEmails}>
          Download emails
        </button>
        <button
          type="button"
          className={styles.restoreAllBtn}
          onClick={handleRestoreAllClients}
          disabled={restoringAll}
          title="Restore clients and bookings that were deleted (soft-deleted on server)"
        >
          {restoringAll ? 'Restoring…' : 'Restore deleted clients'}
        </button>
        <button
          type="button"
          className={styles.deleteAllBtn}
          onClick={handleDeleteAllClients}
          disabled={clients.length === 0 || deletingAll}
          title={clients.length === 0 ? 'No clients to delete' : 'Delete all clients and their projects'}
        >
          {deletingAll ? 'Deleting…' : 'Delete all clients'}
        </button>
      </div>

      <ul className={styles.list}>
        {filteredClients.map((c) => (
          <li key={c.id} className={styles.row}>
            <Link to={`/clients/${c.id}`} className={styles.rowLink}>
              <span className={styles.avatar}>{(c.name || '?').slice(0, 1)}</span>
              <div className={styles.info}>
                <strong>{c.name}</strong>
                <span>{c.partnerName ? `${c.name} & ${c.partnerName}` : c.email}</span>
              </div>
            </Link>
            <span className={styles.email}>{c.email}</span>
            <div className={styles.rowActions}>
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
