import { useState, type FormEvent } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { requestPasswordReset } from '../api/auth'
import styles from './Login.module.css'

export default function Login() {
  const { authenticated, loading, login } = useAuth()
  const location = useLocation()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [recoveryBusy, setRecoveryBusy] = useState(false)
  const [recoveryMessage, setRecoveryMessage] = useState('')

  const from = (location.state as { from?: string } | null)?.from || '/'

  if (!loading && authenticated) {
    return <Navigate to={from} replace />
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      const result = await login(username.trim(), password)
      if (!result.ok) setError(result.error)
    } finally {
      setBusy(false)
    }
  }

  const handleForgotPassword = async () => {
    setRecoveryMessage('')
    setRecoveryBusy(true)
    try {
      const result = await requestPasswordReset()
      setRecoveryMessage(
        result.ok
          ? 'If account recovery is configured, check that inbox for a link to sign in and set a new password.'
          : result.error
      )
    } finally {
      setRecoveryBusy(false)
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.title}>Aurora Sonnet</h1>
        <p className={styles.subtitle}>Sign in to your CRM</p>
        <form className={styles.form} onSubmit={handleSubmit}>
          <label className={styles.label}>
            Username
            <input
              type="text"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              disabled={busy || loading}
            />
          </label>
          <label className={styles.label}>
            Password
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={busy || loading}
            />
          </label>
          {error ? (
            <p className={styles.error} role="alert">
              {error}
            </p>
          ) : null}
          <button type="submit" className={styles.submitBtn} disabled={busy || loading}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        <button
          type="button"
          className={styles.forgotLink}
          onClick={handleForgotPassword}
          disabled={recoveryBusy}
        >
          {recoveryBusy ? 'Sending…' : 'Forgot username or password?'}
        </button>
        {recoveryMessage ? <p className={styles.recoveryMessage}>{recoveryMessage}</p> : null}
      </div>
    </div>
  )
}
