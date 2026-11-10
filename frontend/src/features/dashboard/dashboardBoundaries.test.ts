import { describe, expect, it } from 'vitest'

/**
 * The dashboard shows aggregates only. These read the source so that a future change which pulls in
 * a person's details, or a write call, fails here instead of in production.
 */
const files = import.meta.glob('/src/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const strip = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
const sources = Object.entries(files)
  .filter(([p]) => !/\.test\.tsx?$/.test(p) && !p.startsWith('/src/test/'))
  .map(([p, s]) => [p.replace(/^\/src\//, ''), strip(s)] as const)
const dashboard = sources.filter(([p]) => p.startsWith('features/dashboard/') || p === 'api/analytics.ts' || p === 'types/analytics.ts')

describe('dashboard boundaries', () => {
  it('scanned the real source tree and found the dashboard files', () => {
    expect(sources.length).toBeGreaterThan(100)
    expect(dashboard.length).toBeGreaterThanOrEqual(10)
  })

  it("never handles an applicant's name, email, phone or note (only the signed-in user's own email is shown)", () => {
    for (const [p, s] of dashboard) {
      expect(s.replaceAll('user.email', ''), p).not.toMatch(/first_name|last_name|\bemail\b|\bphone\b|internal_notes|candidate_name|feedback|private_notes/)
    }
  })

  it('never writes: no create, update or delete calls and no non-GET verbs', () => {
    for (const [p, s] of dashboard) {
      expect(s, p).not.toMatch(/method:\s*['"](POST|PUT|PATCH|DELETE)/)
      expect(s, p).not.toMatch(/\b(applicationsApi|candidatesApi|interviewsApi|jobsApi|employeesApi)\b/)
    }
  })

  it('does not rank or score people', () => {
    for (const [p, s] of dashboard) expect(s, p).not.toMatch(/leaderboard|\branking\b|top performer|best candidate|score/i)
  })

  it('only the app shell, sidebar and permissions reference the dashboard', () => {
    const users = sources.filter(([p, s]) => !p.startsWith('features/dashboard/') && /features\/dashboard\//.test(s)).map(([p]) => p)
    expect(users).toEqual(['App.tsx'])
  })
})
