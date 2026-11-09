import { createContext } from 'react'
import type { AuthUser } from '../types/auth'
import type { Permission } from './permissions'
import type { EndReason } from './session'

export interface AuthState {
  /**
   * loading: restoring the session on page load
   * error: could not reach the server while restoring (not the same as "signed out")
   */
  status: 'loading' | 'authenticated' | 'unauthenticated' | 'error'
  user: AuthUser | null
  /** Why the last session ended, so the login page can explain it. null = nothing to say. */
  notice: Exclude<EndReason, 'none'> | null
  error: string | null
}

export interface AuthContextValue extends AuthState {
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  /** Try restoring the session again after a connection error. */
  retry: () => void
  can: (permission: Permission) => boolean
}

export const AuthContext = createContext<AuthContextValue | null>(null)
