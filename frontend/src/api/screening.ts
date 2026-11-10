import type {
  ApplicationScreening,
  Assessment,
  JobScreening,
  Methodology,
  ReviewInput,
} from '../types/screening'
import { request } from './http'

const app = (id: string) => `/applications/${encodeURIComponent(id)}/screening`
const one = (id: string) => `/screening/${encodeURIComponent(id)}`

/**
 * Requirements Coverage. There is deliberately no function here that sorts, ranks or filters by a
 * figure, and the job overview only takes paging parameters.
 */
export const screeningApi = {
  forApplication: (applicationId: string, signal?: AbortSignal) =>
    request<ApplicationScreening>(app(applicationId), { signal }),

  /** Creates a new assessment (or returns the identical one that already exists). */
  create: (applicationId: string) => request<Assessment>(app(applicationId), { method: 'POST' }),

  get: (assessmentId: string, signal?: AbortSignal) => request<Assessment>(one(assessmentId), { signal }),

  review: (assessmentId: string, input: ReviewInput) =>
    request<Assessment>(`${one(assessmentId)}/reviews`, {
      method: 'POST',
      json: {
        judgement: input.judgement,
        adjustments: input.adjustments,
        adjustment_reason: input.adjustment_reason,
        note: input.note,
      },
    }),

  forJob: (jobId: string, page: number, pageSize: number, signal?: AbortSignal) =>
    request<JobScreening>(
      `/jobs/${encodeURIComponent(jobId)}/screening?page=${page}&page_size=${pageSize}`,
      { signal },
    ),

  methodology: (signal?: AbortSignal) => request<Methodology>('/screening/methodology', { signal }),
}
