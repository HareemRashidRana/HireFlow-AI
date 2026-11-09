/**
 * Session manager: the only place that knows the access token.
 *
 *  - The access token lives in this module's memory ONLY. It is never written to localStorage,
 *    sessionStorage, cookies, the URL or React state. A page reload therefore starts with no
 *    token and restores the session through the HttpOnly refresh cookie (restore()).
 *  - The refresh token is the HttpOnly cookie set by the backend. JavaScript cannot read it.
 *  - Single-flight refresh: however many callers need a new token at once, one request is made.
 *  - Multi-tab safety: all tabs share one refresh cookie, and the server rotates it on every use.
 *    A Web Lock serialises refreshes across tabs (so a stale cookie is never replayed), and a
 *    BroadcastChannel shares the new token so the other tabs don't need to refresh again.
 *    Without Web Locks a tiny localStorage mutex (owner id + expiry only, no secrets) is used;
 *    if that is unavailable too, only per-tab single-flight applies.
 */

import { ApiError, networkError, parseError } from '../api/errors'
import type { AuthUser, TokenResponse } from '../types/auth'

export type EndReason = 'none' | 'expired' | 'signed-out' | 'password-changed'

export type SessionEvent =
  | { type: 'authenticated'; user: AuthUser }
  | { type: 'user-updated'; user: AuthUser }
  | { type: 'ended'; reason: EndReason }

export const SESSION_ENDED_MESSAGE = 'Your session has ended. Please sign in again.'
export const PASSWORD_CHANGE_REQUIRED_PREFIX = 'You must change your password'

/** Required by the backend's CSRF check on login / refresh / logout. */
const CSRF_HEADERS = { 'X-Requested-With': 'HireFlow' }

const LOCK_NAME = 'hireflow-refresh'
const CHANNEL_NAME = 'hireflow-auth'
const STORAGE_LOCK_KEY = 'hireflow:refresh-lock'
const EXPIRY_SKEW_MS = 5_000 // refresh slightly early instead of sending a token that is about to die
const REQUEST_TIMEOUT_MS = 15_000
const LOCK_WAIT_MS = 20_000
const STORAGE_LOCK_TTL_MS = 10_000

// ---- injectable dependencies (real browser objects in production, fakes in tests) ----

export interface ChannelLike {
  postMessage(message: unknown): void
  onmessage: ((event: { data: unknown }) => void) | null
  close(): void
}
export interface LocksLike {
  request<T>(name: string, options: { signal?: AbortSignal }, callback: () => Promise<T>): Promise<T>
}
export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}
export interface SessionDeps {
  fetch: typeof fetch
  locks: LocksLike | null
  channel: ChannelLike | null
  storage: StorageLike | null // only ever used for the fallback lock
  now: () => number
  sleep: (ms: number) => Promise<void>
}

