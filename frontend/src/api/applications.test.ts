import { beforeEach, describe, expect, it, vi } from 'vitest'

const request = vi.fn()
vi.mock('./http', () => ({ request: (...args: unknown[]) => request(...args) }))

import { applicationsApi } from './applications'

beforeEach(() => {
  request.mockReset()
  request.mockResolvedValue({})
})

describe('applicationsApi', () => {
  it('lists with only the filters that are set', async () => {
    await applicationsApi.list({ q: 'sana', stage: 'screening', job_id: 'j1', recruiter_id: '', source: '', page: 2, page_size: 10 })
    expect(request).toHaveBeenCalledWith('/applications?q=sana&stage=screening&job_id=j1&page=2&page_size=10', { signal: undefined })
  })

  it('sends the date range and candidate filter', async () => {
    await applicationsApi.list({ candidate_id: 'c1', applied_from: '2026-01-01', applied_to: '2026-01-31' })
    expect(request).toHaveBeenCalledWith('/applications?candidate_id=c1&applied_from=2026-01-01&applied_to=2026-01-31', { signal: undefined })
  })

  it('lists everything when no params are given', async () => {
    await applicationsApi.list({})
    expect(request).toHaveBeenCalledWith('/applications', { signal: undefined })
  })

  it('fetches the board, summary and recruiters from their own paths', async () => {
    const signal = new AbortController().signal
    await applicationsApi.board({ job_id: 'j1' }, signal)
    await applicationsApi.summary(signal)
    await applicationsApi.recruiters(signal)
    expect(request.mock.calls).toEqual([
      ['/applications/board?job_id=j1', { signal }],
      ['/applications/summary', { signal }],
      ['/applications/recruiters', { signal }],
    ])
  })

  it('gets one application and encodes the id', async () => {
    await applicationsApi.get('a/b c')
    expect(request).toHaveBeenCalledWith('/applications/a%2Fb%20c', { signal: undefined })
  })

  it('creates with POST', async () => {
    await applicationsApi.create({ candidate_id: 'c1', job_id: 'j1' })
    expect(request).toHaveBeenCalledWith('/applications', { method: 'POST', json: { candidate_id: 'c1', job_id: 'j1' } })
  })

  it('updates assignment and notes with PATCH, and can clear them with null', async () => {
    await applicationsApi.update('a1', { assigned_recruiter_id: null, internal_notes: 'x' })
    expect(request).toHaveBeenCalledWith('/applications/a1', {
      method: 'PATCH',
      json: { assigned_recruiter_id: null, internal_notes: 'x' },
    })
  })

  it('changes the stage on the dedicated endpoint, never through PATCH', async () => {
    await applicationsApi.changeStage('a1', 'screening')
    await applicationsApi.changeStage('a1', 'rejected', 'Missing skills')
    expect(request.mock.calls).toEqual([
      ['/applications/a1/stage', { method: 'POST', json: { stage: 'screening' } }],
      ['/applications/a1/stage', { method: 'POST', json: { stage: 'rejected', note: 'Missing skills' } }],
    ])
  })

  it('reopens with POST, with or without a note', async () => {
    await applicationsApi.reopen('a1')
    await applicationsApi.reopen('a1', 'Available again')
    expect(request.mock.calls).toEqual([
      ['/applications/a1/reopen', { method: 'POST', json: {} }],
      ['/applications/a1/reopen', { method: 'POST', json: { note: 'Available again' } }],
    ])
  })

  it('has no way to delete an application', () => {
    expect(Object.keys(applicationsApi)).not.toContain('remove')
    expect(Object.keys(applicationsApi)).not.toContain('delete')
  })
})
