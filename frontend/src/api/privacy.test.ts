import { beforeEach, describe, expect, it, vi } from 'vitest'

const request = vi.fn()
const download = vi.fn()
vi.mock('./http', () => ({
  request: (...a: unknown[]) => request(...a),
  download: (...a: unknown[]) => download(...a),
}))

import { privacyApi } from './privacy'

beforeEach(() => {
  request.mockReset()
  download.mockReset()
  request.mockResolvedValue({})
  download.mockResolvedValue({})
})

describe('privacyApi', () => {
  it('lists retention with only the set filters', async () => {
    await privacyApi.retention({ status: 'expired', page: 2, page_size: 10 })
    expect(request).toHaveBeenCalledWith('/privacy/retention?status=expired&page=2&page_size=10', { signal: undefined })
  })

  it('reads the audit trail, optionally for one candidate or event type', async () => {
    await privacyApi.audit({ candidate_id: 'c1', event_type: 'candidate_exported', page: 3 })
    expect(request).toHaveBeenCalledWith('/privacy/audit?candidate_id=c1&event_type=candidate_exported&page=3', { signal: undefined })
    await privacyApi.audit({ event_type: '' })
    expect(request).toHaveBeenLastCalledWith('/privacy/audit', { signal: undefined })
  })

  it('previews anonymization with GET and encodes the id', async () => {
    await privacyApi.anonymizationPreview('a/b c')
    expect(request).toHaveBeenCalledWith('/candidates/a%2Fb%20c/anonymization-preview', { signal: undefined })
  })

  it('anonymizes with POST and always sends the explicit confirmation', async () => {
    await privacyApi.anonymize('c1')
    expect(request).toHaveBeenCalledWith('/candidates/c1/anonymize', { method: 'POST', json: { confirm: true } })
  })

  it('exports with POST so nothing goes into a URL', async () => {
    await privacyApi.exportOne('c1', 'json')
    await privacyApi.exportMany({ format: 'csv', source: 'agency', retention: 'expired' })
    expect(download.mock.calls).toEqual([
      ['/candidates/c1/export', { method: 'POST', json: { format: 'json' } }],
      ['/candidates/export', { method: 'POST', json: { format: 'csv', source: 'agency', retention: 'expired' } }],
    ])
    expect(JSON.stringify(download.mock.calls)).not.toContain('?')
  })

  it('previews a purge as a dry run, and only deletes when asked with the confirmation word', async () => {
    await privacyApi.purgePreview()
    await privacyApi.purge('PURGE', 10)
    expect(request.mock.calls).toEqual([
      ['/privacy/purge', { method: 'POST', json: { dry_run: true, limit: 50 } }],
      ['/privacy/purge', { method: 'POST', json: { dry_run: false, confirm: 'PURGE', limit: 10 } }],
    ])
  })

  it('has no way to edit or delete audit records', () => {
    for (const name of Object.keys(privacyApi)) expect(name).not.toMatch(/delete|remove|update|edit|clearAudit/i)
  })
})
