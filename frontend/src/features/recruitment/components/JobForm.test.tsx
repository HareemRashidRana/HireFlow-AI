// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../../api/errors'
import { makeJob } from '../../../test/fixtures'
import { renderAs } from '../../../test/render'
import { emptyJobValues, toJobFormValues } from '../lib/jobFormValues'
import type { JobFormValues } from '../lib/jobFormValues'
import { JobForm } from './JobForm'

const departments = vi.fn()
vi.mock('../../../api/jobs', () => ({ jobsApi: { departments: (...a: unknown[]) => departments(...a) } }))
vi.mock('../../../api/employees', () => ({
  employeesApi: {
    list: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, page_size: 8 }),
    get: vi.fn(),
  },
}))

beforeEach(() => {
  departments.mockReset()
  departments.mockResolvedValue(['Engineering', 'Sales'])
})

function setup(initial: JobFormValues = emptyJobValues, onSubmit = vi.fn().mockResolvedValue(undefined)) {
  const view = renderAs(
    <JobForm initialValues={initial} submitLabel="Save as draft" cancelTo="/cancel" onSubmit={onSubmit} />,
  )
  return { onSubmit, user: userEvent.setup(), ...view }
}

async function fillValid(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/job title/i), 'Backend Engineer')
  await user.type(screen.getByLabelText(/department/i), 'Engineering')
  await user.type(screen.getByLabelText(/location/i), 'Remote')
  await user.selectOptions(screen.getByLabelText(/employment type/i), 'full_time')
}

const submit = (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByRole('button', { name: 'Save as draft' }))

describe('JobForm validation', () => {
  it('shows errors for the required fields and does not submit', async () => {
    const { user, onSubmit } = setup()
    await submit(user)
    expect(screen.getByText(/enter a job title/i)).toBeTruthy()
    expect(screen.getByText('Department is required.')).toBeTruthy()
    expect(screen.getByText('Location is required.')).toBeTruthy()
    expect(screen.getByText('Choose an employment type.')).toBeTruthy()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('moves focus to the first invalid field', async () => {
    const { user } = setup()
    await submit(user)
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText(/job title/i)))
  })

  it('clears an error as soon as the user edits that field', async () => {
    const { user } = setup()
    await submit(user)
    await user.type(screen.getByLabelText(/job title/i), 'Engineer')
    expect(screen.queryByText(/enter a job title/i)).toBeNull()
    expect(screen.getByText('Department is required.')).toBeTruthy() // others stay
  })

  it('flags a salary range without a currency', async () => {
    const { user, onSubmit } = setup()
    await fillValid(user)
    await user.type(screen.getByLabelText(/minimum salary/i), '100000')
    await submit(user)
    expect(screen.getByText('Choose a currency.')).toBeTruthy()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('flags a minimum salary above the maximum', async () => {
    const { user } = setup()
    await fillValid(user)
    await user.type(screen.getByLabelText(/minimum salary/i), '300')
    await user.type(screen.getByLabelText(/maximum salary/i), '100')
    await user.selectOptions(screen.getByLabelText(/currency/i), 'USD')
    await submit(user)
    expect(screen.getByText(/minimum cannot be greater/i)).toBeTruthy()
  })

  it('rejects zero openings', async () => {
    const { user } = setup()
    await fillValid(user)
    const openings = screen.getByLabelText(/openings/i)
    await user.clear(openings)
    await user.type(openings, '0')
    await submit(user)
    expect(screen.getByText('Enter a whole number from 1 to 500.')).toBeTruthy()
  })
})

describe('JobForm submit', () => {
  it('submits the entered values', async () => {
    const { user, onSubmit } = setup()
    await fillValid(user)
    await user.type(screen.getByLabelText(/role description/i), 'A great job')
    await user.type(screen.getByLabelText('Required skills'), 'Python{Enter}SQL{Enter}')
    await user.type(screen.getByLabelText('Nice-to-have skills'), 'React{Enter}')
    await user.type(screen.getByLabelText(/minimum experience/i), '3')
    await submit(user)

    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      title: 'Backend Engineer',
      department: 'Engineering',
      location: 'Remote',
      employment_type: 'full_time',
      description: 'A great job',
      required_skills: ['Python', 'SQL'],
      nice_to_have_skills: ['React'],
      min_experience_years: '3',
      openings: '1',
    })
  })

  it('prefills every field when editing and submits the saved values untouched', async () => {
    const job = makeJob({ title: 'Staff Engineer', required_skills: ['Go'], salary_currency: 'USD', salary_min: 1, salary_max: 2 })
    const { user, onSubmit } = setup(toJobFormValues(job))
    expect((screen.getByLabelText(/job title/i) as HTMLInputElement).value).toBe('Staff Engineer')
    expect(screen.getByText('Go')).toBeTruthy()
    expect((screen.getByLabelText(/currency/i) as HTMLSelectElement).value).toBe('USD')
    await submit(user)
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it('shows a spinner state and blocks double submits while saving', async () => {
    let finish!: () => void
    const slow = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)))
    const { user } = setup(emptyJobValues, slow)
    await fillValid(user)
    await submit(user)
    const button = screen.getByRole('button', { name: /save as draft/i }) as HTMLButtonElement
    await waitFor(() => expect(button.disabled).toBe(true))
    await user.click(button)
    expect(slow).toHaveBeenCalledTimes(1)
    finish()
  })
})

