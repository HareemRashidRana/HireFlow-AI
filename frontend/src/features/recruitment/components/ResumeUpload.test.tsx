// @vitest-environment jsdom
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../../api/errors'
import { makeResume } from '../../../test/fixtures'
import { renderAs } from '../../../test/render'
import { ResumeUpload } from './ResumeUpload'

const upload = vi.fn()
vi.mock('../../../api/resumes', () => ({ resumesApi: { upload: (...a: unknown[]) => upload(...a) } }))

const onUploaded = vi.fn()
beforeEach(() => {
  upload.mockReset()
  onUploaded.mockReset()
})

const pdf = (name = 'cv.pdf', size = 2000) => {
  const f = new File(['%PDF-1.4'], name, { type: 'application/pdf' })
  Object.defineProperty(f, 'size', { value: size })
  return f
}
const setup = () => {
  const view = renderAs(<ResumeUpload candidateId="cand-1" onUploaded={onUploaded} />)
  return { ...view, zone: screen.getByTestId('resume-dropzone'), input: screen.getByLabelText('Resume file') as HTMLInputElement }
}
const drop = (zone: HTMLElement, files: File[]) => fireEvent.drop(zone, { dataTransfer: { files } })

describe('choosing a file', () => {
  it('uploads the chosen file for this candidate and reports success', async () => {
    upload.mockResolvedValue(makeResume())
    const { input } = setup()
    await userEvent.setup().upload(input, pdf())
    await waitFor(() => expect(onUploaded).toHaveBeenCalledWith(expect.objectContaining({ id: 'res-1' })))
    expect(upload).toHaveBeenCalledWith('cand-1', expect.objectContaining({ name: 'cv.pdf' }), expect.any(AbortSignal))
    expect(await screen.findByText('Resume uploaded.')).toBeTruthy()
  })

  it('the visible button opens the file picker', async () => {
    const { input } = setup()
    const click = vi.spyOn(input, 'click')
    await userEvent.setup().click(screen.getByRole('button', { name: 'Choose a file' }))
    expect(click).toHaveBeenCalled()
  })

  it('only offers PDF and DOCX in the picker', () => {
    expect(setup().input.accept).toBe('.pdf,.docx')
  })
})

describe('drag and drop', () => {
  it('uploads a dropped file', async () => {
    upload.mockResolvedValue(makeResume())
    const { zone } = setup()
    drop(zone, [pdf('dropped.pdf')])
    await waitFor(() => expect(upload).toHaveBeenCalledWith('cand-1', expect.objectContaining({ name: 'dropped.pdf' }), expect.anything()))
  })

  it('highlights the zone while a file is dragged over, and stops when it leaves', () => {
    const { zone } = setup()
    fireEvent.dragOver(zone)
    expect(zone.className).toContain('bg-lavender-50')
    fireEvent.dragLeave(zone)
    expect(zone.className).not.toContain('bg-lavender-50')
  })

  it('refuses several files at once instead of guessing', () => {
    const { zone } = setup()
    drop(zone, [pdf('a.pdf'), pdf('b.pdf')])
    expect(screen.getByRole('alert').textContent).toMatch(/one resume at a time/)
    expect(upload).not.toHaveBeenCalled()
  })

  it('does nothing for a drop that carries no files', () => {
    const { zone } = setup()
    drop(zone, [])
    expect(upload).not.toHaveBeenCalled()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('checking before sending', () => {
  it.each([
    ['virus.exe', 2000, /Only PDF and DOCX/],
    ['notes.txt', 2000, /Only PDF and DOCX/],
    ['empty.pdf', 0, /empty/],
    ['huge.pdf', 6 * 1024 * 1024, /too large/],
  ])('%s is refused on the spot with a clear message and never sent', (name, size, message) => {
    const { zone } = setup()
    drop(zone, [pdf(name, size)])
    expect(screen.getByRole('alert').textContent).toMatch(message)
    expect(upload).not.toHaveBeenCalled()
  })

  it('a good file after a bad one clears the old message', async () => {
    upload.mockResolvedValue(makeResume())
    const { zone } = setup()
    drop(zone, [pdf('bad.exe')])
    expect(screen.getByRole('alert')).toBeTruthy()
    drop(zone, [pdf('good.pdf')])
    await waitFor(() => expect(onUploaded).toHaveBeenCalled())
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('while uploading', () => {
  it('shows what is happening, blocks a second upload, and lets the user cancel', async () => {
    let signal: AbortSignal | undefined
    upload.mockImplementation((_c: string, _f: File, s: AbortSignal) => {
      signal = s
      return new Promise((_resolve, reject) => s.addEventListener('abort', () => reject(new DOMException('x', 'AbortError'))))
    })
    const { zone } = setup()
    drop(zone, [pdf('slow.pdf')])
    expect(await screen.findByText('Uploading slow.pdf…')).toBeTruthy()
    expect(screen.getByRole('progressbar', { name: 'Uploading the resume' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Choose a file' })).toBeNull()

    drop(zone, [pdf('second.pdf')]) // ignored while one is in flight
    expect(upload).toHaveBeenCalledTimes(1)

    await userEvent.setup().click(screen.getByRole('button', { name: 'Cancel upload' }))
    expect(signal?.aborted).toBe(true)
    expect(await screen.findByText('Upload cancelled.')).toBeTruthy()
    expect(onUploaded).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Choose a file' })).toBeTruthy() // ready to try again
  })
})

describe('when the server says no', () => {
  it.each([
    [415, "The file's content does not match its extension."],
    [409, 'This resume has already been uploaded for this candidate.'],
    [413, 'This file is too large.'],
    [503, 'File storage is unavailable right now.'],
  ])('shows the server message for %d and keeps the page usable', async (status, message) => {
    upload.mockRejectedValue(new ApiError(message, status))
    const { zone } = setup()
    drop(zone, [pdf()])
    expect((await screen.findByRole('alert')).textContent).toContain(message)
    expect(onUploaded).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Choose a file' })).toBeTruthy()
  })

  it('a network failure gets a friendly message too', async () => {
    upload.mockRejectedValue('boom')
    const { zone } = setup()
    drop(zone, [pdf()])
    expect((await screen.findByRole('alert')).textContent).toMatch(/upload failed/)
  })
})
