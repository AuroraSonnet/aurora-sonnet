import { Link } from 'react-router-dom'
import { useApp } from '../context/AppContext'
import type { ProjectStage } from '../data/mock'
import { getAutomationSuggestions } from '../utils/automationSuggestions'
import styles from './Dashboard.module.css'

export default function Dashboard() {
  const { state } = useApp()
  const { clients, projects, invoices, proposals, contracts, automations } = state
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
                <Link to={s.link} className={styles.suggestionLink}>
                  {s.linkLabel} →
                </Link>
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