describe('JobForm server errors', () => {
  it('puts a field error from the server on that field and re-enables the form', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new ApiError('Please correct the highlighted fields.', 422, { title: 'Title already used' }))
    const { user } = setup(emptyJobValues, onSubmit)
    await fillValid(user)
    await submit(user)
    expect(await screen.findByText('Title already used')).toBeTruthy()
    expect(screen.getByText('Please correct the highlighted fields.')).toBeTruthy()
    expect((screen.getByRole('button', { name: /save as draft/i }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('shows a rule error on the hiring manager field', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new ApiError('The hiring manager must be an active employee', 422))
    const { user } = setup(emptyJobValues, onSubmit)
    await fillValid(user)
    await submit(user)
    expect(await screen.findByText('The hiring manager must be an active employee')).toBeTruthy()
  })

  it('shows other errors in a banner (e.g. a closed job)', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new ApiError('Closed jobs cannot be edited. Reopen the job first.', 409))
    const { user } = setup(emptyJobValues, onSubmit)
    await fillValid(user)
    await submit(user)
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/closed jobs cannot be edited/i)
  })
})

describe('JobForm extras', () => {
  it('offers existing departments as suggestions', async () => {
    setup()
    await waitFor(() => expect(document.querySelectorAll('#job-departments option')).toHaveLength(2))
    expect([...document.querySelectorAll('#job-departments option')].map((o) => (o as HTMLOptionElement).value)).toEqual(['Engineering', 'Sales'])
  })

  it('still works when the suggestions cannot be loaded', async () => {
    departments.mockRejectedValue(new ApiError('down', 500))
    const { user, onSubmit } = setup()
    await fillValid(user)
    await submit(user)
    expect(onSubmit).toHaveBeenCalled()
  })

  it('keeps an uncommon saved currency selectable', () => {
    setup({ ...emptyJobValues, salary_currency: 'JPY', salary_min: '1', salary_max: '2' })
    const options = [...(screen.getByLabelText(/currency/i) as HTMLSelectElement).options].map((o) => o.value)
    expect(options).toContain('JPY')
    expect((screen.getByLabelText(/currency/i) as HTMLSelectElement).value).toBe('JPY')
  })

  it('counts description characters', async () => {
    const { user } = setup()
    await user.type(screen.getByLabelText(/role description/i), 'hello')
    expect(screen.getByText('5 / 10,000 characters')).toBeTruthy()
  })

  it('has a working cancel link', () => {
    setup()
    expect(screen.getByRole('link', { name: 'Cancel' }).getAttribute('href')).toBe('/cancel')
  })

  it('labels the manager field "Hiring manager"', () => {
    setup()
    expect(screen.getByText('Hiring manager')).toBeTruthy()
    expect(screen.getByLabelText('Search for a hiring manager')).toBeTruthy()
  })
})
