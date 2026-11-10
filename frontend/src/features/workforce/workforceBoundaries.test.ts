import { describe, expect, it } from 'vitest'

/**
 * Attendance and leave are their own area. These read the source so a future change that mixes them
 * with recruitment data, or lets a person edit their own history, fails here instead of in production.
 */
const files = import.meta.glob('/src/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const strip = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
const sources = Object.entries(files)
  .filter(([p]) => !/\.test\.tsx?$/.test(p) && !p.startsWith('/src/test/'))
  .map(([p, s]) => [p.replace(/^\/src\//, ''), strip(s)] as const)
const workforce = sources.filter(([p]) => p.startsWith('features/workforce/') || p === 'api/workforce.ts' || p === 'types/workforce.ts')
const source = (name: string) => sources.find(([p]) => p.endsWith(name))?.[1] ?? ''

describe('workforce boundaries', () => {
  it('scanned the real source tree and found the workforce files', () => {
    expect(sources.length).toBeGreaterThan(150)
    expect(workforce.length).toBeGreaterThanOrEqual(18)
  })

  it('never touches recruitment, candidates, interviews or screening', () => {
    for (const [p, s] of workforce) {
      expect(s, p).not.toMatch(/api\/(applications|candidates|interviews|jobs|screening|resumes|privacy)/)
      expect(s, p).not.toMatch(/types\/(application|candidate|interview|job|screening|resume)/)
    }
  })

  it('the employee-facing pages never call an HR-only endpoint', () => {
    for (const name of ['AttendancePage.tsx', 'AttendanceHistoryPage.tsx', 'MyLeavePage.tsx']) {
      const s = source(`pages/${name}`)
      expect(s.length, name).toBeGreaterThan(100)
      expect(s, name).not.toMatch(/attendanceApi\.(records|summary|stats|addRecord|correct|corrections)/)
      expect(s, name).not.toMatch(/leaveApi\.(list|approve|reject|allocate|adjust|stats|balances)\b/)
    }
  })

  it('there is no route that edits or deletes your own attendance', () => {
    const api = source('api/workforce.ts')
    expect(api).not.toMatch(/\/attendance\/me[^\n]*method:\s*'(PUT|PATCH|DELETE)'/)
    expect(api).not.toMatch(/method:\s*'DELETE'[^\n]*attendance/)
  })

  it('only the app shell and the dashboard panel reference the workforce area', () => {
    const users = sources
      .filter(([p, s]) => !p.startsWith('features/workforce/') && p !== 'api/workforce.ts' && p !== 'types/workforce.ts' && /(features\/workforce\/|api\/workforce|types\/workforce)/.test(s))
      .map(([p]) => p)
      .sort()
    expect(users).toEqual(['App.tsx', 'features/dashboard/components/WorkforcePanel.tsx'])
  })
})
