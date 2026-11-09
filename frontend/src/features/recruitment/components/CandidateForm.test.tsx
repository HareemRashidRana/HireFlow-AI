// @vitest-environment jsdom
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../../api/errors'
import { makeCandidate } from '../../../test/fixtures'
import { renderAs } from '../../../test/render'
import { DUPLICATE_EMAIL_MESSAGE, emptyCandidateValues, toCandidateFormValues } from '../lib/candidateFormValues'
import type { CandidateFormValues } from '../lib/candidateFormValues'
import { todayIso } from '../lib/retention'
import { CandidateForm } from './CandidateForm'

const findByEmail = vi.fn()
vi.mock('../../../api/candidates', () => ({
  candidatesApi: { findByEmail: (...a: unknown[]) => findByEmail(...a) },
}))

beforeEach(() => {
  findByEmail.mockReset()
  findByEmail.mockResolvedValue(null)
})

function setup(initial: CandidateFormValues = emptyCandidateValues(), onSubmit = vi.fn().mockResolvedValue(undefined), editing = false) {
  const view = renderAs(
    <CandidateForm initialValues={initial} submitLabel="Add candidate" cancelTo="/cancel" editing={editing} onSubmit={onSubmit} />,
  )
  return { onSubmit, user: userEvent.setup(), ...view }
}

const submit = (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByRole('button', { name: 'Add candidate' }))
const select = () => ({
  source: screen.getByLabelText(/^source/i) as HTMLSelectElement,
  basis: screen.getByLabelText(/basis for holding/i) as HTMLSelectElement,
})

async function fillValid(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/first name/i), 'Sana')
  await user.type(screen.getByLabelText(/last name/i), 'Iqbal')
  await user.type(screen.getByLabelText(/^email/i), 'Sana@Example.com')
  await user.selectOptions(select().source, 'linkedin')
  await user.selectOptions(select().basis, 'legitimate_interest')
}

describe('privacy by design', () => {
  it('shows a data-minimisation reminder', () => {
    setup()
    expect(screen.getByText(/do not add health, family, ethnicity, religion, age/i)).toBeTruthy()
  })

  it.each([/date of birth/i, /gender/i, /nationality/i, /photo/i, /address$/i, /salary/i, /national id/i, /marital/i])(
    'has no field for %s',
    (label) => {
      setup()
      expect(screen.queryByLabelText(label)).toBeNull()
    },
  )

  it('asks only for city and country as location', () => {
    setup()
    expect(screen.getByText(/city and country only, no street address/i)).toBeTruthy()
  })

  it('pre-selects neither the source nor the basis (consent is never assumed)', () => {
    setup()
    expect(select().source.value).toBe('')
    expect(select().basis.value).toBe('')
    expect(screen.getByText(/nothing is pre-selected/i)).toBeTruthy()
  })

  it('offers all four bases, with consent as just one of them', () => {
    setup()
    const options = [...select().basis.options].map((o) => o.textContent)
    expect(options).toEqual(['Select basis…', 'Consent', 'Legitimate interest', 'Steps before a contract', 'Other'])
  })

  it('explains each basis in plain language when chosen', async () => {
    const { user } = setup()
    await user.selectOptions(select().basis, 'legitimate_interest')
    expect(screen.getByText(/genuine business reason/i)).toBeTruthy()
    await user.selectOptions(select().basis, 'pre_contract_steps')
    expect(screen.getByText(/applied or asked to be considered/i)).toBeTruthy()
    await user.selectOptions(select().basis, 'consent')
    expect(screen.getByText(/agreed to you keeping their details/i)).toBeTruthy()
  })

  it('defaults the date to today and prevents picking a later one', () => {
    setup()
    const date = screen.getByLabelText(/date the basis was established/i) as HTMLInputElement
    expect(date.value).toBe(todayIso())
    expect(date.max).toBe(todayIso())
  })
})

