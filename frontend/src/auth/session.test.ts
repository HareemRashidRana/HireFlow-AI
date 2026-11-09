import { describe, expect, it, vi } from 'vitest'
import {
  FakeApi,
  FakeLocks,
  MemoryStorage,
  createChannelPair,
  delay,
  json,
  makeDeps,
  testUser,
} from '../test/fakes'
import { createSessionManager } from './session'
import type { SessionEvent } from './session'

function setup(overrides = {}) {
  const api = new FakeApi()
  const session = createSessionManager(makeDeps(api, overrides))
  const events: SessionEvent[] = []
  session.subscribe((e) => events.push(e))
  return { api, session, events }
}

describe('restore / refresh', () => {
  it('restores a session from the cookie and keeps the token in memory', async () => {
    const { api, session, events } = setup()
    const user = await session.refresh()
    expect(user.email).toBe(testUser.email)
    expect(session.getAccessToken()).toBe('access-1')
    expect(events).toEqual([{ type: 'authenticated', user: testUser }])
    expect(api.refreshCalls).toBe(1)
  })

  it('sends the CSRF header and credentials on refresh', async () => {
    const { api, session } = setup()
    await session.refresh()
    expect(api.lastRefreshHeaders['x-requested-with']).toBe('HireFlow')
    expect(api.lastRefreshCredentials).toBe('include')
  })

  it('SINGLE-FLIGHT: 25 simultaneous refresh() calls make exactly one request', async () => {
    const { api, session } = setup()
    const results = await Promise.all(Array.from({ length: 25 }, () => session.refresh()))
    expect(api.refreshCalls).toBe(1)
    expect(new Set(results.map((u) => u.id)).size).toBe(1)
    expect(api.reuseDetected).toBe(false)
  })

  it('allows a new refresh after the previous one finished', async () => {
    const { api, session } = setup()
    await session.refresh()
    await session.refresh()
    expect(api.refreshCalls).toBe(2)
  })

  it('a 401 ends the session; first-visit restore stays silent (reason "none")', async () => {
    const { api, session, events } = setup()
    api.refreshStatus = 401
    await expect(session.refresh()).rejects.toMatchObject({ status: 401 })
    expect(session.getAccessToken()).toBeNull()
    expect(events).toEqual([{ type: 'ended', reason: 'none' }])
  })

  it('a 401 while signed in ends the session as "expired" and tells other tabs', async () => {
    const [chanA, chanB] = createChannelPair()
    const received: unknown[] = []
    chanB.onmessage = (e) => received.push(e.data)
    const { api, session, events } = setup({ channel: chanA })
    await session.refresh()
    api.refreshStatus = 401
    await expect(session.refresh()).rejects.toMatchObject({ status: 401 })
    await delay(5)
    expect(events.at(-1)).toEqual({ type: 'ended', reason: 'expired' })
    expect(received).toContainEqual({ type: 'ended', reason: 'expired' })
  })

  it('a network failure does NOT sign the user out', async () => {
    const { api, session, events } = setup()
    await session.refresh()
    api.fetch.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await expect(session.refresh()).rejects.toMatchObject({ status: 0 })
    expect(session.getAccessToken()).toBe('access-1') // still signed in
    expect(events.filter((e) => e.type === 'ended')).toHaveLength(0)
  })

  it('a server error (500) does NOT sign the user out', async () => {
    const { api, session } = setup()
    await session.refresh()
    api.refreshStatus = 500
    await expect(session.refresh()).rejects.toMatchObject({ status: 500 })
    expect(session.getAccessToken()).toBe('access-1')
  })
})

