import { useState } from 'react'
import { useApp } from '../context/AppContext'
import { apiSubmitInquiry } from '../api/db'
import { PERFORMANCE_PACKAGES, DUO_PACKAGES } from '../data/packages'
import styles from './Inquire.module.css'

type ArtistOrDuoId =
  | 'dr-stephanie-susberich'
  | 'blake-friedman'
  | 'eli-liv'
  | 'riley-richard'
  | 'garrett-tamara'

const SOLO_ARTIST_IDS: ArtistOrDuoId[] = ['dr-stephanie-susberich', 'blake-friedman']
const DUO_IDS: ArtistOrDuoId[] = ['eli-liv', 'riley-richard', 'garrett-tamara']

const SOLO_ARTISTS = [
  { id: 'dr-stephanie-susberich' as const, name: 'Dr. Stephanie Susberich', group: 'Solo artist' },
  { id: 'blake-friedman' as const, name: 'Blake Friedman', group: 'Solo artist' },
] as const

const DUOS = [
  { id: 'eli-liv' as const, name: 'Eli & Liv', group: 'Duo' },
  { id: 'riley-richard' as const, name: 'Riley & Richard', group: 'Duo' },
  { id: 'garrett-tamara' as const, name: 'Garrett & Tamara', group: 'Duo' },
] as const

export default function InquireCombined() {
  const { actions } = useApp()
  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    weddingDate: '',
    venue: '',
    requestedArtist: '' as '' | ArtistOrDuoId,
    packageId: '',
    message: '',
  })

  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')

  const isSoloArtist = form.requestedArtist && SOLO_ARTIST_IDS.includes(form.requestedArtist)
  const isDuo = form.requestedArtist && DUO_IDS.includes(form.requestedArtist)
  const availablePackages = isSoloArtist ? PERFORMANCE_PACKAGES : isDuo ? DUO_PACKAGES : []

  const handleArtistChange = (newArtist: '' | ArtistOrDuoId) => {
    const validPkgs = newArtist && SOLO_ARTIST_IDS.includes(newArtist)
      ? PERFORMANCE_PACKAGES
      : newArtist && DUO_IDS.includes(newArtist)
        ? DUO_PACKAGES
        : []
    const keepPackage = validPkgs.some((p) => p.id === form.packageId)
    setForm((s) => ({ ...s, requestedArtist: newArtist, packageId: keepPackage ? s.packageId : '' }))
  }

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
        <h1>Inquire — Solo & Duo</h1>
        <p className={styles.subtitle}>
          New lead form for Solo Vocalist or Duo Vocal experiences. Choose an artist or duo and an experience package.
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
          Artist or duo
          <select
            value={form.requestedArtist}
            onChange={(e) => handleArtistChange(e.target.value as '' | ArtistOrDuoId)}
            className={styles.input}
          >
            <option value="">Select artist or duo</option>
            <optgroup label="Solo artist">
              {SOLO_ARTISTS.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </optgroup>
            <optgroup label="Duo">
              {DUOS.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </optgroup>
          </select>
        </label>

        <fieldset className={styles.packageFieldset}>
          <legend className={styles.packageLegend}>
            {isSoloArtist ? 'Solo experience' : isDuo ? 'Duo experience' : 'Experience (Solo or Duo)'}
          </legend>
          {availablePackages.length === 0 ? (
            <p className={styles.packageHint}>Select an artist or duo above to choose an experience.</p>
          ) : (
            <div className={styles.packageGrid}>
              {availablePackages.map((pkg) => (
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
          )}
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
        <strong>Tip:</strong> Use this form when you want one page for both solo and duo inquiries (e.g. /inquire-combined on your website).
      </p>
    </div>
  )
}
