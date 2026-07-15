import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { fetchAuthMe, login as apiLogin, logout as apiLogout } from '../api/auth'

type AuthContextValue = {
  authenticated: boolean
  username: string | null
  loading: boolean
  login: (username: string, password: string) => Promise<{ ok: true } | { ok: false; error: string }>
  logout: () => Promise<void>
  refresh: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [authenticated, setAuthenticated] = useState(false)
  const [username, setUsername] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    const me = await fetchAuthMe()
    setAuthenticated(Boolean(me.authenticated))
    setUsername(me.username ?? null)
  }, [])

  useEffect(() => {
    let cancelled = false
    refresh().finally(() => {
      if (!cancelled) setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [refresh])

  const login = useCallback(async (user: string, pass: string) => {
    const result = await apiLogin(user, pass)
    if (result.ok) {
      await refresh()
    }
    return result
  }, [refresh])

  const logout = useCallback(async () => {
    await apiLogout()
    setAuthenticated(false)
    setUsername(null)
  }, [])

  return (
    <AuthContext.Provider value={{ authenticated, username, loading, login, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
