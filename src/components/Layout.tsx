import { Outlet, useLocation } from 'react-router-dom'
import { NavLink } from 'react-router-dom'
import { useState, useEffect, useRef } from 'react'
import { useApp } from '../context/AppContext'
import { useAuth } from '../context/AuthContext'
import { getInquiryApiBaseUrl } from '../utils/inquiryApiUrl'
import UndoBar from './UndoBar'
import styles from './Layout.module.css'

const nav = [
  { to: '/', label: 'Dashboard', icon: '◉', match: ['/'] },
  { to: '/bookings-hub', label: 'Bookings', icon: '▷', match: ['/bookings-hub', '/bookings', '/clients', '/proposals'] },
  { to: '/partner-referrals', label: 'Partners', icon: '⇄', match: ['/partner-referrals'] },
  { to: '/marketing', label: 'Marketing', icon: '☀', match: ['/marketing', '/outreach-today', '/partnership-outreach', '/outreach-scoreboard'] },
  { to: '/contracts', label: 'Contracts', icon: '▣', match: ['/contracts', '/templates'] },
  { to: '/finances', label: 'Finances', icon: '◎', match: ['/finances', '/invoices', '/bookkeeping', '/monthly-targets'] },
  { to: '/calendar', label: 'Calendar', icon: '📅', match: ['/calendar'] },
  { to: '/settings', label: 'Settings', icon: '⚙', match: ['/settings', '/experiences', '/newsletter', '/automations', '/inquire', '/inquire-duo', '/inquire-combined', '/inquire-general', '/music-selection'] },
]

function navItemActive(pathname: string, item: { to: string; match: string[] }): boolean {
  if (item.to === '/') return pathname === '/'
  return item.match.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
}

export default function Layout() {
  const location = useLocation()
  const { actions } = useApp()
  const { logout, username } = useAuth()
  const [menuOpen, setMenuOpen] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshedAt, setRefreshedAt] = useState<number | null>(null)
  const hasAutoSynced = useRef(false)

  useEffect(() => {
    setMenuOpen(false)
  }, [location.pathname])

  const handleRefresh = async () => {
    if (refreshing) return
    setRefreshing(true)
    try {
      await actions.syncInquiriesFromWebsite()
      await actions.refreshPartnerReferralsRemote()
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
        <button
          type="button"
          className={styles.menuBtn}
          aria-expanded={menuOpen}
          aria-controls="admin-nav"
          onClick={() => setMenuOpen((open) => !open)}
        >
          {menuOpen ? 'Close' : 'Menu'}
        </button>
        <nav id="admin-nav" className={menuOpen ? `${styles.nav} ${styles.navOpen}` : styles.nav}>
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={() =>
                navItemActive(location.pathname, item)
                  ? `${styles.navLink} ${styles.navLinkActive}`
                  : styles.navLink
              }
            >
              <span className={styles.navIcon}>{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className={menuOpen ? `${styles.sidebarFooter} ${styles.footerOpen}` : styles.sidebarFooter}>
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
          {username ? <span className={styles.userLabel}>{username}</span> : null}
          <button type="button" className={styles.logoutBtn} onClick={() => logout()}>
            Log out
          </button>
        </div>
      </aside>
      <main className={styles.main}>
        <Outlet />
      </main>
      <UndoBar />
    </div>
  )
}
