// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../../api/errors'
import { makeStaff } from '../../../test/fixtures'
import { LocationProbe } from '../../../test/LocationProbe'
import { renderAs } from '../../../test/render'
import type { AuditEvent, RetentionItem, RetentionList } from '../../../types/privacy'
import { PrivacyPage } from './PrivacyPage'

const api = {
  retention: vi.fn(), audit: vi.fn(), anonymizationPreview: vi.fn(), anonymize: vi.fn(),
  exportOne: vi.fn(), exportMany: vi.fn(), purgePreview: vi.fn(), purge: vi.fn(),
}
vi.mock('../../../api/privacy', () => ({ privacyApi: new Proxy({}, { get: (_t, k) => (api as Record<string, unknown>)[k as string] }) }))
vi.mock('../../../lib/download', () => ({ saveFile: vi.fn() }))

const item = (over: Partial<RetentionItem> = {}): RetentionItem => ({
  id: 'c1', first_name: 'Sana', last_name: 'Iqbal', email: 'sana@example.com', consent_basis: 'legitimate_interest',
  consent_date: '2026-01-05', last_activity_at: '2026-01-05T09:00:00Z', retain_until: '2027-01-05', anonymized_at: null,
  application_count: 1, status: 'active', purge_eligible: false, ...over,
})
const list = (items: RetentionItem[], over: Partial<RetentionList> = {}): RetentionList => ({
  summary: { expiring: 2, expired: 3, anonymized: 1, purge_eligible: 2, expired_with_applications: 1, retention_months: 12, expiring_window_days: 30, purge_enabled: false },
  items, total: items.length, page: 1, page_size: 10, ...over,
})
const people = [
  item({ id: 'c1' }),
  item({ id: 'c2', first_name: 'Bilal', last_name: 'Ahmed', email: 'bilal@example.com', status: 'expired', retain_until: '2025-12-01', application_count: 0, purge_eligible: true }),
  item({ id: 'c3', first_name: 'Anonymized', last_name: 'Candidate', email: 'anonymized-c3@anonymized.invalid', status: 'anonymized', anonymized_at: '2026-10-01T09:00:00Z' }),
]

beforeEach(() => {
  for (const m of Object.values(api)) m.mockReset()
  api.retention.mockImplementation(async () => list(people))
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) { this.removeAttribute('open') }
})

const render = (url = '/recruitment/privacy', role: 'admin' | 'hr_manager' = 'hr_manager') =>
  renderAs(<><PrivacyPage /><LocationProbe /></>, { path: '/recruitment/privacy', url, role })
const lastParams = () => api.retention.mock.calls.at(-1)![0]
const urlNow = () => screen.getByTestId('location').textContent ?? ''

describe('retention overview', () => {
  it('shows real counts, the configured period and each person with their status', async () => {
    render()
    const overview = await screen.findByRole('region', { name: 'Retention overview' })
    expect(within(overview).getByText('Expiring soon').nextSibling!.textContent).toBe('2')
    expect(within(overview).getByText('Past retention').nextSibling!.textContent).toBe('3')
    expect(within(overview).getByText('Anonymized').nextSibling!.textContent).toBe('1')
    expect(within(overview).getByText('Eligible for deletion').nextSibling!.textContent).toBe('2')
    expect(screen.getByText(/kept for 12 months after their last meaningful activity/)).toBeTruthy()
    const rows = screen.getAllByRole('row')
    const bilal = rows.find((r) => r.textContent?.includes('Bilal Ahmed'))!
    expect(within(bilal).getByText('Past retention')).toBeTruthy()
    expect(within(bilal).getByText(/Until 1 Dec 2025/)).toBeTruthy()
    expect(within(bilal).getByText('0')).toBeTruthy()
  })

  it('shows the consent basis and date, and the application count', async () => {
    render()
    const sana = (await screen.findAllByRole('row')).find((r) => r.textContent?.includes('Sana Iqbal'))!
    expect(within(sana).getByText('Legitimate interest')).toBeTruthy()
    expect(within(sana).getByText(/since 5 Jan 2026/)).toBeTruthy()
    expect(within(sana).getByText('1')).toBeTruthy()
  })

  it('shows anonymized people as placeholders, with the date', async () => {
    render()
    const row = (await screen.findAllByRole('row')).find((r) => r.textContent?.includes('anonymized-c3'))!
    expect(within(row).getAllByText('Anonymized').length).toBeGreaterThan(0)
    expect(within(row).getByText(/Anonymized 1 Oct 2026/)).toBeTruthy()
  })

  it('offers Anonymize only for people who are not yet anonymized', async () => {
    render()
    await screen.findAllByRole('row')
    expect(screen.getAllByRole('button', { name: 'Anonymize Sana Iqbal' }).length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: /Anonymize Anonymized Candidate/ })).toBeNull()
    expect(screen.getAllByRole('button', { name: 'Export Anonymized Candidate' }).length).toBeGreaterThan(0)
  })

  it('links each person to their profile', async () => {
    render()
    expect((await screen.findAllByRole('link', { name: 'Sana Iqbal' }))[0].getAttribute('href')).toBe('/recruitment/candidates/c1')
  })

  it('has both a table and cards so it works on a phone', async () => {
    render()
    await screen.findAllByRole('row')
    expect(document.querySelector('table')!.parentElement!.className).toContain('md:block')
    expect(document.querySelectorAll('ul.md\\:hidden > li')).toHaveLength(3)
  })
})

