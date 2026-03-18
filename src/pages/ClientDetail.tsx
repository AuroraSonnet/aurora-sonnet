import { useState, useEffect } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { useApp, type MusicSelection } from '../context/AppContext'
import { getInquiryApiBaseUrl } from '../utils/inquiryApiUrl'
import { getPackageLabel } from '../data/packages'
import { getRequestedArtistLabel } from '../utils/artistLabels'
import { getInquiryReplyBody } from '../utils/emailSignature'
import { htmlToPdfBase64 } from '../utils/htmlToPdf'
import styles from './ClientDetail.module.css'

/** Split a single line so "Special requests: ..." appears as its own line. */
function splitSpecialRequest(line: string): string[] {
  const marker = /Special requests:/i
  const m = line.match(marker)
  if (!m || m.index == null) return [line]
  const i = m.index
  const songPart = line.slice(0, i).replace(/,\s*$/, '').trim()
  const requestPart = line.slice(i).trim()
  const out: string[] = []
  if (songPart) out.push(songPart)
  if (requestPart) out.push(requestPart)
  return out.length ? out : [line]
}

/** Split songsText (e.g. "Song A — Artist A, Song B — Artist B") into lines.
 * Handles titles that contain commas (e.g. "Signed, Sealed, Delivered (I'm Yours) — Stevie Wonder")
 * by grouping comma fragments until we hit the artist separator " — ".
 * Lines that contain "Special requests: ..." are split so the special request is its own bullet.
 */
function songLines(songsText: string | undefined): string[] {
  if (!songsText || !songsText.trim()) return []
  const parts = songsText.split(',').map((s) => s.trim()).filter(Boolean)
  const lines: string[] = []
  let current = ''

  for (const part of parts) {
    if (!current) {
      current = part
      continue
    }

    const currentHasArtist = current.includes(' — ')
    const partHasArtist = part.includes(' — ')

    if (!currentHasArtist) {
      // Still building up the song title before the " — Artist" separator
      current = `${current}, ${part}`
      continue
    }

    // current already has an artist section; decide if this starts a new song
    if (partHasArtist) {
      lines.push(current)
      current = part
    } else {
      // Extra comma inside the same title after we've already seen " — "
      current = `${current}, ${part}`
    }
  }

  if (current) lines.push(current)

  // Split any line that contains "Special requests:" so it appears as its own bullet
  const result: string[] = []
  for (const line of lines) {
    result.push(...splitSpecialRequest(line))
  }
  return result
}

function repertoirePlainText(clientName: string, selections: MusicSelection[]): string {
  const lines: string[] = ['Music repertoire', clientName, '']
  for (const m of selections) {
    lines.push((m.label || 'Wedding music') + ' — ' + new Date(m.createdAt).toLocaleDateString())
    for (const line of songLines(m.songsText)) lines.push('  • ' + line)
    lines.push('')
  }
  return lines.join('\n')
}