describe('tokens', () => {
  it('getFreshToken returns the current token while it is valid', async () => {
    const { api, session } = setup()
    await session.refresh()
    expect(await session.getFreshToken()).toBe('access-1')
    expect(api.refreshCalls).toBe(1)
  })

  it('getFreshToken refreshes first when the token is about to expire', async () => {
    let now = 1_000_000
    const { api, session } = setup({ now: () => now })
    await session.refresh()
    now += 899_000 // 1s before the 15-minute lifetime ends (inside the 5s safety margin)
    expect(await session.getFreshToken()).toBe('access-2')
    expect(api.refreshCalls).toBe(2)
  })

  it('getFreshToken is null (and makes no request) when signed out', async () => {
    const { api, session } = setup()
    expect(await session.getFreshToken()).toBeNull()
    expect(api.refreshCalls).toBe(0)
  })

  it('recoverFromUnauthorized reuses a token another request already refreshed', async () => {
    const { api, session } = setup()
    await session.refresh() // access-1
    await session.refresh() // access-2
    // A request that was sent with access-1 fails late: no extra refresh is needed.
    expect(await session.recoverFromUnauthorized('access-1')).toBe('access-2')
    expect(api.refreshCalls).toBe(2)
  })

  it('recoverFromUnauthorized refreshes once when the used token is still current', async () => {
    const { api, session } = setup()
    await session.refresh()
    const results = await Promise.all([
      session.recoverFromUnauthorized('access-1'),
      session.recoverFromUnauthorized('access-1'),
      session.recoverFromUnauthorized('access-1'),
    ])
    expect(results).toEqual(['access-2', 'access-2', 'access-2'])
    expect(api.refreshCalls).toBe(2) // one initial restore + ONE shared refresh
  })

  it('recoverFromUnauthorized never refreshes after the session has ended', async () => {
    const { api, session } = setup()
    await expect(session.recoverFromUnauthorized(null)).rejects.toMatchObject({ status: 401 })
    expect(api.refreshCalls).toBe(0)
  })

  it('never writes tokens to localStorage / sessionStorage', async () => {
    const storage = new MemoryStorage()
    const { session } = setup({ storage })
    await session.refresh()
    await session.login('a@b.co', 'right-password-123')
    const everything = JSON.stringify([...storage.data.entries()])
    expect(everything).not.toContain('login-1')
    expect(everything).not.toContain('access-')
    expect(storage.data.size).toBe(0) // not even the lock key (a Web Lock is used here)
  })
})

describe('login / logout', () => {
  it('login stores the session in memory and notifies listeners', async () => {
    const { session, events } = setup()
    const user = await session.login('hr@example.com', 'right-password-123')
    expect(user.role).toBe('hr_manager')
    expect(session.getAccessToken()).toBe('login-1')
    expect(events[0]).toEqual({ type: 'authenticated', user: testUser })
  })

  it('failed login throws the server message and leaves the session empty', async () => {
    const { session } = setup()
    await expect(session.login('hr@example.com', 'wrong')).rejects.toMatchObject({
      status: 401,
      message: 'Invalid email or password.',
    })
    expect(session.getAccessToken()).toBeNull()
  })

  it('login surfaces 429 with Retry-After', async () => {
    const api = new FakeApi()
    api.fetch.mockResolvedValueOnce(json(429, { detail: 'Too many failed attempts.' }, { 'Retry-After': '120' }))
    const session = createSessionManager(makeDeps(api))
    await expect(session.login('a@b.co', 'x')).rejects.toMatchObject({ status: 429, retryAfterSeconds: 120 })
  })

  it('logout revokes server-side first, then clears the session', async () => {
    const { api, session, events } = setup()
    await session.login('hr@example.com', 'right-password-123')
    await session.logout()
    expect(api.logoutCalls).toBe(1)
    expect(session.getAccessToken()).toBeNull()
    expect(events.at(-1)).toEqual({ type: 'ended', reason: 'signed-out' })
  })

  it('if logout cannot reach the server, the user stays signed in (and sees an error)', async () => {
    const { api, session } = setup()
    await session.login('hr@example.com', 'right-password-123')
    api.fetch.mockRejectedValueOnce(new TypeError('offline'))
    await expect(session.logout()).rejects.toMatchObject({ status: 0 })
    expect(session.getAccessToken()).toBe('login-1') // not silently "signed out" with a live cookie
  })
})

