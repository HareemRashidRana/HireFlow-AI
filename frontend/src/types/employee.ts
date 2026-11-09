// Mirrors the FastAPI schemas in backend/app/schemas/employee.py.

export type EmploymentType = 'full_time' | 'part_time' | 'contract' | 'intern'
export type EmploymentStatus = 'active' | 'inactive' | 'terminated'

export interface Employee {
  id: string
  employee_id: string
  first_name: string
  last_name: string
  work_email: string
  phone_number: string | null
  job_title: string
  department: string
  employment_type: EmploymentType
  employment_status: EmploymentStatus
  date_of_joining: string // ISO date, e.g. "2024-03-01"
  manager_id: string | null
  created_at: string // ISO datetime
  updated_at: string
}

export interface EmployeeCreate {
  employee_id: string
  first_name: string
  last_name: string
  work_email: string
  phone_number?: string | null
  job_title: string
  department: string
  employment_type: EmploymentType
  employment_status?: EmploymentStatus
  date_of_joining: string
  manager_id?: string | null
}

/** PATCH body: only the fields that changed. `null` clears phone_number / manager_id. */
export type EmployeeUpdate = Partial<EmployeeCreate>

export interface EmployeeList {
  items: Employee[]
  total: number
  page: number
  page_size: number
}

export interface EmployeeListParams {
  q?: string
  department?: string
  employment_status?: EmploymentStatus | ''
  employment_type?: EmploymentType | ''
  page?: number
  page_size?: number
}
