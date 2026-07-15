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
