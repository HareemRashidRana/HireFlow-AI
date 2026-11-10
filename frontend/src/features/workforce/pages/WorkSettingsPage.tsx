import { useState } from 'react'
import { configApi, leaveApi } from '../../../api/workforce'
import { Button } from '../../../components/ui/Button'
import { Card, CardHeader } from '../../../components/ui/Card'
import { ErrorState } from '../../../components/ui/Feedback'
import { Input } from '../../../components/ui/Field'
import { TrashIcon } from '../../../components/ui/icons'
import { Spinner } from '../../../components/ui/Spinner'
import { useToast } from '../../../components/ui/Toast'
import { useQuery } from '../../../hooks/useQuery'
import type { LeaveType, WorkSettings, WorkSettingsInput } from '../../../types/workforce'
import { PageHeader } from '../components/Shared'
import { formatDay, validateSettings, weekdayNames } from '../lib/workforce'

const toInput = (s: WorkSettings): WorkSettingsInput => ({
  timezone: s.timezone,
  work_days: [...s.work_days],
  work_start: s.work_start.slice(0, 5),
  work_end: s.work_end.slice(0, 5),
  grace_minutes: s.grace_minutes,
  max_backdate_days: s.max_backdate_days,
})

const zones = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : []

function ScheduleForm({ settings, onSaved }: { settings: WorkSettings; onSaved: () => void }) {
  const toast = useToast()
  const [v, setV] = useState<WorkSettingsInput>(() => toInput(settings))
  const [errors, setErrors] = useState<Partial<Record<keyof WorkSettingsInput, string>>>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const set = (patch: Partial<WorkSettingsInput>) => {
    setV((x) => ({ ...x, ...patch }))
    setErrors({})
    setError(null)
  }
  const save = async () => {
    const found = validateSettings(v)
    setErrors(found)
    if (Object.keys(found).length) return
    setBusy(true)
    try {
      await configApi.saveSettings({ ...v, timezone: v.timezone.trim() })
      toast.success('Working rules saved. They apply to new check-ins and new leave requests.')
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the working rules.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <form onSubmit={(e) => { e.preventDefault(); void save() }} noValidate className="grid gap-4 p-5 sm:p-6 lg:grid-cols-2">
      <div>
        <Input label="Company time zone" required list="work-zones" value={v.timezone} error={errors.timezone} hint="Days and lateness are judged in this zone, e.g. Asia/Karachi." onChange={(e) => set({ timezone: e.target.value })} />
        <datalist id="work-zones">{zones.map((z) => <option key={z} value={z} />)}</datalist>
      </div>
      <fieldset className="min-w-0">
        <legend className="mb-1 text-sm font-medium text-navy-900">Working days</legend>
        <div className="flex flex-wrap gap-2">
          {weekdayNames.map((name, i) => (
            <label key={name} className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm ${v.work_days.includes(i) ? 'border-lavender-400 bg-lavender-50 text-navy-900' : 'border-slate-200 text-slate-600'}`}>
              <input type="checkbox" className="size-4 rounded border-slate-300" checked={v.work_days.includes(i)} onChange={(e) => set({ work_days: e.target.checked ? [...v.work_days, i].sort() : v.work_days.filter((d) => d !== i) })} />
              {name.slice(0, 3)}
            </label>
          ))}
        </div>
        {errors.work_days && <p role="alert" className="mt-1 text-sm text-rose-600">{errors.work_days}</p>}
      </fieldset>
      <Input label="Day starts" type="time" required value={v.work_start} error={errors.work_start} onChange={(e) => set({ work_start: e.target.value })} />
      <Input label="Day ends" type="time" required value={v.work_end} error={errors.work_end} onChange={(e) => set({ work_end: e.target.value })} />
      <Input label="Grace period (minutes)" type="number" min={0} max={240} required value={v.grace_minutes} error={errors.grace_minutes} hint="A check-in this long after the start is still on time." onChange={(e) => set({ grace_minutes: e.target.value === '' ? NaN : Number(e.target.value) })} />
      <Input label="Leave can start this many days in the past" type="number" min={0} max={366} required value={v.max_backdate_days} error={errors.max_backdate_days} onChange={(e) => set({ max_backdate_days: e.target.value === '' ? NaN : Number(e.target.value) })} />
      {error && <p role="alert" className="text-sm text-rose-600 lg:col-span-2">{error}</p>}
      <div className="lg:col-span-2"><Button type="submit" loading={busy}>Save working rules</Button></div>
    </form>
  )
}

function Holidays() {
  const toast = useToast()
  const [year, setYear] = useState(() => new Date().getFullYear())
  const [refresh, setRefresh] = useState(0)
  const [form, setForm] = useState({ day: '', name: '' })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const validYear = Number.isInteger(year) && year >= 2000 && year <= 2100
  const list = useQuery((s) => configApi.holidays(year, s), `holidays-${year}-${refresh}`, validYear)
  const add = async () => {
    if (!form.day || !form.name.trim()) {
      setError('Choose the date and give the holiday a name.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await configApi.addHoliday({ day: form.day, name: form.name.trim() })
      toast.success('Holiday added. Leave already approved is not changed.')
      setForm({ day: '', name: '' })
      setYear(Number(form.day.slice(0, 4)))
      setRefresh((n) => n + 1)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add the holiday.')
    } finally {
      setBusy(false)
    }
  }
  const remove = async (id: string, name: string) => {
    try {
      await configApi.removeHoliday(id)
      toast.success(`${name} removed. Leave already approved is not changed.`)
      setRefresh((n) => n + 1)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not remove the holiday.')
    }
  }
  return (
    <div className="p-5 sm:p-6">
      <form onSubmit={(e) => { e.preventDefault(); void add() }} noValidate className="grid gap-3 sm:grid-cols-[10rem_1fr_auto] sm:items-end">
        <Input label="Date" type="date" value={form.day} onChange={(e) => { setForm({ ...form, day: e.target.value }); setError(null) }} />
        <Input label="Name" maxLength={100} placeholder="e.g. Independence Day" value={form.name} onChange={(e) => { setForm({ ...form, name: e.target.value }); setError(null) }} />
        <div className="pb-0.5"><Button type="submit" loading={busy}>Add holiday</Button></div>
      </form>
      {error && <p role="alert" className="mt-2 text-sm text-rose-600">{error}</p>}
      <div className="mt-6 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-navy-900">Holidays in {validYear ? year : '…'}</h3>
        <div className="w-28"><Input label="Year" type="number" min={2000} max={2100} value={year} onChange={(e) => setYear(Number(e.target.value))} /></div>
      </div>
      {!validYear ? (
        <p role="alert" className="mt-2 text-sm text-rose-600">Choose a year between 2000 and 2100.</p>
      ) : list.error && !list.data ? (
        <ErrorState title="Couldn't load holidays" message={list.error.message} onRetry={list.reload} />
      ) : !list.data ? (
        <p role="status" className="mt-3 flex items-center gap-2 text-sm text-slate-500"><Spinner className="size-4" /> Loading…</p>
      ) : list.data.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">No holidays set for {year}.</p>
      ) : (
        <ul aria-label="Holidays" className="mt-3 divide-y divide-slate-100 rounded-xl border border-slate-200">
          {list.data.map((h) => (
            <li key={h.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
              <span><span className="font-medium text-navy-900">{formatDay(h.day)}</span> <span className="text-slate-600">{h.name}</span></span>
              <Button variant="ghost" size="sm" aria-label={`Remove ${h.name}`} onClick={() => void remove(h.id, h.name)}><TrashIcon className="size-4" /></Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function TypeRow({ t, onSaved }: { t: LeaveType; onSaved: () => void }) {
  const toast = useToast()
  const [days, setDays] = useState(String(t.default_days))
  const [busy, setBusy] = useState(false)
  const save = async (patch: { default_days?: number; is_active?: boolean }) => {
    setBusy(true)
    try {
      await leaveApi.updateType(t.id, patch)
      toast.success(`${t.name} updated.`)
      onSaved()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not update the leave type.')
    } finally {
      setBusy(false)
    }
  }
  const n = Number(days)
  const valid = days !== '' && Number.isFinite(n) && n >= 0 && n <= 366
  return (
    <li className="grid gap-3 px-4 py-3 sm:grid-cols-[1.2fr_8rem_auto] sm:items-end">
      <span>
        <span className="block text-sm font-medium text-navy-900">{t.name}{!t.is_active && ' (turned off)'}</span>
        <span className="block text-xs text-slate-500">{t.is_paid ? 'Paid' : 'Unpaid'}, {t.tracks_balance ? 'has a balance' : 'no balance limit'}</span>
      </span>
      {t.tracks_balance ? (
        <Input label="Yearly days" type="number" min={0} max={366} step="0.5" value={days} error={valid ? undefined : 'Use 0 to 366.'} onChange={(e) => setDays(e.target.value)} />
      ) : (
        <span className="text-xs text-slate-500">No yearly days</span>
      )}
      <span className="flex gap-2 pb-0.5">
        {t.tracks_balance && <Button variant="secondary" size="sm" loading={busy} disabled={!valid || n === t.default_days} onClick={() => void save({ default_days: n })} aria-label={`Save yearly days for ${t.name}`}>Save</Button>}
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => void save({ is_active: !t.is_active })}>{t.is_active ? 'Turn off' : 'Turn on'}</Button>
      </span>
    </li>
  )
}

function LeaveTypes() {
  const [refresh, setRefresh] = useState(0)
  const list = useQuery((s) => leaveApi.types(true, s), `types-all-${refresh}`)
  if (list.error && !list.data) return <ErrorState title="Couldn't load leave types" message={list.error.message} onRetry={list.reload} />
  if (!list.data) return <p role="status" className="flex items-center gap-2 p-5 text-sm text-slate-500 sm:p-6"><Spinner className="size-4" /> Loading…</p>
  return (
    <div className="p-5 sm:p-6">
      <p className="mb-3 text-sm text-slate-600">Yearly days are what &ldquo;Grant entitlement&rdquo; gives each employee. Changing them does not change anyone&apos;s existing balance.</p>
      <ul aria-label="Leave types" className="divide-y divide-slate-100 rounded-xl border border-slate-200">
        {list.data.map((t) => <TypeRow key={`${t.id}-${t.default_days}-${t.is_active}`} t={t} onSaved={() => setRefresh((n) => n + 1)} />)}
      </ul>
    </div>
  )
}

/** HR: the company time zone, working days and hours, grace period, holidays and leave types. */
export function WorkSettingsPage() {
  const [refresh, setRefresh] = useState(0)
  const settings = useQuery((s) => configApi.settings(s), `work-settings-${refresh}`)
  return (
    <>
      <PageHeader title="Work schedule" subtitle="These rules decide who is late, which days count as leave, and which days nobody is expected." />
      <div className="space-y-6">
        <Card>
          <CardHeader title="Working rules" />
          {settings.error && !settings.data ? (
            <ErrorState title="Couldn't load the working rules" message={settings.error.message} onRetry={settings.reload} />
          ) : !settings.data ? (
            <p role="status" className="flex items-center gap-2 px-5 py-8 text-sm text-slate-500 sm:px-6"><Spinner className="size-4" /> Loading…</p>
          ) : (
            <ScheduleForm key={settings.data.updated_at ?? 'initial'} settings={settings.data} onSaved={() => setRefresh((n) => n + 1)} />
          )}
        </Card>
        <Card>
          <CardHeader title="Company holidays" />
          <Holidays />
        </Card>
        <Card>
          <CardHeader title="Leave types" />
          <LeaveTypes />
        </Card>
      </div>
    </>
  )
}
