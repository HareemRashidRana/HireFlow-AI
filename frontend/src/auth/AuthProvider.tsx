import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { ApiError } from '../api/errors'
import { AuthContext } from './context'
import type { AuthContextValue, AuthState } from './context'
import { can } from './permissions'
import type { Permission } from './permissions'
import { session } from './sessionInstance'

/**
 * Holds the signed-in USER for the UI. The access token itself is never put in React state: it
 * stays inside the session manager's memory.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    status: 'loading',
    user: null,
    notice: null,
    error: null,
  })

  // Restore the session from the HttpOnly refresh cookie. Concurrent calls (React StrictMode
  // mounts effects twice in development) share one request thanks to single-flight refresh.
  const restore = useCallback(() => {
    session.refresh().catch((error: unknown) => {
      // 401 just means "not signed in": the 'ended' event below moves us to the login page.
      if (error instanceof ApiError && error.status === 401) return
      setState({
        status: 'error',
        user: null,
        notice: null,
        error: error instanceof Error ? error.message : 'Could not reach the server.',
      })
    })
  }, [])

  // After a connection error the user can retry: show the loading screen again first.
  const retry = useCallback(() => {
    setState((s) => ({ ...s, status: 'loading', error: null }))
    restore()
  }, [restore])

  useEffect(() => {
    const unsubscribe = session.subscribe((event) => {
      if (event.type === 'ended') {
        setState({
          status: 'unauthenticated',
          user: null,
          notice: event.reason === 'none' ? null : event.reason,
          error: null,
        })
      } else {
        setState({ status: 'authenticated', user: event.user, notice: null, error: null })
      }
    })
    restore()
    return unsubscribe
  }, [restore])

  const login = useCallback(async (email: string, password: string) => {
    await session.login(email, password) // the 'authenticated' event updates the state
  }, [])

  const logout = useCallback(async () => {
    await session.logout() // throws if the server could not be reached: the user stays signed in
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      ...state,
      login,
      logout,
      retry,
      can: (permission: Permission) => can(state.user, permission),
    }),
    [state, login, logout, retry],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
