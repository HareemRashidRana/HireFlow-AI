// @vitest-environment jsdom
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../../api/errors'
import { makeJobItem, makeJobScreening } from '../../../test/screeningFixtures'
import { renderAs } from '../../../test/render'
import type { UserRole } from '../../../types/auth'
import { JobCoverageOverview } from './JobCoverageOverview'

const forJob = vi.fn()
vi.mock('../../../api/screening', () => ({ screeningApi: { forJob: (...a: unknown[]) => forJob(...a) } }))

beforeEach(() => forJob.mockReset())

function render(role: UserRole = 'recruiter') {
  renderAs(<JobCoverageOverview jobId="job-1" />, { role })
  return userEvent.setup()
}

describe('JobCoverageOverview', () => {
  it('lists applicants in the order the server gave (by application date) with a status only', async () => {
    forJob.mockResolvedValue(makeJobScreening([
      makeJobItem({ application_id: 'a1', candidate_name: 'Newest Person', state: 'current', assessment_count: 1 }),
      makeJobItem({ application_id: 'a2', candidate_name: 'Middle Person', state: 'outdated', assessment_count: 3 }),
      makeJobItem({ application_id: 'a3', candidate_name: 'Oldest Person', state: 'cannot_assess', blocker: 'no_active_resume' }),
    ]))
    render()
    const links = await screen.findAllByRole('link')
    expect(links.map((l) => l.textContent?.split('Applied')[0])).toEqual(['Newest Person', 'Middle Person', 'Oldest Person'])
    expect(screen.getByText('Current assessment')).toBeTruthy()
    expect(screen.getByText(/Outdated assessment \(3 assessments\)/)).toBeTruthy()
    expect(screen.getByText('Cannot assess yet')).toBeTruthy()
    expect(links[0].getAttribute('href')).toBe('/recruitment/applications/a1')
  })

  it('never shows a figure or offers sorting or filtering', async () => {
    forJob.mockResolvedValue(makeJobScreening([makeJobItem({ state: 'current', assessment_count: 1 })]))
    const { container } = renderAs(<JobCoverageOverview jobId="job-1" />)
    await screen.findByText('Current assessment')
    expect(container.textContent).not.toMatch(/\d+(\.\d)?\s*\/\s*100|points|score|rank/i)
    expect(screen.queryByRole('combobox')).toBeNull()
    expect(screen.queryByRole('searchbox')).toBeNull()
    expect(screen.queryByRole('columnheader')).toBeNull()
    expect(screen.getByText(/Only the status of each assessment is shown here, never a figure/)).toBeTruthy()
  })

  it('requests page 1 with paging parameters only', async () => {
    forJob.mockResolvedValue(makeJobScreening([makeJobItem()]))
    render()
    await screen.findByText('Not assessed')
    expect(forJob).toHaveBeenCalledWith('job-1', 1, 10, expect.anything())
  })

  it('pages forward and back', async () => {
    forJob.mockImplementation(async (_j: string, page: number) => makeJobScreening([makeJobItem({ candidate_name: `Page ${page} Person` })], { total: 25, page, page_size: 10 }))
    const user = render()
    expect(await screen.findByText(/Page 1 of 3/)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByText('Page 2 Person')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Previous' }))
    expect(await screen.findByText('Page 1 Person')).toBeTruthy()
  })

  it('has an empty state, an error with retry, and is hidden from employees', async () => {
    forJob.mockResolvedValueOnce(makeJobScreening([]))
    const { unmount } = renderAs(<JobCoverageOverview jobId="job-1" />)
    expect(await screen.findByText('No applications for this job yet.')).toBeTruthy()
    unmount()

    forJob.mockRejectedValueOnce(new ApiError('boom', 500)).mockResolvedValueOnce(makeJobScreening([makeJobItem()]))
    const user = render()
    expect(await screen.findByText(/Couldn't load the status/)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('Not assessed')).toBeTruthy()

    forJob.mockClear()
    renderAs(<JobCoverageOverview jobId="job-2" />, { role: 'employee' })
    expect(forJob).not.toHaveBeenCalled()
  })
})
