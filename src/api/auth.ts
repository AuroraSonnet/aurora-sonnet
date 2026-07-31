const API = '/api'

export type AuthUser = {
  authenticated: boolean
  username: string | null
}

export async function fetchAuthMe(): Promise<AuthUser> {
  try {
    const res = await fetch(`${API}/me`, { credentials: 'include' })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      return { authenticated: false, username: null, ...data }
    }
    return res.json()
  } catch {
    return { authenticated: false, username: null }
  }
}

export async function login(username: string, password: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch(`${API}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ username, password }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      return { ok: false, error: typeof data.error === 'string' ? data.error : 'Login failed.' }
    }
    return { ok: true }
  } catch {
    return { ok: false, error: 'Could not reach the server. Try again.' }
  }
}

export async function logout(): Promise<boolean> {
  try {
    const res = await fetch(`${API}/logout`, {
      method: 'POST',
      credentials: 'include',
    })
    return res.ok
  } catch {
    return false
  }
}

export async function requestPasswordReset(): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch(`${API}/forgot-password`, { method: 'POST' })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      return { ok: false, error: typeof data.error === 'string' ? data.error : 'Could not send recovery email.' }
    }
    return { ok: true }
  } catch {
    return { ok: false, error: 'Could not reach the server. Try again.' }
  }
}

export async function validateResetToken(token: string): Promise<boolean> {
  try {
    const res = await fetch(`${API}/reset-password/validate?token=${encodeURIComponent(token)}`)
    const data = await res.json().catch(() => ({}))
    return Boolean(data.valid)
  } catch {
    return false
  }
}

export async function resetPassword(
  token: string,
  newPassword: string
): Promise<{ ok: true; username: string } | { ok: false; error: string }> {
  try {
    const res = await fetch(`${API}/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, newPassword }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      return { ok: false, error: typeof data.error === 'string' ? data.error : 'Could not reset password.' }
    }
    return { ok: true, username: data.username || '' }
  } catch {
    return { ok: false, error: 'Could not reach the server. Try again.' }
  }
}
