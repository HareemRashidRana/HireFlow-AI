// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../../api/errors'
import { makeParsed, makeResume } from '../../../test/fixtures'
import { renderAs } from '../../../test/render'
import type { ResumeParsed } from '../../../types/resume'
import { ResumeReviewDialog } from './ResumeReviewDialog'

const parsed = vi.fn()
const review = vi.fn()
vi.mock('../../../api/resumes', () => ({
  resumesApi: { parsed: (...a: unknown[]) => parsed(...a), review: (...a: unknown[]) => review(...a) },
}))

const onClose = vi.fn()
const onSaved = vi.fn()
beforeEach(() => {
  for (const m of [parsed, review, onClose, onSaved]) m.mockReset()
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) { this.removeAttribute('open') }
})

function open(data: Partial<ResumeParsed> = {}) {
  parsed.mockResolvedValue({ resume: makeResume(), parsed: makeParsed(), reviewed: null, ...data })
  const view = renderAs(<ResumeReviewDialog resume={makeResume()} onClose={onClose} onSaved={onSaved} />)
  return { ...view, user: userEvent.setup() }
}
const save = () => screen.getByRole('button', { name: 'Save reviewed details' }) as HTMLButtonElement
const confirmBox = () => screen.getByRole('checkbox', { name: /checked these details/ }) as HTMLInputElement
const ready = () => screen.findByLabelText('Name')

describe('what is shown', () => {
  it('loads the parsed data and fills the form with it', async () => {
    open()
    expect(((await ready()) as HTMLInputElement).value).toBe('Sana Iqbal')
    expect((screen.getByLabelText('Email') as HTMLInputElement).value).toBe('sana.iqbal@example.com')
    expect((screen.getByLabelText('Phone') as HTMLInputElement).value).toBe('+92 300 1234567')
    expect(screen.getByText('Python')).toBeTruthy()
    expect((screen.getByLabelText('Job title') as HTMLInputElement).value).toBe('Backend Developer')
    expect((screen.getByLabelText('Institution') as HTMLInputElement).value).toBe('LUMS')
    expect(parsed).toHaveBeenCalledWith('res-1', expect.anything())
  })

  it('says these are automatic readings that may be wrong, and that the profile is untouched', async () => {
    open()
    await ready()
    expect(screen.getByText(/read automatically from the file and may be wrong/)).toBeTruthy()
    expect(screen.getByText('not', { selector: 'strong' }).parentElement?.textContent).toMatch(/does not change the candidate's profile/)
  })

  it('shows how sure the parser was, field by field', async () => {
    open({ parsed: makeParsed({ phone: { value: '123', confidence: 'low' } }) })
    await ready()
    expect(screen.getAllByText('High confidence').length).toBeGreaterThan(0)
    expect(screen.getByText('Low confidence: please check')).toBeTruthy()
  })

  it('shows the total-experience estimate as an estimate', async () => {
    open()
    await ready()
    expect(screen.getByText('5 years 10 months')).toBeTruthy()
    expect(screen.getByText(/an estimate/)).toBeTruthy()
  })

  it('turns parser warnings into readable sentences', async () => {
    open({ parsed: makeParsed({ warnings: ['multiple_emails', 'no_phone', 'text_truncated', 'some_future_code'] }) })
    await ready()
    expect(screen.getByText(/More than one email address/)).toBeTruthy()
    expect(screen.getByText('No phone number could be found.')).toBeTruthy()
    expect(screen.getByText(/only the first part was read/)).toBeTruthy()
    expect(screen.getByText('some future code')).toBeTruthy()
  })

  it('leaves fields the parser could not find empty rather than inventing them', async () => {
    open({ parsed: makeParsed({ name: { value: null, confidence: null }, education: [], experience: [], skills: { values: [], confidence: null, source: null } }) })
    expect(((await ready()) as HTMLInputElement).value).toBe('')
    expect(screen.getByText('No work experience entries.')).toBeTruthy()
    expect(screen.getByText('No education entries.')).toBeTruthy()
  })

  it('shows previously confirmed values (not the machine reading) and who confirmed them', async () => {
    open({
      resume: makeResume({ reviewed: true, reviewed_at: '2026-11-06T09:00:00Z', reviewed_by: { id: 'u', email: 'hr@example.com', role: 'hr_manager' } }),
      reviewed: { name: 'Sana I.', email: null, phone: null, skills: ['Go'], education: [], experience: [] },
    })
    expect(((await ready()) as HTMLInputElement).value).toBe('Sana I.')
    expect(screen.getByText(/These details were reviewed on .* by hr@example\.com/)).toBeTruthy()
    expect(screen.queryByText('High confidence')).toBeNull() // confidence describes the machine, not a person
    expect(screen.queryByText('Python')).toBeNull()
  })

  it('shows an error with a retry when the data cannot be loaded', async () => {
    parsed.mockRejectedValueOnce(new ApiError('Could not load.', 500))
    parsed.mockResolvedValueOnce({ resume: makeResume(), parsed: makeParsed(), reviewed: null })
    renderAs(<ResumeReviewDialog resume={makeResume()} onClose={onClose} onSaved={onSaved} />)
    expect((await screen.findByRole('alert')).textContent).toContain('Could not load.')
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }))
    expect(await ready()).toBeTruthy()
  })
})

