import { beforeEach, describe, expect, it, vi } from 'vitest'

const request = vi.fn()
const download = vi.fn()
vi.mock('./http', () => ({
  request: (...args: unknown[]) => request(...args),
  download: (...args: unknown[]) => download(...args),
}))

import { resumesApi } from './resumes'

beforeEach(() => {
  request.mockReset()
  download.mockReset()
  request.mockResolvedValue({})
})

describe('resumesApi', () => {
  it('lists under the candidate and encodes the id', async () => {
    await resumesApi.list('a/b c')
    expect(request).toHaveBeenCalledWith('/candidates/a%2Fb%20c/resumes?page_size=50', { signal: undefined })
  })

  it('uploads the file as multipart form data, not JSON', async () => {
    const file = new File(['%PDF-1.4 hello'], 'cv.pdf', { type: 'application/pdf' })
    await resumesApi.upload('c1', file)
    const [path, options] = request.mock.calls[0]
    expect(path).toBe('/candidates/c1/resumes')
    expect(options.method).toBe('POST')
    expect(options.json).toBeUndefined()
    const form = options.formData as FormData
    expect(form).toBeInstanceOf(FormData)
    expect([...form.keys()]).toEqual(['file']) // nothing else, e.g. no uploader id, is ever sent
    expect((form.get('file') as File).name).toBe('cv.pdf')
  })

  it('passes the abort signal through so an upload can be cancelled', async () => {
    const ctl = new AbortController()
    await resumesApi.upload('c1', new File(['x'], 'a.pdf'), ctl.signal)
    expect(request.mock.calls[0][1].signal).toBe(ctl.signal)
  })

  it('reads parsed data, re-reads, activates and deletes with the right verbs', async () => {
    await resumesApi.parsed('r1')
    expect(request).toHaveBeenLastCalledWith('/resumes/r1/parsed', { signal: undefined })
    await resumesApi.parse('r1')
    expect(request).toHaveBeenLastCalledWith('/resumes/r1/parse', { method: 'POST' })
    await resumesApi.activate('r1')
    expect(request).toHaveBeenLastCalledWith('/resumes/r1/activate', { method: 'POST' })
    await resumesApi.remove('r1')
    expect(request).toHaveBeenLastCalledWith('/resumes/r1', { method: 'DELETE' })
  })

  it('always sends the explicit confirmation with a review', async () => {
    const data = { name: 'A', email: null, phone: null, skills: [], education: [], experience: [] }
    await resumesApi.review('r1', data)
    expect(request).toHaveBeenLastCalledWith('/resumes/r1/review', { method: 'PUT', json: { ...data, confirm: true } })
  })

  it('downloads through the authenticated client, never a bare link', async () => {
    await resumesApi.download('r 1')
    expect(download).toHaveBeenCalledWith('/resumes/r%201/download')
  })
})
