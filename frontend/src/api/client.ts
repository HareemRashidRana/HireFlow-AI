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
  /** A multipart body (file uploads). The browser adds the Content-Type and boundary itself. */
  formData?: FormData
  /** Set false for public endpoints. They are neither given a token nor refreshed on 401. */
  auth?: boolean
}

export interface DownloadedFile {
  blob: Blob
  /** From the server's Content-Disposition (it never contains a person's name). */
  filename: string
  contentType: string
}

export interface HttpClient {
  request<T>(path: string, options?: RequestOptions): Promise<T>
  /** Like request(), but for a file the server sends back (CSV / JSON exports). */
  download(path: string, options?: RequestOptions): Promise<DownloadedFile>
}

export function createHttpClient(
  session: SessionManager,
  fetchImpl: typeof fetch = (...args) => fetch(...args),
): HttpClient {
  async function send(path: string, options: RequestOptions, token: string | null): Promise<Response> {
    const { json, formData, auth: _auth, headers, ...rest } = options
    try {
      return await fetchImpl(`/api/v1${path}`, {
        ...rest,
        headers: {
          Accept: 'application/json',
          ...(json !== undefined && { 'Content-Type': 'application/json' }),
          ...(token !== null && { Authorization: `Bearer ${token}` }),
          ...headers,
        },
        body: formData ?? (json !== undefined ? JSON.stringify(json) : undefined),
      })
    } catch (error) {
      if (isAbortError(error)) throw error
      throw networkError()
    }
  }

  /** One request with the shared token handling: a single refresh + retry on 401, never a loop. */
  async function authedFetch(path: string, options: RequestOptions): Promise<Response> {
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
    return res
  }

  async function failure(res: Response, body: unknown): Promise<never> {
    const error = parseError(res.status, body, res.headers.get('Retry-After'))
    if (res.status === 403 && error.message.startsWith(PASSWORD_CHANGE_REQUIRED_PREFIX)) {
      session.markPasswordChangeRequired() // the router then sends the user to the change screen
    }
    throw error
  }

  async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const res = await authedFetch(path, options)

    if (res.status === 204) return undefined as T

    let body: unknown = null
    try {
      body = await res.json()
    } catch {
      /* non-JSON body */
    }

    if (!res.ok) await failure(res, body)
    return body as T
  }

  async function download(path: string, options: RequestOptions = {}): Promise<DownloadedFile> {
    const res = await authedFetch(path, {
      ...options,
      headers: { ...(options.headers as Record<string, string> | undefined), Accept: '*/*' },
    })
    if (!res.ok) {
      let body: unknown = null
      try {
        body = await res.json()
      } catch {
        /* non-JSON error body */
      }
      await failure(res, body)
    }
    const disposition = res.headers.get('Content-Disposition') ?? ''
    const match = /filename="([^"\\/]+)"/.exec(disposition)
    return {
      blob: await res.blob(),
      filename: match?.[1] ?? 'export',
      contentType: res.headers.get('Content-Type') ?? 'application/octet-stream',
    }
  }

  return { request, download }
}
