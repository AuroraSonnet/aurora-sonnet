import { useState } from 'react'
import { useApp } from '../context/AppContext'
import { apiSubmitInquiry } from '../api/db'
import styles from './InquireGeneral.module.css'

export default function InquireGeneral() {
  const { actions } = useApp()
  const [form, setForm] = useState({
    name: '',
    email: '',
    message: '',
  })
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitError('')
    setSubmitting(true)
    try {
      const result = await apiSubmitInquiry({
        name: form.name.trim(),
        email: form.email.trim(),
        message: form.message.trim() || undefined,
      })
      if (!result) {
        setSubmitError('Failed to send. Please try again.')
        return
      }
      await actions.refreshState()
      window.location.href = 'https://aurorasonnet.com/general-inquiry-thank-you'
    } catch {
      setSubmitError('Failed to send. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className={styles.page}>
      <form className={styles.form} onSubmit={handleSubmit}>
        <label>
          Your Name *
          <input
            type="text"
            value={form.name}
            onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))}
            placeholder="Enter full name"
            className={styles.input}
            required
          />
        </label>
        <label>
          Email Address*
          <input
            type="email"
            value={form.email}
            onChange={(e) => setForm((s) => ({ ...s, email: e.target.value }))}
            placeholder="Enter email"
            className={styles.input}
            required
          />
        </label>
        <label>
          Message*
          <textarea
            value={form.message}
            onChange={(e) => setForm((s) => ({ ...s, message: e.target.value }))}
            placeholder="Write your message"
            className={styles.textarea}
            required
          />
        </label>
        {submitError && <p className={styles.error} role="alert">{submitError}</p>}
        <button type="submit" className={styles.submitBtn} disabled={submitting}>
          {submitting ? 'Sending…' : 'Send Inquiry'}
        </button>
      </form>
    </div>
  )
}
