import { beforeEach, describe, expect, it, vi } from 'vitest'

const request = vi.fn()
vi.mock('./http', () => ({ request: (...args: unknown[]) => request(...args) }))

import { interviewsApi } from './interviews'

beforeEach(() => {
  request.mockReset()
  request.mockResolvedValue({})
})

describe('interviewsApi', () => {
  it('lists with only the filters that are set', async () => {
    await interviewsApi.list({ q: 'sana', status: 'scheduled', interviewer_id: 'me', page: 2, page_size: 10 })
    expect(request).toHaveBeenCalledWith('/interviews?q=sana&status=scheduled&interviewer_id=me&page=2&page_size=10', { signal: undefined })
    await interviewsApi.list({})
    expect(request).toHaveBeenLastCalledWith('/interviews', { signal: undefined })
  })

  it('reads the application list, the detail and the fixed collections from their own paths', async () => {
    const signal = new AbortController().signal
    await interviewsApi.forApplication('a/1', signal)
    await interviewsApi.get('i 1', signal)
    await interviewsApi.stats(signal)
    await interviewsApi.interviewers(signal)
    await interviewsApi.ratingScale(signal)
    await interviewsApi.history('i1', signal)
    await interviewsApi.feedback('i1', signal)
    await interviewsApi.revisions('i1', 'f1', signal)
    expect(request.mock.calls.map((c) => c[0])).toEqual([
      '/applications/a%2F1/interviews', '/interviews/i%201', '/interviews/stats', '/interviews/interviewers', '/interviews/rating-scale',
      '/interviews/i1/history', '/interviews/i1/feedback', '/interviews/i1/feedback/f1/revisions',
    ])
  })

  it('uses the right verbs for each lifecycle action', async () => {
    await interviewsApi.create({ title: 't' } as never)
    await interviewsApi.update('i1', { title: 'x' })
    await interviewsApi.confirm('i1')
    await interviewsApi.complete('i1')
    await interviewsApi.cancel('i1', 'because')
    await interviewsApi.reschedule('i1', { starts_at: 'a', ends_at: 'b', timezone: 'UTC', reason: null })
    await interviewsApi.addInterviewer('i1', 'u1')
    await interviewsApi.removeInterviewer('i1', 'u1')
    expect(request.mock.calls.map((c) => `${c[1].method ?? 'GET'} ${c[0]}`)).toEqual([
      'POST /interviews', 'PATCH /interviews/i1', 'POST /interviews/i1/confirm', 'POST /interviews/i1/complete', 'POST /interviews/i1/cancel',
      'POST /interviews/i1/reschedule', 'POST /interviews/i1/interviewers', 'DELETE /interviews/i1/interviewers/u1',
    ])
    expect(request.mock.calls[4][1].json).toEqual({ reason: 'because' })
  })

  it('feedback: draft is PUT, submit is POST, a change is PATCH carrying its reason', async () => {
    await interviewsApi.saveDraft('i1', { overall_rating: 3 } as never)
    await interviewsApi.submitFeedback('i1', { overall_rating: 3 } as never)
    await interviewsApi.editFeedback('i1', { overall_rating: 4 } as never, 'why')
    expect(request.mock.calls.map((c) => `${c[1].method} ${c[0]}`)).toEqual(['PUT /interviews/i1/feedback', 'POST /interviews/i1/feedback/submit', 'PATCH /interviews/i1/feedback'])
    expect(request.mock.calls[2][1].json).toEqual({ overall_rating: 4, edit_reason: 'why' })
  })

  it('has no way to delete an interview or sort by a rating', () => {
    expect(Object.keys(interviewsApi).some((k) => /^(delete|remove|destroy)$/i.test(k))).toBe(false)
    expect(Object.keys(interviewsApi).some((k) => /rank|sort|score/i.test(k))).toBe(false)
  })
})
