import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { validateResetToken, resetPassword } from '../api/auth'
import styles from './Login.module.css'

// Chrome treats the first password box on this site as the saved login and can
// write that shorter password over what was typed. Keep the field locked until
// the user focuses it, and don't let a saved login impose its length.
function unlockPasswordField(field: HTMLInputElement) {
  field.readOnly = false
  field.removeAttribute('maxlength')
  field.maxLength = 2048
}

export default function ResetPassword() {
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token') || ''
  const newPasswordRef = useRef<HTMLInputElement>(null)
  const confirmPasswordRef = useRef<HTMLInputElement>(null)
  const [checking, setChecking] = useState(true)
  const [valid, setValid] = useState(false)
  const [newUnlocked, setNewUnlocked] = useState(false)
  const [confirmUnlocked, setConfirmUnlocked] = useState(false)
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
    const newPassword = newPasswordRef.current?.value ?? ''
    const confirmPassword = confirmPasswordRef.current?.value ?? ''
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
          <form className={styles.form} onSubmit={handleSubmit} noValidate autoComplete="off">
            <label className={styles.label}>
              New password
              <input
                ref={newPasswordRef}
                type="password"
                name="new-password"
                autoComplete="new-password"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                readOnly={!newUnlocked}
                onMouseDown={(event) => {
                  setNewUnlocked(true)
                  unlockPasswordField(event.currentTarget)
                }}
                onFocus={(event) => {
                  setNewUnlocked(true)
                  unlockPasswordField(event.currentTarget)
                }}
                onKeyDown={(event) => unlockPasswordField(event.currentTarget)}
                onBeforeInput={(event) => unlockPasswordField(event.currentTarget)}
                required
                disabled={busy}
              />
            </label>
            <label className={styles.label}>
              Confirm new password
              <input
                ref={confirmPasswordRef}
                type="password"
                name="confirm-password"
                autoComplete="new-password"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                readOnly={!confirmUnlocked}
                onMouseDown={(event) => {
                  setConfirmUnlocked(true)
                  unlockPasswordField(event.currentTarget)
                }}
                onFocus={(event) => {
                  setConfirmUnlocked(true)
                  unlockPasswordField(event.currentTarget)
                }}
                onKeyDown={(event) => unlockPasswordField(event.currentTarget)}
                onBeforeInput={(event) => unlockPasswordField(event.currentTarget)}
                required
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
