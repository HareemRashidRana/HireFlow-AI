// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { makeUser } from '../test/fixtures'
import type { UserRole } from '../types/auth'
import { AuthContext } from './context'
import type { AuthContextValue } from './context'
import { PublicOnly } from './guards'
import { can } from './permissions'

/** A signed-in person arriving at /login with a remembered "requested page". */
function arrive(role: UserRole, from: unknown, extra: Partial<ReturnType<typeof makeUser>> = {}) {
  const user = makeUser(role, extra)
  const auth: AuthContextValue = {
    status: 'authenticated', user, notice: null, error: null,
    login: vi.fn(), logout: vi.fn(), retry: vi.fn(), can: (p) => can(user, p),
  }
  render(
    <MemoryRouter initialEntries={[{ pathname: '/login', state: { from } }]}>
      <AuthContext.Provider value={auth}>
        <Routes>
          <Route path="/login" element={<PublicOnly><p>login form</p></PublicOnly>} />
          <Route path="*" element={<Landed />} />
        </Routes>
      </AuthContext.Provider>
    </MemoryRouter>,
  )
}

import { useLocation } from 'react-router-dom'
function Landed() {
  const l = useLocation()
  return <p data-testid="landed">{l.pathname + l.search}</p>
}
const landed = () => screen.getByTestId('landed').textContent

describe('PublicOnly: after signing in, every role lands on its own dashboard', () => {
  it.each([
    ['admin', '/admin'],
    ['hr_manager', '/hr'],
    ['recruiter', '/recruiter'],
    ['employee', '/employee'],
  ] as const)('%s with no remembered page goes to %s', (role, home) => {
    arrive(role, null)
    expect(landed()).toBe(home)
  })

  it.each([
    ['hr_manager', '/admin', '/hr'],
    ['recruiter', '/admin/users', '/recruiter'],
    ['employee', '/hr', '/employee'],
    ['admin', '/recruiter', '/admin'],
    ['employee', '/recruitment/jobs', '/employee'],
    ['recruiter', '/leave/approvals', '/recruiter'],
  ] as const)('%s who had asked for %s lands on %s', (role, asked, home) => {
    arrive(role, asked)
    expect(landed()).toBe(home)
  })

  it('a deep link the person may open is still honoured', () => {
    arrive('recruiter', '/recruitment/applications/42?tab=history')
    expect(landed()).toBe('/recruitment/applications/42?tab=history')
    arrive('employee', '/leave/requests')
    expect(screen.getAllByTestId('landed').at(-1)?.textContent).toBe('/leave/requests')
  })

  it('an off-site target is ignored', () => {
    arrive('admin', 'https://evil.example/admin')
    expect(landed()).toBe('/admin')
  })

  it('someone who must change their password goes there first, whatever they asked for', () => {
    arrive('admin', '/admin/users', { must_change_password: true })
    expect(landed()).toBe('/change-password')
  })
})
