import { useCallback, useEffect, useState } from 'react'
import { apiGetOutreachScoreboard, type OutreachScoreboard } from '../api/db'
import { VENUE_STAGE_LABELS, VISIT_OUTCOME_LABELS } from '../utils/venuePipeline'
import styles from './OutreachScoreboard.module.css'

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function startOfWeek(d: Date): Date {
  const copy = new Date(d)
  const day = copy.getDay()
  const diff = day === 0 ? -6 : 1 - day // Monday start
  copy.setDate(copy.getDate() + diff)
  return copy
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}

function daysAgo(d: Date, days: number): Date {
  const copy = new Date(d)
  copy.setDate(copy.getDate() - days)
  return copy
}

type Preset = 'week' | 'month' | '30d' | 'custom'

const FUNNEL_STEPS: { key: keyof OutreachScoreboard['funnel']; label: string }[] = [
  { key: 'visits', label: 'Visits Completed' },
  { key: 'replied', label: 'Met Decision Maker' },
  { key: 'meetingsOrShowcases', label: 'Meetings/Showcases' },
  { key: 'strongVenues', label: 'Strong Partners' },
  { key: 'referrals', label: 'Referrals' },
  { key: 'bookings', label: 'Bookings' },
]

export default function OutreachScoreboard() {
  const today = new Date()
  const [preset, setPreset] = useState<Preset>('month')
  const [startDate, setStartDate] = useState(toDateStr(startOfMonth(today)))
  const [endDate, setEndDate] = useState(toDateStr(today))
  const [data, setData] = useState<OutreachScoreboard | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const applyPreset = (p: Preset) => {
    setPreset(p)
    const now = new Date()
    if (p === 'week') {
      setStartDate(toDateStr(startOfWeek(now)))
      setEndDate(toDateStr(now))
    } else if (p === 'month') {
      setStartDate(toDateStr(startOfMonth(now)))
      setEndDate(toDateStr(now))
    } else if (p === '30d') {
      setStartDate(toDateStr(daysAgo(now, 29)))
      setEndDate(toDateStr(now))
    }
  }

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const result = await apiGetOutreachScoreboard(startDate, endDate)
    if (result.ok) setData(result.data)
    else setError(result.error)
    setLoading(false)
  }, [startDate, endDate])

  useEffect(() => {
    void load()
  }, [load])

  const goalCurrent = data?.pipeline.progressTowardTenGoal ?? 0
  const goalPct = Math.min(100, Math.round((goalCurrent / 10) * 100))

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1>Outreach Scoreboard</h1>
        <p className={styles.subtitle}>Computed from visits, debriefs, emails, and referrals — the measured outcome of the playbook.</p>
      </header>

      <div className={styles.goalCard}>
        <div className={styles.goalTop}>
          <span>Goal: 10 strong venue &amp; planner partners that consistently refer</span>
          <strong>{goalCurrent} / 10</strong>
        </div>
        <div className={styles.progressBar}>
          <div className={styles.progressFill} style={{ width: `${goalPct}%` }} />
        </div>
      </div>

      <div className={styles.rangeBar}>
        <button type="button" className={styles.presetBtn} data-active={preset === 'week'} onClick={() => applyPreset('week')}>This week</button>
        <button type="button" className={styles.presetBtn} data-active={preset === 'month'} onClick={() => applyPreset('month')}>This month</button>
        <button type="button" className={styles.presetBtn} data-active={preset === '30d'} onClick={() => applyPreset('30d')}>Last 30 days</button>
        <input
          type="date"
          className={styles.dateInput}
          value={startDate}
          onChange={(e) => { setPreset('custom'); setStartDate(e.target.value) }}
        />
        <span className={styles.rangeLabel}>to</span>
        <input
          type="date"
          className={styles.dateInput}
          value={endDate}
          onChange={(e) => { setPreset('custom'); setEndDate(e.target.value) }}
        />
      </div>

      {error && <p className={styles.error} role="alert">{error}</p>}
      {loading && !data && <p className={styles.loading}>Loading…</p>}

      {data && (
        <>
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Visits ({data.range.businessDays} business days)</h2>
            <div className={styles.grid}>
              <div className={styles.card}>
                <span className={styles.cardLabel}>Completed</span>
                <span className={styles.cardValue}>{data.visits.completed}</span>
                <span className={styles.cardSub}>of {data.visits.targetTotal} targeted</span>
              </div>
              <div className={styles.card}>
                <span className={styles.cardLabel}>Planned</span>
                <span className={styles.cardValue}>{data.visits.planned}</span>
              </div>
              <div className={styles.card}>
                <span className={styles.cardLabel}>Skipped/Cancelled</span>
                <span className={styles.cardValue}>{data.visits.skipped}</span>
              </div>
              <div className={styles.card}>
                <span className={styles.cardLabel}>Completion rate</span>
                <span className={styles.cardValue}>{data.visits.completionRate}%</span>
              </div>
              <div className={styles.card}>
                <span className={styles.cardLabel}>Daily average</span>
                <span className={styles.cardValue}>{data.visits.dailyAverage}</span>
                <span className={styles.cardSub}>target {data.dailyVisitTarget}/day</span>
              </div>
              <div className={styles.card}>
                <span className={styles.cardLabel}>Avg. partnership confidence</span>
                <span className={styles.cardValue}>{data.confidence.average ?? '—'}</span>
                <span className={styles.cardSub}>{data.confidence.count} scored</span>
              </div>
            </div>
          </section>

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Visit outcomes</h2>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr><th>Outcome</th><th>Count</th></tr>
                </thead>
                <tbody>
                  {Object.entries(data.outcomes).map(([key, count]) => (
                    <tr key={key}>
                      <td>{VISIT_OUTCOME_LABELS[key] ?? key}</td>
                      <td>{count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Emails</h2>
            <div className={styles.grid}>
              <div className={styles.card}>
                <span className={styles.cardLabel}>Same-day emails sent</span>
                <span className={styles.cardValue}>{data.emails.sameDayEmailsSent}</span>
              </div>
              <div className={styles.card}>
                <span className={styles.cardLabel}>Sequences started</span>
                <span className={styles.cardValue}>{data.emails.sequencesStarted}</span>
              </div>
              <div className={styles.card}>
                <span className={styles.cardLabel}>Automatic follow-ups sent</span>
                <span className={styles.cardValue}>{data.emails.automaticFollowUpsSent}</span>
                <span className={styles.cardSub}>
                  1st: {data.emails.followUpsByStep.follow_up_1 ?? 0} · 2nd: {data.emails.followUpsByStep.follow_up_2 ?? 0} · 3rd: {data.emails.followUpsByStep.follow_up_3 ?? 0}
                </span>
              </div>
            </div>
          </section>

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Pipeline (current, all venues)</h2>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr><th>Stage</th><th>Venues</th></tr>
                </thead>
                <tbody>
                  {Object.entries(data.pipeline.byStage).map(([stage, count]) => (
                    <tr key={stage}>
                      <td>{VENUE_STAGE_LABELS[stage] ?? stage}</td>
                      <td>{count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Referrals &amp; bookings</h2>
            <div className={styles.grid}>
              <div className={styles.card}>
                <span className={styles.cardLabel}>Referrals received</span>
                <span className={styles.cardValue}>{data.referrals.received}</span>
              </div>
              <div className={styles.card}>
                <span className={styles.cardLabel}>Booked</span>
                <span className={styles.cardValue}>{data.referrals.booked}</span>
              </div>
              <div className={styles.card}>
                <span className={styles.cardLabel}>Conversion rate</span>
                <span className={styles.cardValue}>{data.referrals.conversionRate}%</span>
              </div>
              <div className={styles.card}>
                <span className={styles.cardLabel}>Booking amount</span>
                <span className={styles.cardValue}>${data.referrals.bookingAmountTotal.toLocaleString()}</span>
              </div>
            </div>
          </section>

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Funnel</h2>
            <div className={styles.funnelRow}>
              {FUNNEL_STEPS.map((step, idx) => (
                <span key={step.key} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span className={styles.funnelStep}>
                    <span className={styles.funnelStepValue}>{data.funnel[step.key]}</span>
                    <span className={styles.funnelStepLabel}>{step.label}</span>
                  </span>
                  {idx < FUNNEL_STEPS.length - 1 && <span className={styles.funnelArrow}>→</span>}
                </span>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  )
}
