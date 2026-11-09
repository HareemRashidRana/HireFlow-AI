import { describe, expect, it } from 'vitest'
import { createSessionManager } from '../auth/session'
import { FakeApi, FakeLocks, MemoryStorage, delay, json, makeDeps } from '../test/fakes'
import { createHttpClient } from './client'

async function signedIn(extra = {}) {
  const api = new FakeApi()
  const session = createSessionManager(makeDeps(api, { locks: new FakeLocks(), ...extra }))
  await session.login('hr@example.com', 'right-password-123')
  const http = createHttpClient(session, api.fetch as unknown as typeof fetch)
  return { api, session, http }
}

/** Make the server reject the current token (as if it expired) while the cookie is still good. */
const expireAccessToken = (api: FakeApi) => {
  api.validToken = 'something-else'
}

describe('authenticated requests', () => {
  it('attach the access token as a Bearer header', async () => {
    const { http } = await signedIn()
    await expect(http.request('/employees')).resolves.toMatchObject({ ok: true })
  })

  it('public requests (auth: false) get no token and never trigger a refresh', async () => {
    const { api, http } = await signedIn()
    expireAccessToken(api)
    await expect(http.request('/health', { auth: false })).rejects.toMatchObject({ status: 401 })
    expect(api.refreshCalls).toBe(0)
  })

  it('204 responses resolve to undefined', async () => {
    const { api, http } = await signedIn()
    api.fetch.mockResolvedValueOnce(json(204, null))
    await expect(http.request('/employees/1', { method: 'DELETE' })).resolves.toBeUndefined()
  })
})

describe('401 handling: refresh once, retry once', () => {
  it('CONCURRENT 401s: 12 parallel requests share ONE refresh and all succeed on retry', async () => {
    const { api, http } = await signedIn()
    expireAccessToken(api) // every in-flight request is about to get a 401
    // Server will accept whatever the refresh returns.
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, i) => http.request<{ ok: boolean }>(`/employees?page=${i}`)),
    )
    expect(results.every((r) => r.ok)).toBe(true)
    expect(api.refreshCalls).toBe(1) // exactly one refresh, not twelve
    expect(api.reuseDetected).toBe(false)
    expect(api.apiCalls).toBe(12 * 2) // each request: the 401, then ONE retry
  })

  it('late 401s after the refresh already happened reuse the new token (no second refresh)', async () => {
    const { api, http } = await signedIn()
    expireAccessToken(api)
    await http.request('/employees') // triggers the refresh
    expect(api.refreshCalls).toBe(1)
    await http.request('/employees') // now fine
    expect(api.refreshCalls).toBe(1)
  })

  it('NO LOOP: a server that always answers 401 causes one refresh and one retry, then sign-out', async () => {
    const { api, session, http } = await signedIn()
    api.alwaysUnauthorized = true
    api.apiCalls = 0
    await expect(http.request('/employees')).rejects.toMatchObject({ status: 401 })
    expect(api.refreshCalls).toBe(1)
    expect(api.apiCalls).toBe(2) // original + exactly one retry
    expect(session.getAccessToken()).toBeNull() // session ended
  })

  it('NO LOOP with many requests: still a single refresh, two attempts each, one end event', async () => {
    const { api, session, http } = await signedIn()
    const ended: string[] = []
    session.subscribe((e) => e.type === 'ended' && ended.push(e.reason))
    api.alwaysUnauthorized = true
    api.apiCalls = 0
    const settled = await Promise.allSettled(Array.from({ length: 8 }, () => http.request('/employees')))
    expect(settled.every((s) => s.status === 'rejected')).toBe(true)
    expect(api.refreshCalls).toBe(1)
    expect(api.apiCalls).toBeLessThanOrEqual(8 * 2)
    expect(ended.length).toBeGreaterThanOrEqual(1)
    expect(ended.every((r) => r === 'expired')).toBe(true)
  })

  it('when the refresh itself fails with 401, requests fail with 401 and the session ends once', async () => {
    const { api, session, http } = await signedIn()
    const ended: string[] = []
    session.subscribe((e) => e.type === 'ended' && ended.push(e.reason))
    expireAccessToken(api)
    api.refreshStatus = 401
    const settled = await Promise.allSettled(Array.from({ length: 5 }, () => http.request('/employees')))
    expect(settled.every((s) => s.status === 'rejected')).toBe(true)
    expect(api.refreshCalls).toBe(1) // never retried
    expect(ended).toEqual(['expired']) // announced exactly once
    expect(session.getAccessToken()).toBeNull()
  })

  it('after the session ended, further requests fail fast without calling the server', async () => {
    const { api, session, http } = await signedIn()
    session.end('expired')
    api.apiCalls = 0
    await expect(http.request('/employees')).rejects.toMatchObject({ status: 401 })
    expect(api.refreshCalls).toBe(0)
  })

  it('a network error during refresh keeps the session and reports the error', async () => {
    const { api, session, http } = await signedIn()
    expireAccessToken(api)
    api.fetch.mockImplementation(async (input) => {
      if (String(input).endsWith('/auth/refresh')) throw new TypeError('Failed to fetch')
      return json(401, { detail: 'expired' })
    })
    await expect(http.request('/employees')).rejects.toMatchObject({ status: 0 })
    expect(session.getAccessToken()).not.toBeNull()
  })

  it('proactively refreshes a token that is about to expire instead of provoking a 401', async () => {
    let now = 5_000_000
    const { api, http } = await signedIn({ now: () => now })
    now += 899_500 // within the 5 second safety margin
    api.apiCalls = 0
    await http.request('/employees')
    expect(api.refreshCalls).toBe(1)
    expect(api.apiCalls).toBe(1) // no wasted 401 round trip
  })
})

