import { useState, useEffect } from 'react'
import { useLocation, useNavigate, Link } from 'react-router-dom'
import { useApp } from '../context/AppContext'
import type { CalendarReminder } from '../data/mock'
import styles from './Calendar.module.css'

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

function toDateKey(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function getDaysInMonth(year: number, month: number): Date[] {
  const first = new Date(year, month, 1)
  const last = new Date(year, month + 1, 0)
  const startPad = first.getDay()
  const days: Date[] = []
  for (let i = 0; i < startPad; i++) {
    const d = new Date(year, month, 1 - (startPad - i))
    days.push(d)
  }
  for (let d = 1; d <= last.getDate(); d++) {
    days.push(new Date(year, month, d))
  }
  const endPad = 42 - days.length
  for (let i = 1; i <= endPad; i++) {
    days.push(new Date(year, month, last.getDate() + i))
  }
  return days.slice(0, 42)
}

export default function Calendar() {
  const location = useLocation()
  const navigate = useNavigate()
  const { state, actions } = useApp()
  const { calendarReminders, clients } = state
  const today = new Date()
  const [viewYear, setViewYear] = useState(today.getFullYear())
  const [viewMonth, setViewMonth] = useState(today.getMonth())
  const [modalDate, setModalDate] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingForm, setEditingForm] = useState({ title: '', notes: '', clientId: '', reminderAt: '' })
  const [form, setForm] = useState({ title: '', notes: '', clientId: '', reminderAt: '' })

  const statePreselect = location.state as { preselectedClientId?: string; openAddModal?: boolean; date?: string } | null
  const preselectedClientId = statePreselect?.preselectedClientId
  const openAddModal = statePreselect?.openAddModal
  const stateDate = statePreselect?.date

  useEffect(() => {
    if (openAddModal) {
      const date = stateDate && /^\d{4}-\d{2}-\d{2}$/.test(stateDate) ? stateDate : toDateKey(today)
      setModalDate(date)
      setForm((f) => ({ ...f, clientId: preselectedClientId || '' }))
      navigate(location.pathname, { replace: true, state: {} })
    }
  }, [openAddModal, stateDate, preselectedClientId, navigate, location.pathname])

  const days = getDaysInMonth(viewYear, viewMonth)
  const remindersByDate = calendarReminders.reduce<Record<string, CalendarReminder[]>>((acc, r) => {
    if (!acc[r.date]) acc[r.date] = []
    acc[r.date].push(r)
    return acc
  }, {})

  const currentDateReminders = modalDate ? (remindersByDate[modalDate] ?? []) : []
  const isCurrentMonth = (d: Date) => d.getMonth() === viewMonth

  const openModal = (dateKey: string) => {
    setModalDate(dateKey)
    setEditingId(null)
    setEditingForm({ title: '', notes: '', clientId: '', reminderAt: '' })
    setForm({ title: '', notes: '', clientId: '', reminderAt: '' })
  }

  const closeModal = () => {
    setModalDate(null)
    setEditingId(null)
  }

  const handleSaveNew = () => {
    if (!modalDate || !form.title.trim()) return
    actions.addCalendarReminder({
      date: modalDate,
      title: form.title.trim(),
      notes: form.notes.trim() || undefined,
      clientId: form.clientId || undefined,
      reminderAt: form.reminderAt ? new Date(form.reminderAt).toISOString() : undefined,
      createdAt: new Date().toISOString(),
    })
    setForm({ title: '', notes: '', clientId: '', reminderAt: '' })
  }

  const handleUpdate = (id: string) => {
    const r = calendarReminders.find((x) => x.id === id)
    if (!r) return
    actions.updateCalendarReminder(id, {
      title: editingForm.title.trim() || r.title,
      notes: editingForm.notes.trim() || undefined,
      clientId: editingForm.clientId || undefined,
      reminderAt: editingForm.reminderAt ? new Date(editingForm.reminderAt).toISOString() : undefined,
    })
    setEditingId(null)
    setEditingForm({ title: '', notes: '', clientId: '', reminderAt: '' })
  }

  const startEdit = (r: CalendarReminder) => {
    setEditingId(r.id)
    setEditingForm({
      title: r.title,
      notes: r.notes || '',
      clientId: r.clientId || '',
      reminderAt: r.reminderAt ? r.reminderAt.slice(0, 16) : '',
    })
  }

  const prevMonth = () => {
    if (viewMonth === 0) {
      setViewMonth(11)
      setViewYear((y) => y - 1)
    } else setViewMonth((m) => m - 1)
  }

  const nextMonth = () => {
    if (viewMonth === 11) {
      setViewMonth(0)
      setViewYear((y) => y + 1)
    } else setViewMonth((m) => m + 1)
  }

  const clientName = (id: string) => clients.find((c) => c.id === id)?.name ?? id

  const [sendingReminders, setSendingReminders] = useState(false)
  const [reminderToast, setReminderToast] = useState<string | null>(null)
  useEffect(() => {
    if (!reminderToast) return
    const t = setTimeout(() => setReminderToast(null), 3000)
    return () => clearTimeout(t)
  }, [reminderToast])

  const handleSendDueReminders = async () => {
    setSendingReminders(true)
    try {
      const res = await fetch('/api/calendar-reminders/send-due', { method: 'POST' })
      const data = res.ok ? await res.json() : null
      const sent = data?.sent ?? 0
      if (sent > 0) {
        setReminderToast(`Sent ${sent} reminder email(s) to you.`)
        actions.refreshState()
      } else {
        setReminderToast('No due reminders to send right now.')
      }
    } catch {
      setReminderToast('Could not send reminders. Is the server running?')
    } finally {
      setSendingReminders(false)
    }
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1>Calendar</h1>
          <p className={styles.subtitle}>
            Add reminders for any date. Link a contact, add notes, and optionally get an email reminder.
          </p>
        </div>
        <div className={styles.headerActions}>
          <button
            type="button"
            className={styles.sendRemindersBtn}
            onClick={handleSendDueReminders}
            disabled={sendingReminders}
          >
            {sendingReminders ? 'Sending…' : 'Send due reminders now'}
          </button>
        </div>
      </header>
      {reminderToast && <p className={styles.reminderToast} role="status">{reminderToast}</p>}

      <div className={styles.controls}>
        <button type="button" className={styles.navBtn} onClick={prevMonth} aria-label="Previous month">
          ←
        </button>
        <h2 className={styles.monthTitle}>
          {MONTHS[viewMonth]} {viewYear}
        </h2>
        <button type="button" className={styles.navBtn} onClick={nextMonth} aria-label="Next month">
          →
        </button>
      </div>

      <div className={styles.gridWrap}>
        <div className={styles.weekdayRow}>
          {WEEKDAYS.map((w) => (
            <span key={w} className={styles.weekday}>
              {w}
            </span>
          ))}
        </div>
        <div className={styles.daysGrid}>
          {days.map((d, i) => {
            const dateKey = toDateKey(d)
            const reminders = remindersByDate[dateKey] ?? []
            const isToday = dateKey === toDateKey(today)
            return (
              <button
                key={i}
                type="button"
                className={`${styles.dayCell} ${!isCurrentMonth(d) ? styles.dayOther : ''} ${isToday ? styles.dayToday : ''}`}
                onClick={() => openModal(dateKey)}
              >
                <span className={styles.dayNum}>{d.getDate()}</span>
                {reminders.length > 0 && (
                  <span className={styles.dayDots} aria-hidden>
                    {reminders.length <= 3 ? reminders.map(() => '•').join('') : '•••'}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {modalDate && (
        <div className={styles.overlay} onClick={closeModal} role="dialog" aria-modal="true" aria-labelledby="calendar-modal-title">
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h2 id="calendar-modal-title" className={styles.modalTitle}>
              {modalDate}
            </h2>
            <div className={styles.reminderList}>
              {currentDateReminders.map((r) => (
                <div key={r.id} className={styles.reminderCard}>
                  {editingId === r.id ? (
                    <div className={styles.inlineForm}>
                      <input
                        type="text"
                        className={styles.input}
                        value={editingForm.title}
                        onChange={(e) => setEditingForm((f) => ({ ...f, title: e.target.value }))}
                        placeholder="Title"
                      />
                      <textarea
                        className={styles.textarea}
                        value={editingForm.notes}
                        onChange={(e) => setEditingForm((f) => ({ ...f, notes: e.target.value }))}
                        placeholder="Notes"
                        rows={2}
                      />
                      <select
                        className={styles.select}
                        value={editingForm.clientId}
                        onChange={(e) => setEditingForm((f) => ({ ...f, clientId: e.target.value }))}
                      >
                        <option value="">No contact</option>
                        {clients.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                      <label className={styles.reminderAtLabel}>
                        Email reminder at
                        <input
                          type="datetime-local"
                          className={styles.input}
                          value={editingForm.reminderAt}
                          onChange={(e) => setEditingForm((f) => ({ ...f, reminderAt: e.target.value }))}
                        />
                      </label>
                      <div className={styles.inlineActions}>
                        <button type="button" className={styles.primaryBtn} onClick={() => handleUpdate(r.id)}>
                          Save
                        </button>
                        <button type="button" className={styles.linkBtn} onClick={() => { setEditingId(null); setEditingForm({ title: '', notes: '', clientId: '', reminderAt: '' }) }}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className={styles.reminderTitle}>{r.title}</div>
                      {r.notes && <p className={styles.reminderNotes}>{r.notes}</p>}
                      {r.clientId && (
                        <Link to={`/clients/${r.clientId}`} className={styles.clientLink} onClick={closeModal}>
                          {clientName(r.clientId)}
                        </Link>
                      )}
                      {r.reminderAt && (
                        <p className={styles.reminderAt}>Email reminder: {new Date(r.reminderAt).toLocaleString()}</p>
                      )}
                      <div className={styles.cardActions}>
                        <button type="button" className={styles.smallBtn} onClick={() => startEdit(r)}>
                          Edit
                        </button>
                        <button
                          type="button"
                          className={styles.smallBtnDanger}
                          onClick={() => {
                            actions.deleteCalendarReminder(r.id)
                            if (currentDateReminders.length <= 1) closeModal()
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
            <div className={styles.addSection}>
              <label className={styles.label}>Title</label>
              <input
                type="text"
                className={styles.input}
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="e.g. Call artist, Send follow-up email"
              />
              <label className={styles.label}>Notes</label>
              <textarea
                className={styles.textarea}
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                placeholder="Optional details"
                rows={2}
              />
              <label className={styles.label}>Contact</label>
              <select
                className={styles.select}
                value={form.clientId}
                onChange={(e) => setForm((f) => ({ ...f, clientId: e.target.value }))}
              >
                <option value="">None</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <label className={styles.reminderAtLabel}>
                <input
                  type="checkbox"
                  checked={!!form.reminderAt}
                  onChange={(e) => setForm((f) => ({ ...f, reminderAt: e.target.checked ? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 16) : '' }))}
                />
                {' '}
                Send me an email reminder
              </label>
              {form.reminderAt && (
                <input
                  type="datetime-local"
                  className={styles.input}
                  value={form.reminderAt}
                  onChange={(e) => setForm((f) => ({ ...f, reminderAt: e.target.value }))}
                />
              )}
              <div className={styles.modalActions}>
                <button type="button" className={styles.primaryBtn} onClick={handleSaveNew} disabled={!form.title.trim()}>
                  Add reminder
                </button>
                <button type="button" className={styles.linkBtn} onClick={closeModal}>
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