describe('multi-tab coordination', () => {
  function twoTabs(opts: { withLocks: boolean }) {
    const api = new FakeApi()
    const locks = opts.withLocks ? new FakeLocks() : null
    const [chanA, chanB] = createChannelPair()
    const a = createSessionManager(makeDeps(api, { locks, channel: chanA }))
    const b = createSessionManager(makeDeps(api, { locks, channel: chanB }))
    return { api, locks, a, b }
  }

  it('uses the Web Lock around every refresh', async () => {
    const api = new FakeApi()
    const locks = new FakeLocks()
    const spy = vi.spyOn(locks, 'request')
    const session = createSessionManager(makeDeps(api, { locks }))
    await session.refresh()
    expect(spy).toHaveBeenCalledWith('hireflow-refresh', expect.anything(), expect.any(Function))
  })

  it('two tabs refreshing at the same moment cause NO token reuse (Web Locks)', async () => {
    const { api, a, b } = twoTabs({ withLocks: true })
    await Promise.all([a.refresh(), b.refresh()])
    expect(api.reuseDetected).toBe(false)
    expect(a.getAccessToken()).not.toBeNull()
    expect(b.getAccessToken()).not.toBeNull()
  })

  it('the second tab adopts the first tab\'s token instead of refreshing again', async () => {
    const { api, a, b } = twoTabs({ withLocks: true })
    await Promise.all([a.refresh(), b.refresh()])
    expect(api.refreshCalls).toBe(1)
    expect(b.getAccessToken()).toBe(a.getAccessToken())
  })

  it('WITHOUT any coordination the same race WOULD replay a token (why the lock exists)', async () => {
    const { api, a, b } = twoTabs({ withLocks: false })
    const results = await Promise.allSettled([a.refresh(), b.refresh()])
    expect(api.reuseDetected).toBe(true)
    expect(results.some((r) => r.status === 'rejected')).toBe(true)
  })

  it('a sign-in in one tab signs the other tab in', async () => {
    const { a, b } = twoTabs({ withLocks: true })
    const events: SessionEvent[] = []
    b.subscribe((e) => events.push(e))
    await a.login('hr@example.com', 'right-password-123')
    await delay(10)
    expect(b.getAccessToken()).toBe('login-1')
    expect(events).toContainEqual({ type: 'authenticated', user: testUser })
  })

  it('logging out in one tab signs the other tab out', async () => {
    const { a, b } = twoTabs({ withLocks: true })
    await a.login('hr@example.com', 'right-password-123')
    await delay(10)
    const events: SessionEvent[] = []
    b.subscribe((e) => events.push(e))
    await a.logout()
    await delay(10)
    expect(b.getAccessToken()).toBeNull()
    expect(events).toContainEqual({ type: 'ended', reason: 'signed-out' })
  })

  it('ignores malformed broadcast messages', async () => {
    const [chanA, chanB] = createChannelPair()
    const { session } = setup({ channel: chanA })
    chanB.postMessage({ type: 'session', token: 123 })
    chanB.postMessage('garbage')
    chanB.postMessage(null)
    await delay(10)
    expect(session.getAccessToken()).toBeNull()
  })

  it('fallback lock (no Web Locks): uses localStorage for the lock only, and stores no secrets', async () => {
    const api = new FakeApi()
    const storage = new MemoryStorage()
    const a = createSessionManager(makeDeps(api, { storage }))
    const b = createSessionManager(makeDeps(api, { storage }))
    await Promise.all([a.refresh(), b.refresh()])
    expect(api.reuseDetected).toBe(false) // the storage mutex serialised them
    const stored = JSON.stringify([...storage.data.values()])
    expect(stored).not.toContain('access-')
    expect(storage.data.size).toBe(0) // lock released
  })

  it('fallback is safe when storage is blocked: still works, still single-flight per tab', async () => {
    const storage = new MemoryStorage()
    storage.failing = true
    const { api, session } = setup({ storage })
    await Promise.all([session.refresh(), session.refresh(), session.refresh()])
    expect(api.refreshCalls).toBe(1)
  })

  it('works with neither Web Locks, BroadcastChannel nor storage', async () => {
    const { api, session } = setup({ locks: null, channel: null, storage: null })
    await Promise.all([session.refresh(), session.refresh()])
    expect(api.refreshCalls).toBe(1)
  })

  it('a stale fallback lock from a crashed tab expires instead of blocking forever', async () => {
    const storage = new MemoryStorage()
    storage.setItem('hireflow:refresh-lock', JSON.stringify({ owner: 'dead-tab', expires: Date.now() - 1 }))
    const { api, session } = setup({ storage })
    await session.refresh()
    expect(api.refreshCalls).toBe(1)
  })
})

describe('misc', () => {
  it('end() clears the session and notifies', async () => {
    const { session, events } = setup()
    await session.login('hr@example.com', 'right-password-123')
    session.end('password-changed')
    expect(session.getAccessToken()).toBeNull()
    expect(events.at(-1)).toEqual({ type: 'ended', reason: 'password-changed' })
  })

  it('markPasswordChangeRequired flags the current user once', async () => {
    const { session, events } = setup()
    await session.login('hr@example.com', 'right-password-123')
    session.markPasswordChangeRequired()
    session.markPasswordChangeRequired()
    expect(session.getUser()?.must_change_password).toBe(true)
    expect(events.filter((e) => e.type === 'user-updated')).toHaveLength(1)
  })
})
