import { useState, useEffect } from 'react'
import { useApp } from '../context/AppContext'
import { getStripeSettings, saveStripeSettings } from '../api/stripe'
import { getInquiryApiBaseUrl, getInquiryApiUrlKey } from '../utils/inquiryApiUrl'
import styles from './Settings.module.css'

export default function Settings() {
  const { actions } = useApp()
  const [configured, setConfigured] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const [stripeSecretKey, setStripeSecretKey] = useState('')
  const [stripeWebhookSecret, setStripeWebhookSecret] = useState('')
  const [inquiryApiUrl, setInquiryApiUrl] = useState('')
  const [syncing, setSyncing] = useState(false)
  const [syncMessage, setSyncMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const [testEmailLoading, setTestEmailLoading] = useState(false)
  const [testEmailResult, setTestEmailResult] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  useEffect(() => {
    getStripeSettings().then((r) => {
      setConfigured(r.configured)
      setLoading(false)
    })
  }, [])

  useEffect(() => {
    setInquiryApiUrl(getInquiryApiBaseUrl())
  }, [])

  const saveInquiryApiUrl = () => {
    try {
      localStorage.setItem(getInquiryApiUrlKey(), inquiryApiUrl.trim())
      setSyncMessage({ type: 'ok', text: 'URL saved.' })
    } catch {
      setSyncMessage({ type: 'err', text: 'Failed to save URL.' })
    }
  }

  const syncInquiries = async () => {
    const base = inquiryApiUrl.trim().replace(/\/$/, '')
    if (!base) {
      setSyncMessage({ type: 'err', text: 'Enter an Inquiry API URL and save first.' })
      return
    }
    setSyncMessage(null)
    setSyncing(true)
    try {
      await actions.syncInquiriesFromWebsite()
      setSyncMessage({ type: 'ok', text: 'Synced inquiries. Check Clients and Bookings.' })
    } catch (err) {
      setSyncMessage({ type: 'err', text: err instanceof Error ? err.message : 'Sync failed' })
    } finally {
      setSyncing(false)
    }
  }

  const testSmtp = async () => {
    setTestEmailResult(null)
    setTestEmailLoading(true)
    try {
      const res = await fetch('/api/test-email', { headers: { Accept: 'application/json' } })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.ok) {
        setTestEmailResult({ type: 'ok', text: data.message || 'Test email sent.' })
      } else {
        setTestEmailResult({ type: 'err', text: data.error || `Request failed (${res.status})` })
      }
    } catch (err) {
      setTestEmailResult({ type: 'err', text: err instanceof Error ? err.message : 'Could not reach server' })
    } finally {
      setTestEmailLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setMessage(null)
    setSaving(true)
    try {
      await saveStripeSettings({
        stripeSecretKey: stripeSecretKey.trim(),
        stripeWebhookSecret: stripeWebhookSecret.trim() || undefined,
      })
      setConfigured(true)
      setMessage({ type: 'ok', text: 'Stripe settings saved. You can accept card payments on invoices.' })
      setStripeSecretKey('')
      setStripeWebhookSecret('')
    } catch (err) {
      setMessage({ type: 'err', text: err instanceof Error ? err.message : 'Failed to save' })
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className={styles.page}>
        <h1>Settings</h1>
        <p className={styles.muted}>Loading…</p>
      </div>
    )
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1>Settings</h1>
        <p className={styles.subtitle}>Stripe payments and app configuration.</p>
      </header>

      <section className={styles.card}>
        <h2>Stripe payments</h2>
        {configured && (
          <p className={styles.badgeOk}>Stripe is connected. Customers can pay invoices with a card.</p>
        )}
        <form onSubmit={handleSubmit} className={styles.form}>
          <div className={styles.field}>
            <label htmlFor="stripe-secret">Stripe Secret Key *</label>
            <input
              id="stripe-secret"
              type="password"
              value={stripeSecretKey}
              onChange={(e) => setStripeSecretKey(e.target.value)}
              placeholder="sk_test_... or sk_live_..."
              required
              className={styles.input}
              autoComplete="off"
            />
          </div>
          <div className={styles.field}>
            <label htmlFor="stripe-webhook">Stripe Webhook Secret (optional)</label>
            <input
              id="stripe-webhook"
              type="password"
              value={stripeWebhookSecret}
              onChange={(e) => setStripeWebhookSecret(e.target.value)}
              placeholder="whsec_... (only needed for deployed web app)"
              className={styles.input}
              autoComplete="off"
            />
            <p className={styles.hint}>
              For the desktop app, leave this blank. When you deploy the app online (e.g. Railway), add a webhook in
              Stripe and paste the signing secret here.
            </p>
          </div>
          {message && (
            <p className={message.type === 'ok' ? styles.messageOk : styles.messageErr}>{message.text}</p>
          )}
          <button type="submit" className={styles.submitBtn} disabled={saving}>
            {saving ? 'Saving…' : 'Save Stripe settings'}
          </button>
        </form>
      </section>

      <section className={styles.card}>
        <h2>Email (SMTP)</h2>
        <p className={styles.hint}>
          Inquiry and calendar reminder emails use the server’s SMTP settings. Test that they work from this app.
        </p>
        <div className={styles.buttonRow}>
          <button type="button" onClick={testSmtp} className={styles.submitBtn} disabled={testEmailLoading}>
            {testEmailLoading ? 'Testing…' : 'Test SMTP'}
          </button>
        </div>
        {testEmailResult && (
          <p className={testEmailResult.type === 'ok' ? styles.messageOk : styles.messageErr}>{testEmailResult.text}</p>
        )}
      </section>

      <section className={styles.card}>
        <h2>Website inquiries</h2>
        <p className={styles.hint}>
          When your lead form on aurorasonnet.com posts to your own API (see docs/embed-lead-form.md), new inquiries are saved on that server. Enter its URL below and save it; the app will pull new inquiries automatically when you open the app or open Bookings. You can also click Sync to pull now.
        </p>
        <div className={styles.field}>
          <label htmlFor="inquiry-api-url">Inquiry API URL</label>
          <input
            id="inquiry-api-url"
            type="url"
            value={inquiryApiUrl}
            onChange={(e) => setInquiryApiUrl(e.target.value)}
            placeholder="https://your-app.railway.app"
            className={styles.input}
          />
        </div>
        <div className={styles.buttonRow}>
          <button type="button" onClick={saveInquiryApiUrl} className={styles.submitBtn}>
            Save URL
          </button>
          <button type="button" onClick={syncInquiries} className={styles.submitBtn} disabled={syncing}>
            {syncing ? 'Syncing…' : 'Sync inquiries now'}
          </button>
        </div>
        {syncMessage && (
          <p className={syncMessage.type === 'ok' ? styles.messageOk : styles.messageErr}>{syncMessage.text}</p>
        )}
      </section>
    </div>
  )
}
