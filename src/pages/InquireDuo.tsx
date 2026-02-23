import { useState } from 'react'
import { useApp } from '../context/AppContext'
import { apiSubmitInquiry } from '../api/db'
import { DUO_PACKAGES, type DuoPackageId } from '../data/packages'
import styles from './Inquire.module.css'

export default function InquireDuo() {
  const { actions } = useApp()
  const ARTISTS = [
    { id: 'eli-liv', name: 'Eli & Liv' },
    { id: 'riley-richard', name: 'Riley & Richard' },
    { id: 'garrett-tamara', name: 'Garrett & Tamara' },
  ] as const

  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    weddingDate: '',
    venue: '',
    packageId: '' as DuoPackageId | '',
    requestedArtist: '' as '' | 'eli-liv' | 'riley-richard' | 'garrett-tamara',
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
        phone: form.phone.trim() || undefined,
        weddingDate: form.weddingDate || undefined,
        venue: form.venue.trim() || undefined,
        packageId: form.packageId || undefined,
        requestedArtist: form.requestedArtist || undefined,
        message: form.message.trim() || undefined,
      })
      if (!result) {
        setSubmitError('Failed to submit. Please try again.')
        return
      }
      await actions.refreshState()
      window.location.href = 'https://aurorasonnet.com/inquiry-thank-you'
    } catch {
      setSubmitError('Failed to submit. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1>Inquire — Duo Vocal</h1>
        <p className={styles.subtitle}>
          New lead form for Duo Vocal experiences. Use on your website or submit manually.
        </p>
      </header>

      <form className={styles.form} onSubmit={handleSubmit}>
        <div className={styles.grid}>
          <label>
            Full Name *
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))}
              required
              placeholder="e.g. Emma Walsh"
              className={styles.input}
            />
          </label>
          <label>
            Email *
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm((s) => ({ ...s, email: e.target.value }))}
              required
              className={styles.input}
            />
          </label>
          <label>
            Phone
            <input
              type="tel"
              value={form.phone}
              onChange={(e) => setForm((s) => ({ ...s, phone: e.target.value }))}
              className={styles.input}
            />
          </label>
          <label>
            Wedding Date *
            <input
              type="date"
              value={form.weddingDate}
              onChange={(e) => setForm((s) => ({ ...s, weddingDate: e.target.value }))}
              min={new Date().toISOString().slice(0, 10)}
              className={styles.input}
              required
            />
          </label>
          <label>
            Venue / Location *
            <input
              type="text"
              value={form.venue}
              onChange={(e) => setForm((s) => ({ ...s, venue: e.target.value }))}
              placeholder="e.g. Garden Estate Vineyard"
              className={styles.input}
              required
            />
          </label>
        </div>

        <label className={styles.fullWidth}>
          Requested duo
          <select
            value={form.requestedArtist}
            onChange={(e) => setForm((s) => ({ ...s, requestedArtist: e.target.value as typeof form.requestedArtist }))}
            className={styles.input}
          >
            <option value="">Select duo</option>
            {ARTISTS.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>

        <fieldset className={styles.packageFieldset}>
          <legend className={styles.packageLegend}>Duo Vocal Experience</legend>
          <div className={styles.packageGrid}>
            {DUO_PACKAGES.map((pkg) => (
              <label
                key={pkg.id}
                className={`${styles.packageCard} ${form.packageId === pkg.id ? styles.packageCardSelected : ''}`}
              >
                <input
                  type="radio"
                  name="packageId"
                  value={pkg.id}
                  checked={form.packageId === pkg.id}
                  onChange={() => setForm((s) => ({ ...s, packageId: pkg.id }))}
                  className={styles.packageRadio}
                />
                <span className={styles.packageName}>{pkg.shortName}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <label className={styles.fullWidth}>
          Message
          <textarea
            value={form.message}
            onChange={(e) => setForm((s) => ({ ...s, message: e.target.value }))}
            placeholder="Tell us about your wedding or any questions you may have."
            rows={3}
            className={styles.textarea}
          />
        </label>
        {submitError && <p className={styles.error} role="alert">{submitError}</p>}
        <button type="submit" className={styles.submitBtn} disabled={submitting}>
          {submitting ? 'Sending…' : 'Send Inquiry'}
        </button>
      </form>

      <p className={styles.tip}>
        <strong>Tip:</strong> Embed this form on aurorasonnet.com for Duo Vocal inquiries (e.g. /inquire-duo) so leads become clients and bookings automatically.
      </p>
    </div>
  )
}
