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
  { to: '/bookings', label: 'Bookings', icon: '▷' },
  { to: '/clients', label: 'Clients', icon: '◇' },
  { to: '/proposals', label: 'Proposals', icon: '◆' },
  { to: '/contracts', label: 'Contracts', icon: '▣' },
  { to: '/invoices', label: 'Invoices', icon: '◎' },
  { to: '/calendar', label: 'Calendar', icon: '📅' },
  { to: '/experiences', label: 'Experiences', icon: '✦' },
  { to: '/music-selection', label: 'Repertoire', icon: '♪' },
  { to: '/newsletter', label: 'Newsletter', icon: '✉' },
  { to: '/bookkeeping', label: 'Bookkeeping', icon: '◈' },
  { to: '/monthly-targets', label: 'Monthly Targets', icon: '◌' },
  { to: '/automations', label: 'Automations', icon: '⚡' },
  { to: '/settings', label: 'Settings', icon: '⚙' },
]
const navBeforeLeadForms = 10 // Dashboard through Repertoire, then Lead forms

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
      await actions.syncInquiriesFromWebsite()
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

  // Daily backup from server to Mac (Electron only): once per 24h, fetch state and save to Application Support/backups
  useEffect(() => {
    const api = (window as unknown as { electronAPI?: { saveBackup: (data: string) => Promise<{ ok?: boolean; error?: string }> } }).electronAPI
    if (!api?.saveBackup) return
    const key = 'aurora_last_backup_ts'
    const raw = localStorage.getItem(key)
    const last = raw ? parseInt(raw, 10) : 0
    if (Number.isNaN(last)) return
    const dayMs = 24 * 60 * 60 * 1000
    if (last > 0 && Date.now() - last < dayMs) return
    const base = getInquiryApiBaseUrl()
    if (!base || !base.startsWith('http')) return
    const t = setTimeout(async () => {
      try {
        let res = await fetch(`/api/proxy-remote-state?base=${encodeURIComponent(base)}`)
        if (!res.ok) res = await fetch(`${base}/api/state`)
        if (!res.ok) return
        const data = await res.json().catch(() => null)
        if (!data || !Array.isArray(data.clients)) return
        const result = await api.saveBackup(JSON.stringify(data, null, 2))
        if (result?.ok !== true) return
        localStorage.setItem(key, String(Date.now()))
      } catch {
        // ignore; will retry next app open
      }
    }, 5000)
    return () => clearTimeout(t)
  }, [])

  return (
    <div className={styles.layout}>
      <aside className={styles.sidebar}>
        <div className={styles.logo}>
          <span className={styles.logoIcon}>Aurora Sonnet</span>
        </div>
        <nav className={styles.nav}>
          {nav.slice(0, navBeforeLeadForms).map(({ to, label, icon }) => (
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
          {nav.slice(navBeforeLeadForms).map(({ to, label, icon }) => (
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
            aria-label="Sync inquiries from website"
          >
            {refreshing ? 'Syncing…' : refreshedAt != null ? 'Synced' : 'Sync inquiries'}
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
