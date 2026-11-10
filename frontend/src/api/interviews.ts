import type {
  Feedback,
  FeedbackContent,
  FeedbackOverview,
  Interview,
  InterviewCreate,
  InterviewEvent,
  InterviewList,
  InterviewParams,
  InterviewStats,
  InterviewUpdate,
  RatingScale,
  RescheduleInput,
  Revision,
  StaffRef,
} from '../types/interview'
import { request } from './http'
import { toQuery } from './query'

const one = (id: string) => `/interviews/${encodeURIComponent(id)}`

/**
 * Interviews. Interviews are cancelled or rescheduled, never deleted, and nothing here sorts or
 * filters by a rating: the list is ordered by start time only.
 */
export const interviewsApi = {
  list: (params: InterviewParams, signal?: AbortSignal) =>
    request<InterviewList>(`/interviews${toQuery(params)}`, { signal }),

  forApplication: (applicationId: string, signal?: AbortSignal) =>
    request<InterviewList>(`/applications/${encodeURIComponent(applicationId)}/interviews`, { signal }),

  get: (id: string, signal?: AbortSignal) => request<Interview>(one(id), { signal }),

  create: (data: InterviewCreate) => request<Interview>('/interviews', { method: 'POST', json: data }),

  update: (id: string, data: InterviewUpdate) => request<Interview>(one(id), { method: 'PATCH', json: data }),

  confirm: (id: string) => request<Interview>(`${one(id)}/confirm`, { method: 'POST' }),

  complete: (id: string) => request<Interview>(`${one(id)}/complete`, { method: 'POST' }),

  cancel: (id: string, reason: string) =>
    request<Interview>(`${one(id)}/cancel`, { method: 'POST', json: { reason } }),

  /** Returns the NEW interview; the original stays, marked rescheduled. */
  reschedule: (id: string, data: RescheduleInput) =>
    request<Interview>(`${one(id)}/reschedule`, { method: 'POST', json: data }),

  addInterviewer: (id: string, userId: string) =>
    request<Interview>(`${one(id)}/interviewers`, { method: 'POST', json: { user_id: userId } }),

  removeInterviewer: (id: string, userId: string) =>
    request<Interview>(`${one(id)}/interviewers/${encodeURIComponent(userId)}`, { method: 'DELETE' }),

  history: (id: string, signal?: AbortSignal) => request<InterviewEvent[]>(`${one(id)}/history`, { signal }),

  stats: (signal?: AbortSignal) => request<InterviewStats>('/interviews/stats', { signal }),

  interviewers: (signal?: AbortSignal) => request<StaffRef[]>('/interviews/interviewers', { signal }),

  ratingScale: (signal?: AbortSignal) => request<RatingScale>('/interviews/rating-scale', { signal }),

  feedback: (id: string, signal?: AbortSignal) => request<FeedbackOverview>(`${one(id)}/feedback`, { signal }),

  saveDraft: (id: string, data: FeedbackContent) =>
    request<Feedback>(`${one(id)}/feedback`, { method: 'PUT', json: data }),

  submitFeedback: (id: string, data: FeedbackContent) =>
    request<Feedback>(`${one(id)}/feedback/submit`, { method: 'POST', json: data }),

  editFeedback: (id: string, data: FeedbackContent, editReason: string) =>
    request<Feedback>(`${one(id)}/feedback`, { method: 'PATCH', json: { ...data, edit_reason: editReason } }),

  revisions: (id: string, feedbackId: string, signal?: AbortSignal) =>
    request<Revision[]>(`${one(id)}/feedback/${encodeURIComponent(feedbackId)}/revisions`, { signal }),
}
