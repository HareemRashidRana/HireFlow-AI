// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../../api/errors'
import { isoDaysFromToday, makeCandidateItem, makeCandidateList } from '../../../test/fixtures'
import { LocationProbe } from '../../../test/LocationProbe'
import { renderAs } from '../../../test/render'
import { CandidatesPage } from './CandidatesPage'

const list = vi.fn()
vi.mock('../../../api/candidates', () => ({ candidatesApi: { list: (...a: unknown[]) => list(...a) } }))

const people = [
  makeCandidateItem({ id: 'c1', first_name: 'Sana', last_name: 'Iqbal', email: 'sana@example.com', source: 'linkedin' }),
  makeCandidateItem({
    id: 'c2', first_name: 'Bilal', last_name: 'Ahmed', email: 'bilal@corp.io', current_title: 'Accountant',
    current_company: 'Globex', source: 'referral', retain_until: isoDaysFromToday(10),
  }),
  makeCandidateItem({
    id: 'c3', first_name: 'Omar', last_name: 'Farooq', email: 'omar@example.com', location: null,
    current_title: null, current_company: null, source: 'agency', retain_until: isoDaysFromToday(-5),
  }),
]

beforeEach(() => {
  list.mockReset()
  list.mockResolvedValue(makeCandidateList(people))
})

const lastParams = () => list.mock.calls.at(-1)![0]
const render = (url = '/recruitment/candidates', role: 'admin' | 'hr_manager' | 'recruiter' = 'recruiter') =>
  renderAs(
    <>
      <CandidatesPage />
      <LocationProbe />
    </>,
    { path: '/recruitment/candidates', url, role },
  )
