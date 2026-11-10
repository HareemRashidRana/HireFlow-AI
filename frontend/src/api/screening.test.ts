import { beforeEach, describe, expect, it, vi } from 'vitest'

const request = vi.fn()
vi.mock('./http', () => ({ request: (...args: unknown[]) => request(...args) }))

import { screeningApi } from './screening'

beforeEach(() => {
  request.mockReset()
  request.mockResolvedValue({})
})

describe('screeningApi', () => {
  it('lists an application\'s assessments and encodes the id', async () => {
    await screeningApi.forApplication('a/b c')
    expect(request).toHaveBeenCalledWith('/applications/a%2Fb%20c/screening', { signal: undefined })
  })

  it('creates with a bare POST: nobody sends a score, a stage or a requester', async () => {
    await screeningApi.create('app-1')
    expect(request).toHaveBeenCalledWith('/applications/app-1/screening', { method: 'POST' })
  })

  it('opens one assessment', async () => {
    await screeningApi.get('x y')
    expect(request).toHaveBeenCalledWith('/screening/x%20y', { signal: undefined })
  })

  it('sends only the judgement, adjustments, reason and note for a review', async () => {
    await screeningApi.review('asm-1', { judgement: 'disagree', adjustments: ['Docker'], adjustment_reason: 'other', note: 'n' })
    expect(request).toHaveBeenCalledWith('/screening/asm-1/reviews', {
      method: 'POST',
      json: { judgement: 'disagree', adjustments: ['Docker'], adjustment_reason: 'other', note: 'n' },
    })
  })

  it('the job overview sends paging parameters and nothing that sorts or filters', async () => {
    await screeningApi.forJob('job-1', 2, 10)
    const [path] = request.mock.calls[0]
    expect(path).toBe('/jobs/job-1/screening?page=2&page_size=10')
    expect(path).not.toMatch(/sort|order|score|filter|min|rank/i)
  })

  it('loads the methodology', async () => {
    await screeningApi.methodology()
    expect(request).toHaveBeenCalledWith('/screening/methodology', { signal: undefined })
  })

  it('exposes no update or delete operation at all', () => {
    expect(Object.keys(screeningApi).sort()).toEqual(['create', 'forApplication', 'forJob', 'get', 'methodology', 'review'])
  })
})
