import type { Job, JobStatus } from '../../../types/job'

export const jobStatusLabels: Record<JobStatus, string> = {
  draft: 'Draft',
  open: 'Open',
  on_hold: 'On hold',
  closed: 'Closed',
}

/** Order used by the status tabs. */
export const jobStatuses: JobStatus[] = ['open', 'draft', 'on_hold', 'closed']

/**
 * Which status may follow which. This MIRRORS backend/app/services/job.py (ALLOWED_TRANSITIONS);
 * it only decides which buttons to show: the server rejects illegal moves with 409 regardless.
 */
export const ALLOWED_TRANSITIONS: Record<JobStatus, readonly JobStatus[]> = {
  draft: ['open', 'closed'],
  open: ['on_hold', 'closed'],
  on_hold: ['open', 'closed'],
  closed: ['open'],
}

export interface StatusAction {
  to: JobStatus
  label: string
  /** The main call to action for this status (rendered as a filled button). */
  primary: boolean
  /** Closing needs an "are you sure?" step. */
  confirm: boolean
  /** Toast shown after success. */
  success: string
}

const ACTIONS: Record<JobStatus, StatusAction[]> = {
  draft: [
    { to: 'open', label: 'Publish job', primary: true, confirm: false, success: 'Job published.' },
    { to: 'closed', label: 'Close job', primary: false, confirm: true, success: 'Job closed.' },
  ],
  open: [
    { to: 'on_hold', label: 'Put on hold', primary: false, confirm: false, success: 'Job put on hold.' },
    { to: 'closed', label: 'Close job', primary: false, confirm: true, success: 'Job closed.' },
  ],
  on_hold: [
    { to: 'open', label: 'Reopen job', primary: true, confirm: false, success: 'Job reopened.' },
    { to: 'closed', label: 'Close job', primary: false, confirm: true, success: 'Job closed.' },
  ],
  closed: [{ to: 'open', label: 'Reopen job', primary: true, confirm: false, success: 'Job reopened.' }],
}

export const statusActions = (status: JobStatus): StatusAction[] => ACTIONS[status]

/** Closed jobs are read-only on the server, so the UI hides Edit for them too. */
export const isEditable = (job: Pick<Job, 'status'>): boolean => job.status !== 'closed'

/** Only drafts can be deleted (and only by admins); anything published is closed instead. */
export const isDeletable = (job: Pick<Job, 'status'>): boolean => job.status === 'draft'

const number = (n: number) => n.toLocaleString('en-US')

/** "PKR 100,000 – 200,000", "From PKR 100,000", "Up to PKR 200,000", or null when not set. */
export function formatSalary(job: Pick<Job, 'salary_min' | 'salary_max' | 'salary_currency'>): string | null {
  const { salary_min: low, salary_max: high } = job
  const cur = job.salary_currency ?? ''
  if (low === null && high === null) return null
  if (low !== null && high !== null) return `${cur} ${number(low)} – ${number(high)}`.trim()
  if (low !== null) return `From ${cur} ${number(low)}`.replace('  ', ' ')
  return `Up to ${cur} ${number(high as number)}`.replace('  ', ' ')
}
