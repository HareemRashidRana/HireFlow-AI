import { describe, expect, it } from 'vitest'
import { makeUser } from '../test/fixtures'
import type { UserRole } from '../types/auth'
import { ROUTE_RULES, canOpenPath, homePath, landingPath, roleHomes } from './permissions'

const roles: UserRole[] = ['admin', 'hr_manager', 'recruiter', 'employee']
const user = (role: UserRole) => makeUser(role)

describe('landingPath: where someone goes right after signing in', () => {
  it.each(roles)('%s with no requested page lands on their own home', (role) => {
    expect(landingPath(user(role), null)).toBe(roleHomes[role])
    expect(landingPath(user(role), undefined)).toBe(roleHomes[role])
  })

  it.each(
    roles.flatMap((role) =>
      Object.values(roleHomes)
        .filter((home) => home !== roleHomes[role])
        .map((home) => [role, home] as const),
    ),
  )('%s who asked for another role\'s dashboard (%s) lands on their own home instead', (role, requested) => {
    expect(landingPath(user(role), requested)).toBe(roleHomes[role])
  })

  it.each([
    ['hr_manager', '/admin/users'],
    ['hr_manager', '/admin/roles'],
    ['recruiter', '/admin/settings'],
    ['recruiter', '/hr/reports'],
    ['recruiter', '/attendance/manage'],
    ['recruiter', '/leave/approvals'],
    ['recruiter', '/settings/work'],
    ['recruiter', '/recruitment/privacy'],
    ['employee', '/dashboard'],
    ['employee', '/employees'],
    ['employee', '/recruitment/jobs'],
    ['employee', '/recruitment/candidates/abc'],
    ['employee', '/recruitment/interviews'],
    ['employee', '/attendance/overview'],
    ['employee', '/admin'],
    ['hr_manager', '/recruiter'],
  ] as const)('%s asking for %s is sent home, never to an access-denied page', (role, requested) => {
    expect(canOpenPath(user(role), requested)).toBe(false)
    expect(landingPath(user(role), requested)).toBe(homePath(user(role)))
  })

  it.each([
    ['admin', '/recruitment/jobs/123'],
    ['admin', '/admin/users'],
    ['admin', '/employees/abc/edit'],
    ['hr_manager', '/leave/approvals'],
    ['hr_manager', '/attendance/manage'],
    ['hr_manager', '/employees'],
    ['recruiter', '/recruitment/applications/42'],
    ['recruiter', '/recruitment/pipeline'],
    ['recruiter', '/recruitment/interviews'],
    ['recruiter', '/dashboard'],
    ['employee', '/leave/requests'],
    ['employee', '/attendance/history'],
    ['employee', '/profile'],
  ] as const)('%s asking for %s keeps their deep link (they may open it)', (role, requested) => {
    expect(landingPath(user(role), requested)).toBe(requested)
  })

  it('keeps a query string and hash on an allowed page', () => {
    expect(landingPath(user('recruiter'), '/recruitment/jobs?status=open#top')).toBe('/recruitment/jobs?status=open#top')
  })

  it('judges a page by its path, not by its query, trailing slash or case-sensitive look-alikes', () => {
    expect(canOpenPath(user('employee'), '/admin?x=1')).toBe(false)
    expect(canOpenPath(user('employee'), '/admin/')).toBe(false)
    expect(canOpenPath(user('employee'), '/hr#section')).toBe(false)
    expect(canOpenPath(user('employee'), '/leave/requests?tab=x')).toBe(true)
  })

  it.each(['//evil.example', 'https://evil.example/admin', 'javascript:alert(1)', '', 'admin', 5, {}, ['/admin']])(
    'refuses a non-path or off-site target (%s) and lands on home',
    (bad) => {
      expect(landingPath(user('admin'), bad)).toBe('/admin')
      expect(landingPath(user('employee'), bad)).toBe('/employee')
    },
  )

  it('every role has a distinct home that its own rules allow', () => {
    expect(new Set(Object.values(roleHomes)).size).toBe(4)
    for (const role of roles) expect(canOpenPath(user(role), roleHomes[role])).toBe(true)
  })

  it('a role home is open to exactly one role', () => {
    for (const home of Object.values(roleHomes)) {
      expect(roles.filter((r) => canOpenPath(user(r), home)).length).toBe(1)
    }
  })
})

describe('the rules table cannot drift from the real route guards', () => {
  const files = import.meta.glob('/src/App.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
  const app = Object.values(files)[0]

  // <Route path="x/:id" element={<RequirePermission permission="p">  or  <RequireRole roles={['a','b']}>
  const guarded = [
    ...app.matchAll(
      /path="([^"]+)"\s+element=\{<Require(?:Permission permission="([^"]+)"|Role roles=\{\[([^\]]*)\]\})/g,
    ),
  ].map(([, path, permission, roleList]) => ({
    path: '/' + path.replace(/:[^/]+/g, 'sample'),
    permission: permission ?? null,
    roles: roleList ? [...roleList.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]) : null,
  }))

  it('actually found the guarded routes in App.tsx', () => {
    expect(guarded.length).toBeGreaterThanOrEqual(30)
  })

  it('every guarded route has a rule with the same requirement', () => {
    for (const g of guarded) {
      const rule = ROUTE_RULES.find((r) => r.pattern.test(g.path))
      expect(rule, `no rule for ${g.path}`).toBeTruthy()
      expect(rule?.permission ?? null, g.path).toBe(g.permission)
      expect(rule?.roles ? [...rule.roles] : null, g.path).toEqual(g.roles)
    }
  })

  it('every rule still describes at least one real guarded route (no dead rules)', () => {
    for (const rule of ROUTE_RULES) {
      expect(guarded.some((g) => rule.pattern.test(g.path)), String(rule.pattern)).toBe(true)
    }
  })

  it('pages App.tsx leaves open have no rule (so a login deep link to them is kept)', () => {
    for (const open of ['/attendance', '/attendance/history', '/leave', '/leave/requests', '/leave/balances', '/leave/calendar', '/profile', '/employees/sample']) {
      expect(ROUTE_RULES.some((r) => r.pattern.test(open)), open).toBe(false)
    }
  })
})
