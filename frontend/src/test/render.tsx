import { render } from '@testing-library/react'
import type { ReactElement } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { vi } from 'vitest'
import { AuthContext } from '../auth/context'
import type { AuthContextValue } from '../auth/context'
import { can } from '../auth/permissions'
import { ToastProvider } from '../components/ui/Toast'
import type { UserRole } from '../types/auth'
import { makeUser } from './fixtures'
import { LocationProbe } from './LocationProbe'

interface Options {
  /** Router pattern the element is mounted at, e.g. "/recruitment/jobs/:id". Default "*". */
  path?: string
  /** URL the test starts at. */
  url?: string
  role?: UserRole
}

/**
 * Renders an element inside a router, a signed-in user (any role) and the toast provider.
 * Navigating anywhere that is not `path` renders a location probe instead of a blank page.
 */
export function renderAs(ui: ReactElement, { path = '*', url = '/', role = 'recruiter' }: Options = {}) {
  const user = makeUser(role)
  const auth: AuthContextValue = {
    status: 'authenticated',
    user,
    notice: null,
    error: null,
    login: vi.fn(),
    logout: vi.fn(),
    retry: vi.fn(),
    can: (permission) => can(user, permission),
  }
  return render(
    <MemoryRouter initialEntries={[url]}>
      <ToastProvider>
        <AuthContext.Provider value={auth}>
          <Routes>
            <Route path={path} element={ui} />
            <Route path="*" element={<LocationProbe />} />
          </Routes>
        </AuthContext.Provider>
      </ToastProvider>
    </MemoryRouter>,
  )
}
