import { describe, expect, it } from 'vitest'
import { createSessionManager } from '../auth/session'
import { FakeApi, FakeLocks, json, makeDeps } from '../test/fakes'
import { createHttpClient } from './client'

async function signedIn() {
  const api = new FakeApi()
  const session = createSessionManager(makeDeps(api, { locks: new FakeLocks() }))
  await session.login('hr@example.com', 'right-password-123')
  return { api, session, http: createHttpClient(session, api.fetch as unknown as typeof fetch) }
}

const file = (body: string, headers: Record<string, string> = {}) =>
  new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="candidates-2026-11-10.csv"',
      ...headers,
    },
  })

describe('download()', () => {
  it('returns the file, its content type and the filename the server chose', async () => {
    const { api, http } = await signedIn()
    api.fetch.mockResolvedValueOnce(file('id,email\r\n1,a@b.co\r\n'))
    const result = await http.download('/candidates/export', { method: 'POST', json: { format: 'csv' } })
    expect(result.filename).toBe('candidates-2026-11-10.csv')
    expect(result.contentType).toContain('text/csv')
    expect(await result.blob.text()).toBe('id,email\r\n1,a@b.co\r\n')
  })

  it('sends the access token, the JSON body and accepts any content type', async () => {
    const { api, http } = await signedIn()
    api.fetch.mockResolvedValueOnce(file('x'))
    await http.download('/candidates/export', { method: 'POST', json: { format: 'json' } })
    const [, init] = api.fetch.mock.calls.at(-1)!
    const headers = new Headers((init as RequestInit).headers)
    expect(headers.get('authorization')).toMatch(/^Bearer /)
    expect(headers.get('accept')).toBe('*/*')
    expect(headers.get('content-type')).toBe('application/json')
    expect((init as RequestInit).body).toBe('{"format":"json"}')
    expect((init as RequestInit).method).toBe('POST')
  })

  it('falls back to a neutral name when the server sends none', async () => {
    const { api, http } = await signedIn()
    api.fetch.mockResolvedValueOnce(new Response('x', { status: 200 }))
    expect((await http.download('/x')).filename).toBe('export')
  })

  it.each(['../../etc/passwd', 'a/b.csv', 'a\\b.csv'])('ignores a path-like filename (%s)', async (name) => {
    const { api, http } = await signedIn()
    api.fetch.mockResolvedValueOnce(file('x', { 'Content-Disposition': `attachment; filename="${name}"` }))
    const got = (await http.download('/x')).filename
    expect(got).not.toContain('/')
    expect(got).not.toContain('\\')
  })

  it('turns an error response into an ApiError with the server message, not a broken file', async () => {
    const { api, http } = await signedIn()
    api.fetch.mockResolvedValueOnce(json(422, { detail: 'This export would contain more than 500 candidates.' }))
    await expect(http.download('/candidates/export', { method: 'POST', json: {} })).rejects.toMatchObject({
      status: 422,
      message: 'This export would contain more than 500 candidates.',
    })
  })

  it('handles an error with no JSON body', async () => {
    const { api, http } = await signedIn()
    api.fetch.mockResolvedValueOnce(new Response('<html>oops</html>', { status: 502 }))
    await expect(http.download('/x')).rejects.toMatchObject({ status: 502 })
  })

  it('a 403 is reported as such and leaves the session alone', async () => {
    const { api, session, http } = await signedIn()
    api.fetch.mockResolvedValueOnce(json(403, { detail: 'You do not have permission to perform this action.' }))
    await expect(http.download('/x')).rejects.toMatchObject({ status: 403 })
    expect(session.getAccessToken()).toBeTruthy()
  })
})

describe('download() shares the refresh-once rules of request()', () => {
  it('an expired token gets ONE refresh and ONE retry, then the file arrives', async () => {
    const { api, http } = await signedIn()
    api.validToken = 'something-else' // the server now rejects the token we hold
    const first = await http.download('/x').catch((e) => e)
    // The fake server answers JSON for any valid call; what matters is the handshake, not the body.
    expect(first.blob).toBeDefined()
    expect(api.refreshCalls).toBe(1)
    expect(api.apiCalls).toBe(2) // the 401, then exactly one retry
  })

  it('a server that always says 401 causes one refresh, one retry, then a failure (no loop)', async () => {
    const { api, http } = await signedIn()
    api.alwaysUnauthorized = true
    await expect(http.download('/x')).rejects.toMatchObject({ status: 401 })
    expect(api.refreshCalls).toBe(1)
    expect(api.apiCalls).toBe(2)
  })

  it('twelve parallel downloads and requests still share a single refresh', async () => {
    const { api, http } = await signedIn()
    api.validToken = 'something-else'
    const all = await Promise.all([
      ...Array.from({ length: 6 }, () => http.download('/x')),
      ...Array.from({ length: 6 }, () => http.request('/x')),
    ])
    expect(all).toHaveLength(12)
    expect(api.refreshCalls).toBe(1)
    expect(api.reuseDetected).toBe(false)
  })
})
