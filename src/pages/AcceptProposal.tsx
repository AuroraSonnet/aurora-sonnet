import { useState, useEffect } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import styles from './AcceptProposal.module.css'

type EnhancementOption = {
  id: string
  label: string
  description: string
  amount: number
}

type ElevatedEnhancement = {
  id: string
  label: string
  defaultPrice: number
  options?: EnhancementOption[]
}

const ELEVATED_ENHANCEMENTS: ElevatedEnhancement[] = [
  { id: 'dj', label: 'DJ set (evening, 3–4 hours)', defaultPrice: 1500 },
  {
    id: 'saxophone',
    label: 'Saxophone feature (cocktails or reception; 2 × 45‑minute sets)',
    defaultPrice: 1250,
  },
  {
    id: 'grand-piano',
    label: 'Grand piano hire (delivery, tuning, pickup; NYC area)',
    defaultPrice: 1900,
    options: [
      {
        id: 'upright',
        label: 'Upright piano',
        description: 'Compact acoustic piano; ideal for tighter stages and most venues.',
        amount: 1300,
      },
      {
        id: 'baby-grand',
        label: 'Baby grand piano',
        description: 'Smaller grand with an elegant look; perfect balance of presence and footprint.',
        amount: 1900,
      },
      {
        id: 'concert-grand',
        label: 'Concert grand piano',
        description: 'Full‑size grand with the richest tone; best for large rooms and statement stages.',
        amount: 2500,
      },
    ],
  },
]

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
  const [selectedEnhancementIds, setSelectedEnhancementIds] = useState<Set<string>>(new Set())
  const [enhancementAmountById, setEnhancementAmountById] = useState<Record<string, number>>(() => {
    const initial: Record<string, number> = {}
    for (const e of ELEVATED_ENHANCEMENTS) initial[e.id] = e.defaultPrice
    return initial
  })
  const [enhancementOptionById, setEnhancementOptionById] = useState<Record<string, string | undefined>>(
    () => {
      const initial: Record<string, string | undefined> = {}
      for (const e of ELEVATED_ENHANCEMENTS) {
        if (e.options && e.options.length > 0) {
          const def = e.options.find((opt) => opt.amount === e.defaultPrice) ?? e.options[0]
          initial[e.id] = def.id
        }
      }
      return initial
    }
  )

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

  const baseValue = info?.value ?? 0
  const selectedEnhancements = ELEVATED_ENHANCEMENTS.filter((e) => selectedEnhancementIds.has(e.id))
  const enhancementsTotal = selectedEnhancements.reduce((sum, e) => sum + (enhancementAmountById[e.id] ?? e.defaultPrice), 0)
  const acceptedTotal = baseValue + enhancementsTotal

  const toggleEnhancement = (id: string) => {
    setSelectedEnhancementIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleAccept = async () => {
    if (!proposalId || !token || submitting) return
    setSubmitting(true)
    setError(null)
    const baseUrl = typeof window !== 'undefined' ? window.location.origin : ''
    try {
      const body: {
        token: string
        baseUrl: string
        acceptedTotal?: number
        selectedEnhancements?: { id: string; label: string; amount: number }[]
      } = { token, baseUrl }
      if (selectedEnhancements.length > 0) {
        body.acceptedTotal = acceptedTotal
        body.selectedEnhancements = selectedEnhancements.map((e) => {
          const amount = enhancementAmountById[e.id] ?? e.defaultPrice
          let label = e.label
          if (e.options && e.options.length > 0) {
            const chosenId = enhancementOptionById[e.id]
            const chosen = e.options.find((opt) => opt.id === chosenId)
            if (chosen) label = `${e.label} — ${chosen.label}`
          }
          return { id: e.id, label, amount }
        })
      }
      const res = await fetch(`/api/proposals/${proposalId}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
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
          <p className={styles.value}>Experience investment: ${baseValue.toLocaleString()}</p>

          <p className={styles.enhancementsTitle}>Elevated enhancements (optional)</p>
          <p className={styles.enhancementsIntro}>Add any of the following to your proposal before confirming.</p>
          <ul className={styles.enhancementsList}>
            {ELEVATED_ENHANCEMENTS.map((e) => (
              <li key={e.id} className={styles.enhancementItem}>
                <label className={styles.enhancementLabel}>
                  <input
                    type="checkbox"
                    checked={selectedEnhancementIds.has(e.id)}
                    onChange={() => toggleEnhancement(e.id)}
                    className={styles.enhancementCheckbox}
                  />
                  <span className={styles.enhancementText}>{e.label}</span>
                  <span className={styles.enhancementPrice}>
                    ${(
                      enhancementAmountById[e.id] ??
                      e.defaultPrice
                    ).toLocaleString()}
                  </span>
                </label>
                {e.options && e.options.length > 1 && selectedEnhancementIds.has(e.id) && (
                  <div className={styles.pianoOptions}>
                    <p className={styles.pianoOptionsIntro}>Choose the piano that best fits your space:</p>
                    <ul className={styles.pianoOptionsList}>
                      {e.options.map((opt) => (
                        <li key={opt.id}>
                          <label className={styles.pianoOptionLabel}>
                            <input
                              type="radio"
                              name={`piano-option-${e.id}`}
                              value={opt.id}
                              checked={enhancementOptionById[e.id] === opt.id}
                              onChange={() => {
                                setEnhancementOptionById((prev) => ({ ...prev, [e.id]: opt.id }))
                                setEnhancementAmountById((prev) => ({ ...prev, [e.id]: opt.amount }))
                              }}
                              className={styles.pianoOptionRadio}
                            />
                            <span className={styles.pianoOptionText}>
                              <span className={styles.pianoOptionTitle}>{opt.label}</span>
                              <span className={styles.pianoOptionDescription}>{opt.description}</span>
                            </span>
                            <span className={styles.pianoOptionPrice}>${opt.amount.toLocaleString()}</span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </li>
            ))}
          </ul>

          {selectedEnhancements.length > 0 && (
            <p className={styles.addedLine}>
              Added:{' '}
              {selectedEnhancements
                .map((e) => {
                  const amount = enhancementAmountById[e.id] ?? e.defaultPrice
                  if (e.options && e.options.length > 0) {
                    const chosenId = enhancementOptionById[e.id]
                    const chosen = e.options.find((opt) => opt.id === chosenId)
                    if (chosen) {
                      return `${e.label} — ${chosen.label} ($${amount.toLocaleString()})`
                    }
                  }
                  return `${e.label} ($${amount.toLocaleString()})`
                })
                .join('; ')}{' '}
              (+${enhancementsTotal.toLocaleString()})
            </p>
          )}
          <p className={styles.value}>
            {acceptedTotal > baseValue ? (
              <>Total investment: ${acceptedTotal.toLocaleString()}</>
            ) : (
              <>Total investment: ${baseValue.toLocaleString()}</>
            )}
          </p>
          <p className={styles.hint}>
            By accepting, you confirm that you would like to proceed. We will send your agreement and retainer invoice to your email so you can sign and pay to secure your date.
          </p>
          <button
            type="button"
            className={styles.acceptBtn}
            onClick={handleAccept}
            disabled={submitting}
          >
            {submitting ? 'Accepting…' : acceptedTotal > baseValue ? `Accept proposal ($${acceptedTotal.toLocaleString()})` : 'Accept this proposal'}
          </button>
        </div>
      </div>
    </div>
  )
}