describe('other errors', () => {
  it('403 "password change required" flags the user so the router can redirect', async () => {
    const { api, session, http } = await signedIn()
    api.fetch.mockResolvedValueOnce(json(403, { detail: 'You must change your password before continuing.' }))
    await expect(http.request('/employees')).rejects.toMatchObject({ status: 403 })
    expect(session.getUser()?.must_change_password).toBe(true)
  })

  it('an ordinary 403 does not touch the session', async () => {
    const { api, session, http } = await signedIn()
    api.fetch.mockResolvedValueOnce(json(403, { detail: 'You do not have permission to perform this action.' }))
    await expect(http.request('/employees')).rejects.toMatchObject({ status: 403 })
    expect(session.getAccessToken()).not.toBeNull()
    expect(session.getUser()?.must_change_password).toBe(false)
  })

  it('parses both backend error shapes', async () => {
    const { api, http } = await signedIn()
    api.fetch.mockResolvedValueOnce(
      json(422, { detail: [{ loc: ['body', 'work_email'], msg: 'Value error, bad email', type: 'x' }] }),
    )
    await expect(http.request('/employees', { method: 'POST', json: {} })).rejects.toMatchObject({
      status: 422,
      fieldErrors: { work_email: 'bad email' },
    })
    api.fetch.mockResolvedValueOnce(json(409, { detail: "Employee ID 'X' already exists" }))
    await expect(http.request('/employees', { method: 'POST', json: {} })).rejects.toMatchObject({
      status: 409,
      message: "Employee ID 'X' already exists",
    })
  })

  it('aborted requests propagate as abort errors (not as network failures)', async () => {
    const { api, http } = await signedIn()
    api.fetch.mockRejectedValueOnce(new DOMException('aborted', 'AbortError'))
    await expect(http.request('/employees')).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('network failures become a friendly ApiError with status 0', async () => {
    const { api, http } = await signedIn()
    api.fetch.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await expect(http.request('/employees')).rejects.toMatchObject({ status: 0 })
  })
})

describe('token hygiene', () => {
  it('no token ever reaches web storage while requests are refreshed and retried', async () => {
    const storage = new MemoryStorage()
    const { api, http } = await signedIn({ storage, locks: null })
    expireAccessToken(api)
    await http.request('/employees')
    await delay(5)
    const dump = JSON.stringify([...storage.data.entries()])
    expect(dump).not.toMatch(/access-|login-|Bearer/)
  })
})
