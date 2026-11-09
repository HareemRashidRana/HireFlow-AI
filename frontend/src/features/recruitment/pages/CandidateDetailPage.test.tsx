// @vitest-environment jsdom
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../../api/errors'
import { isoDaysFromToday, makeCandidate } from '../../../test/fixtures'
import { renderAs } from '../../../test/render'
import type { UserRole } from '../../../types/auth'
import type { Candidate } from '../../../types/candidate'
import { CandidateDetailPage } from './CandidateDetailPage'

const get = vi.fn()
const remove = vi.fn()
vi.mock('../../../api/candidates', () => ({
  candidatesApi: { get: (...a: unknown[]) => get(...a), remove: (...a: unknown[]) => remove(...a) },
}))

beforeEach(() => {
  get.mockReset()
  remove.mockReset()
})

function render(candidate: Candidate, role: UserRole = 'recruiter') {
  get.mockResolvedValue(candidate)
  const view = renderAs(<CandidateDetailPage />, {
    path: '/recruitment/candidates/:id',
    url: `/recruitment/candidates/${candidate.id}`,
    role,
  })
  return { ...view, user: userEvent.setup() }
}

const link = (name: string | RegExp) => screen.queryByRole('link', { name })
const button = (name: string | RegExp) => screen.queryByRole('button', { name })
const heading = () => screen.findByRole('heading', { level: 1 })

describe('content', () => {
  it('shows a loading state first', () => {
    get.mockReturnValue(new Promise(() => {}))
    renderAs(<CandidateDetailPage />, { path: '/recruitment/candidates/:id', url: '/recruitment/candidates/c1' })
    expect(screen.getByText('Loading candidate…')).toBeTruthy()
  })

  it('shows the contact details, role and source', async () => {
    render(makeCandidate())
    expect((await heading()).textContent).toBe('Sana Iqbal')
    expect(screen.getByText('Backend Developer at Acme Ltd')).toBeTruthy()
    expect(screen.getByRole('link', { name: /sana\.iqbal@example\.com/ }).getAttribute('href')).toBe('mailto:sana.iqbal@example.com')
    expect(screen.getByRole('link', { name: /\+92 300 1234567/ }).getAttribute('href')).toBe('tel:+92 300 1234567')
    expect(screen.getByText('Lahore, Pakistan')).toBeTruthy()
    expect(screen.getAllByText('LinkedIn').length).toBeGreaterThan(0)
  })

  it('handles missing optional details', async () => {
    render(makeCandidate({ phone: null, location: null, current_title: null, current_company: null }))
    await heading()
    expect(screen.getAllByText('Not provided')).toHaveLength(4)
    expect(screen.getByText('No current role recorded')).toBeTruthy()
  })

  it('does not link to the employees area: candidates are separate from employees', async () => {
    render(makeCandidate(), 'admin')
    await heading()
    expect(document.querySelector('a[href^="/employees"]')).toBeNull()
  })

  it('shows no sensitive fields', async () => {
    render(makeCandidate())
    await heading()
    expect(document.body.textContent).not.toMatch(/date of birth|gender|nationality|salary|national id/i)
  })
})

describe('data basis and retention', () => {
  it('shows the basis, its date and the last activity', async () => {
    render(makeCandidate({ consent_basis: 'pre_contract_steps', consent_date: '2026-10-01' }))
    await heading()
    const card = screen.getByText('Data basis and retention').closest('div')!.parentElement!
    expect(within(card).getByText('Steps before a contract')).toBeTruthy()
    expect(within(card).getByText('1 Oct 2026')).toBeTruthy()
    expect(within(card).getByText('1 Nov 2026')).toBeTruthy() // last activity
  })

  it('shows the explanation when the basis is "Other"', async () => {
    render(makeCandidate({ consent_basis: 'other', consent_basis_note: 'Referred by a partner firm' }))
    await heading()
    expect(screen.getByText('Other')).toBeTruthy()
    expect(screen.getByText('Referred by a partner firm')).toBeTruthy()
  })

  it('does not present consent unless that is the recorded basis', async () => {
    render(makeCandidate({ consent_basis: 'legitimate_interest' }))
    await heading()
    expect(screen.getByText('Legitimate interest')).toBeTruthy()
    expect(screen.queryByText('Consent')).toBeNull()
  })

  it.each([
    ['far from expiry', 200, /^Until /],
    ['close to expiry', 12, /Review in 12 days/],
    ['past its date', -3, /Past retention date/],
  ])('flags retention when %s', async (_label, days, expected) => {
    render(makeCandidate({ retain_until: isoDaysFromToday(days) }))
    await heading()
    expect(screen.getAllByText(expected).length).toBeGreaterThan(0)
  })

  it('explains what the retention date means', async () => {
    render(makeCandidate())
    await heading()
    expect(screen.getByText(/unless there is further activity, then due for review/i)).toBeTruthy()
  })
})

