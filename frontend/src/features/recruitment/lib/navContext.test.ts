import { describe, expect, it } from 'vitest'
import { backLabel, cleanFilterValue, countActiveFilters, safeFrom, sharedFilterQuery } from './navContext'

describe('cleanFilterValue', () => {
  it.each([
    ['job', 'abc-123', 'abc-123'],
    ['job', '../../etc/passwd', ''],
    ['job', '<script>', ''],
    ['job', 'x'.repeat(65), ''],
    ['recruiter', '8f31a53-9b6d', '8f31a53-9b6d'],
    ['source', 'referral', 'referral'],
    ['source', 'carrier-pigeon', ''],
    ['stage', 'interview', 'interview'],
    ['stage', 'promoted', ''],
    ['from', '2026-11-03', '2026-11-03'],
    ['from', 'yesterday', ''],
    ['to', '2026-1-3', ''],
  ] as const)('%s=%j -> %j', (key, value, expected) => {
    expect(cleanFilterValue(key, value)).toBe(expected)
  })

  it('treats a missing value as empty', () => {
    expect(cleanFilterValue('job', null)).toBe('')
  })
})

describe('sharedFilterQuery', () => {
  it('keeps only valid shared filters, in a stable order', () => {
    const p = new URLSearchParams('to=2026-02-01&job=j1&junk=1&source=agency&page=3&stage=hired&from=oops')
    expect(sharedFilterQuery(p)).toBe('?job=j1&source=agency&to=2026-02-01')
  })

  it('is empty when nothing is set', () => {
    expect(sharedFilterQuery(new URLSearchParams('page=2'))).toBe('')
  })

  it('never carries a search term, whatever the parameter is called', () => {
    expect(sharedFilterQuery(new URLSearchParams('q=sana&search=sana&name=sana&email=a@b.co'))).toBe('')
  })

  it('can add known extras', () => {
    expect(sharedFilterQuery(new URLSearchParams('job=j1'), { stage: 'hired' })).toBe('?job=j1&stage=hired')
  })
})

describe('countActiveFilters', () => {
  it('counts filled filters and the search box', () => {
    expect(countActiveFilters({ job: 'j', source: '', from: '2026-01-01' }, false)).toBe(2)
    expect(countActiveFilters({ job: '', source: '' }, true)).toBe(1)
    expect(countActiveFilters({}, false)).toBe(0)
  })
})

describe('safeFrom (where "back" may go)', () => {
  it.each([
    [{ from: '/recruitment/pipeline?job=j1' }, '/recruitment/pipeline?job=j1'],
    [{ from: '/recruitment/applications?stage=hired' }, '/recruitment/applications?stage=hired'],
    [{ from: 'https://evil.example/recruitment/x' }, null],
    [{ from: '//evil.example/recruitment/' }, null],
    [{ from: '/employees' }, null],
    [{ from: '/recruitment' }, null],
    [{ from: 5 }, null],
    [{}, null],
    [null, null],
    ['/recruitment/pipeline', null],
  ])('%j -> %j', (state, expected) => {
    expect(safeFrom(state)).toBe(expected)
  })
})

describe('backLabel', () => {
  it('names the place the user came from', () => {
    expect(backLabel('/recruitment/pipeline?job=j1', 'All')).toBe('Back to pipeline')
    expect(backLabel('/recruitment/applications?stage=hired', 'All')).toBe('Back to applications')
    expect(backLabel('/recruitment/candidates/c1', 'All')).toBe('Back to candidate')
  })

  it('falls back when there is nowhere specific', () => {
    expect(backLabel(null, 'All applications')).toBe('All applications')
    expect(backLabel('/recruitment/jobs/j1', 'All applications')).toBe('All applications')
  })
})
