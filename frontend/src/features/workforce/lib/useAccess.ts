import { useAuth } from '../../../auth/useAuth'
import type { Tab } from '../components/Shared'

/** What this person may open: their own pages need an employee record; HR pages need the HR permission. */
export function useAccess() {
  const { user, can } = useAuth()
  return { isHr: can('workforce:manage'), hasRecord: user?.employee_id != null, employeeId: user?.employee_id ?? null }
}

export function attendanceTabs(a: { isHr: boolean; hasRecord: boolean }): Tab[] {
  return [
    ...(a.hasRecord ? [{ to: '/attendance', label: 'My attendance' }, { to: '/attendance/history', label: 'History' }] : []),
    ...(a.isHr ? [{ to: '/attendance/overview', label: 'Today and month' }, { to: '/attendance/manage', label: 'Records and corrections' }] : []),
  ]
}

export function leaveTabs(a: { isHr: boolean; hasRecord: boolean }): Tab[] {
  return [
    { to: '/leave', label: 'Overview' },
    ...(a.hasRecord ? [{ to: '/leave/requests', label: 'My requests' }] : []),
    ...(a.isHr ? [{ to: '/leave/approvals', label: 'Approvals' }] : []),
    { to: '/leave/balances', label: 'Balances' },
    { to: '/leave/calendar', label: 'Calendar' },
  ]
}
