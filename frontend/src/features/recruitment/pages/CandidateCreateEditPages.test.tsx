// @vitest-environment jsdom
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../../api/errors'
import { makeCandidate } from '../../../test/fixtures'
import { renderAs } from '../../../test/render'
import { todayIso } from '../lib/retention'
import { CandidateCreatePage } from './CandidateCreatePage'
import { CandidateEditPage } from './CandidateEditPage'

const create = vi.fn()
const get = vi.fn()
const update = vi.fn()
const findByEmail = vi.fn()
vi.mock('../../../api/candidates', () => ({
  candidatesApi: {
    create: (...a: unknown[]) => create(...a),
    get: (...a: unknown[]) => get(...a),
    update: (...a: unknown[]) => update(...a),
    findByEmail: (...a: unknown[]) => findByEmail(...a),
  },
}))

beforeEach(() => {
  create.mockReset()
  get.mockReset()
  update.mockReset()
  findByEmail.mockReset()
  findByEmail.mockResolvedValue(null)
})

describe('create page', () => {
  async function fillAndSubmit(user: ReturnType<typeof userEvent.setup>) {
    await user.type(screen.getByLabelText(/first name/i), 'Sana')
    await user.type(screen.getByLabelText(/last name/i), 'Iqbal')
    await user.type(screen.getByLabelText(/^email/i), 'Sana@Example.com')
    await user.selectOptions(screen.getByLabelText(/^source/i), 'referral')
    await user.selectOptions(screen.getByLabelText(/basis for holding/i), 'consent')
    await user.click(screen.getByRole('button', { name: 'Add candidate' }))
  }

  it('creates the candidate with a normalised payload, then opens the profile', async () => {
    create.mockResolvedValue(makeCandidate({ id: 'new-1' }))
    renderAs(<CandidateCreatePage />, { path: '/recruitment/candidates/new', url: '/recruitment/candidates/new' })
    await fillAndSubmit(userEvent.setup())
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    expect(create.mock.calls[0][0]).toEqual({
      first_name: 'Sana',
      last_name: 'Iqbal',
      email: 'sana@example.com',
      phone: null,
      location: null,
      current_title: null,
      current_company: null,
      source: 'referral',
      consent_basis: 'consent',
      consent_basis_note: null,
      consent_date: todayIso(),
    })
    expect((await screen.findByTestId('location')).textContent).toBe('/recruitment/candidates/new-1')
    expect(await screen.findByText('Candidate added.')).toBeTruthy()
  })

  it('stays on the form and explains a duplicate email', async () => {
    create.mockRejectedValue(new ApiError('A candidate with this email already exists', 409))
    renderAs(<CandidateCreatePage />, { path: '/recruitment/candidates/new', url: '/recruitment/candidates/new' })
    await fillAndSubmit(userEvent.setup())
    expect(await screen.findByText('A candidate with this email already exists')).toBeTruthy()
    expect(screen.queryByTestId('location')).toBeNull()
  })

  it('tells people candidates are not employees', () => {
    renderAs(<CandidateCreatePage />, { path: '/recruitment/candidates/new', url: '/recruitment/candidates/new' })
    expect(screen.getByText(/separate from employees/i)).toBeTruthy()
  })
})

describe('edit page', () => {
  const render = (candidate = makeCandidate({ id: 'c1' })) => {
    get.mockResolvedValue(candidate)
    return renderAs(<CandidateEditPage />, { path: '/recruitment/candidates/:id/edit', url: `/recruitment/candidates/${candidate.id}/edit` })
  }

  it('prefills the form', async () => {
    render()
    expect(((await screen.findByLabelText(/first name/i)) as HTMLInputElement).value).toBe('Sana')
    expect((screen.getByLabelText(/^email/i) as HTMLInputElement).value).toBe('sana.iqbal@example.com')
  })

  it('saving without changes says so and updates nothing', async () => {
    const user = userEvent.setup()
    render()
    await screen.findByLabelText(/first name/i)
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByText('No changes to save.')).toBeTruthy()
    expect(update).not.toHaveBeenCalled()
    expect((await screen.findByTestId('location')).textContent).toBe('/recruitment/candidates/c1')
  })

  it('sends only the fields that changed', async () => {
    update.mockResolvedValue(makeCandidate())
    const user = userEvent.setup()
    render()
    const location = await screen.findByLabelText(/^location/i)
    await user.clear(location)
    await user.type(location, 'Karachi')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1))
    expect(update).toHaveBeenCalledWith('c1', { location: 'Karachi' })
    expect(await screen.findByText('Candidate updated.')).toBeTruthy()
  })

  it('re-recording the basis date is sent as a change (it restarts retention)', async () => {
    update.mockResolvedValue(makeCandidate())
    const user = userEvent.setup()
    render()
    const date = await screen.findByLabelText(/date the basis was established/i)
    fireEvent.change(date, { target: { value: '2026-11-09' } })
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(update).toHaveBeenCalledWith('c1', { consent_date: '2026-11-09' }))
  })

  it('refuses to edit an anonymized candidate', async () => {
    render(makeCandidate({ id: 'c1', anonymized_at: '2026-11-05T00:00:00Z' }))
    expect(await screen.findByText('This candidate was anonymized')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull()
  })

  it('shows "not found" for a missing candidate', async () => {
    get.mockRejectedValue(new ApiError('Candidate not found', 404))
    renderAs(<CandidateEditPage />, { path: '/recruitment/candidates/:id/edit', url: '/recruitment/candidates/nope/edit' })
    expect(await screen.findByText('Candidate not found')).toBeTruthy()
  })
})