describe('the explanation for "other"', () => {
  it('is hidden until "Other" is chosen', async () => {
    const { user } = setup()
    expect(screen.queryByLabelText(/explain the basis/i)).toBeNull()
    await user.selectOptions(select().basis, 'other')
    expect(screen.getByLabelText(/explain the basis/i)).toBeTruthy()
    await user.selectOptions(select().basis, 'consent')
    expect(screen.queryByLabelText(/explain the basis/i)).toBeNull()
  })

  it('is required when "Other" is chosen', async () => {
    const { user, onSubmit } = setup()
    await fillValid(user)
    await user.selectOptions(select().basis, 'other')
    await submit(user)
    expect(screen.getByText('Explain the basis when you choose "Other".')).toBeTruthy()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('does not send a stale explanation after switching to another basis', async () => {
    const { user, onSubmit } = setup()
    await fillValid(user)
    await user.selectOptions(select().basis, 'other')
    await user.type(screen.getByLabelText(/explain the basis/i), 'Old reason')
    await user.selectOptions(select().basis, 'consent')
    await submit(user)
    expect(onSubmit).toHaveBeenCalledTimes(1)
    // the values object still holds the text; the payload builder drops it (covered in the logic tests)
    expect(onSubmit.mock.calls[0][0].consent_basis).toBe('consent')
  })
})

describe('validation', () => {
  it('shows errors for every required field and does not submit', async () => {
    const { user, onSubmit } = setup()
    await submit(user)
    expect(screen.getByText('First name is required.')).toBeTruthy()
    expect(screen.getByText('Last name is required.')).toBeTruthy()
    expect(screen.getByText('Enter a valid email address.')).toBeTruthy()
    expect(screen.getByText('Choose where this candidate came from.')).toBeTruthy()
    expect(screen.getByText('Choose the basis for holding their details.')).toBeTruthy()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('moves focus to the first invalid field', async () => {
    const { user } = setup()
    await submit(user)
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText(/first name/i)))
  })

  it('clears an error as soon as the user edits that field', async () => {
    const { user } = setup()
    await submit(user)
    await user.type(screen.getByLabelText(/first name/i), 'S')
    expect(screen.queryByText('First name is required.')).toBeNull()
    expect(screen.getByText('Last name is required.')).toBeTruthy()
  })

  it('rejects an invalid phone number', async () => {
    const { user } = setup()
    await fillValid(user)
    await user.type(screen.getByLabelText(/^phone/i), 'abc')
    await submit(user)
    expect(screen.getByText(/enter a valid phone number/i)).toBeTruthy()
  })

  it('rejects a basis date in the future', async () => {
    const { user, onSubmit } = setup()
    await fillValid(user)
    fireEvent.change(screen.getByLabelText(/date the basis was established/i), { target: { value: '2999-01-01' } })
    await submit(user)
    expect(screen.getByText('The date cannot be in the future.')).toBeTruthy()
    expect(onSubmit).not.toHaveBeenCalled()
  })
})

describe('submitting', () => {
  it('submits the entered values', async () => {
    const { user, onSubmit } = setup()
    await fillValid(user)
    await user.type(screen.getByLabelText(/current job title/i), 'Backend Developer')
    await user.type(screen.getByLabelText(/current company/i), 'Acme')
    await submit(user)
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      first_name: 'Sana',
      last_name: 'Iqbal',
      email: 'Sana@Example.com', // lowercased later, when the payload is built
      current_title: 'Backend Developer',
      current_company: 'Acme',
      source: 'linkedin',
      consent_basis: 'legitimate_interest',
      consent_date: todayIso(),
    })
  })

  it('blocks double submits while saving', async () => {
    let finish!: () => void
    const slow = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)))
    const { user } = setup(emptyCandidateValues(), slow)
    await fillValid(user)
    await submit(user)
    const button = screen.getByRole('button', { name: /add candidate/i }) as HTMLButtonElement
    await waitFor(() => expect(button.disabled).toBe(true))
    await user.click(button)
    expect(slow).toHaveBeenCalledTimes(1)
    finish()
  })
})

