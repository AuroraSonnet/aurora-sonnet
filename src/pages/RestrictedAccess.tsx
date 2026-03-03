import { useLocation } from 'react-router-dom'
import styles from './RestrictedAccess.module.css'

/**
 * Shown when someone opens a non-public path on the deployed app (e.g. Render).
 * Only /invoices/view/:id, /sign/:id, and /embed/* are public; everything else shows this.
 */
export default function RestrictedAccess() {
  const { pathname } = useLocation()
  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.title}>Access restricted</h1>
        <p className={styles.text}>
          This area is private. If you have a link from your email to view an invoice or sign a contract, use that link directly.
        </p>
        <p className={styles.muted}>
          You tried to open: <code>{pathname || '/'}</code>
        </p>
      </div>
    </div>
  )
}
