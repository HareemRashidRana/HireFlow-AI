// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../../api/errors'
import {
  makeApplication,
  makeApplicationItem,
  makeApplicationList,
  makeCandidate,
  makeCandidateItem,
  makeCandidateList,
  makeJob,
  makeJobList,
} from '../../../test/fixtures'
import { LocationProbe } from '../../../test/LocationProbe'
import { renderAs } from '../../../test/render'
import { ApplicationCreatePage } from './ApplicationCreatePage'

const create = vi.fn()
const listApplications = vi.fn()
const listCandidates = vi.fn()
const getCandidate = vi.fn()
const listJobs = vi.fn()
vi.mock('../../../api/applications', () => ({
  applicationsApi: { create: (...a: unknown[]) => create(...a), list: (...a: unknown[]) => listApplications(...a) },
}))
vi.mock('../../../api/candidates', () => ({
  candidatesApi: { list: (...a: unknown[]) => listCandidates(...a), get: (...a: unknown[]) => getCandidate(...a) },
}))
vi.mock('../../../api/jobs', () => ({ jobsApi: { list: (...a: unknown[]) => listJobs(...a) } }))

const sana = makeCandidateItem({ id: 'c1', first_name: 'Sana', last_name: 'Iqbal', email: 'sana@example.com' })
const bilal = makeCandidateItem({ id: 'c2', first_name: 'Bilal', last_name: 'Ahmed', email: 'bilal@example.com' })
const openJobs = [
  makeJob({ id: 'j1', title: 'Backend Engineer', department: 'Engineering', status: 'open' }),
  makeJob({ id: 'j2', title: 'Product Designer', department: 'Design', status: 'open' }),
]

beforeEach(() => {
  for (const m of [create, listApplications, listCandidates, getCandidate, listJobs]) m.mockReset()
  listCandidates.mockResolvedValue(makeCandidateList([sana, bilal]))
  listJobs.mockResolvedValue(makeJobList(openJobs))
})

const render = (url = '/recruitment/applications/new') =>
  renderAs(
    <>
      <ApplicationCreatePage />
      <LocationProbe />
    </>,
    { path: '/recruitment/applications/new', url, role: 'recruiter' },
  )
const submit = () => screen.getByRole('button', { name: 'Create application' }) as HTMLButtonElement

async function pickCandidate(user: ReturnType<typeof userEvent.setup>, term = 'sana') {
  await user.type(screen.getByLabelText('Search candidates'), term)
  await user.click(await screen.findByRole('button', { name: /Sana Iqbal/, hidden: false }, { timeout: 2000 }))
}

describe('choosing a candidate', () => {
  it('asks for at least two characters before searching', async () => {
    const user = userEvent.setup()
    render()
    expect(screen.getByText('Type at least two characters.')).toBeTruthy()
    await user.type(screen.getByLabelText('Search candidates'), 's')
    await new Promise((r) => setTimeout(r, 400))
    expect(listCandidates).not.toHaveBeenCalled()
  })

  it('searches existing candidates and lists matches', async () => {
    const user = userEvent.setup()
    render()
    await user.type(screen.getByLabelText('Search candidates'), 'sa')
    const list = await screen.findByRole('list', { name: 'Matching candidates' }, { timeout: 2000 })
    expect(list.textContent).toContain('Sana Iqbal')
    expect(list.textContent).toContain('bilal@example.com')
    expect(listCandidates.mock.calls.at(-1)![0]).toMatchObject({ q: 'sa', page_size: 8 })
  })

  it('never puts the search text in the address bar', async () => {
    const user = userEvent.setup()
    render()
    await user.type(screen.getByLabelText('Search candidates'), 'sana@example.com')
    await screen.findByRole('list', { name: 'Matching candidates' }, { timeout: 2000 })
    expect(screen.getByTestId('location').textContent).toBe('/recruitment/applications/new')
  })

  it('points to "add a new candidate" when nobody matches (and creates no candidate itself)', async () => {
    listCandidates.mockResolvedValue(makeCandidateList([]))
    const user = userEvent.setup()
    render()
    await user.type(screen.getByLabelText('Search candidates'), 'zzz')
    expect(await screen.findByText(/No candidates found/, undefined, { timeout: 2000 })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Add a new candidate' }).getAttribute('href')).toBe('/recruitment/candidates/new')
  })

  it('shows search errors with a retry', async () => {
    listCandidates.mockRejectedValueOnce(new ApiError('Search is down', 500))
    const user = userEvent.setup()
    render()
    await user.type(screen.getByLabelText('Search candidates'), 'sana')
    expect((await screen.findByRole('alert', undefined, { timeout: 2000 })).textContent).toContain('Search is down')
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('list', { name: 'Matching candidates' })).toBeTruthy()
  })

  it('lets the user change their pick', async () => {
    const user = userEvent.setup()
    render()
    await pickCandidate(user)
    expect(screen.queryByLabelText('Search candidates')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Change' }))
    expect(screen.getByLabelText('Search candidates')).toBeTruthy()
  })

  it('preloads a candidate named in the link (an id, not personal data)', async () => {
    getCandidate.mockResolvedValue(makeCandidate({ id: 'c1' }))
    render('/recruitment/applications/new?candidate=c1')
    expect(await screen.findByText('sana.iqbal@example.com')).toBeTruthy()
    expect(getCandidate.mock.calls[0][0]).toBe('c1')
  })

  it('falls back to searching when the linked candidate cannot be loaded', async () => {
    getCandidate.mockRejectedValue(new ApiError('Candidate not found', 404))
    render('/recruitment/applications/new?candidate=gone')
    expect(await screen.findByText(/could not be loaded/)).toBeTruthy()
    expect(screen.getByLabelText('Search candidates')).toBeTruthy()
  })
})

describe('choosing a job', () => {
  it('lists only open jobs', async () => {
    render()
    await screen.findByLabelText('Open job')
    expect(listJobs.mock.calls[0][0]).toMatchObject({ status: 'open' })
    const options = [...(screen.getByLabelText('Open job') as HTMLSelectElement).options].map((o) => o.textContent)
    expect(options).toEqual(['Choose a job…', 'Backend Engineer — Engineering', 'Product Designer — Design'])
  })

  it('preselects the job named in the link', async () => {
    render('/recruitment/applications/new?job=j2')
    await waitFor(() => expect((screen.getByLabelText('Open job') as HTMLSelectElement).value).toBe('j2'))
  })

  it('ignores a linked job that is not open', async () => {
    render('/recruitment/applications/new?job=draft-job')
    await screen.findByLabelText('Open job')
    expect((screen.getByLabelText('Open job') as HTMLSelectElement).value).toBe('')
    expect(submit().disabled).toBe(true)
  })

  it('explains when there are no open jobs', async () => {
    listJobs.mockResolvedValue(makeJobList([]))
    render()
    expect(await screen.findByText(/no open jobs/)).toBeTruthy()
  })

  it('shows a job-loading error with retry', async () => {
    listJobs.mockRejectedValueOnce(new ApiError('Jobs unavailable', 500))
    const user = userEvent.setup()
    render()
    expect((await screen.findByRole('alert')).textContent).toContain('Jobs unavailable')
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByLabelText('Open job')).toBeTruthy()
  })
})