describe('server errors', () => {
  it('explains a duplicate email and links to the existing candidate', async () => {
    findByEmail.mockResolvedValue({ id: 'existing-9' })
    const onSubmit = vi.fn().mockRejectedValue(new ApiError(DUPLICATE_EMAIL_MESSAGE, 409))
    const { user } = setup(emptyCandidateValues(), onSubmit)
    await fillValid(user)
    await submit(user)
    expect(await screen.findByText(DUPLICATE_EMAIL_MESSAGE)).toBeTruthy()
    const link = await screen.findByRole('link', { name: 'View the existing candidate' })
    expect(link.getAttribute('href')).toBe('/recruitment/candidates/existing-9')
    expect(findByEmail).toHaveBeenCalledWith('sana@example.com') // normalised before looking up
    expect((screen.getByRole('button', { name: /add candidate/i }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('removes the link once the email is changed', async () => {
    findByEmail.mockResolvedValue({ id: 'existing-9' })
    const onSubmit = vi.fn().mockRejectedValue(new ApiError(DUPLICATE_EMAIL_MESSAGE, 409))
    const { user } = setup(emptyCandidateValues(), onSubmit)
    await fillValid(user)
    await submit(user)
    await screen.findByRole('link', { name: 'View the existing candidate' })
    await user.type(screen.getByLabelText(/^email/i), 'x')
    expect(screen.queryByRole('link', { name: 'View the existing candidate' })).toBeNull()
  })

  it('still reports a duplicate if the lookup fails', async () => {
    findByEmail.mockRejectedValue(new ApiError('down', 500))
    const onSubmit = vi.fn().mockRejectedValue(new ApiError(DUPLICATE_EMAIL_MESSAGE, 409))
    const { user } = setup(emptyCandidateValues(), onSubmit)
    await fillValid(user)
    await submit(user)
    expect(await screen.findByText(DUPLICATE_EMAIL_MESSAGE)).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'View the existing candidate' })).toBeNull()
  })

  it('puts a server field error on that field', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new ApiError('Please correct the highlighted fields.', 422, { phone: 'Not a phone' }))
    const { user } = setup(emptyCandidateValues(), onSubmit)
    await fillValid(user)
    await submit(user)
    expect(await screen.findByText('Not a phone')).toBeTruthy()
  })

  it('shows other errors in a banner', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new ApiError("This candidate's data was anonymized and can no longer be edited", 409))
    const { user } = setup(emptyCandidateValues(), onSubmit)
    await fillValid(user)
    await submit(user)
    expect((await screen.findByRole('alert')).textContent).toMatch(/anonymized/i)
  })
})

describe('editing', () => {
  it('prefills the saved values, including an explanation for "Other"', () => {
    setup(toCandidateFormValues(makeCandidate({ consent_basis: 'other', consent_basis_note: 'Met at a fair' })), undefined, true)
    expect((screen.getByLabelText(/first name/i) as HTMLInputElement).value).toBe('Sana')
    expect(select().basis.value).toBe('other')
    expect((screen.getByLabelText(/explain the basis/i) as HTMLInputElement).value).toBe('Met at a fair')
  })

  it('warns that re-recording the basis restarts the retention period', () => {
    setup(toCandidateFormValues(makeCandidate()), undefined, true)
    expect(screen.getByText(/restarts the retention period/i)).toBeTruthy()
  })

  it('explains the retention approach when creating', () => {
    setup()
    expect(screen.getByText(/kept for a set period after their last activity/i)).toBeTruthy()
  })

  it('has a working cancel link', () => {
    setup()
    expect(screen.getByRole('link', { name: 'Cancel' }).getAttribute('href')).toBe('/cancel')
  })
})