const urlNow = () => screen.getByTestId('location').textContent ?? ''
/** Give the app a moment to finish re-rendering after a navigation, so "absent" checks are real. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 150))

describe('listing', () => {
  it('shows each candidate with role, source and a retention badge', async () => {
    render()
    const rows = await screen.findAllByRole('row')
    const sana = rows.find((r) => r.textContent?.includes('Sana Iqbal'))!
    expect(within(sana).getByText('sana@example.com')).toBeTruthy()
    expect(within(sana).getByText('Backend Developer · Acme Ltd')).toBeTruthy()
    expect(within(sana).getByText('LinkedIn')).toBeTruthy()
    expect(within(sana).getByText(/^Until /)).toBeTruthy()
    const bilal = rows.find((r) => r.textContent?.includes('Bilal Ahmed'))!
    expect(within(bilal).getByText(/Review in 10 days/)).toBeTruthy()
    const omar = rows.find((r) => r.textContent?.includes('Omar Farooq'))!
    expect(within(omar).getByText('Past retention date')).toBeTruthy()
  })

  it('shows a dash instead of missing role and location', async () => {
    render()
    const omar = (await screen.findAllByRole('row')).find((r) => r.textContent?.includes('Omar Farooq'))!
    expect(within(omar).getAllByText('—').length).toBeGreaterThanOrEqual(2)
  })

  it('links each candidate to their profile', async () => {
    render()
    expect((await screen.findAllByRole('link', { name: 'Sana Iqbal' }))[0].getAttribute('href')).toBe('/recruitment/candidates/c1')
  })

  it('never shows phone numbers or consent details in the directory', async () => {
    render()
    await screen.findAllByRole('row')
    expect(document.body.textContent).not.toMatch(/\+92|consent|legitimate/i)
  })

  it('makes the first request with no filters', async () => {
    render()
    await screen.findAllByRole('row')
    expect(lastParams()).toMatchObject({ q: '', source: '', retention: '', page: 1, page_size: 10 })
  })
})

describe('search keeps personal data out of the address bar', () => {
  it('searches after a pause but never writes the search text to the URL', async () => {
    const user = userEvent.setup()
    render()
    await screen.findAllByRole('row')
    await user.type(screen.getByLabelText('Search candidates'), 'sana@example.com')
    await waitFor(() => expect(lastParams()).toMatchObject({ q: 'sana@example.com' }), { timeout: 2000 })
    await settle()
    expect(urlNow()).not.toMatch(/sana|example|q=/i)
    expect(urlNow()).toBe('/recruitment/candidates')
  })

  it('does not read a search term from the URL either', async () => {
    render('/recruitment/candidates?q=secret.name')
    await screen.findAllByRole('row')
    expect(lastParams().q).toBe('')
    expect((screen.getByLabelText('Search candidates') as HTMLInputElement).value).toBe('')
  })

  it('a new search goes back to page 1', async () => {
    const user = userEvent.setup()
    render('/recruitment/candidates?page=3')
    await screen.findAllByRole('row')
    await user.type(screen.getByLabelText('Search candidates'), 'omar')
    await waitFor(() => expect(lastParams()).toMatchObject({ q: 'omar', page: 1 }), { timeout: 2000 })
    await settle()
    expect(urlNow()).not.toMatch(/page=|omar|q=/)
  })

  it('a deep link to page 2 is kept when the page first loads', async () => {
    render('/recruitment/candidates?page=2')
    await screen.findAllByRole('row')
    expect(lastParams()).toMatchObject({ page: 2 })
    expect(urlNow()).toContain('page=2')
  })
})

describe('filters', () => {
  it('filter by source (kept in the URL) and reset to page 1', async () => {
    const user = userEvent.setup()
    render('/recruitment/candidates?page=2')
    await screen.findAllByRole('row')
    await user.selectOptions(screen.getByLabelText('Filter by source'), 'referral')
    await waitFor(() => expect(lastParams()).toMatchObject({ source: 'referral', page: 1 }))
    expect(urlNow()).toContain('source=referral')
    expect(urlNow()).not.toContain('page=')
  })

  it('filter by retention', async () => {
    const user = userEvent.setup()
    render()
    await screen.findAllByRole('row')
    await user.selectOptions(screen.getByLabelText('Filter by retention'), 'expired')
    await waitFor(() => expect(lastParams()).toMatchObject({ retention: 'expired' }))
    expect(urlNow()).toContain('retention=expired')
    expect(screen.getByRole('option', { name: 'Expiring within 30 days' })).toBeTruthy()
    expect(screen.getByRole('option', { name: 'Past retention date' })).toBeTruthy()
  })

  it('start from filters in the URL', async () => {
    render('/recruitment/candidates?source=agency&retention=expiring')
    await screen.findAllByRole('row')
    expect(lastParams()).toMatchObject({ source: 'agency', retention: 'expiring' })
  })

  it('ignore invalid filter values in the URL', async () => {
    render('/recruitment/candidates?source=tv&retention=soon&page=abc')
    await screen.findAllByRole('row')
    expect(lastParams()).toMatchObject({ source: '', retention: '', page: 1 })
  })

  it('"Clear" resets the filters, the search box and the URL', async () => {
    const user = userEvent.setup()
    render('/recruitment/candidates?source=agency')
    await screen.findAllByRole('row')
    await user.type(screen.getByLabelText('Search candidates'), 'omar')
    await user.click(screen.getByRole('button', { name: 'Clear' }))
    await waitFor(() => expect(lastParams()).toMatchObject({ q: '', source: '' }))
    expect((screen.getByLabelText('Search candidates') as HTMLInputElement).value).toBe('')
    expect(urlNow()).toBe('/recruitment/candidates')
  })
})

describe('pagination', () => {
  it('shows the range and moves to the next page', async () => {
    const many = Array.from({ length: 10 }, (_, i) => makeCandidateItem({ id: `p${i}`, email: `p${i}@example.com` }))
    list.mockResolvedValue(makeCandidateList(many, { total: 25 }))
    const user = userEvent.setup()
    render()
    expect(await screen.findByText('Showing 1–10 of 25')).toBeTruthy()
    expect(screen.getByText('Page 1 of 3')).toBeTruthy()
    expect((screen.getByRole('button', { name: /previous/i }) as HTMLButtonElement).disabled).toBe(true)
    await user.click(screen.getByRole('button', { name: /next/i }))
    await waitFor(() => expect(lastParams()).toMatchObject({ page: 2 }))
    expect(urlNow()).toContain('page=2')
  })
})

describe('states', () => {
  it('shows a loading indicator first', () => {
    list.mockReturnValue(new Promise(() => {}))
    render()
    expect(screen.getByText('Loading candidates…')).toBeTruthy()
  })

  it('shows an empty state with an add button', async () => {
    list.mockResolvedValue(makeCandidateList([]))
    render()
    expect(await screen.findByText('No candidates yet')).toBeTruthy()
    expect(screen.getAllByRole('link', { name: /add candidate/i }).length).toBeGreaterThan(0)
  })

  it('shows a "no matches" state when filters hide everything', async () => {
    list.mockResolvedValue(makeCandidateList([]))
    render('/recruitment/candidates?source=agency')
    expect(await screen.findByText('No candidates match your filters')).toBeTruthy()
  })

  it('shows an error with a working retry', async () => {
    list.mockRejectedValueOnce(new ApiError('Cannot reach the server.', 0))
    const user = userEvent.setup()
    render()
    expect(await screen.findByText("Couldn't load candidates")).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect((await screen.findAllByText('Sana Iqbal')).length).toBeGreaterThan(0)
  })
})

describe('permissions', () => {
  it.each(['admin', 'hr_manager', 'recruiter'] as const)('%s can add candidates', async (role) => {
    render('/recruitment/candidates', role)
    await screen.findAllByRole('row')
    expect(screen.getAllByRole('link', { name: /add candidate/i })[0].getAttribute('href')).toBe('/recruitment/candidates/new')
  })

  it('states that candidates are separate from employees', async () => {
    render()
    expect(await screen.findByText(/kept separate from your employees/i)).toBeTruthy()
  })
})
