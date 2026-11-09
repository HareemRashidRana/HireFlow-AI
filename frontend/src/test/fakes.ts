/** Test doubles: a fake backend, Web Locks, BroadcastChannel and storage. Not shipped in the app. */

import { vi } from 'vitest'
import type { ChannelLike, LocksLike, SessionDeps, StorageLike } from '../auth/session'
import type { AuthUser } from '../types/auth'

export const testUser: AuthUser = {
  id: 'u-1',
  email: 'hr@example.com',
  role: 'hr_manager',
  is_active: true,
  must_change_password: false,
  employee_id: null,
  last_login_at: null,
  created_at: '2026-01-01T00:00:00Z',
}

export const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })

export const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * A tiny fake of the HireFlow API with realistic refresh-token behaviour:
 * the refresh "cookie" is shared by every caller (like a browser), and a refresh that starts while
 * another one is still running replays a consumed token, which the real server treats as theft.
 */
export class FakeApi {
  refreshCalls = 0
  loginCalls = 0
  logoutCalls = 0
  apiCalls = 0
  reuseDetected = false
  /** Access token the "server" currently accepts. */
  validToken = 'access-0'
  /** Set to make /auth/refresh fail with this status. */
  refreshStatus = 200
  refreshDelayMs = 10
  /** Make every protected call answer 401 no matter what (broken server). */
  alwaysUnauthorized = false
  lastRefreshHeaders: Record<string, string> = {}
  lastRefreshCredentials: RequestCredentials | undefined
  private refreshRunning = false

  fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input)
    const headers = new Headers(init?.headers)

    if (url.endsWith('/auth/refresh')) {
      this.refreshCalls++
      this.lastRefreshHeaders = Object.fromEntries(headers.entries())
      this.lastRefreshCredentials = init?.credentials
      if (this.refreshRunning) {
        this.reuseDetected = true
        return json(401, { detail: 'Your session has ended. Please sign in again.' })
      }
      this.refreshRunning = true
      try {
        await delay(this.refreshDelayMs)
        if (this.refreshStatus !== 200) return json(this.refreshStatus, { detail: 'nope' })
        this.validToken = `access-${this.refreshCalls}`
        return json(200, {
          access_token: this.validToken,
          token_type: 'bearer',
          expires_in: 900,
          user: testUser,
        })
      } finally {
        this.refreshRunning = false
      }
    }

    if (url.endsWith('/auth/login')) {
      this.loginCalls++
      const body = JSON.parse(String(init?.body))
      if (body.password !== 'right-password-123') {
        return json(401, { detail: 'Invalid email or password.' })
      }
      this.validToken = `login-${this.loginCalls}`
      return json(200, {
        access_token: this.validToken,
        token_type: 'bearer',
        expires_in: 900,
        user: testUser,
      })
    }

    if (url.endsWith('/auth/logout')) {
      this.logoutCalls++
      return json(204, null)
    }

    // any protected endpoint
    this.apiCalls++
    if (this.alwaysUnauthorized || headers.get('authorization') !== `Bearer ${this.validToken}`) {
      return json(401, { detail: 'Invalid or expired token.' })
    }
    return json(200, { ok: true, path: url })
  })
}

/** Web Locks stand-in: exclusive and first-come-first-served, shared by "tabs". */
export class FakeLocks implements LocksLike {
  requests = 0
  private tail: Promise<unknown> = Promise.resolve()

  request<T>(_name: string, _options: { signal?: AbortSignal }, callback: () => Promise<T>): Promise<T> {
    this.requests++
    const run = this.tail.then(callback)
    this.tail = run.catch(() => undefined)
    return run
  }
}

/** Two BroadcastChannel endpoints wired to each other (messages arrive asynchronously). */
export function createChannelPair(): [ChannelLike, ChannelLike] {
  const make = (): ChannelLike => ({ postMessage: () => {}, onmessage: null, close: () => {} })
  const a = make()
  const b = make()
  a.postMessage = (m) => void setTimeout(() => b.onmessage?.({ data: m }), 0)
  b.postMessage = (m) => void setTimeout(() => a.onmessage?.({ data: m }), 0)
  return [a, b]
}

export class MemoryStorage implements StorageLike {
  data = new Map<string, string>()
  failing = false
  getItem(key: string) {
    if (this.failing) throw new Error('storage blocked')
    return this.data.get(key) ?? null
  }
  setItem(key: string, value: string) {
    if (this.failing) throw new Error('storage blocked')
    this.data.set(key, value)
  }
  removeItem(key: string) {
    this.data.delete(key)
  }
}

export function makeDeps(api: FakeApi, overrides: Partial<SessionDeps> = {}): SessionDeps {
  return {
    fetch: api.fetch as unknown as typeof fetch,
    locks: null,
    channel: null,
    storage: null,
    now: () => Date.now(),
    sleep: (ms) => delay(Math.min(ms, 2)),
    ...overrides,
  }
}
