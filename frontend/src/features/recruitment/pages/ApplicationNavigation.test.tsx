// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthContext } from '../../../auth/context'
import { can } from '../../../auth/permissions'
import { ToastProvider } from '../../../components/ui/Toast'
import { makeApplication, makeApplicationItem, makeApplicationList, makeBoard, makeUser } from '../../../test/fixtures'
import { LocationProbe } from '../../../test/LocationProbe'
import { ApplicationDetailPage } from './ApplicationDetailPage'
import { ApplicationsPage } from './ApplicationsPage'
import { PipelineBoardPage } from './PipelineBoardPage'

const api = { list: vi.fn(), board: vi.fn(), summary: vi.fn(), recruiters: vi.fn(), get: vi.fn() }
vi.mock('../../../api/interviews', () => ({
  interviewsApi: {
    forApplication: async () => ({ items: [], total: 0, page: 1, page_size: 50 }),
    interviewers: async () => [],
  },
}))
vi.mock('../../../api/screening', () => ({
  screeningApi: {
    forApplication: async () => ({
      application_id: 'x',
      readiness: { can_assess: false, blocker: 'no_active_resume', blocker_text: 'This candidate has no active resume. Upload a resume first.' },
      job_requirements: { required: [], preferred: [] },
      items: [],
      total: 0,
    }),
  },
}))
vi.mock('../../../api/applications', () => ({ applicationsApi: new Proxy({}, { get: (_t, k) => (api as Record<string, unknown>)[k as string] }) }))
vi.mock('../../../api/jobs', () => ({ jobsApi: { list: async () => ({ items: [], total: 0, page: 1, page_size: 100, status_counts: {} }) } }))

beforeEach(() => {
  for (const m of Object.values(api)) m.mockReset()
  api.list.mockImplementation(async () => makeApplicationList([makeApplicationItem({ id: 'a1' })]))
  api.board.mockImplementation(async () => makeBoard([makeApplicationItem({ id: 'a1' })]))
  api.summary.mockResolvedValue(null)
  api.recruiters.mockResolvedValue([])
  api.get.mockImplementation(async () => makeApplication({ id: 'a1' }))
})

/** The three pages in one router, so real navigation between them can be exercised. */
function app(url: string) {
  const user = makeUser('recruiter')
  render(
    <MemoryRouter initialEntries={[url]}>
      <ToastProvider>
        <AuthContext.Provider value={{ status: 'authenticated', user, notice: null, error: null, login: vi.fn(), logout: vi.fn(), retry: vi.fn(), can: (p) => can(user, p) }}>
          <Routes>
            <Route path="/recruitment/applications" element={<ApplicationsPage />} />
            <Route path="/recruitment/applications/:id" element={<ApplicationDetailPage />} />
            <Route path="/recruitment/pipeline" element={<PipelineBoardPage />} />
            <Route path="/recruitment/candidates/:id" element={<div>candidate profile</div>} />
            <Route path="*" element={<div>elsewhere</div>} />
          </Routes>
          <LocationProbe />
        </AuthContext.Provider>
      </ToastProvider>
    </MemoryRouter>,
  )
  return userEvent.setup()
}
const here = () => screen.getByTestId('location').textContent ?? ''

describe('back navigation keeps the place the user came from', () => {
  it('from the board: "Back to pipeline" returns with the filters intact', async () => {
    const user = app('/recruitment/pipeline?job=job-1&source=agency')
    await user.click((await screen.findAllByRole('link', { name: 'Sana Iqbal' }))[0])
    const back = await screen.findByRole('link', { name: /Back to pipeline/ })
    expect(back.getAttribute('href')).toBe('/recruitment/pipeline?job=job-1&source=agency')
    await user.click(back)
    await waitFor(() => expect(here()).toBe('/recruitment/pipeline?job=job-1&source=agency'))
  })

  it('from a filtered list: "Back to applications" returns with the filters and page', async () => {
    const user = app('/recruitment/applications?stage=applied&job=job-1&page=2')
    await user.click((await screen.findAllByRole('link', { name: 'Sana Iqbal' }))[0])
    const back = await screen.findByRole('link', { name: /Back to applications/ })
    expect(back.getAttribute('href')).toBe('/recruitment/applications?stage=applied&job=job-1&page=2')
  })

  it('opening the page directly falls back to the plain applications list', async () => {
    app('/recruitment/applications/a1')
    const back = await screen.findByRole('link', { name: /All applications/ })
    expect(back.getAttribute('href')).toBe('/recruitment/applications')
  })

  it('the candidate link from the detail page remembers the application it came from', async () => {
    const user = app('/recruitment/pipeline')
    await user.click((await screen.findAllByRole('link', { name: 'Sana Iqbal' }))[0])
    await screen.findByRole('heading', { level: 1 })
    await user.click(screen.getAllByRole('link', { name: 'Sana Iqbal' }).find((l) => l.getAttribute('href')?.includes('/candidates/'))!)
    await waitFor(() => expect(here()).toBe('/recruitment/candidates/cand-1'))
  })
})

describe('moving between the board and the list', () => {
  it('the list view link from the board keeps the shared filters', async () => {
    app('/recruitment/pipeline?job=job-1&recruiter=u-1&source=agency&from=2026-01-01&to=2026-02-01')
    const link = await screen.findByRole('link', { name: /List view/ })
    expect(link.getAttribute('href')).toBe('/recruitment/applications?job=job-1&recruiter=u-1&source=agency&from=2026-01-01&to=2026-02-01')
  })

  it('the board link from the list keeps them too, and drops stage and page (which only the list has)', async () => {
    app('/recruitment/applications?job=job-1&stage=hired&page=3&source=agency')
    const link = await screen.findByRole('link', { name: /Pipeline board/ })
    expect(link.getAttribute('href')).toBe('/recruitment/pipeline?job=job-1&source=agency')
  })

  it('never carries a search term between them', async () => {
    const user = app('/recruitment/applications?job=job-1')
    await user.type(await screen.findByLabelText('Search applications'), 'sana')
    expect(screen.getByRole('link', { name: /Pipeline board/ }).getAttribute('href')).toBe('/recruitment/pipeline?job=job-1')
  })
})

describe('an outside "from" is never followed', () => {
  it('ignores an external or non-recruitment from-state', async () => {
    const user = makeUser('recruiter')
    render(
      <MemoryRouter initialEntries={[{ pathname: '/recruitment/applications/a1', state: { from: 'https://evil.example/recruitment/x' } }]}>
        <ToastProvider>
          <AuthContext.Provider value={{ status: 'authenticated', user, notice: null, error: null, login: vi.fn(), logout: vi.fn(), retry: vi.fn(), can: (p) => can(user, p) }}>
            <Routes><Route path="/recruitment/applications/:id" element={<ApplicationDetailPage />} /></Routes>
          </AuthContext.Provider>
        </ToastProvider>
      </MemoryRouter>,
    )
    expect((await screen.findByRole('link', { name: /All applications/ })).getAttribute('href')).toBe('/recruitment/applications')
  })
})
