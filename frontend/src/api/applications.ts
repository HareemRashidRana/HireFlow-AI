import type {
  Application,
  ApplicationCreate,
  ApplicationList,
  ApplicationListParams,
  ApplicationStage,
  ApplicationSummary,
  ApplicationUpdate,
  Board,
  BoardParams,
  StaffSummary,
} from '../types/application'
import { request } from './http'
import { toQuery } from './query'

const path = (id: string) => `/applications/${encodeURIComponent(id)}`

export const applicationsApi = {
  list: (params: ApplicationListParams, signal?: AbortSignal) =>
    request<ApplicationList>(`/applications${toQuery(params)}`, { signal }),

  board: (params: BoardParams, signal?: AbortSignal) =>
    request<Board>(`/applications/board${toQuery(params)}`, { signal }),

  summary: (signal?: AbortSignal) => request<ApplicationSummary>('/applications/summary', { signal }),

  /** Active staff who can be assigned to an application. */
  recruiters: (signal?: AbortSignal) => request<StaffSummary[]>('/applications/recruiters', { signal }),

  get: (id: string, signal?: AbortSignal) => request<Application>(path(id), { signal }),

  create: (data: ApplicationCreate) => request<Application>('/applications', { method: 'POST', json: data }),

  update: (id: string, data: ApplicationUpdate) =>
    request<Application>(path(id), { method: 'PATCH', json: data }),

  /** The server validates the move (one step at a time, who may do it). Rejecting needs a note. */
  changeStage: (id: string, stage: ApplicationStage, note?: string) =>
    request<Application>(`${path(id)}/stage`, { method: 'POST', json: note ? { stage, note } : { stage } }),

  reopen: (id: string, note?: string) =>
    request<Application>(`${path(id)}/reopen`, { method: 'POST', json: note ? { note } : {} }),
}
