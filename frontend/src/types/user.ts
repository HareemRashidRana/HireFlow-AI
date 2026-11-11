// Mirrors backend/app/schemas/user.py (UserRead, UserList). There is no password or token field.
import type { UserRole } from './auth'

export interface ManagedUser {
  id: string
  email: string
  role: UserRole
  is_active: boolean
  must_change_password: boolean
  employee_id: string | null
  last_login_at: string | null
  created_at: string
}

export interface UserListResponse {
  items: ManagedUser[]
  total: number
  page: number
  page_size: number
}

export interface UserListParams {
  q?: string
  role?: UserRole
  is_active?: boolean
  page?: number
  page_size?: number
}

export interface UserCreate {
  email: string
  password: string
  role: UserRole
  employee_id: string | null
  must_change_password: boolean
}

export interface UserUpdate {
  role?: UserRole
  is_active?: boolean
  employee_id?: string | null
}
