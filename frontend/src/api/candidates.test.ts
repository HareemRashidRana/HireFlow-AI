import { beforeEach, describe, expect, it, vi } from 'vitest'

const request = vi.fn()
vi.mock('./http', () => ({ request: (...args: unknown[]) => request(...args) }))

import { candidatesApi } from './candidates'

beforeEach(() => {
  request.mockReset()
  request.mockResolvedValue({})
})

describe('candidatesApi', () => {
  it('lists with only the filters that are set', async () => {
    await candidatesApi.list({ q: 'sana', source: 'referral', retention: '', page: 2, page_size: 10 })
    expect(request).toHaveBeenCalledWith('/candidates?q=sana&source=referral&page=2&page_size=10', { signal: undefined })
  })

  it('lists everything when no params are given', async () => {
    await candidatesApi.list({})
    expect(request).toHaveBeenCalledWith('/candidates', { signal: undefined })
  })

  it('sends the retention filter', async () => {
    await candidatesApi.list({ retention: 'expired' })
    expect(request).toHaveBeenCalledWith('/candidates?retention=expired', { signal: undefined })
  })

  it('gets one candidate and encodes the id', async () => {
    await candidatesApi.get('a/b c')
    expect(request).toHaveBeenCalledWith('/candidates/a%2Fb%20c', { signal: undefined })
  })

  it('creates with POST', async () => {
    const data = {
      first_name: 'A', last_name: 'B', email: 'a@b.co', source: 'direct' as const,
      consent_basis: 'consent' as const, consent_date: '2026-01-01',
    }
    await candidatesApi.create(data)
    expect(request).toHaveBeenCalledWith('/candidates', { method: 'POST', json: data })
  })

  it('updates with PATCH', async () => {
    await candidatesApi.update('c1', { location: 'Karachi' })
    expect(request).toHaveBeenCalledWith('/candidates/c1', { method: 'PATCH', json: { location: 'Karachi' } })
  })

  it('deletes with DELETE', async () => {
    await candidatesApi.remove('c1')
    expect(request).toHaveBeenCalledWith('/candidates/c1', { method: 'DELETE' })
  })

  it('finds an existing candidate by exact email', async () => {
    request.mockResolvedValue({ items: [{ id: 'c9' }], total: 1 })
    const found = await candidatesApi.findByEmail('a@b.co')
    expect(request).toHaveBeenCalledWith('/candidates?email=a%40b.co', { signal: undefined })
    expect(found).toEqual({ id: 'c9' })
  })

  it('returns null when nobody has that email', async () => {
    request.mockResolvedValue({ items: [], total: 0 })
    expect(await candidatesApi.findByEmail('nobody@example.com')).toBeNull()
  })
})
