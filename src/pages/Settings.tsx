import { useState, useEffect } from 'react'
import { useApp } from '../context/AppContext'
import { getStripeSettings, saveStripeSettings } from '../api/stripe'
import { apiCreateClient, apiCreateProject } from '../api/db'
import styles from './Settings.module.css'

const INQUIRY_API_URL_KEY = 'aurora_inquiry_api_url'

export default function Settings() {
  const { state, actions } = useApp()
  const [configured, setConfigured] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const [stripeSecretKey, setStripeSecretKey] = useState('')
  const [stripeWebhookSecret, setStripeWebhookSecret] = useState('')
  const [inquiryApiUrl, setInquiryApiUrl] = useState('')
  const [syncing, setSyncing] = useState(false)
  const [syncMessage, setSyncMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  useEffect(() => {
    getStripeSettings().then((r) => {
      setConfigured(r.configured)
      setLoading(false)
    })
  }, [])

  useEffect(() => {
    try {
      const saved = localStorage.getItem(INQUIRY_API_URL_KEY)
      if (saved) setInquiryApiUrl(saved)
    } catch {
      // ignore
    }
  }, [])

  const saveInquiryApiUrl = () => {
    try {
      localStorage.setItem(INQUIRY_API_URL_KEY, inquiryApiUrl.trim())
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
      const res = await fetch(`${base}/api/state`)
      if (!res.ok) throw new Error('Failed to fetch from API')
      const apiState = (await res.json()) as {
        clients?: { id: string; name: string; email: string; phone?: string; partnerName?: string; createdAt: string }[]
        projects?: { id: string; clientId: string; clientName: string; title: string; stage: string; value: number; weddingDate: string; venue?: string; packageType?: string; dueDate: string; createdAt?: string }[]
      }
      const cloudClients = apiState.clients ?? []
      const cloudProjects = apiState.projects ?? []
      let created = 0
      for (const c of cloudClients) {
        if (!state.clients.some((x) => x.id === c.id)) {
          await apiCreateClient({ ...c, createdAt: c.createdAt ?? new Date().toISOString().slice(0, 10) })
          created++
        }
      }
      for (const p of cloudProjects) {
        if (!state.projects.some((x) => x.id === p.id)) {
          await apiCreateProject({ ...p, dueDate: p.dueDate ?? new Date().toISOString().slice(0, 10) })
          created++
        }
      }
      await actions.refreshState()
      setSyncMessage({ type: 'ok', text: created > 0 ? `Synced ${created} new client(s)/project(s).` : 'No new inquiries to sync.' })
    } catch (err) {
      setSyncMessage({ type: 'err', text: err instanceof Error ? err.message : 'Sync failed' })
    } finally {
      setSyncing(false)
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
