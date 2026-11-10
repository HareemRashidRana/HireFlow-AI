import type { InterviewStatus, InterviewType } from '../../../types/interview'

export interface InterviewFilterValues {
  q: string
  status: InterviewStatus | ''
  type: InterviewType | ''
  from: string
  to: string
  mine: boolean
}

export const emptyFilters: InterviewFilterValues = { q: '', status: '', type: '', from: '', to: '', mine: false }

export const activeFilterCount = (f: InterviewFilterValues) =>
  [f.q, f.status, f.type, f.from, f.to].filter(Boolean).length + (f.mine ? 1 : 0)
