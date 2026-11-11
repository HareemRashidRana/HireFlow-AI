import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { AccessDenied, ConnectionProblem, SplashScreen } from '../components/layout/Screens'
import { homePath, landingPath } from './permissions'
import type { UserRole } from '../types/auth'
import type { Permission } from './permissions'
import { useAuth } from './useAuth'

/** Everything inside requires a signed-in user. */
export function RequireAuth({
  children,
  allowPasswordChange = false,
}: {
  children: ReactNode
  /** Only the change-password page sets this: other pages are blocked until the password is changed. */
  allowPasswordChange?: boolean
}) {
  const auth = useAuth()
  const location = useLocation()

  if (auth.status === 'loading') return <SplashScreen />
  if (auth.status === 'error')
    return <ConnectionProblem message={auth.error ?? 'Could not reach the server.'} onRetry={auth.retry} />

  if (auth.status === 'unauthenticated' || !auth.user) {
    // Remember where they were going, except after an explicit sign-out / password change
    // (the next person to sign in on this device may be someone else).
    const keepPlace = auth.notice !== 'signed-out' && auth.notice !== 'password-changed'
    return (
      <Navigate
        to="/login"
        replace
        state={{ from: keepPlace ? location.pathname + location.search : null, notice: auth.notice }}
      />
    )
  }

  if (auth.user.must_change_password && !allowPasswordChange) {
    return <Navigate to="/change-password" replace />
  }
  return children
}

/** The login page itself: signed-in users are sent on to where they were headed. */
export function PublicOnly({ children }: { children: ReactNode }) {
  const auth = useAuth()
  const location = useLocation()

  if (auth.status === 'loading') return <SplashScreen />
  if (auth.status === 'error')
    return <ConnectionProblem message={auth.error ?? 'Could not reach the server.'} onRetry={auth.retry} />

  if (auth.status === 'authenticated' && auth.user) {
    if (auth.user.must_change_password) return <Navigate to="/change-password" replace />
    // Only go back to the requested page if THIS person's role can open it; otherwise their own home.
    return <Navigate to={landingPath(auth.user, (location.state as { from?: unknown } | null)?.from)} replace />
  }
  return children
}

/** Renders an access-denied page instead of the children when the role lacks the permission. */
export function RequirePermission({ permission, children }: { permission: Permission; children: ReactNode }) {
  const { can } = useAuth()
  return can(permission) ? children : <AccessDenied />
}

/**
 * A panel's own landing pages: only people in that role may open them. (Their data routes, such as
 * the user list, are separately protected by the server.)
 */
export function RequireRole({ roles, children }: { roles: UserRole[]; children: ReactNode }) {
  const { user } = useAuth()
  return user && roles.includes(user.role) ? children : <AccessDenied />
}

/** "/" sends each role to its own home page. */
export function HomeRedirect() {
  const { user } = useAuth()
  return <Navigate to={user ? homePath(user) : '/login'} replace />
}