export function browserDeps(): SessionDeps {
  let locks: LocksLike | null = null
  if (typeof navigator !== 'undefined' && navigator.locks) {
    const manager = navigator.locks
    locks = { request: (name, options, callback) => manager.request(name, options, callback) }
  }

  let channel: ChannelLike | null = null
  if (typeof BroadcastChannel !== 'undefined') {
    channel = new BroadcastChannel(CHANNEL_NAME) as unknown as ChannelLike
  }

  let storage: StorageLike | null = null
  try {
    storage = typeof localStorage !== 'undefined' ? localStorage : null
  } catch {
    storage = null // e.g. blocked by privacy settings
  }

  return {
    fetch: (...args) => fetch(...args),
    locks,
    channel,
    storage,
    now: () => Date.now(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  }
}

// ---- cross-tab messages ----

type Message =
  | { type: 'session'; token: string; expiresAt: number; user: AuthUser }
  | { type: 'ended'; reason: EndReason }

const END_REASONS: EndReason[] = ['none', 'expired', 'signed-out', 'password-changed']

function isMessage(data: unknown): data is Message {
  if (typeof data !== 'object' || data === null) return false
  const m = data as Record<string, unknown>
  if (m.type === 'session')
    return typeof m.token === 'string' && typeof m.expiresAt === 'number' && typeof m.user === 'object' && m.user !== null
  if (m.type === 'ended') return END_REASONS.includes(m.reason as EndReason)
  return false
}

// ---- the manager ----

export interface SessionManager {
  /** Current user, or null when signed out. */
  getUser(): AuthUser | null
  getAccessToken(): string | null
  subscribe(listener: (event: SessionEvent) => void): () => void
  /** Restore a session on page load, or refresh an expired token. Single-flight. */
  refresh(): Promise<AuthUser>
  login(email: string, password: string): Promise<AuthUser>
  logout(): Promise<void>
  /** A token that is valid for at least a few more seconds (refreshes first if it is not). */
  getFreshToken(): Promise<string | null>
  /** Called after a 401. Returns the token to retry with, refreshing at most once. */
  recoverFromUnauthorized(usedToken: string | null): Promise<string>
  /** End the session locally (and in other tabs). The server-side session is already gone. */
  end(reason: EndReason): void
  markPasswordChangeRequired(): void
}

export function createSessionManager(deps: SessionDeps): SessionManager {
  let token: string | null = null
  let expiresAt = 0
  let user: AuthUser | null = null
  let inFlight: Promise<AuthUser> | null = null
  let lastAdoptedAt = 0
  const listeners = new Set<(event: SessionEvent) => void>()

  const emit = (event: SessionEvent) => listeners.forEach((l) => l(event))
  const broadcast = (message: Message) => {
    try {
      deps.channel?.postMessage(message)
    } catch {
      /* a closed channel must never break sign-in */
    }
  }

  function setSession(res: TokenResponse, share: boolean) {
    token = res.access_token
    expiresAt = deps.now() + res.expires_in * 1000
    user = res.user
    if (share) broadcast({ type: 'session', token, expiresAt, user })
    emit({ type: 'authenticated', user })
  }

  function clear(reason: EndReason, share: boolean) {
    token = null
    expiresAt = 0
    user = null
    if (share) broadcast({ type: 'ended', reason })
    emit({ type: 'ended', reason })
  }

  if (deps.channel) {
    deps.channel.onmessage = (event) => {
      const message = event.data
      if (!isMessage(message)) return
      if (message.type === 'session') {
        // Another tab signed in or refreshed: adopt its token instead of refreshing ourselves.
        token = message.token
        expiresAt = message.expiresAt
        user = message.user
        lastAdoptedAt = deps.now()
        emit({ type: 'authenticated', user: message.user })
      } else {
        clear(message.reason === 'none' ? 'signed-out' : message.reason, false)
      }
    }
  }

  // ---- talking to the auth endpoints ----

  async function post(path: string, body?: unknown): Promise<Response> {
    try {
      return await deps.fetch(`/api/v1${path}`, {
        method: 'POST',
        credentials: 'include', // sends/accepts the HttpOnly refresh cookie
        headers: {
          Accept: 'application/json',
          ...CSRF_HEADERS,
          ...(body !== undefined && { 'Content-Type': 'application/json' }),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
    } catch {
      throw networkError() // offline, DNS, timeout, server down
    }
  }

  async function readToken(res: Response): Promise<TokenResponse> {
    let body: unknown = null
    try {
      body = await res.json()
    } catch {
      /* non-JSON */
    }
    if (!res.ok) throw parseError(res.status, body, res.headers.get('Retry-After'))
    return body as TokenResponse
  }

  // ---- cross-tab lock ----

  async function withStorageLock<T>(fn: () => Promise<T>): Promise<T> {
    const storage = deps.storage
    if (!storage) return fn() // nothing to coordinate with: per-tab single-flight only

    const owner = `${deps.now()}-${Math.random().toString(36).slice(2)}`
    // Only the storage calls are guarded: errors from fn() itself must never be swallowed or retried.
    const safe = <V>(operation: () => V, fallback: V): V => {
      try {
        return operation()
      } catch {
        return fallback // storage blocked or full: behave as if there were no lock
      }
    }
    const read = () =>
      safe<{ owner: string; expires: number } | null>(() => {
        const raw = storage.getItem(STORAGE_LOCK_KEY)
        return raw ? (JSON.parse(raw) as { owner: string; expires: number }) : null
      }, null)

    let acquired = false
    const deadline = deps.now() + LOCK_WAIT_MS
    while (deps.now() < deadline) {
      const current = read()
      if (!current || current.expires < deps.now()) {
        const wrote = safe(() => {
          storage.setItem(STORAGE_LOCK_KEY, JSON.stringify({ owner, expires: deps.now() + STORAGE_LOCK_TTL_MS }))
          return true
        }, false)
        if (!wrote) break // storage unusable
        await deps.sleep(25) // let a competing write land, then check who won
        if (read()?.owner === owner) {
          acquired = true
          break
        }
      }
      await deps.sleep(50 + Math.random() * 50)
    }

    // If the lock was not obtained in time, proceeding is still safe: the worst case is that the
    // server sees a reused token and ends the session, which only means signing in again.
    try {
      return await fn()
    } finally {
      if (acquired && read()?.owner === owner) safe(() => storage.removeItem(STORAGE_LOCK_KEY), undefined)
    }
  }

  async function withRefreshLock<T>(fn: () => Promise<T>): Promise<T> {
    if (!deps.locks) return withStorageLock(fn)
    try {
      return await deps.locks.request(LOCK_NAME, { signal: AbortSignal.timeout(LOCK_WAIT_MS) }, fn)
    } catch (error) {
      if (error instanceof DOMException && (error.name === 'AbortError' || error.name === 'TimeoutError'))
        throw new ApiError('Refreshing your session timed out. Please try again.', 0)
      throw error
    }
  }

  // ---- refresh (single-flight) ----

  async function runRefresh(): Promise<AuthUser> {
    const requestedAt = deps.now()
    return withRefreshLock(async () => {
      if (deps.now() - requestedAt > 2) {
        // We had to wait for another tab's refresh. Give its broadcast a moment to arrive...
        await deps.sleep(25)
        // ...and if it did, use that token instead of rotating the cookie a second time.
        if (lastAdoptedAt >= requestedAt && token !== null && user !== null) return user
      }

      const wasSignedIn = token !== null
      const res = await post('/auth/refresh')
      if (res.status === 401) {
        // Expired, revoked or reused: the session is over (the server also clears the cookie).
        clear(wasSignedIn ? 'expired' : 'none', wasSignedIn)
        throw new ApiError(SESSION_ENDED_MESSAGE, 401)
      }
      const body = await readToken(res) // other failures (5xx, 429...) keep the session as it is
      setSession(body, true)
      return body.user
    })
  }

  function refresh(): Promise<AuthUser> {
    if (!inFlight) {
      inFlight = runRefresh().finally(() => {
        inFlight = null
      })
    }
    return inFlight // every concurrent caller shares this one promise
  }

  return {
    getUser: () => user,
    getAccessToken: () => token,

    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },

    refresh,

    async login(email, password) {
      const res = await post('/auth/login', { email, password })
      const body = await readToken(res)
      setSession(body, true)
      return body.user
    },

    async logout() {
      const res = await post('/auth/logout')
      if (!res.ok) {
        let body: unknown = null
        try {
          body = await res.json()
        } catch {
          /* ignore */
        }
        throw parseError(res.status, body)
      }
      // Only forget the session once the server confirmed it was revoked (otherwise a reload
      // would silently sign the user back in through the still-valid cookie).
      clear('signed-out', true)
    },

    async getFreshToken() {
      if (token === null) return null
      if (expiresAt - deps.now() > EXPIRY_SKEW_MS) return token
      await refresh()
      return token
    },

    async recoverFromUnauthorized(usedToken) {
      // Signed out meanwhile: don't try to bring the session back to life.
      if (token === null) throw new ApiError(SESSION_ENDED_MESSAGE, 401)
      // Someone already refreshed since this request was sent: just retry with the new token.
      if (token !== usedToken) return token
      await refresh()
      if (token === null) throw new ApiError(SESSION_ENDED_MESSAGE, 401)
      return token
    },

    end(reason) {
      clear(reason, true)
    },

    markPasswordChangeRequired() {
      if (user && !user.must_change_password) {
        user = { ...user, must_change_password: true }
        emit({ type: 'user-updated', user })
      }
    },
  }
}
