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

const form = () => {
  const f = new FormData()
  f.append('file', new File(['%PDF-1.4'], 'cv.pdf', { type: 'application/pdf' }))
  return f
}

describe('request() with a multipart body', () => {
  it('sends the FormData untouched and lets the browser set the content type', async () => {
    const { api, http } = await signedIn()
    api.fetch.mockResolvedValueOnce(json(201, { id: 'r1' }))
    const body = form()
    await http.request('/candidates/c1/resumes', { method: 'POST', formData: body })
    const [, init] = api.fetch.mock.calls.at(-1)!
    const headers = new Headers((init as RequestInit).headers)
    expect((init as RequestInit).body).toBe(body)
    expect(headers.get('content-type')).toBeNull() // a hand-set value would lose the multipart boundary
    expect(headers.get('authorization')).toMatch(/^Bearer /)
  })

  it('an expired token still gets exactly one refresh and one retry, with the same file', async () => {
    const { api, http } = await signedIn()
    api.validToken = 'something-else'
    const body = form()
    await http.request('/candidates/c1/resumes', { method: 'POST', formData: body }).catch(() => undefined)
    expect(api.refreshCalls).toBe(1)
    expect(api.apiCalls).toBe(2)
    expect((api.fetch.mock.calls.at(-1)![1] as RequestInit).body).toBe(body)
  })

  it('a server error (such as a refused file type) becomes an ApiError with the server message', async () => {
    const { api, http } = await signedIn()
    api.fetch.mockResolvedValueOnce(json(415, { detail: 'Only PDF and DOCX resumes are accepted.' }))
    await expect(http.request('/candidates/c1/resumes', { method: 'POST', formData: form() })).rejects.toMatchObject({
      status: 415,
      message: 'Only PDF and DOCX resumes are accepted.',
    })
  })
})
