// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { saveFile } from './download'

describe('saveFile', () => {
  const created: string[] = []
  beforeEach(() => {
    vi.useFakeTimers()
    URL.createObjectURL = vi.fn(() => {
      created.push('blob:fake-1')
      return 'blob:fake-1'
    })
    URL.revokeObjectURL = vi.fn()
  })
  afterEach(() => {
    vi.useRealTimers()
    created.length = 0
  })

  it('triggers a download with the given filename and leaves nothing behind in the page', () => {
    const clicked: HTMLAnchorElement[] = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this)
    })
    saveFile(new Blob(['a,b']), 'candidates-2026-11-10.csv')
    expect(clicked).toHaveLength(1)
    expect(clicked[0].download).toBe('candidates-2026-11-10.csv')
    expect(clicked[0].href).toBe('blob:fake-1')
    expect(document.querySelector('a[download]')).toBeNull()
  })

  it('releases the in-memory copy afterwards', () => {
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    saveFile(new Blob(['x']), 'x.csv')
    expect(URL.revokeObjectURL).not.toHaveBeenCalled()
    vi.runAllTimers()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake-1')
  })

  it('never writes the file to web storage', () => {
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    saveFile(new Blob(['secret personal data']), 'x.csv')
    vi.runAllTimers()
    expect(JSON.stringify({ ...localStorage })).not.toContain('secret')
    expect(JSON.stringify({ ...sessionStorage })).not.toContain('secret')
  })
})
