import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../context/AppContext'
import { useUndo } from '../context/UndoContext'
import { apiDeleteProposal } from '../api/db'
import { PERFORMANCE_PACKAGES, getPackage, type PackageId } from '../data/packages'
import styles from './Proposals.module.css'

export default function Proposals() {
  const navigate = useNavigate()
  const { state, actions } = useApp()
  const { pushUndo } = useUndo()
  const { proposals, projects } = state
  const [showCreate, setShowCreate] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [selectedPackage, setSelectedPackage] = useState<Record<string, PackageId>>({})

  const projectsWithProposal = new Set(proposals.map((p) => p.projectId))
  const projectsWithoutProposal = projects.filter((p) => !projectsWithProposal.has(p.id))

  const copyProposalLink = (id: string) => {
    const url = `${window.location.origin}/proposal/${id}/view`
    navigator.clipboard.writeText(url).then(() => {
      setCopiedId(id)
      setTimeout(() => setCopiedId(null), 2000)
    })
  }

  const handleCreateFromBooking = (projectId: string) => {
    const p = projects.find((x) => x.id === projectId)
    if (!p) return
    const pkgId = selectedPackage[p.id] ?? p.packageType
    const pkg = pkgId ? getPackage(pkgId) : undefined
    const value = pkg?.fromPrice ?? p.value
    const proposalId = actions.addProposal({
      projectId: p.id,
      clientName: p.clientName,
      title: p.title,
      status: 'draft',
      value,
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
      const updates: { stage: 'proposal'; value?: number; packageType?: PackageId } = { stage: 'proposal' }
      if (pkgId && (!p.packageType || p.value !== value)) {
        updates.value = value
        updates.packageType = pkgId
      }
      actions.updateProject(p.id, updates)
    }
    setSelectedPackage((s) => ({ ...s, [projectId]: undefined! }))
    setShowCreate(false)
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1>Proposals</h1>
        <p className={styles.subtitle}>
          Create and track proposals. Share the link so clients can view and accept.
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
            Pick a project to create a proposal. The client can use the link to view and accept.
          </p>
          {projectsWithoutProposal.length === 0 ? (
            <p className={styles.emptyText}>Every project already has a proposal.</p>
          ) : (
            <ul className={styles.bookingList}>
              {projectsWithoutProposal.map((p) => {
                const pkgId = selectedPackage[p.id] ?? p.packageType
                const pkg = pkgId ? getPackage(pkgId) : undefined
                const value = pkg?.fromPrice ?? p.value
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
                        value={pkgId ?? ''}
                        onChange={(e) =>
                          setSelectedPackage((s) => ({
                            ...s,
                            [p.id]: (e.target.value || undefined) as PackageId,
                          }))
                        }
                        className={styles.packageSelect}
                        aria-label="Select package"
                      >
                        <option value="">
                          {p.value > 0 ? `$${p.value.toLocaleString()}` : 'Custom'}
                        </option>
                        {PERFORMANCE_PACKAGES.map((pk) => (
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
              <th>Share</th>
              <th aria-hidden />
            </tr>
          </thead>
          <tbody>
            {proposals.map((p) => (
              <tr key={p.id}>
                <td>
                  <strong>{p.title}</strong>
                </td>
                <td>{p.clientName}</td>
                <td>${p.value.toLocaleString()}</td>
                <td>
                  <span className={styles.status} data-status={p.status}>
                    {p.status}
                  </span>
                </td>
                <td>
                  <button
                    type="button"
                    className={styles.linkBtn}
                    onClick={() => copyProposalLink(p.id)}
                    disabled={copiedId === p.id}
                    aria-label={copiedId === p.id ? 'Copied' : 'Copy proposal link'}
                  >
                    {copiedId === p.id ? 'Copied!' : 'Copy link'}
                  </button>
                </td>
                <td>
                  <button
                    type="button"
                    className={styles.menuBtn}
                    aria-label="View proposal"
                    onClick={() => navigate(`/proposal/${p.id}/view`)}
                  >
                    ⋮
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

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
    </div>
  )
}
