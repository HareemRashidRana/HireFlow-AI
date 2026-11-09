import { useEffect, useState } from 'react'
import { employeesApi } from '../../../api/employees'
import { Avatar } from '../../../components/ui/Avatar'
import { CloseIcon, SearchIcon } from '../../../components/ui/icons'
import { Spinner } from '../../../components/ui/Spinner'
import { useDebounce } from '../../../hooks/useDebounce'
import { useQuery } from '../../../hooks/useQuery'
import { fullName, initials } from '../../../lib/format'
import type { Employee } from '../../../types/employee'

interface Props {
  /** Selected manager's UUID, or '' for none. */
  value: string
  onChange: (id: string) => void
  /** Hide this employee from the results (you cannot manage yourself). */
  excludeId?: string
  error?: string
}

/** Search-as-you-type picker: the API has no "list all" beyond 100 rows, so we query by name. */
export function ManagerPicker({ value, onChange, excludeId, error }: Props) {
  const [selected, setSelected] = useState<Employee | null>(null)
  const [text, setText] = useState('')
  const [open, setOpen] = useState(false)
  const query = useDebounce(text.trim(), 250)

  // Load the manager's name when editing an employee that already has one.
  useEffect(() => {
    if (!value) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- sync local label with the value prop
      setSelected(null)
      return
    }
    if (selected?.id === value) return
    const controller = new AbortController()
    employeesApi
      .get(value, controller.signal)
      .then(setSelected)
      .catch(() => {})
    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  const results = useQuery(
    (signal) => employeesApi.list({ q: query, page_size: 8 }, signal),
    `managers:${query}`,
    open,
  )
  const options = (results.data?.items ?? []).filter((e) => e.id !== excludeId)

  const choose = (employee: Employee) => {
    setSelected(employee)
    onChange(employee.id)
    setText('')
    setOpen(false)
  }

  return (
    <div>
      <span className="mb-1.5 block text-sm font-medium text-navy-800">Manager</span>

      {selected ? (
        <div className="flex h-11 items-center justify-between rounded-xl border border-slate-200 bg-white pr-2 pl-3 shadow-sm">
          <div className="flex items-center gap-2.5 truncate">
            <Avatar initials={initials(selected)} size="sm" />
            <span className="truncate text-sm text-navy-900">
              {fullName(selected)} <span className="text-slate-400">· {selected.job_title}</span>
            </span>
          </div>
          <button
            type="button"
            onClick={() => onChange('')}
            aria-label="Remove manager"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-lavender-100 hover:text-navy-900"
          >
            <CloseIcon className="size-4" />
          </button>
        </div>
      ) : (
        <div
          className="relative"
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false)
          }}
        >
          <SearchIcon className="pointer-events-none absolute top-3 left-3.5 size-5 text-slate-400" />
          <input
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onFocus={() => setOpen(true)}
            onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
            placeholder="Search by name or email (optional)"
            aria-label="Search for a manager"
            aria-invalid={!!error}
            className={`block h-11 w-full rounded-xl border bg-white pr-3.5 pl-11 text-sm shadow-sm placeholder:text-slate-400 focus:ring-4 focus:outline-none ${
              error
                ? 'border-rose-400 focus:border-rose-500 focus:ring-rose-100'
                : 'border-slate-200 hover:border-slate-300 focus:border-lavender-500 focus:ring-lavender-100'
            }`}
          />
          {open && (
            <ul className="absolute z-20 mt-2 max-h-64 w-full overflow-auto rounded-xl border border-slate-200 bg-white p-1 shadow-xl">
              {results.loading && !results.data && (
                <li className="flex items-center gap-2 px-3 py-3 text-sm text-slate-500">
                  <Spinner className="size-4" /> Searching…
                </li>
              )}
              {results.error && <li className="px-3 py-3 text-sm text-rose-600">{results.error.message}</li>}
              {!results.error && results.data && options.length === 0 && (
                <li className="px-3 py-3 text-sm text-slate-500">No matching employees.</li>
              )}
              {options.map((e) => (
                <li key={e.id}>
                  <button
                    type="button"
                    onMouseDown={(ev) => ev.preventDefault()}
                    onClick={() => choose(e)}
                    className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left hover:bg-lavender-50"
                  >
                    <Avatar initials={initials(e)} size="sm" />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-navy-900">{fullName(e)}</span>
                      <span className="block truncate text-xs text-slate-500">
                        {e.job_title} · {e.department}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {error && <p className="mt-1.5 text-xs font-medium text-rose-600">{error}</p>}
    </div>
  )
}
