import type { ManagedUser, UserCreate, UserListParams, UserListResponse, UserUpdate } from '../types/user'
import { request } from './http'
import { toQuery } from './query'

const enc = encodeURIComponent

/** Account management. Every route is administrator-only on the server. */
export const usersApi = {
  list: (params: UserListParams, signal?: AbortSignal) => request<UserListResponse>(`/users${toQuery(params)}`, { signal }),
  create: (data: UserCreate) => request<ManagedUser>('/users', { method: 'POST', json: data }),
  update: (id: string, data: UserUpdate) => request<ManagedUser>(`/users/${enc(id)}`, { method: 'PATCH', json: data }),
  unlock: (id: string) => request<void>(`/users/${enc(id)}/unlock`, { method: 'POST' }),
  resetPassword: (id: string, newPassword: string) =>
    request<void>(`/users/${enc(id)}/reset-password`, { method: 'POST', json: { new_password: newPassword } }),
}