describe('submitting', () => {
  it('stays disabled until both a candidate and a job are chosen', async () => {
    const user = userEvent.setup()
    render()
    await screen.findByLabelText('Open job')
    expect(submit().disabled).toBe(true)
    await pickCandidate(user)
    expect(submit().disabled).toBe(true)
    await user.selectOptions(screen.getByLabelText('Open job'), 'j1')
    expect(submit().disabled).toBe(false)
  })

  it('shows what is about to be created before submitting', async () => {
    const user = userEvent.setup()
    render()
    await screen.findByLabelText('Open job')
    expect(screen.getAllByText('Not chosen')).toHaveLength(2)
    await pickCandidate(user)
    await user.selectOptions(screen.getByLabelText('Open job'), 'j1')
    expect(screen.queryByText('Not chosen')).toBeNull()
    expect(screen.getByText(/starts at “Applied”/)).toBeTruthy()
  })

  it('creates the application with ids only, then opens it', async () => {
    create.mockResolvedValue(makeApplication({ id: 'new-1' }))
    const user = userEvent.setup()
    render()
    await screen.findByLabelText('Open job')
    await pickCandidate(user)
    await user.selectOptions(screen.getByLabelText('Open job'), 'j1')
    await user.click(submit())
    await waitFor(() => expect(create).toHaveBeenCalledWith({ candidate_id: 'c1', job_id: 'j1' }))
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/recruitment/applications/new-1'))
  })

  it('explains a duplicate and links to the application that already exists', async () => {
    create.mockRejectedValue(new ApiError('This candidate already has an application for this job', 409))
    listApplications.mockResolvedValue(makeApplicationList([makeApplicationItem({ id: 'existing-9' })]))
    const user = userEvent.setup()
    render()
    await screen.findByLabelText('Open job')
    await pickCandidate(user)
    await user.selectOptions(screen.getByLabelText('Open job'), 'j1')
    await user.click(submit())
    expect((await screen.findByRole('alert')).textContent).toContain('already has an application for this job')
    expect(await screen.findByRole('link', { name: 'View the existing application' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'View the existing application' }).getAttribute('href')).toBe('/recruitment/applications/existing-9')
    expect(listApplications).toHaveBeenCalledWith({ candidate_id: 'c1', job_id: 'j1', page_size: 1 })
    expect(screen.getByTestId('location').textContent).toBe('/recruitment/applications/new') // did not navigate
  })

  it('shows the server message when the job is no longer open', async () => {
    create.mockRejectedValue(new ApiError('Applications can only be added to open jobs', 409))
    listApplications.mockResolvedValue(makeApplicationList([]))
    const user = userEvent.setup()
    render()
    await screen.findByLabelText('Open job')
    await pickCandidate(user)
    await user.selectOptions(screen.getByLabelText('Open job'), 'j1')
    await user.click(submit())
    expect((await screen.findByRole('alert')).textContent).toContain('only be added to open jobs')
    expect(screen.queryByRole('link', { name: 'View the existing application' })).toBeNull()
  })

  it('shows other errors and lets the user try again', async () => {
    create.mockRejectedValueOnce(new ApiError('Server error', 500)).mockResolvedValueOnce(makeApplication({ id: 'n2' }))
    const user = userEvent.setup()
    render()
    await screen.findByLabelText('Open job')
    await pickCandidate(user)
    await user.selectOptions(screen.getByLabelText('Open job'), 'j1')
    await user.click(submit())
    expect((await screen.findByRole('alert')).textContent).toContain('Server error')
    await user.click(submit())
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/recruitment/applications/n2'))
  })
})
