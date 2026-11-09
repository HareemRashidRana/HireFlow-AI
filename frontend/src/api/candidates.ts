import type {
  Candidate,
  CandidateCreate,
  CandidateList,
  CandidateListParams,
  CandidateUpdate,
} from '../types/candidate'
import { request } from './http'
import { toQuery } from './query'

export const candidatesApi = {
  list: (params: CandidateListParams, signal?: AbortSignal) =>
    request<CandidateList>(`/candidates${toQuery(params)}`, { signal }),

  get: (id: string, signal?: AbortSignal) =>
    request<Candidate>(`/candidates/${encodeURIComponent(id)}`, { signal }),

  /** The candidate with exactly this email, if any (used to explain a duplicate). */
  async findByEmail(email: string, signal?: AbortSignal) {
    const result = await request<CandidateList>(`/candidates${toQuery({ email })}`, { signal })
    return result.items[0] ?? null
  },

  create: (data: CandidateCreate) => request<Candidate>('/candidates', { method: 'POST', json: data }),

  update: (id: string, data: CandidateUpdate) =>
    request<Candidate>(`/candidates/${encodeURIComponent(id)}`, { method: 'PATCH', json: data }),

  remove: (id: string) => request<void>(`/candidates/${encodeURIComponent(id)}`, { method: 'DELETE' }),
}
