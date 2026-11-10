import { beforeEach, describe, expect, it, vi } from 'vitest'

const request = vi.fn()
vi.mock('./http', () => ({ request: (...args: unknown[]) => request(...args) }))

import { analyticsApi } from './analytics'

beforeEach(() => {
  request.mockReset()
  request.mockResolvedValue({})
})

describe('analyticsApi', () => {
  it('sends only the filters that are set', async () => {
    await analyticsApi.overview({ start: '2026-03-01', end: '2026-03-31', timezone: 'Asia/Karachi', job_id: '', department: undefined })
    expect(request).toHaveBeenCalledWith('/analytics/overview?start=2026-03-01&end=2026-03-31&timezone=Asia%2FKarachi', { signal: undefined })
  })

  it('encodes a department as data', async () => {
    await analyticsApi.overview({ department: "R&D; DROP TABLE x'" })
    expect(request.mock.calls[0][0]).toBe("/analytics/overview?department=R%26D%3B+DROP+TABLE+x%27")
  })

  it('pages the job table and passes the abort signal', async () => {
    const signal = new AbortController().signal
    await analyticsApi.jobs({ start: '2026-03-01', page: 2, page_size: 8 }, signal)
    expect(request).toHaveBeenCalledWith('/analytics/jobs?start=2026-03-01&page=2&page_size=8', { signal })
  })

  it('reads the filter options from their own path', async () => {
    await analyticsApi.filterOptions()
    expect(request).toHaveBeenCalledWith('/analytics/filter-options', { signal: undefined })
  })

  it('only reads: every call is a GET', async () => {
    await analyticsApi.overview({})
    await analyticsApi.jobs({})
    await analyticsApi.filterOptions()
    expect(request.mock.calls.every((c) => c[1].method === undefined)).toBe(true)
    expect(Object.keys(analyticsApi).sort()).toEqual(['filterOptions', 'jobs', 'overview'])
  })
})
