import { NavLink, Outlet } from 'react-router-dom'
import styles from './AreaTabs.module.css'

export type AreaTab = { to: string; label: string; end?: boolean }

export default function AreaTabs({ tabs }: { tabs: AreaTab[] }) {
  return (
    <div className={styles.wrap}>
      <nav className={styles.tabs} aria-label="Section">
        {tabs.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.end}
            className={({ isActive }) => (isActive ? `${styles.tab} ${styles.tabActive}` : styles.tab)}
          >
            {tab.label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </div>
  )
}
