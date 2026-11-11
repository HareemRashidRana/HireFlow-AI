import { beforeEach, describe, expect, it, vi } from 'vitest'

const request = vi.fn()
vi.mock('./http', () => ({ request: (...args: unknown[]) => request(...args) }))

import { usersApi } from './users'

beforeEach(() => {
  request.mockReset()
  request.mockResolvedValue({})
})

describe('usersApi', () => {
  it('lists with only the filters that are set', async () => {
    await usersApi.list({ q: 'sana', role: 'recruiter', is_active: false, page: 2, page_size: 15 })
    expect(request).toHaveBeenCalledWith('/users?q=sana&role=recruiter&is_active=false&page=2&page_size=15', { signal: undefined })
    await usersApi.list({})
    expect(request).toHaveBeenLastCalledWith('/users', { signal: undefined })
  })

  it('creates, updates, unlocks and resets with the right verbs and bodies', async () => {
    await usersApi.create({ email: 'a@example.com', password: 'a-long-password', role: 'employee', employee_id: null, must_change_password: true })
    await usersApi.update('u 1', { role: 'hr_manager', is_active: false })
    await usersApi.unlock('u1')
    await usersApi.resetPassword('u1', 'another-long-password')
    expect(request.mock.calls.map((c) => `${c[1]?.method ?? 'GET'} ${c[0]}`)).toEqual([
      'POST /users',
      'PATCH /users/u%201',
      'POST /users/u1/unlock',
      'POST /users/u1/reset-password',
    ])
    expect(request.mock.calls[3][1].json).toEqual({ new_password: 'another-long-password' })
    expect(request.mock.calls[0][1].json).toMatchObject({ must_change_password: true })
  })

  it('has no way to delete a user, and nothing here reads a password', () => {
    expect(Object.keys(usersApi).sort()).toEqual(['create', 'list', 'resetPassword', 'unlock', 'update'])
  })
})
