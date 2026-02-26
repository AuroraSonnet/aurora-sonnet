import { Outlet, useLocation } from 'react-router-dom'
import { NavLink } from 'react-router-dom'
import { useState, useEffect, useRef } from 'react'
import { useApp } from '../context/AppContext'
import { getInquiryApiBaseUrl } from '../utils/inquiryApiUrl'
import UndoBar from './UndoBar'
import styles from './Layout.module.css'

const leadFormRoutes = ['/inquire', '/inquire-duo', '/inquire-combined', '/inquire-general']

const leadForms = [
  { to: '/inquire', label: 'Solo' },
  { to: '/inquire-duo', label: 'Duo' },
  { to: '/inquire-combined', label: 'Solo + Duo' },
  { to: '/inquire-general', label: 'General' },
]

const nav = [
  { to: '/', label: 'Dashboard', icon: '◉' },
  { to: '/clients', label: 'Clients', icon: '◇' },
  { to: '/newsletter', label: 'Newsletter', icon: '✉' },
  { to: '/bookings', label: 'Bookings', icon: '▷' },
  { to: '/proposals', label: 'Proposals', icon: '◆' },
  { to: '/contracts', label: 'Contracts', icon: '▣' },
  { to: '/invoices', label: 'Invoices', icon: '◎' },
  { to: '/bookkeeping', label: 'Bookkeeping', icon: '◈' },
  { to: '/calendar', label: 'Calendar', icon: '📅' },
  { to: '/automations', label: 'Automations', icon: '⚡' },
  { to: '/settings', label: 'Settings', icon: '⚙' },
]

export default function Layout() {
  const location = useLocation()
  const { actions } = useApp()
  const isInLeadForms = leadFormRoutes.some((r) => location.pathname === r)
  const [leadFormsOpen, setLeadFormsOpen] = useState(isInLeadForms)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshedAt, setRefreshedAt] = useState<number | null>(null)
  const hasAutoSynced = useRef(false)

  useEffect(() => {
    if (isInLeadForms) setLeadFormsOpen(true)
  }, [isInLeadForms])

  const handleRefresh = async () => {
    if (refreshing) return
    setRefreshing(true)
    try {
      await actions.refreshState()
      setRefreshedAt(Date.now())
    } finally {
      setRefreshing(false)
    }
  }

  useEffect(() => {
    if (refreshedAt == null) return
    const t = setTimeout(() => setRefreshedAt(null), 2000)
    return () => clearTimeout(t)
  }, [refreshedAt])

  // Auto-sync website inquiries into the app on load so new submissions appear without clicking Sync
  useEffect(() => {
    if (hasAutoSynced.current) return
    const base = getInquiryApiBaseUrl()
    if (!base) return
    hasAutoSynced.current = true
    const t = setTimeout(() => {
      actions.syncInquiriesFromWebsite()
    }, 800)
    return () => clearTimeout(t)
  }, [actions])

  return (
    <div className={styles.layout}>
      <aside className={styles.sidebar}>
        <div className={styles.logo}>
          <span className={styles.logoIcon}>Aurora Sonnet</span>
        </div>
        <nav className={styles.nav}>
          {nav.slice(0, 2).map(({ to, label, icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                isActive ? `${styles.navLink} ${styles.navLinkActive}` : styles.navLink
              }
            >
              <span className={styles.navIcon}>{icon}</span>
              {label}
            </NavLink>
          ))}
          <div className={styles.navGroup}>
            <button
              type="button"
              className={`${styles.navGroupLabel} ${leadFormsOpen ? styles.navGroupLabelOpen : ''} ${isInLeadForms ? styles.navLinkActive : ''}`}
              onClick={() => setLeadFormsOpen((o) => !o)}
              aria-expanded={leadFormsOpen}
            >
              <span className={styles.navIcon}>✉</span>
              Lead forms
            </button>
            {leadFormsOpen && (
              <div className={styles.navGroupItems}>
                {leadForms.map(({ to, label }) => (
                  <NavLink
                    key={to}
                    to={to}
                    className={({ isActive }) =>
                      isActive ? `${styles.navLink} ${styles.navLinkSub} ${styles.navLinkActive}` : `${styles.navLink} ${styles.navLinkSub}`
                    }
                  >
                    {label}
                  </NavLink>
                ))}
              </div>
            )}
          </div>
          {nav.slice(2).map(({ to, label, icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                isActive ? `${styles.navLink} ${styles.navLinkActive}` : styles.navLink
              }
            >
              <span className={styles.navIcon}>{icon}</span>
              {label}
            </NavLink>
          ))}
        </nav>
        <div className={styles.sidebarFooter}>
          <button
            type="button"
            className={styles.refreshBtn}
            onClick={handleRefresh}
            disabled={refreshing}
            aria-label="Refresh data"
          >
            {refreshing ? 'Refreshing…' : refreshedAt != null ? 'Refreshed' : 'Refresh'}
          </button>
          <span className={styles.badge}>Pro</span>
        </div>
      </aside>
      <main className={styles.main}>
        <Outlet />
      </main>
      <UndoBar />
    </div>
  )
}
