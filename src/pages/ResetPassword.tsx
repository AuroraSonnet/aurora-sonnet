import { useEffect, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { validateResetToken, resetPassword } from '../api/auth'
import styles from './Login.module.css'

export default function ResetPassword() {
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token') || ''
  const [checking, setChecking] = useState(true)
  const [valid, setValid] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  useEffect(() => {
    let cancelled = false
    if (!token) {
      setChecking(false)
      setValid(false)
      return
    }
    validateResetToken(token).then((ok) => {
      if (!cancelled) {
        setValid(ok)
        setChecking(false)
      }
    })
    return () => {
      cancelled = true
    }
  }, [token])

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }
    setBusy(true)
    try {
      const result = await resetPassword(token, newPassword)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setDone(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.title}>Aurora Sonnet</h1>
        <p className={styles.subtitle}>Reset your password</p>

        {checking ? (
          <p className={styles.recoveryMessage}>Checking your link…</p>
        ) : done ? (
          <>
            <p className={styles.recoveryMessage}>Your password has been reset. You can sign in now.</p>
            <Link to="/login" className={styles.submitBtn} style={{ display: 'block', textAlign: 'center', textDecoration: 'none' }}>
              Go to sign in
            </Link>
          </>
        ) : !valid ? (
          <>
            <p className={styles.error} role="alert">
              This reset link is invalid or has expired. Request a new one from the sign-in page.
            </p>
            <Link to="/login" className={styles.forgotLink} style={{ display: 'block', textAlign: 'center' }}>
              Back to sign in
            </Link>
          </>
        ) : (
          <form className={styles.form} onSubmit={handleSubmit}>
            <label className={styles.label}>
              New password
              <input
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                minLength={8}
                disabled={busy}
              />
            </label>
            <label className={styles.label}>
              Confirm new password
              <input
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                minLength={8}
                disabled={busy}
              />
            </label>
            {error ? (
              <p className={styles.error} role="alert">
                {error}
              </p>
            ) : null}
            <button type="submit" className={styles.submitBtn} disabled={busy}>
              {busy ? 'Saving…' : 'Set new password'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