describe('filtering and paging', () => {
  it('filters by tile or tab and keeps only the status in the URL', async () => {
    const user = userEvent.setup()
    render()
    await screen.findAllByRole('row')
    await user.click(screen.getByRole('button', { name: /Past retention/ }))
    await waitFor(() => expect(lastParams()).toMatchObject({ status: 'expired', page: 1 }))
    expect(urlNow()).toContain('status=expired')
    await user.click(screen.getByRole('tab', { name: 'All' }))
    await waitFor(() => expect(lastParams().status).toBe('all'))
    expect(urlNow()).not.toContain('status')
  })

  it('ignores an unknown status in the URL', async () => {
    render('/recruitment/privacy?status=evil')
    await screen.findAllByRole('row')
    expect(lastParams().status).toBe('all')
  })

  it('pages through results', async () => {
    api.retention.mockImplementation(async () => list(people, { total: 25 }))
    const user = userEvent.setup()
    render()
    await screen.findAllByRole('row')
    expect(screen.getByText('Page 1 of 3')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: /Next/ }))
    await waitFor(() => expect(lastParams().page).toBe(2))
    expect(urlNow()).toContain('page=2')
  })

  it('explains an empty group', async () => {
    api.retention.mockImplementation(async () => list([]))
    render('/recruitment/privacy?status=anonymized')
    expect(await screen.findByText('Nobody here')).toBeTruthy()
  })
})