describe('what each role can do', () => {
  it.each(['admin', 'hr_manager'] as const)('%s can edit and delete', async (role) => {
    render(makeCandidate(), role)
    await heading()
    expect(link('Edit')).toBeTruthy()
    expect(button('Delete')).toBeTruthy()
  })

  it('a recruiter can edit but not delete', async () => {
    render(makeCandidate(), 'recruiter')
    await heading()
    expect(link('Edit')).toBeTruthy()
    expect(button('Delete')).toBeNull()
  })

  it('the edit link points at the edit page', async () => {
    render(makeCandidate({ id: 'abc' }))
    expect((await screen.findByRole('link', { name: 'Edit' })).getAttribute('href')).toBe('/recruitment/candidates/abc/edit')
  })
})

describe('anonymized candidates', () => {
  it('show a notice and cannot be edited', async () => {
    render(makeCandidate({ anonymized_at: '2026-11-05T00:00:00Z' }), 'admin')
    await heading()
    expect(screen.getByText(/personal data was anonymized/i)).toBeTruthy()
    expect(link('Edit')).toBeNull()
  })
})

describe('deleting', () => {
  it('asks first, then deletes and returns to the directory', async () => {
    remove.mockResolvedValue(undefined)
    const { user } = render(makeCandidate({ id: 'cand-77' }), 'hr_manager')
    await user.click(await screen.findByRole('button', { name: 'Delete' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('Delete candidate?')).toBeTruthy()
    expect(within(dialog).getByText('Sana Iqbal')).toBeTruthy()
    expect(remove).not.toHaveBeenCalled()
    await user.click(within(dialog).getByRole('button', { name: 'Delete candidate' }))
    expect(remove).toHaveBeenCalledWith('cand-77')
    expect((await screen.findByTestId('location')).textContent).toBe('/recruitment/candidates')
    expect(await screen.findByText('Candidate deleted.')).toBeTruthy()
  })

  it('cancelling deletes nothing', async () => {
    const { user } = render(makeCandidate(), 'admin')
    await user.click(await screen.findByRole('button', { name: 'Delete' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }))
    expect(remove).not.toHaveBeenCalled()
  })

  it('shows a server refusal inside the dialog', async () => {
    remove.mockRejectedValue(new ApiError('You do not have permission to perform this action.', 403))
    const { user } = render(makeCandidate(), 'admin')
    await user.click(await screen.findByRole('button', { name: 'Delete' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete candidate' }))
    expect(await within(screen.getByRole('dialog')).findByText(/do not have permission/i)).toBeTruthy()
    expect(screen.queryByTestId('location')).toBeNull()
  })
})

describe('errors', () => {
  it('shows "Candidate not found" for a missing candidate', async () => {
    get.mockRejectedValue(new ApiError('Candidate not found', 404))
    renderAs(<CandidateDetailPage />, { path: '/recruitment/candidates/:id', url: '/recruitment/candidates/nope' })
    expect(await screen.findByText('Candidate not found')).toBeTruthy()
  })

  it('shows a retry for other errors and recovers', async () => {
    get.mockRejectedValueOnce(new ApiError('Cannot reach the server.', 0))
    get.mockResolvedValue(makeCandidate())
    const user = userEvent.setup()
    renderAs(<CandidateDetailPage />, { path: '/recruitment/candidates/:id', url: '/recruitment/candidates/c1' })
    expect(await screen.findByText("Couldn't load the candidate")).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect((await heading()).textContent).toBe('Sana Iqbal')
  })

  it('has a back link to the directory', async () => {
    render(makeCandidate())
    expect((await screen.findByRole('link', { name: /all candidates/i })).getAttribute('href')).toBe('/recruitment/candidates')
  })
})
