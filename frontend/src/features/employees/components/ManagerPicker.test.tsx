// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ManagerPicker } from './ManagerPicker'

vi.mock('../../../api/employees', () => ({
  employeesApi: {
    list: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, page_size: 8 }),
    get: vi.fn().mockResolvedValue({
      id: 'm1',
      first_name: 'Ayesha',
      last_name: 'Khan',
      job_title: 'CTO',
    }),
  },
}))

describe('ManagerPicker wording', () => {
  it('keeps the original "Manager" wording by default (used by the Employee form)', () => {
    render(<ManagerPicker value="" onChange={() => {}} />)
    expect(screen.getByText('Manager')).toBeTruthy()
    expect(screen.getByLabelText('Search for a manager')).toBeTruthy()
  })

  it('keeps the original "Remove manager" button name once someone is selected', async () => {
    render(<ManagerPicker value="m1" onChange={() => {}} />)
    expect(await screen.findByRole('button', { name: 'Remove manager' })).toBeTruthy()
  })

  it('can be relabelled, e.g. for a job\'s hiring manager', async () => {
    render(<ManagerPicker label="Hiring manager" value="" onChange={() => {}} />)
    expect(screen.getByText('Hiring manager')).toBeTruthy()
    expect(screen.getByLabelText('Search for a hiring manager')).toBeTruthy()
    expect(screen.queryByText('Manager')).toBeNull()
  })
})
