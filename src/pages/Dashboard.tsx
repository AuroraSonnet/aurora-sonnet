import { Link } from 'react-router-dom'
import { useEffect, useMemo, useState } from 'react'
import { useApp } from '../context/AppContext'
import type { ProjectStage } from '../data/mock'
import { getAutomationSuggestions } from '../utils/automationSuggestions'
import { apiGetReferralDecisionsDue, type PartnerReferral } from '../api/db'
import styles from './Dashboard.module.css'

export default function Dashboard() {
  const { state } = useApp()
  const { clients, projects, invoices, proposals, contracts } = state
  const automations = state.automations ?? []
  const [referralDecisionsDue, setReferralDecisionsDue] = useState<PartnerReferral[]>([])

  useEffect(() => {
    void apiGetReferralDecisionsDue(2).then((res) => {
      if (res.ok) setReferralDecisionsDue(res.data.referrals ?? [])
    })
  }, [])

  const referralDecisionSummary = useMemo(() => {
    const overdue = referralDecisionsDue.filter((r) => r.referralDecisionStatus === 'overdue').length
    const approaching = referralDecisionsDue.length - overdue
    return { overdue, approaching, total: referralDecisionsDue.length }
  }, [referralDecisionsDue])

  const paidInvoices = invoices.filter((i) => i.status === 'paid')
  const totalRevenue = paidInvoices.reduce((s, i) => s + i.amount, 0)
  const activeBookings = projects.filter((p) => p.stage === 'proposal' || p.stage === 'booked').length
  const upcomingWeddings = projects.filter((p) => p.stage === 'booked').length
  const activeAutomations = automations.filter((a) => a.enabled).length

  const suggestions = getAutomationSuggestions(projects, proposals, invoices, contracts)

  const pipeline = projects.slice(0, 5).map((p) => ({
    ...p,
    stage: p.stage as ProjectStage,
  }))

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1>Dashboard</h1>
        <p className={styles.subtitle}>Your wedding singing agency at a glance.</p>
      </header>

      <div className={styles.metrics}>
        <div className={styles.metric}>
          <span className={styles.metricValue}>{clients.length}</span>
          <span className={styles.metricLabel}>Clients</span>
        </div>
        <div className={styles.metric}>
          <span className={styles.metricValue}>${totalRevenue.toLocaleString()}</span>
          <span className={styles.metricLabel}>Revenue (paid)</span>
        </div>
        <div className={styles.metric}>
          <span className={styles.metricValue}>{activeBookings}</span>
          <span className={styles.metricLabel}>Active bookings</span>
        </div>
        <div className={styles.metric}>
          <span className={styles.metricValue}>{upcomingWeddings}</span>
          <span className={styles.metricLabel}>Weddings booked</span>
        </div>
        <div className={styles.metric}>
          <span className={styles.metricValue}>{activeAutomations}</span>
          <span className={styles.metricLabel}>Automations on</span>
        </div>
      </div>

      {referralDecisionSummary.total > 0 ? (
        <section className={styles.card} aria-label="Notifications">
          <h2>Notifications</h2>
          <p className={styles.cardDesc}>
            {referralDecisionSummary.total} partner referral
            {referralDecisionSummary.total === 1 ? '' : 's'} need an accept/reject decision within 5 business days.
            {referralDecisionSummary.overdue > 0
              ? ` ${referralDecisionSummary.overdue} overdue.`
              : referralDecisionSummary.approaching > 0
                ? ` ${referralDecisionSummary.approaching} approaching deadline.`
                : ''}{' '}
            Silence is not acceptance.
          </p>
          <ul className={styles.suggestions}>
            {referralDecisionsDue.slice(0, 5).map((r) => (
              <li key={r.id} className={styles.suggestionItem}>
                <span className={styles.suggestionLabel}>
                  {r.partnerName}
                  {r.companyName ? ` · ${r.companyName}` : ''}
                </span>
                <span className={styles.suggestionSub}>
                  {r.referralReference || r.id} · Due {r.referralDecisionDeadline || '—'} ·{' '}
                  <span className={r.referralDecisionStatus === 'overdue' ? styles.noticeOverdue : undefined}>
                    {r.referralDecisionStatus === 'overdue' ? 'Overdue' : 'Approaching deadline'}
                  </span>
                </span>
              </li>
            ))}
          </ul>
          <Link to="/partner-referrals" className={styles.cardLink}>
            Review in Partner Referrals →
          </Link>
        </section>
      ) : null}

      <div className={styles.grid}>
        <section className={styles.card}>
          <h2>Recent clients</h2>
          <ul className={styles.list}>
            {clients.slice(0, 4).map((c) => (
              <li key={c.id} className={styles.listItem}>
                <Link to={`/clients/${c.id}`} className={styles.listLink}>
                  <span className={styles.avatar}>{c.name.slice(0, 1)}</span>
                  <div>
                    <strong>{c.name}</strong>
                    <span className={styles.muted}>{c.partnerName ? `${c.name} & ${c.partnerName}` : c.email}</span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
          <Link to="/clients" className={styles.cardLink}>
            View all clients →
          </Link>
        </section>

        <section className={styles.card}>
          <h2>Pipeline</h2>
          <ul className={styles.list}>
            {pipeline.map((p) => (
              <li key={p.id} className={styles.listItem}>
                <div className={styles.projectRow}>
                  <div>
                    <strong>{p.title}</strong>
                    <span className={styles.muted}>{p.clientName} · {p.weddingDate}</span>
                  </div>
                  <span className={styles.stage} data-stage={p.stage}>
                    {p.stage}
                  </span>
                </div>
                <span className={styles.amount}>${p.value.toLocaleString()}</span>
              </li>
            ))}
          </ul>
          <Link to="/bookings" className={styles.cardLink}>
            View all bookings →
          </Link>
        </section>
      </div>

      {suggestions.length > 0 && (
        <section className={styles.card}>
          <h2>Suggested actions</h2>
          <p className={styles.cardDesc}>
            Automations that need your click. Send proposals, nudge for contracts, or chase payments.
          </p>
          <ul className={styles.suggestions}>
            {suggestions.map((s, i) => (
              <li key={`${s.type}-${s.projectId ?? s.invoiceId ?? i}`} className={styles.suggestionItem}>
                <span className={styles.suggestionLabel}>{s.label}</span>
                {s.sublabel && <span className={styles.suggestionSub}>{s.sublabel}</span>}
                <span className={styles.suggestionLinks}>
                  <Link to={s.link} className={styles.suggestionLink}>
                    {s.linkLabel} →
                  </Link>
                  {s.type === 'payment_reminder' && s.invoiceId && (
                    <Link to={`/invoices?remind=${encodeURIComponent(s.invoiceId)}`} className={styles.suggestionLink}>
                      Send reminder →
                    </Link>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className={styles.grid}>
        <section className={styles.card}>
          <h2>Automations</h2>
          <p className={styles.cardDesc}>
            {activeAutomations} workflow{activeAutomations !== 1 ? 's' : ''} running. Contract signed → deposit invoice is automatic; the rest appear above when they need you.
          </p>
          <Link to="/automations" className={styles.cardLink}>
            Manage automations →
          </Link>
        </section>

        <section className={styles.card}>
          <h2>Recent activity</h2>
          <ul className={styles.activity}>
            <li>
              <span className={styles.activityDot} />
              <span>Deposit paid — Michael & Sofia Torres, Beach House Wedding — $475</span>
              <span className={styles.muted}>2 days ago</span>
            </li>
            <li>
              <span className={styles.activityDot} />
              <span>Proposal sent — Emma & James Walsh, Garden Estate</span>
              <span className={styles.muted}>3 days ago</span>
            </li>
            <li>
              <span className={styles.activityDot} />
              <span>New inquiry — Jessica Park</span>
              <span className={styles.muted}>3 days ago</span>
            </li>
          </ul>
        </section>
      </div>
    </div>
  )
}