describe('saving needs an explicit human confirmation', () => {
  it('the Save button is disabled until the box is ticked', async () => {
    const { user } = open()
    await ready()
    expect(save().disabled).toBe(true)
    expect(confirmBox().checked).toBe(false) // never pre-ticked
    await user.click(confirmBox())
    expect(save().disabled).toBe(false)
  })

  it('changing anything un-ticks the box so the new values are confirmed too', async () => {
    const { user } = open()
    await ready()
    await user.click(confirmBox())
    expect(save().disabled).toBe(false)
    await user.type(screen.getByLabelText('Name'), 'x')
    expect(confirmBox().checked).toBe(false)
    expect(save().disabled).toBe(true)
  })

  it('pressing Enter in a field cannot save an unconfirmed form', async () => {
    const { user } = open()
    await ready()
    await user.type(screen.getByLabelText('Name'), '{Enter}')
    expect(review).not.toHaveBeenCalled()
  })

  it('a form submission that bypasses the disabled button still cannot save an unconfirmed review', async () => {
    open()
    await ready()
    fireEvent.submit(screen.getByRole('dialog').querySelector('form')!)
    await new Promise((r) => setTimeout(r, 20))
    expect(review).not.toHaveBeenCalled()
  })

  it('sends exactly the edited values, then refreshes and closes', async () => {
    review.mockResolvedValue(makeResume({ reviewed: true }))
    const { user } = open()
    const name = await ready()
    await user.clear(name)
    await user.type(name, 'Sana Q. Iqbal')
    await user.clear(screen.getByLabelText('Phone'))
    await user.click(confirmBox())
    await user.click(save())
    await waitFor(() => expect(review).toHaveBeenCalledTimes(1))
    expect(review).toHaveBeenCalledWith('res-1', {
      name: 'Sana Q. Iqbal', email: 'sana.iqbal@example.com', phone: null, skills: ['Python', 'SQL'],
      education: [{ institution: 'LUMS', degree: 'BSc', field: 'Computer Science', start_year: 2014, end_year: 2018 }],
      experience: [{ title: 'Backend Developer', company: 'Acme Ltd', start: '2020-01', end: null, current: true }],
    })
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(onClose).toHaveBeenCalled()
    expect(await screen.findByText('Reviewed details saved.')).toBeTruthy()
  })

  it('Cancel saves nothing', async () => {
    const { user } = open()
    await ready()
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }))
    expect(review).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })
})

describe('editing', () => {
  it('can add and remove positions and education', async () => {
    const { user } = open({ parsed: makeParsed({ education: [], experience: [] }) })
    await ready()
    await user.click(screen.getByRole('button', { name: 'Add a position' }))
    await user.type(screen.getByLabelText('Job title'), 'Analyst')
    await user.click(screen.getByRole('button', { name: 'Add education' }))
    await user.type(screen.getByLabelText('Institution'), 'NUST')
    await user.click(confirmBox())
    await user.click(save())
    review.mockResolvedValue(makeResume())
    await waitFor(() => expect(review).toHaveBeenCalled())
    const sent = review.mock.calls[0][1]
    expect(sent.experience).toEqual([{ title: 'Analyst', company: null, start: null, end: null, current: false }])
    expect(sent.education[0].institution).toBe('NUST')

    await user.click(screen.getByRole('button', { name: 'Remove position 1' }))
    expect(screen.queryByLabelText('Job title')).toBeNull()
  })

  it('"I currently work here" disables and clears the end date', async () => {
    const { user } = open({ parsed: makeParsed({ experience: [{ title: 'Dev', company: 'X', start: '2019', end: '2021', current: false, months: 24, date_precision: 'year', confidence: 'high' }] }) })
    await ready()
    const end = screen.getByLabelText('End (YYYY or YYYY-MM)') as HTMLInputElement
    expect(end.value).toBe('2021')
    await user.click(screen.getByRole('checkbox', { name: 'I currently work here' }))
    expect(end.disabled).toBe(true)
    expect(end.value).toBe('')
  })

  it('adds and removes skills', async () => {
    const { user } = open()
    await ready()
    await user.type(screen.getByLabelText('Skills', { selector: 'input' }), 'Docker{Enter}')
    expect(screen.getByText('Docker')).toBeTruthy()
  })
})

describe('mistakes are caught before anything is sent', () => {
  it('refuses a bad email and a bad date, naming the field', async () => {
    const { user } = open()
    const email = await screen.findByLabelText('Email')
    await user.clear(email)
    await user.type(email, 'not-an-email')
    const start = screen.getByLabelText('Start (YYYY or YYYY-MM)')
    await user.clear(start)
    await user.type(start, 'January 2020')
    await user.click(confirmBox())
    await user.click(save())
    expect(await screen.findByText(/valid email address/)).toBeTruthy()
    expect(screen.getByText('Use YYYY or YYYY-MM.')).toBeTruthy()
    expect(review).not.toHaveBeenCalled()
  })

  it('shows the server message when saving fails and keeps the dialog open', async () => {
    review.mockRejectedValue(new ApiError('This resume was removed.', 404))
    const { user } = open()
    await ready()
    await user.click(confirmBox())
    await user.click(save())
    expect((await screen.findByText('This resume was removed.'))).toBeTruthy()
    expect(onClose).not.toHaveBeenCalled()
    expect(onSaved).not.toHaveBeenCalled()
  })
})
