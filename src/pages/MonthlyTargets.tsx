import { useEffect, useMemo, useState } from 'react'
import { useApp } from '../context/AppContext'
import styles from './MonthlyTargets.module.css'

type MonthlyTargetsState = {
  weddings: number
  bookingRevenue: number
  commissionRevenue: number
}

const STORAGE_KEY = 'aurora_monthly_targets'
const DEFAULT_TARGETS: MonthlyTargetsState = {
  weddings: 5,
  bookingRevenue: 27500,
  commissionRevenue: 5500,
}

function loadTargets(): MonthlyTargetsState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_TARGETS
    const parsed = JSON.parse(raw) as Partial<MonthlyTargetsState>
    return {
      weddings: Number(parsed.weddings) > 0 ? Number(parsed.weddings) : DEFAULT_TARGETS.weddings,
      bookingRevenue: Number(parsed.bookingRevenue) > 0 ? Number(parsed.bookingRevenue) : DEFAULT_TARGETS.bookingRevenue,
      commissionRevenue: Number(parsed.commissionRevenue) > 0 ? Number(parsed.commissionRevenue) : DEFAULT_TARGETS.commissionRevenue,
    }
  } catch {
    return DEFAULT_TARGETS
  }
}

function formatCurrency(value: number): string {
  return `$${Math.round(value).toLocaleString()}`
}

function monthKey(dateStr: string | undefined): string {
  return typeof dateStr === 'string' ? dateStr.slice(0, 7) : ''
}

function laterDate(a: string, b: string): string {
  return a > b ? a : b
}

function addMonths(isoMonth: string, delta: number): string {
  const [yearStr, monthStr] = isoMonth.split('-')
  const year = Number(yearStr)
  const month = Number(monthStr) - 1
  if (!Number.isFinite(year) || !Number.isFinite(month)) {
    const now = new Date()
    return now.toISOString().slice(0, 7)
  }
  const d = new Date(year, month + delta, 1)
  return d.toISOString().slice(0, 7)
}

function monthLabelFromKey(key: string): string {
  const [yearStr, monthStr] = key.split('-')
  const year = Number(yearStr)
  const month = Number(monthStr) - 1
  const d = Number.isFinite(year) && Number.isFinite(month) ? new Date(year, month, 1) : new Date()
  return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}