describe('states', () => {
  it('shows loading, then an error with retry that works', async () => {
    api.retention.mockRejectedValueOnce(new ApiError('Server is down', 500))
    const user = userEvent.setup()
    render()
    expect(screen.getByText('Loading retention data…')).toBeTruthy()
    expect(await screen.findByText('Server is down')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect((await screen.findAllByRole('row')).length).toBeGreaterThan(1)
  })

  it('keeps the old list and offers a retry when a later load fails', async () => {
    const user = userEvent.setup()
    render()
    await screen.findAllByRole('row')
    api.retention.mockRejectedValueOnce(new ApiError('Lost connection', 0))
    await user.click(screen.getByRole('tab', { name: 'Anonymized' }))
    expect(await screen.findByText('Lost connection')).toBeTruthy()
    expect(screen.getAllByRole('row').length).toBeGreaterThan(1)
  })
})

describe('actions open the right dialogs', () => {
  it('Anonymize opens a preview first and does nothing yet', async () => {
    api.anonymizationPreview.mockResolvedValue({ candidate_id: 'c1', already_anonymized: false, fields_cleared: ['phone'], fields_replaced: ['email'], fields_kept: ['source'], application_count: 1, application_notes_cleared: 0, history_notes_cleared: 0 })
    const user = userEvent.setup()
    render()
    await user.click((await screen.findAllByRole('button', { name: 'Anonymize Sana Iqbal' }))[0])
    expect(await screen.findByText('Anonymize this candidate?')).toBeTruthy()
    expect(api.anonymizationPreview).toHaveBeenCalledWith('c1', expect.anything())
    expect(api.anonymize).not.toHaveBeenCalled()
  })

  it('Export on a row opens the export dialog for that person', async () => {
    const user = userEvent.setup()
    render()
    await user.click((await screen.findAllByRole('button', { name: 'Export Sana Iqbal' }))[0])
    expect(await screen.findByText(/Export the data held about/)).toBeTruthy()
  })

  it('"Export candidates" opens the bulk export dialog', async () => {
    const user = userEvent.setup()
    render()
    await user.click(await screen.findByRole('button', { name: 'Export candidates' }))
    expect(await screen.findByText(/anonymized people are left out/)).toBeTruthy()
  })

  it('"Review expired" runs a dry run only', async () => {
    api.purgePreview.mockResolvedValue({ dry_run: true, purge_enabled: false, eligible_total: 2, batch_size: 2, candidate_ids: [], deleted: 0, remaining_eligible: 2, expired_with_applications: 1 })
    const user = userEvent.setup()
    render()
    await user.click(await screen.findByRole('button', { name: 'Review expired' }))
    expect(await screen.findByText(/past their retention date/)).toBeTruthy()
    expect(api.purge).not.toHaveBeenCalled()
  })

  it('refreshes the list after an anonymization', async () => {
    api.anonymizationPreview.mockResolvedValue({ candidate_id: 'c1', already_anonymized: false, fields_cleared: ['phone'], fields_replaced: ['email'], fields_kept: ['source'], application_count: 0, application_notes_cleared: 0, history_notes_cleared: 0 })
    api.anonymize.mockResolvedValue({ changed: true, candidate: {} })
    const user = userEvent.setup()
    render()
    await user.click((await screen.findAllByRole('button', { name: 'Anonymize Sana Iqbal' }))[0])
    await user.click(await screen.findByLabelText(/I understand/))
    const calls = api.retention.mock.calls.length
    await user.click(screen.getByRole('button', { name: 'Anonymize candidate' }))
    await waitFor(() => expect(api.retention.mock.calls.length).toBeGreaterThan(calls))
  })
})

describe('audit log tab', () => {
  const events: AuditEvent[] = [
    { id: 'e1', event_type: 'candidate_exported', candidate_id: 'aaaaaaaa-1111', actor: makeStaff({ email: 'hr@example.com' }), metadata: { format: 'csv', scope: 'single' }, request_id: 'req-12345678-abcd', created_at: '2026-11-10T09:00:00Z' },
    { id: 'e2', event_type: 'candidate_purged', candidate_id: 'bbbbbbbb-2222', actor: null, metadata: { reason: 'retention_expired' }, request_id: null, created_at: '2026-11-09T09:00:00Z' },
    { id: 'e3', event_type: 'candidate_updated', candidate_id: 'cccccccc-3333', actor: makeStaff(), metadata: { fields: ['phone'] }, request_id: null, created_at: '2026-11-08T09:00:00Z' },
  ]
  beforeEach(() => {
    api.audit.mockImplementation(async () => ({ items: events, total: 3, page: 1, page_size: 15 }))
  })

  it('opens from the tab, lists events newest first with who and when, and puts only the tab in the URL', async () => {
    const user = userEvent.setup()
    render()
    await screen.findAllByRole('row')
    await user.click(screen.getByRole('tab', { name: 'Audit log' }))
    const log = await screen.findByRole('list', { name: 'Audit history' })
    const rows = within(log).getAllByRole('listitem')
    expect(rows[0].textContent).toContain('Exported as CSV (single candidate)')
    expect(rows[0].textContent).toContain('hr@example.com')
    expect(rows[0].textContent).toContain('ref req-1234')
    expect(rows[1].textContent).toContain('a removed user')
    expect(rows[2].textContent).toContain('Details edited: phone')
    expect(urlNow()).toBe('/recruitment/privacy?tab=audit')
  })

  it('links to existing candidates but not to deleted ones', async () => {
    const user = userEvent.setup()
    render('/recruitment/privacy?tab=audit')
    await screen.findByRole('list', { name: 'Audit history' })
    expect(screen.getByRole('link', { name: 'Candidate aaaaaaaa' }).getAttribute('href')).toBe('/recruitment/candidates/aaaaaaaa-1111')
    expect(screen.queryByRole('link', { name: 'Candidate bbbbbbbb' })).toBeNull()
    expect(screen.getByText('Candidate bbbbbbbb')).toBeTruthy()
    void user
  })

  it('filters by event type and pages', async () => {
    api.audit.mockImplementation(async () => ({ items: events, total: 40, page: 1, page_size: 15 }))
    const user = userEvent.setup()
    render('/recruitment/privacy?tab=audit')
    await screen.findByRole('list', { name: 'Audit history' })
    await user.selectOptions(screen.getByLabelText('Filter by event'), 'candidate_exported')
    await waitFor(() => expect(api.audit.mock.calls.at(-1)![0]).toMatchObject({ event_type: 'candidate_exported', page: 1 }))
    await user.click(screen.getByRole('button', { name: /Next/ }))
    await waitFor(() => expect(api.audit.mock.calls.at(-1)![0].page).toBe(2))
  })

  it('has no controls that could edit or delete audit records', async () => {
    render('/recruitment/privacy?tab=audit')
    await screen.findByRole('list', { name: 'Audit history' })
    expect(screen.queryByRole('button', { name: /delete|edit|remove|clear/i })).toBeNull()
  })

  it('shows empty and error states', async () => {
    api.audit.mockImplementation(async () => ({ items: [], total: 0, page: 1, page_size: 15 }))
    const { unmount } = render('/recruitment/privacy?tab=audit')
    expect(await screen.findByText('No audit events')).toBeTruthy()
    unmount()
    api.audit.mockReset()
    api.audit.mockRejectedValueOnce(new ApiError('Audit unavailable', 500))
    render('/recruitment/privacy?tab=audit')
    expect(await screen.findByText('Audit unavailable')).toBeTruthy()
  })
})

describe('personal data stays out of the URL', () => {
  it('never writes a name, email or id into the address bar while browsing', async () => {
    api.audit.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 15 })
    const user = userEvent.setup()
    render()
    await screen.findAllByRole('row')
    await user.click(screen.getByRole('button', { name: /Past retention/ }))
    await user.click(screen.getByRole('tab', { name: 'Audit log' }))
    expect(urlNow()).not.toMatch(/sana|iqbal|bilal|example\.com|c1|c2/i)
  })
})