function repertoireHtml(clientName: string, selections: MusicSelection[]): string {
  const brandColor = '#382e27'
  const accentColor = '#6b5b52'
  const fontDisplay = "'Playfair Display', serif"
  const fontBody = "'Inter', sans-serif"
  let html =
    `<div style="font-family: ${fontBody}; max-width:210mm; margin:0 auto; background:#fff; color:${brandColor}; font-size:18px; line-height:1.65; padding:48px 56px 56px;">` +
    `<header style="text-align:center; margin-bottom:28px; padding-bottom:18px; border-bottom:2px solid ${brandColor};">` +
    `<div style="font-family: ${fontDisplay}; font-size:30px; font-weight:500; letter-spacing:0.24em; text-transform:uppercase; margin:0;">Aurora Sonnet</div>` +
    `<div style="font-family: ${fontBody}; font-size:14px; color:${accentColor}; margin-top:6px; letter-spacing:0.18em; text-transform:uppercase;">Music Repertoire</div>` +
    `</header>` +
    `<h1 style="font-family: ${fontDisplay}; font-size:22px; font-weight:600; margin:0 0 8px 0; color:${brandColor};">${escapeHtml(clientName)}</h1>` +
    `<p style="font-family: ${fontBody}; color:${accentColor}; font-size:16px; margin:0 0 32px 0;">Repertoire selections</p>`
  for (const m of selections) {
    const label = escapeHtml(m.label || 'Wedding music')
    const date = new Date(m.createdAt).toLocaleDateString()
    html +=
      `<section style="margin-bottom:28px;">` +
      `<h2 style="font-family: ${fontDisplay}; font-size:20px; font-weight:600; margin:0 0 6px 0; color:${brandColor};">${label}</h2>` +
      `<p style="font-family: ${fontBody}; color:${accentColor}; font-size:14px; margin:0 0 12px 0;">${date}</p>` +
      `<ul style="font-family: ${fontBody}; margin:0; padding-left:28px; font-size:17px;">`
    for (const line of songLines(m.songsText)) html += `<li style="margin:0 0 8px 0;">${escapeHtml(line)}</li>`
    html += '</ul></section>'
  }
  html += `<footer style="font-family: ${fontBody}; margin-top:40px; padding-top:16px; border-top:1px solid #e0d9d4; font-size:13px; color:${accentColor};">Aurora Sonnet · Music repertoire</footer>`
  html += '</div>'
  return html
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export default function ClientDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { state, actions } = useApp()
  const { clients, projects, proposals, invoices, musicSelections } = state
  const client = clients.find((c) => c.id === id)
  const clientProjects = projects.filter((p) => p.clientId === id)
  const clientProjectIds = new Set(clientProjects.map((p) => p.id))
  const acceptedProposals = proposals.filter(
    (p) =>
      p.status === 'accepted' &&
      (clientProjectIds.has(p.projectId) || p.clientName === client?.name)
  )
  const clientInvoices = invoices.filter((i) => client && i.clientName.includes(client.name))
  const clientMusicSelections = (musicSelections ?? []).filter((m) => m.clientId === id)

  const [remoteMusicSelections, setRemoteMusicSelections] = useState<MusicSelection[] | null>(null)

  const [showEdit, setShowEdit] = useState(false)
  const [editForm, setEditForm] = useState({ name: '', email: '', phone: '', partnerName: '' })
  const [editError, setEditError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [editingSelectionId, setEditingSelectionId] = useState<string | null>(null)
  const [editLabelValue, setEditLabelValue] = useState('')
  const [editLabelError, setEditLabelError] = useState<string | null>(null)
  const [repertoirePdfLoading, setRepertoirePdfLoading] = useState(false)

  useEffect(() => {
    if (client) setEditForm({ name: client.name, email: client.email || '', phone: client.phone || '', partnerName: client.partnerName || '' })
  }, [client])

  // Fallback: if no local music selections yet, fetch from server (Render) by client id/email
  useEffect(() => {
    if (!client) return
    if (clientMusicSelections.length > 0) return
    const base = getInquiryApiBaseUrl()
    if (!base) return
    let cancelled = false
    const fetchRemoteSelections = async () => {
      try {
        // Use the same proxy as sync so Electron avoids CORS (request goes to local server, which fetches Render)
        let res = await fetch(`/api/proxy-remote-state?base=${encodeURIComponent(base.replace(/\/$/, ''))}`)
        if (!res.ok) {
          // Fallback: direct Render fetch (works in browser when CORS allows)
          res = await fetch(`${base.replace(/\/$/, '')}/api/state`)
        }
        if (!res.ok) return
        const data = (await res.json()) as { musicSelections?: MusicSelection[] }
        const all = (data.musicSelections ?? []) as MusicSelection[]
        if (all.length === 0) return
        const byId = all.filter((m) => m.clientId === client.id)
        const byEmail =
          client.email && client.email.trim()
            ? all.filter((m) => (m.submitterEmail || '').toLowerCase() === client.email!.toLowerCase())
            : []
        const merged: MusicSelection[] = []
        const seen = new Set<string>()
        for (const m of [...byId, ...byEmail]) {
          if (!seen.has(m.id)) {
            seen.add(m.id)
            merged.push(m)
          }
        }
        if (!cancelled && merged.length > 0) {
          setRemoteMusicSelections(merged)
        }
      } catch {
        // ignore; page still works without remote selections
      }
    }
    void fetchRemoteSelections()
    return () => {
      cancelled = true
    }
  }, [client, clientMusicSelections.length])

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

  const effectiveMusicSelections = remoteMusicSelections ?? clientMusicSelections

  const handleSendRepertoireEmail = () => {
    if (!client?.email || effectiveMusicSelections.length === 0) return
    const subject = encodeURIComponent(`Music repertoire — ${client.name}`)
    const body = encodeURIComponent(repertoirePlainText(client.name, effectiveMusicSelections))
    window.location.href = `mailto:${encodeURIComponent(client.email)}?subject=${subject}&body=${body}`
  }

  const handleDownloadRepertoirePdf = async () => {
    if (!client || effectiveMusicSelections.length === 0) return
    setRepertoirePdfLoading(true)
    try {
      const html = repertoireHtml(client.name, effectiveMusicSelections)
      const base64 = await htmlToPdfBase64(html)
      const blob = await (await fetch(`data:application/pdf;base64,${base64}`)).blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `music-repertoire-${client.name.replace(/\s+/g, '-')}.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setRepertoirePdfLoading(false)
    }
  }

  const handleStartEditLabel = (m: MusicSelection) => {
    setEditingSelectionId(m.id)
    setEditLabelValue(m.label || 'Wedding music')
  }

  const handleSaveEditLabel = async () => {
    if (!editingSelectionId) return
    setEditLabelError(null)
    const label = editLabelValue.trim() || 'Wedding music'
    try {
      await actions.updateMusicSelection(editingSelectionId, { label })
      setRemoteMusicSelections((prev) =>
        prev ? prev.map((x) => (x.id === editingSelectionId ? { ...x, label } : x)) : null
      )
      setEditingSelectionId(null)
    } catch (err) {
      setEditLabelError(err instanceof Error ? err.message : 'Failed to save')
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
                    {getRequestedArtistLabel(p.requestedArtist) && (
                      <span className={styles.artist}> · {getRequestedArtistLabel(p.requestedArtist)}</span>
                    )}
                    {p.performanceMoment && (
                      <span className={styles.performanceMoment}> · {p.performanceMoment}</span>
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

        {acceptedProposals.length > 0 && (
          <section className={styles.card}>
            <h2>Accepted proposal{acceptedProposals.length > 1 ? 's' : ''}</h2>
            <div className={styles.acceptedList}>
              {acceptedProposals.map((ap) => {
                let enhancements: { id: string; label: string; amount: number }[] = []
                try { enhancements = ap.acceptedEnhancements ? JSON.parse(ap.acceptedEnhancements) : [] } catch { /* ignore */ }
                return (
                  <div key={ap.id} className={styles.acceptedBlock}>
                    <div className={styles.acceptedHead}>
                      <strong>{ap.title}</strong>
                      <span className={styles.acceptedValue}>${ap.value.toLocaleString()}</span>
                    </div>
                    {ap.sentAt && (
                      <p className={styles.meta}>
                        Sent {new Date(ap.sentAt).toLocaleDateString()}
                      </p>
                    )}
                    {enhancements.length > 0 && (
                      <div className={styles.enhSection}>
                        <p className={styles.enhTitle}>Selected enhancements</p>
                        <ul className={styles.enhList}>
                          {enhancements.map((e) => (
                            <li key={e.id}>
                              <span>{e.label}</span>
                              <span className={styles.enhAmount}>${e.amount.toLocaleString()}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {enhancements.length === 0 && (
                      <p className={styles.meta} style={{ marginTop: '0.35rem' }}>No enhancements selected</p>
                    )}
                  </div>
                )
              })}
            </div>
          </section>
        )}

        <section className={styles.card}>
          <div className={styles.cardHeader}>
            <h2>Music repertoire</h2>
            {effectiveMusicSelections.length > 0 && (
              <div className={styles.repertoireActions}>
                <button
                  type="button"
                  className={styles.secBtn}
                  onClick={handleSendRepertoireEmail}
                  title="Open email with repertoire"
                >
                  Send by email
                </button>
                <button
                  type="button"
                  className={styles.secBtn}
                  onClick={handleDownloadRepertoirePdf}
                  disabled={repertoirePdfLoading}
                >
                  {repertoirePdfLoading ? 'Creating…' : 'Download PDF'}
                </button>
              </div>
            )}
          </div>
          {effectiveMusicSelections.length === 0 ? (
            <p className={styles.empty}>No music selections yet.</p>
          ) : (
            <div className={styles.repertoireList}>
              {effectiveMusicSelections.map((m) => (
                <div key={m.id} className={styles.repertoireBlock}>
                  <div className={styles.repertoireBlockHead}>
                    {editingSelectionId === m.id ? (
                      <div className={styles.repertoireEditRow}>
                        <input
                          type="text"
                          value={editLabelValue}
                          onChange={(e) => setEditLabelValue(e.target.value)}
                          className={styles.input}
                          placeholder="e.g. Ceremony – Processional"
                          autoFocus
                        />
                        <button type="button" className={styles.primBtn} onClick={handleSaveEditLabel}>
                          Save
                        </button>
                        <button type="button" className={styles.secBtn} onClick={() => { setEditingSelectionId(null); setEditLabelError(null) }}>
                          Cancel
                        </button>
                        {editLabelError && <span className={styles.error} style={{ width: '100%' }}>{editLabelError}</span>}
                      </div>
                    ) : (
                      <>
                        <h3 className={styles.repertoireLabel}>{m.label || 'Wedding music'}</h3>
                        <span className={styles.meta}>{new Date(m.createdAt).toLocaleDateString()}</span>
                        <button
                          type="button"
                          className={styles.repertoireEditBtn}
                          onClick={() => handleStartEditLabel(m)}
                          title="Edit label"
                        >
                          Edit
                        </button>
                      </>
                    )}
                  </div>
                  {songLines(m.songsText).length > 0 ? (
                    <ul className={styles.songList}>
                      {songLines(m.songsText).map((line, i) => (
                        <li key={i}>{line}</li>
                      ))}
                    </ul>
                  ) : m.songsText ? (
                    <p className={styles.meta}>{m.songsText}</p>
                  ) : null}
                </div>
              ))}
            </div>
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
