import type { Employee, EmploymentStatus, EmploymentType } from '../types/employee'

export const employmentTypeLabels: Record<EmploymentType, string> = {
  full_time: 'Full-time',
  part_time: 'Part-time',
  contract: 'Contract',
  intern: 'Intern',
}

export const employmentStatusLabels: Record<EmploymentStatus, string> = {
  active: 'Active',
  inactive: 'Inactive',
  terminated: 'Terminated',
}

export const employmentTypes = Object.keys(employmentTypeLabels) as EmploymentType[]
export const employmentStatuses = Object.keys(employmentStatusLabels) as EmploymentStatus[]

type NameParts = Pick<Employee, 'first_name' | 'last_name'>

export const fullName = (e: NameParts) => `${e.first_name} ${e.last_name}`
export const initials = (e: NameParts) => `${e.first_name[0] ?? ''}${e.last_name[0] ?? ''}`.toUpperCase()

/** "2024-03-01" -> "1 Mar 2024". Parsed manually so the date never shifts with the time zone. */
export function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}
