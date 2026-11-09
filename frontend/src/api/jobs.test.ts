import { beforeEach, describe, expect, it, vi } from 'vitest'

const request = vi.fn()
vi.mock('./http', () => ({ request: (...args: unknown[]) => request(...args) }))

import { jobsApi } from './jobs'
import { toQuery } from './query'

beforeEach(() => {
  request.mockReset()
  request.mockResolvedValue({})
})

describe('toQuery', () => {
  it('skips undefined, null and empty values', () => {
    expect(toQuery({ q: '', status: undefined, department: null, page: 2 })).toBe('?page=2')
  })

  it('returns an empty string when nothing is set', () => {
    expect(toQuery({})).toBe('')
    expect(toQuery({ q: '' })).toBe('')
  })

  it('keeps 0 and false, and encodes special characters', () => {
    expect(toQuery({ n: 0, flag: false, q: 'a b&c' })).toBe('?n=0&flag=false&q=a+b%26c')
  })
})

describe('jobsApi', () => {
  it('lists with only the filters that are set', async () => {
    await jobsApi.list({ q: 'eng', status: 'open', department: '', employment_type: '', page: 2, page_size: 10 })
    expect(request).toHaveBeenCalledWith('/jobs?q=eng&status=open&page=2&page_size=10', { signal: undefined })
  })

  it('lists everything when no params are given', async () => {
    await jobsApi.list({})
    expect(request).toHaveBeenCalledWith('/jobs', { signal: undefined })
  })

  it('passes the abort signal through', async () => {
    const controller = new AbortController()
    await jobsApi.list({}, controller.signal)
    expect(request).toHaveBeenCalledWith('/jobs', { signal: controller.signal })
  })

  it('gets one job and encodes the id', async () => {
    await jobsApi.get('a/b c')
    expect(request).toHaveBeenCalledWith('/jobs/a%2Fb%20c', { signal: undefined })
  })

  it('loads department suggestions', async () => {
    await jobsApi.departments()
    expect(request).toHaveBeenCalledWith('/jobs/departments', { signal: undefined })
  })

  it('creates with POST', async () => {
    const data = { title: 'T', department: 'D', location: 'L', employment_type: 'intern' as const }
    await jobsApi.create(data)
    expect(request).toHaveBeenCalledWith('/jobs', { method: 'POST', json: data })
  })

  it('updates with PATCH', async () => {
    await jobsApi.update('j1', { title: 'New' })
    expect(request).toHaveBeenCalledWith('/jobs/j1', { method: 'PATCH', json: { title: 'New' } })
  })

  it('changes status through its own endpoint', async () => {
    await jobsApi.changeStatus('j1', 'on_hold')
    expect(request).toHaveBeenCalledWith('/jobs/j1/status', { method: 'POST', json: { status: 'on_hold' } })
  })

  it('deletes with DELETE', async () => {
    await jobsApi.remove('j1')
    expect(request).toHaveBeenCalledWith('/jobs/j1', { method: 'DELETE' })
  })
})
