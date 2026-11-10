import { describe, expect, it } from 'vitest'
import { can } from '../../../auth/permissions'
import type { Permission } from '../../../auth/permissions'
import type { UserRole } from '../../../types/auth'
import type { JobStatus } from '../../../types/job'
import { makeUser } from '../../../test/fixtures'
import {
  ALLOWED_TRANSITIONS,
  formatSalary,
  isDeletable,
  isEditable,
  jobStatusLabels,
  jobStatuses,
  statusActions,
} from './jobStatus'

const STATUSES: JobStatus[] = ['draft', 'open', 'on_hold', 'closed']

describe('workflow rules', () => {
  it('matches the backend transition table exactly (backend/app/services/job.py)', () => {
    // If this fails, the UI and the API disagree: update ALLOWED_TRANSITIONS or the backend.
    expect(ALLOWED_TRANSITIONS).toEqual({
      draft: ['open', 'closed'],
      open: ['on_hold', 'closed'],
      on_hold: ['open', 'closed'],
      closed: ['open'],
    })
  })

  it.each(STATUSES)('offers only legal moves from %s', (from) => {
    const offered = statusActions(from).map((a) => a.to)
    expect(offered.sort()).toEqual([...ALLOWED_TRANSITIONS[from]].sort())
  })

  it.each(STATUSES)('never offers a move to the current status (%s)', (from) => {
    expect(statusActions(from).map((a) => a.to)).not.toContain(from)
  })

  it('highlights one primary action where the next step is obvious (not while a job is open)', () => {
    const primaries = (s: JobStatus) => statusActions(s).filter((a) => a.primary).map((a) => a.label)
    expect(primaries('draft')).toEqual(['Publish job'])
    expect(primaries('on_hold')).toEqual(['Reopen job'])
    expect(primaries('closed')).toEqual(['Reopen job'])
    expect(primaries('open')).toEqual([]) // pausing or closing are deliberate, secondary choices
  })

  it('asks for confirmation only when closing', () => {
    for (const status of STATUSES) {
      for (const action of statusActions(status)) {
        expect(action.confirm).toBe(action.to === 'closed')
      }
    }
  })

  it('labels the actions sensibly', () => {
    expect(statusActions('draft')[0]).toMatchObject({ to: 'open', label: 'Publish job' })
    expect(statusActions('open').map((a) => a.label)).toEqual(['Put on hold', 'Close job'])
    expect(statusActions('on_hold')[0].label).toBe('Reopen job')
    expect(statusActions('closed')[0].label).toBe('Reopen job')
  })

  it('every status has a label, and the tab order covers all of them once', () => {
    expect(STATUSES.map((s) => jobStatusLabels[s])).toEqual(['Draft', 'Open', 'On hold', 'Closed'])
    expect([...jobStatuses].sort()).toEqual([...STATUSES].sort())
  })
})

describe('editability', () => {
  it('closed jobs are read-only, everything else is editable', () => {
    expect(isEditable({ status: 'closed' })).toBe(false)
    for (const status of ['draft', 'open', 'on_hold'] as const) expect(isEditable({ status })).toBe(true)
  })

  it('only drafts can be deleted', () => {
    expect(isDeletable({ status: 'draft' })).toBe(true)
    for (const status of ['open', 'on_hold', 'closed'] as const) expect(isDeletable({ status })).toBe(false)
  })
})

describe('formatSalary', () => {
  const base = { salary_min: null, salary_max: null, salary_currency: null }

  it('is null when no range is set', () => {
    expect(formatSalary(base)).toBeNull()
  })

  it('formats a full range with thousands separators', () => {
    expect(formatSalary({ salary_min: 100000, salary_max: 250000, salary_currency: 'PKR' })).toBe('PKR 100,000 – 250,000')
  })

  it('formats open-ended ranges', () => {
    expect(formatSalary({ salary_min: 5000, salary_max: null, salary_currency: 'USD' })).toBe('From USD 5,000')
    expect(formatSalary({ salary_min: null, salary_max: 9000, salary_currency: 'USD' })).toBe('Up to USD 9,000')
  })

  it('handles zero as a real amount', () => {
    expect(formatSalary({ salary_min: 0, salary_max: 0, salary_currency: 'EUR' })).toBe('EUR 0 – 0')
  })
})

describe('recruitment permissions mirror the API', () => {
  const expected: Record<Permission, Record<UserRole, boolean>> = {
    'recruitment:read': { admin: true, hr_manager: true, recruiter: true, employee: false },
    'recruitment:write': { admin: true, hr_manager: true, recruiter: true, employee: false },
    'recruitment:delete': { admin: true, hr_manager: false, recruiter: false, employee: false },
    'candidates:delete': { admin: true, hr_manager: true, recruiter: false, employee: false },
    'applications:assign': { admin: true, hr_manager: true, recruiter: false, employee: false },
    'privacy:manage': { admin: true, hr_manager: true, recruiter: false, employee: false },
    'privacy:purge': { admin: true, hr_manager: false, recruiter: false, employee: false },
    'employees:read': { admin: true, hr_manager: true, recruiter: true, employee: false },
    'employees:write': { admin: true, hr_manager: true, recruiter: false, employee: false },
    'employees:delete': { admin: true, hr_manager: false, recruiter: false, employee: false },
    'users:manage': { admin: true, hr_manager: false, recruiter: false, employee: false },
  }

  for (const [permission, byRole] of Object.entries(expected)) {
    for (const [role, allowed] of Object.entries(byRole)) {
      it(`${role} ${allowed ? 'can' : 'cannot'} ${permission}`, () => {
        expect(can(makeUser(role as UserRole), permission as Permission)).toBe(allowed)
      })
    }
  }

  it('nobody signed out can do anything', () => {
    expect(can(null, 'recruitment:read')).toBe(false)
  })
})
