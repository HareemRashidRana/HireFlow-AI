// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../../api/errors'
import { makeResume } from '../../../test/fixtures'
import { renderAs } from '../../../test/render'
import type { UserRole } from '../../../types/auth'
import type { Resume } from '../../../types/resume'
import { ResumesCard } from './ResumesCard'

const api = { list: vi.fn(), upload: vi.fn(), parsed: vi.fn(), parse: vi.fn(), review: vi.fn(), activate: vi.fn(), remove: vi.fn(), download: vi.fn() }
const saveFile = vi.fn()
vi.mock('../../../api/resumes', () => ({
  resumesApi: {
    list: (...a: unknown[]) => api.list(...a), upload: (...a: unknown[]) => api.upload(...a),
    parsed: (...a: unknown[]) => api.parsed(...a), parse: (...a: unknown[]) => api.parse(...a),
    review: (...a: unknown[]) => api.review(...a), activate: (...a: unknown[]) => api.activate(...a),
    remove: (...a: unknown[]) => api.remove(...a), download: (...a: unknown[]) => api.download(...a),
  },
}))
vi.mock('../../../lib/download', () => ({ saveFile: (...a: unknown[]) => saveFile(...a) }))

beforeEach(() => {
  for (const m of Object.values(api)) m.mockReset()
  saveFile.mockReset()
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) { this.removeAttribute('open') }
})

const listOf = (...items: Resume[]) => ({ items, total: items.length, page: 1, page_size: 50 })
function render(items: Resume[], role: UserRole = 'recruiter', anonymized = false) {
  api.list.mockResolvedValue(listOf(...items))
  const view = renderAs(<ResumesCard candidateId="cand-1" anonymized={anonymized} />, { role })
  return { ...view, user: userEvent.setup() }
}
const row = (version: number) => screen.getByRole('listitem', { name: `Resume version ${version}` })

