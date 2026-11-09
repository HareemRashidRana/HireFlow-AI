import type { Job, JobCreate, JobList, JobListParams, JobStatus, JobUpdate } from '../types/job'
import { request } from './http'
import { toQuery } from './query'

export const jobsApi = {
  list: (params: JobListParams, signal?: AbortSignal) =>
    request<JobList>(`/jobs${toQuery(params)}`, { signal }),

  get: (id: string, signal?: AbortSignal) =>
    request<Job>(`/jobs/${encodeURIComponent(id)}`, { signal }),

  /** Department names already used by jobs or employees (for suggestions). */
  departments: (signal?: AbortSignal) => request<string[]>('/jobs/departments', { signal }),

  create: (data: JobCreate) => request<Job>('/jobs', { method: 'POST', json: data }),

  update: (id: string, data: JobUpdate) =>
    request<Job>(`/jobs/${encodeURIComponent(id)}`, { method: 'PATCH', json: data }),

  changeStatus: (id: string, status: JobStatus) =>
    request<Job>(`/jobs/${encodeURIComponent(id)}/status`, { method: 'POST', json: { status } }),

  remove: (id: string) => request<void>(`/jobs/${encodeURIComponent(id)}`, { method: 'DELETE' }),
}
