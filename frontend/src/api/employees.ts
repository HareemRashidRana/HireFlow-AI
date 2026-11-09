import type {
  Employee,
  EmployeeCreate,
  EmployeeList,
  EmployeeListParams,
  EmployeeUpdate,
} from '../types/employee'
import { request } from './client'

function toQuery(params: EmployeeListParams): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value))
  }
  const query = search.toString()
  return query ? `?${query}` : ''
}

export const employeesApi = {
  list: (params: EmployeeListParams, signal?: AbortSignal) =>
    request<EmployeeList>(`/employees${toQuery(params)}`, { signal }),

  get: (id: string, signal?: AbortSignal) =>
    request<Employee>(`/employees/${encodeURIComponent(id)}`, { signal }),

  create: (data: EmployeeCreate) =>
    request<Employee>('/employees', { method: 'POST', json: data }),

  update: (id: string, data: EmployeeUpdate) =>
    request<Employee>(`/employees/${encodeURIComponent(id)}`, { method: 'PATCH', json: data }),

  remove: (id: string) =>
    request<void>(`/employees/${encodeURIComponent(id)}`, { method: 'DELETE' }),
}