describe('who sees it (the API enforces the same rules)', () => {
  it.each(['admin', 'hr_manager', 'recruiter'] as const)('%s sees the card and the upload zone', async (role) => {
    render([], role)
    expect(await screen.findByText('No resumes uploaded yet.')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Resumes' })).toBeTruthy()
    expect(screen.getByTestId('resume-dropzone')).toBeTruthy()
  })

  it('an employee sees nothing and the list is never requested', () => {
    render([], 'employee')
    expect(screen.queryByText('Resumes')).toBeNull()
    expect(api.list).not.toHaveBeenCalled()
  })

  it.each([['admin', true], ['hr_manager', true], ['recruiter', false]] as const)('%s Delete button: %s', async (role, shown) => {
    render([makeResume()], role)
    await screen.findByText('sana-iqbal-cv.pdf')
    expect(!!screen.queryByRole('button', { name: 'Delete version 1' })).toBe(shown)
  })
})

describe('the history', () => {
  it('lists versions with the active one marked, size, uploader and status', async () => {
    render([
      makeResume({ id: 'r2', version_number: 2, original_filename: 'new.docx', extension: 'docx', is_active: true, size_bytes: 2048 }),
      makeResume({ id: 'r1', version_number: 1, is_active: false }),
    ])
    expect(await screen.findByText('new.docx')).toBeTruthy()
    expect(within(row(2)).getByText('Active')).toBeTruthy()
    expect(within(row(1)).queryByText('Active')).toBeNull()
    expect(within(row(2)).getByText(/DOCX · 2\.0 KB · uploaded .* by recruiter@example\.com/)).toBeTruthy()
    expect(within(row(2)).getByText('Read')).toBeTruthy()
  })

  it('hides removed (anonymized or deleted) entries', async () => {
    render([makeResume({ id: 'r9', status: 'removed', original_filename: 'removed' }), makeResume()])
    await screen.findByText('sana-iqbal-cv.pdf')
    expect(screen.queryByText('removed')).toBeNull()
  })

  it('renders a hostile file name as plain text', async () => {
    render([makeResume({ original_filename: '<img src=x onerror=alert(1)>.pdf' })])
    expect(await screen.findByText('<img src=x onerror=alert(1)>.pdf')).toBeTruthy()
    expect(document.querySelector('img')).toBeNull()
  })

  it('explains a scanned (no text) file and offers to read it again', async () => {
    render([makeResume({ status: 'no_text', parse_error_code: 'ocr_unavailable' })])
    expect(await screen.findByText(/scanned image/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Read version 1 again' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Review details/ })).toBeNull() // nothing to review
  })

  it('a read file offers review, not "read again"', async () => {
    render([makeResume()])
    expect(await screen.findByRole('button', { name: 'Review details of version 1' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Read version/ })).toBeNull()
  })

  it('marks a reviewed resume and changes the button label', async () => {
    render([makeResume({ reviewed: true, reviewed_at: '2026-11-06T09:00:00Z' })])
    expect(await screen.findByText('Reviewed')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Review details of version 1' }).textContent).toBe('Review again')
  })

  it('shows an error with a retry when the list fails', async () => {
    api.list.mockRejectedValueOnce(new ApiError('boom', 500)).mockResolvedValueOnce(listOf(makeResume()))
    const { user } = renderCard()
    expect(await screen.findByText(/Couldn't load resumes/)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('sana-iqbal-cv.pdf')).toBeTruthy()
  })
})

function renderCard(role: UserRole = 'recruiter') {
  const view = renderAs(<ResumesCard candidateId="cand-1" anonymized={false} />, { role })
  return { ...view, user: userEvent.setup() }
}

describe('actions', () => {
  it('Download fetches through the API and hands the file to the browser', async () => {
    const blob = new Blob(['%PDF-'])
    api.download.mockResolvedValue({ blob, filename: 'resume-v1.pdf', contentType: 'application/pdf' })
    const { user } = render([makeResume()])
    await user.click(await screen.findByRole('button', { name: 'Download sana-iqbal-cv.pdf' }))
    await waitFor(() => expect(saveFile).toHaveBeenCalledWith(blob, 'resume-v1.pdf'))
    expect(api.download).toHaveBeenCalledWith('res-1')
  })

  it('a failed download says so and saves nothing', async () => {
    api.download.mockRejectedValue(new ApiError('This resume file is no longer available.', 404))
    const { user } = render([makeResume()])
    await user.click(await screen.findByRole('button', { name: /Download/ }))
    expect(await screen.findByText('This resume file is no longer available.')).toBeTruthy()
    expect(saveFile).not.toHaveBeenCalled()
  })

  it('Make active switches the version and reloads the list', async () => {
    api.activate.mockResolvedValue(makeResume({ id: 'r1', is_active: true }))
    const { user } = render([makeResume({ id: 'r2', version_number: 2, is_active: true }), makeResume({ id: 'r1', version_number: 1, is_active: false })])
    await user.click(await screen.findByRole('button', { name: 'Make version 1 the active resume' }))
    await waitFor(() => expect(api.activate).toHaveBeenCalledWith('r1'))
    expect(await screen.findByText('Version 1 is now the active resume.')).toBeTruthy()
    expect(api.list).toHaveBeenCalledTimes(2)
  })

  it('the active version has no Make active button', async () => {
    render([makeResume({ is_active: true })])
    await screen.findByText('sana-iqbal-cv.pdf')
    expect(screen.queryByRole('button', { name: /Make version/ })).toBeNull()
  })

  it('Read again retries extraction', async () => {
    api.parse.mockResolvedValue(makeResume())
    const { user } = render([makeResume({ status: 'failed', parse_error_code: 'parser_error' })])
    await user.click(await screen.findByRole('button', { name: 'Read version 1 again' }))
    await waitFor(() => expect(api.parse).toHaveBeenCalledWith('res-1'))
    expect(await screen.findByText('Finished reading the file.')).toBeTruthy()
  })

  it('a failing action shows the server message', async () => {
    api.activate.mockRejectedValue(new ApiError('This resume cannot be made active.', 409))
    const { user } = render([makeResume({ is_active: false })])
    await user.click(await screen.findByRole('button', { name: /Make version 1/ }))
    expect(await screen.findByText('This resume cannot be made active.')).toBeTruthy()
  })

  it('only one action runs at a time', async () => {
    let finish: (v: unknown) => void = () => undefined
    api.activate.mockImplementation(() => new Promise((r) => { finish = r }))
    const { user } = render([makeResume({ is_active: false })])
    const button = await screen.findByRole('button', { name: /Make version 1/ })
    await user.click(button)
    expect((button as HTMLButtonElement).disabled).toBe(true)
    await user.click(button)
    expect(api.activate).toHaveBeenCalledTimes(1)
    finish(makeResume())
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false))
  })
})

describe('deleting', () => {
  it('asks first, naming the file, and deletes nothing until confirmed', async () => {
    const { user } = render([makeResume()], 'hr_manager')
    await user.click(await screen.findByRole('button', { name: 'Delete version 1' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Delete this resume?')).toBeTruthy()
    expect(within(dialog).getByText('sana-iqbal-cv.pdf')).toBeTruthy()
    expect(within(dialog).getByText(/cannot be undone/)).toBeTruthy()
    expect(api.remove).not.toHaveBeenCalled()
  })

  it('Cancel leaves everything as it was', async () => {
    const { user } = render([makeResume()], 'hr_manager')
    await user.click(await screen.findByRole('button', { name: 'Delete version 1' }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }))
    expect(api.remove).not.toHaveBeenCalled()
  })

  it('confirming deletes and refreshes the list', async () => {
    api.remove.mockResolvedValue(undefined)
    const { user } = render([makeResume()], 'admin')
    await user.click(await screen.findByRole('button', { name: 'Delete version 1' }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete resume' }))
    await waitFor(() => expect(api.remove).toHaveBeenCalledWith('res-1'))
    expect(await screen.findByText('Resume deleted.')).toBeTruthy()
    expect(api.list).toHaveBeenCalledTimes(2)
  })

  it('shows the server message and keeps the dialog open when deletion fails', async () => {
    api.remove.mockRejectedValue(new ApiError('You do not have permission to perform this action.', 403))
    const { user } = render([makeResume()], 'admin')
    await user.click(await screen.findByRole('button', { name: 'Delete version 1' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Delete resume' }))
    expect(await within(dialog).findByText('You do not have permission to perform this action.')).toBeTruthy()
  })

  it('warns when the active resume is the one being deleted', async () => {
    const { user } = render([makeResume({ is_active: true })], 'admin')
    await user.click(await screen.findByRole('button', { name: 'Delete version 1' }))
    expect(within(await screen.findByRole('dialog')).getByText(/the active resume/)).toBeTruthy()
  })
})

describe('an anonymized candidate', () => {
  it('cannot receive uploads and says why', async () => {
    render([], 'admin', true)
    expect(await screen.findByText(/anonymized, so no resumes are kept/)).toBeTruthy()
    expect(screen.queryByTestId('resume-dropzone')).toBeNull()
  })
})
