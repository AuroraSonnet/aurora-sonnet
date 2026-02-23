import { Outlet, useLocation } from 'react-router-dom'
import { NavLink } from 'react-router-dom'
import { useState, useEffect } from 'react'
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
  { to: '/bookings', label: 'Bookings', icon: '▷' },
  { to: '/proposals', label: 'Proposals', icon: '◆' },
  { to: '/contracts', label: 'Contracts', icon: '▣' },
  { to: '/invoices', label: 'Invoices', icon: '◎' },
  { to: '/bookkeeping', label: 'Bookkeeping', icon: '◈' },
  { to: '/automations', label: 'Automations', icon: '⚡' },
  { to: '/settings', label: 'Settings', icon: '⚙' },
]

export default function Layout() {
  const location = useLocation()
  const isInLeadForms = leadFormRoutes.some((r) => location.pathname === r)
  const [leadFormsOpen, setLeadFormsOpen] = useState(isInLeadForms)
  useEffect(() => {
    if (isInLeadForms) setLeadFormsOpen(true)
  }, [isInLeadForms])

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
