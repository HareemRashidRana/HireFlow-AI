// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeCandidate } from '../../../test/fixtures'
import { renderAs } from '../../../test/render'
import type { UserRole } from '../../../types/auth'
import type { Candidate } from '../../../types/candidate'
import { CandidateDetailPage } from './CandidateDetailPage'

const get = vi.fn()
const audit = vi.fn()
const preview = vi.fn()
vi.mock('../../../api/candidates', () => ({ candidatesApi: { get: (...a: unknown[]) => get(...a), remove: vi.fn() } }))
vi.mock('../../../api/applications', () => ({ applicationsApi: { list: async () => ({ items: [], total: 0, page: 1, page_size: 20, stage_counts: {} }) } }))
vi.mock('../../../api/privacy', () => ({
  privacyApi: { audit: (...a: unknown[]) => audit(...a), anonymizationPreview: (...a: unknown[]) => preview(...a), anonymize: vi.fn(), exportOne: vi.fn() },
}))

beforeEach(() => {
  for (const m of [get, audit, preview]) m.mockReset()
  audit.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 5 })
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) { this.removeAttribute('open') }
})

function render(candidate: Candidate, role: UserRole) {
  get.mockResolvedValue(candidate)
  const view = renderAs(<CandidateDetailPage />, { path: '/recruitment/candidates/:id', url: `/recruitment/candidates/${candidate.id}`, role })
  return { ...view, user: userEvent.setup() }
}
const heading = () => screen.findByRole('heading', { level: 1 })

describe('privacy actions follow the role (the API enforces the same rules)', () => {
  it.each(['admin', 'hr_manager'] as const)('%s sees Export, Anonymize and the access history', async (role) => {
    render(makeCandidate(), role)
    await heading()
    expect(screen.getByRole('button', { name: 'Export data' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Anonymize…' })).toBeTruthy()
    expect(await screen.findByText('Access history')).toBeTruthy()
    await waitFor(() => expect(audit).toHaveBeenCalledWith({ candidate_id: 'cand-1', event_type: '', page: 1, page_size: 5 }, expect.anything()))
  })

  it('a recruiter sees none of it and never even asks for the audit trail', async () => {
    render(makeCandidate(), 'recruiter')
    await heading()
    expect(screen.queryByRole('button', { name: 'Export data' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Anonymize…' })).toBeNull()
    expect(screen.queryByText('Access history')).toBeNull()
    expect(audit).not.toHaveBeenCalled()
    expect(preview).not.toHaveBeenCalled()
  })

  it('an anonymized candidate has no Anonymize button (but can still be exported)', async () => {
    render(makeCandidate({ anonymized_at: '2026-10-01T09:00:00Z', first_name: 'Anonymized', last_name: 'Candidate' }), 'hr_manager')
    await heading()
    expect(screen.queryByRole('button', { name: 'Anonymize…' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Export data' })).toBeTruthy()
  })
})

describe('dialogs from the profile', () => {
  it('Anonymize… opens the preview, not the action', async () => {
    preview.mockResolvedValue({ candidate_id: 'cand-1', already_anonymized: false, fields_cleared: ['phone'], fields_replaced: ['email'], fields_kept: ['source'], application_count: 0, application_notes_cleared: 0, history_notes_cleared: 0 })
    const { user } = render(makeCandidate(), 'admin')
    await heading()
    await user.click(screen.getByRole('button', { name: 'Anonymize…' }))
    expect(await screen.findByText('Anonymize this candidate?')).toBeTruthy()
    expect(preview).toHaveBeenCalledWith('cand-1', expect.anything())
  })

  it('Export data opens the export dialog naming the person', async () => {
    const { user } = render(makeCandidate(), 'hr_manager')
    await heading()
    await user.click(screen.getByRole('button', { name: 'Export data' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Sana Iqbal')).toBeTruthy()
  })

  it('shows the access history entries', async () => {
    audit.mockResolvedValue({ items: [{ id: 'e1', event_type: 'candidate_viewed', candidate_id: 'cand-1', actor: { id: 'u', email: 'hr@example.com', role: 'hr_manager' }, metadata: {}, request_id: null, created_at: '2026-11-10T09:00:00Z' }], total: 1, page: 1, page_size: 5 })
    render(makeCandidate(), 'admin')
    await heading()
    expect(await screen.findByText('Profile viewed')).toBeTruthy()
    expect(screen.getByText(/hr@example\.com/)).toBeTruthy()
  })
})
