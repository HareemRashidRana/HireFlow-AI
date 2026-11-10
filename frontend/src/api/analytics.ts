import type { AnalyticsParams, FilterOptions, JobPerformanceList, Overview } from '../types/analytics'
import { request } from './http'
import { toQuery } from './query'

/** Recruitment analytics. Read-only: there is nothing here that creates or changes data. */
export const analyticsApi = {
  overview: (params: AnalyticsParams, signal?: AbortSignal) =>
    request<Overview>(`/analytics/overview${toQuery(params)}`, { signal }),

  jobs: (params: AnalyticsParams & { page?: number; page_size?: number }, signal?: AbortSignal) =>
    request<JobPerformanceList>(`/analytics/jobs${toQuery(params)}`, { signal }),

  filterOptions: (signal?: AbortSignal) => request<FilterOptions>('/analytics/filter-options', { signal }),
}
