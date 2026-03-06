import { useState, useEffect } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import styles from './AcceptProposal.module.css'

type AcceptInfo = {
  id: string
  title: string
  clientName: string
  value: number
  alreadyAccepted?: boolean
}

export default function AcceptProposal() {
  const { proposalId } = useParams<{ proposalId: string }>()
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token')

  const [info, setInfo] = useState<AcceptInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [accepted, setAccepted] = useState(false)

  useEffect(() => {
    if (!proposalId || !token) {
      setError('Invalid link')
      setLoading(false)
      return
    }
    fetch(`/api/proposals/${proposalId}/accept-info?token=${encodeURIComponent(token)}`)
      .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
      .then(({ ok, data }) => {
        if (!ok || data.error) throw new Error(data?.error || 'Invalid or expired link')
        setInfo(data)
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load'))
      .finally(() => setLoading(false))
  }, [proposalId, token])

  const handleAccept = async () => {
    if (!proposalId || !token || submitting) return
    setSubmitting(true)
    setError(null)
    const baseUrl = typeof window !== 'undefined' ? window.location.origin : ''
    try {
      const res = await fetch(`/api/proposals/${proposalId}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, baseUrl }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Failed to accept')
      setAccepted(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to accept')
    } finally {
      setSubmitting(false)
    }
  }

  const brandHeader = (
    <header className={styles.header}>
      <h1 className={styles.brand}>Aurora Sonnet</h1>
      <p className={styles.subline}>Confirm your experience</p>
    </header>
  )

  if (loading && !info) {
    return (
      <div className={styles.page}>
        <div className={styles.card}>
          {brandHeader}
          <div className={styles.loadingWrap}>
            Loading…
          </div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className={styles.page}>
        <div className={styles.card}>
          {brandHeader}
          <div className={styles.body}>
            <h2>Link invalid</h2>
            <p className={styles.error}>{error}</p>
            <p className={styles.hint}>
              If you received this link by email, try copying the full link from the email and pasting it into your browser address bar.
            </p>
          </div>
        </div>
      </div>
    )
  }

  if (accepted || info?.alreadyAccepted) {
    return (
      <div className={styles.page}>
        <div className={styles.card}>
          {brandHeader}
          <div className={styles.body}>
            <h2>Thank you</h2>
            <p className={styles.success}>
              {accepted
                ? "You've accepted this proposal. We'll email you your agreement and retainer invoice shortly so you can sign and pay to secure your date."
                : "This proposal was already accepted. We'll email you your agreement and retainer invoice shortly."}
            </p>
          </div>
        </div>
      </div>
    )
  }

  if (!info) return null

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        {brandHeader}
        <div className={styles.body}>
          <h2>Accept proposal</h2>
          <p className={styles.subtitle}>{info.title}</p>
          <p className={styles.meta}>for {info.clientName}</p>
          <p className={styles.value}>Total investment: ${info.value.toLocaleString()}</p>
          <p className={styles.hint}>
            By accepting, you confirm that you would like to proceed. We will send your agreement and retainer invoice to your email so you can sign and pay to secure your date.
          </p>
          <button
            type="button"
            className={styles.acceptBtn}
            onClick={handleAccept}
            disabled={submitting}
          >
            {submitting ? 'Accepting…' : 'Accept this proposal'}
          </button>
        </div>
      </div>
    </div>
  )
}
