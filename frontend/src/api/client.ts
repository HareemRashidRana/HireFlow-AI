/**
 * HTTP client for the FastAPI backend. All calls go to /api/..., which Vite proxies in development.
 *
 * Authentication behaviour (see auth/session.ts for the token handling):
 *   1. A valid access token is attached as `Authorization: Bearer ...`.
 *   2. If the server answers 401, the request waits for ONE shared refresh (however many requests
 *      failed at once) and is retried exactly once with the new token.
 *   3. If the retry is also 401 the session is ended. There is no third attempt and no loop.
 */

import { PASSWORD_CHANGE_REQUIRED_PREFIX, SESSION_ENDED_MESSAGE } from '../auth/session'
import type { SessionManager } from '../auth/session'
import { ApiError, isAbortError, networkError, parseError } from './errors'

export { ApiError, isAbortError } from './errors'

export interface RequestOptions extends Omit<RequestInit, 'body'> {
  json?: unknown
  /** Set false for public endpoints. They are neither given a token nor refreshed on 401. */
  auth?: boolean
}

export interface HttpClient {
  request<T>(path: string, options?: RequestOptions): Promise<T>
}

export function createHttpClient(
  session: SessionManager,
  fetchImpl: typeof fetch = (...args) => fetch(...args),
): HttpClient {
  async function send(path: string, options: RequestOptions, token: string | null): Promise<Response> {
    const { json, auth: _auth, headers, ...rest } = options
    try {
      return await fetchImpl(`/api/v1${path}`, {
        ...rest,
        headers: {
          Accept: 'application/json',
          ...(json !== undefined && { 'Content-Type': 'application/json' }),
          ...(token !== null && { Authorization: `Bearer ${token}` }),
          ...headers,
        },
        body: json !== undefined ? JSON.stringify(json) : undefined,
      })
    } catch (error) {
      if (isAbortError(error)) throw error
      throw networkError()
    }
  }

  async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const authenticated = options.auth ?? true

    const token = authenticated ? await session.getFreshToken() : null
    let res = await send(path, options, token)

    if (authenticated && res.status === 401) {
      // The single allowed retry. recoverFromUnauthorized() joins the shared refresh, or reuses a
      // token another request already obtained; it throws if the session has ended.
      const freshToken = await session.recoverFromUnauthorized(token)
      res = await send(path, options, freshToken)
      if (res.status === 401) {
        if (session.getAccessToken() === freshToken) session.end('expired')
        throw new ApiError(SESSION_ENDED_MESSAGE, 401)
      }
    }

    if (res.status === 204) return undefined as T

    let body: unknown = null
    try {
      body = await res.json()
    } catch {
      /* non-JSON body */
    }

    if (!res.ok) {
      const error = parseError(res.status, body, res.headers.get('Retry-After'))
      if (res.status === 403 && error.message.startsWith(PASSWORD_CHANGE_REQUIRED_PREFIX)) {
        session.markPasswordChangeRequired() // the router then sends the user to the change screen
      }
      throw error
    }
    return body as T
  }

  return { request }
}