export default function MonthlyTargets() {
  const { state } = useApp()
  const [targets, setTargets] = useState<MonthlyTargetsState>(() => loadTargets())
  const [selectedMonthKey, setSelectedMonthKey] = useState(() => new Date().toISOString().slice(0, 7))

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(targets))
  }, [targets])

  const monthLabel = monthLabelFromKey(selectedMonthKey)

  const securedBookings = useMemo(() => {
    const depositByProject = new Map(
      (state.invoices ?? [])
        .filter((invoice) => invoice.projectId && invoice.type === 'deposit' && invoice.paidAt)
        .map((invoice) => [invoice.projectId!, invoice])
    )

    return (state.contracts ?? [])
      .filter((contract) => contract.status === 'signed' && contract.signedAt)
      .map((contract) => {
        const deposit = depositByProject.get(contract.projectId)
        if (!deposit?.paidAt) return null
        const securedAt = laterDate(contract.signedAt!, deposit.paidAt)
        if (monthKey(securedAt) !== selectedMonthKey) return null
        const project = (state.projects ?? []).find((item) => item.id === contract.projectId)
        const bookingValue = Number(project?.value ?? contract.value ?? 0)
        return {
          projectId: contract.projectId,
          securedAt,
          title: project?.title || contract.title,
          value: bookingValue,
          commission: bookingValue * 0.2,
        }
      })
      .filter((booking): booking is NonNullable<typeof booking> => booking !== null)
  }, [selectedMonthKey, state.contracts, state.invoices, state.projects])

  const report = useMemo(() => {
    const weddingsBooked = securedBookings.length
    const bookingRevenue = securedBookings.reduce((sum, booking) => sum + booking.value, 0)
    const agencyCommission = securedBookings.reduce((sum, booking) => sum + booking.commission, 0)
    const averageBookingValue = weddingsBooked > 0 ? bookingRevenue / weddingsBooked : 0
    return { weddingsBooked, bookingRevenue, agencyCommission, averageBookingValue }
  }, [securedBookings])

  const commissionProgressPercent = Math.min(
    100,
    Math.round((report.agencyCommission / Math.max(targets.commissionRevenue, 1)) * 100)
  )
  const commissionRemaining = Math.max(0, targets.commissionRevenue - report.agencyCommission)
  const motivationMessage =
    report.agencyCommission >= targets.commissionRevenue
      ? 'Monthly goal achieved — transfer $500 to founder savings or investment.'
      : commissionProgressPercent >= 80
        ? 'Almost there.'
        : commissionProgressPercent >= 50
          ? 'Halfway to the monthly target.'
          : ''

  const progress = [
    {
      label: 'Weddings booked',
      current: `${report.weddingsBooked}`,
      target: `${targets.weddings}`,
      percent: Math.min(100, Math.round((report.weddingsBooked / Math.max(targets.weddings, 1)) * 100)),
    },
    {
      label: 'Booking revenue',
      current: formatCurrency(report.bookingRevenue),
      target: formatCurrency(targets.bookingRevenue),
      percent: Math.min(100, Math.round((report.bookingRevenue / Math.max(targets.bookingRevenue, 1)) * 100)),
    },
    {
      label: 'Agency commission',
      current: formatCurrency(report.agencyCommission),
      target: formatCurrency(targets.commissionRevenue),
      percent: Math.min(100, Math.round((report.agencyCommission / Math.max(targets.commissionRevenue, 1)) * 100)),
    },
  ]

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerMain}>
          <div>
            <h1>Monthly Targets</h1>
            <p className={styles.subtitle}>Founder dashboard for Aurora Sonnet. Tracking secured bookings for {monthLabel}.</p>
          </div>
          <div className={styles.monthSwitcher}>
            <button
              type="button"
              className={styles.monthBtn}
              onClick={() => setSelectedMonthKey((key) => addMonths(key, -1))}
              aria-label="Previous month"
            >
              ←
            </button>
            <span className={styles.monthLabel}>{monthLabel}</span>
            <button
              type="button"
              className={styles.monthBtn}
              onClick={() => setSelectedMonthKey((key) => addMonths(key, 1))}
              aria-label="Next month"
            >
              →
            </button>
          </div>
        </div>
      </header>

      <section className={styles.card}>
        <div className={styles.sectionHeader}>
          <div>
            <h2>Monthly Targets</h2>
            <p className={styles.cardDesc}>Set your monthly goal for weddings, total booking revenue, and agency commission.</p>
          </div>
          <button
            type="button"
            className={styles.resetBtn}
            onClick={() => setTargets(DEFAULT_TARGETS)}
          >
            Reset defaults
          </button>
        </div>

        <div className={styles.targetGrid}>
          <label className={styles.field}>
            <span>Weddings target</span>
            <input
              type="number"
              min={0}
              step={1}
              value={targets.weddings}
              onChange={(e) => setTargets((prev) => ({ ...prev, weddings: Math.max(0, Number(e.target.value) || 0) }))}
            />
          </label>

          <label className={styles.field}>
            <span>Booking revenue target</span>
            <input
              type="number"
              min={0}
              step={100}
              value={targets.bookingRevenue}
              onChange={(e) => setTargets((prev) => ({ ...prev, bookingRevenue: Math.max(0, Number(e.target.value) || 0) }))}
            />
          </label>

          <label className={styles.field}>
            <span>Agency commission target</span>
            <input
              type="number"
              min={0}
              step={100}
              value={targets.commissionRevenue}
              onChange={(e) => setTargets((prev) => ({ ...prev, commissionRevenue: Math.max(0, Number(e.target.value) || 0) }))}
            />
          </label>
        </div>
      </section>

      <section className={styles.card}>
        <h2>Monthly Progress</h2>
        <p className={styles.cardDesc}>Current progress against your targets for {monthLabel}.</p>

        <div className={styles.graphCard}>
          <div className={styles.graphHeader}>
            <div>
              <span className={styles.graphEyebrow}>Commission progress</span>
              <strong className={styles.graphValue}>
                {formatCurrency(report.agencyCommission)} / {formatCurrency(targets.commissionRevenue)} ({commissionProgressPercent}%)
              </strong>
            </div>
            <span className={styles.graphRemaining}>
              {formatCurrency(commissionRemaining)} remaining
            </span>
          </div>

          <div className={styles.graphTrackWrap}>
            <div className={styles.graphTrack}>
              <div
                className={styles.graphFill}
                style={{ width: `${commissionProgressPercent}%` }}
                aria-hidden="true"
              />
            </div>
            <div className={styles.graphLabels}>
              <span>Point A: $0 commission</span>
              <span>Point B: {formatCurrency(targets.commissionRevenue)} target</span>
            </div>
          </div>

          {motivationMessage && (
            <div
              className={
                report.agencyCommission >= targets.commissionRevenue
                  ? `${styles.motivationBanner} ${styles.goalAchieved}`
                  : styles.motivationBanner
              }
            >
              {motivationMessage}
            </div>
          )}

          <p className={styles.cardDesc} style={{ marginTop: '0.9rem', marginBottom: 0 }}>
            This is a clean in-page motivation system, not a push notification system. That is probably the better first version unless you specifically want popups, sounds, or email reminders for target milestones.
          </p>
        </div>

        <div className={styles.progressGrid}>
          {progress.map((item) => (
            <div key={item.label} className={styles.progressCard}>
              <span className={styles.progressLabel}>{item.label}</span>
              <strong className={styles.progressValue}>{item.current} / {item.target}</strong>
              <span className={styles.progressMeta}>{item.percent}% of target</span>
            </div>
          ))}
        </div>
      </section>

      <section className={styles.card}>
        <h2>Monthly Report</h2>
        <p className={styles.cardDesc}>Summary for secured bookings this month. A booking counts when the contract is signed and the retainer is paid.</p>

        <div className={styles.reportGrid}>
          <div className={styles.reportStat}>
            <span className={styles.reportLabel}>Total weddings booked</span>
            <strong className={styles.reportValue}>{report.weddingsBooked}</strong>
          </div>
          <div className={styles.reportStat}>
            <span className={styles.reportLabel}>Total booking revenue</span>
            <strong className={styles.reportValue}>{formatCurrency(report.bookingRevenue)}</strong>
          </div>
          <div className={styles.reportStat}>
            <span className={styles.reportLabel}>Agency commission earned</span>
            <strong className={styles.reportValue}>{formatCurrency(report.agencyCommission)}</strong>
          </div>
          <div className={styles.reportStat}>
            <span className={styles.reportLabel}>Average booking value</span>
            <strong className={styles.reportValue}>{formatCurrency(report.averageBookingValue)}</strong>
          </div>
        </div>
      </section>
    </div>
  )
}
