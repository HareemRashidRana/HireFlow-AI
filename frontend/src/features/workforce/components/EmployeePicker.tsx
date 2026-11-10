import { useState } from 'react'
import { employeesApi } from '../../../api/employees'
import { Input, Select } from '../../../components/ui/Field'
import { useQuery } from '../../../hooks/useQuery'
import { fullName } from '../../../lib/format'

export interface PickedEmployee {
  id: string
  name: string
}

/** Search active employees by name, then choose one. Used by HR screens. */
export function EmployeePicker({
  label = 'Employee',
  value,
  onChange,
  error,
  allowAll = false,
}: {
  label?: string
  value: PickedEmployee | null
  onChange: (employee: PickedEmployee | null) => void
  error?: string
  allowAll?: boolean
}) {
  const [q, setQ] = useState('')
  const { data, error: failed, reload } = useQuery(
    (s) => employeesApi.list({ q: q.trim() || undefined, employment_status: 'active', page_size: 20 }, s),
    `employee-picker-${q.trim()}`,
  )
  const found = (data?.items ?? []).map((e) => ({ id: e.id, name: fullName(e) }))
  const options = value && !found.some((f) => f.id === value.id) ? [value, ...found] : found
  return (
    <div className="space-y-2">
      <Input label={`Search ${label.toLowerCase()}`} type="search" placeholder="Type a name" value={q} onChange={(e) => setQ(e.target.value)} />
      <Select
        label={label}
        value={value?.id ?? ''}
        error={error}
        onChange={(e) => onChange(options.find((o) => o.id === e.target.value) ?? null)}
      >
        <option value="">{allowAll ? 'Everyone' : 'Choose a person…'}</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </Select>
      {failed && (
        <p role="alert" className="text-xs text-rose-600">
          Couldn&apos;t load employees.{' '}
          <button type="button" onClick={reload} className="font-medium underline">
            Retry
          </button>
        </p>
      )}
    </div>
  )
}
