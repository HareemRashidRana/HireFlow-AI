// Mirrors backend/app/schemas/user.py and auth.py.

export type UserRole = 'admin' | 'hr_manager' | 'recruiter' | 'employee'

export interface AuthUser {
  id: string
  email: string
  role: UserRole
  is_active: boolean
  must_change_password: boolean
  employee_id: string | null
  last_login_at: string | null
  created_at: string
}

/** Body of POST /auth/login and /auth/refresh. The refresh token is NOT here (HttpOnly cookie). */
export interface TokenResponse {
  access_token: string
  token_type: string
  expires_in: number // seconds
  user: AuthUser
}
