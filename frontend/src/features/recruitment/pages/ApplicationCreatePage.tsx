import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { applicationsApi } from '../../../api/applications'
import { candidatesApi } from '../../../api/candidates'
import { ApiError } from '../../../api/errors'
import { jobsApi } from '../../../api/jobs'
import { PageHeader } from '../../../components/layout/PageHeader'
import { Button } from '../../../components/ui/Button'
import { buttonClasses } from '../../../components/ui/buttonStyles'
import { Card, CardHeader } from '../../../components/ui/Card'
import { Alert } from '../../../components/ui/Feedback'
import { Select } from '../../../components/ui/Field'
import { SearchIcon } from '../../../components/ui/icons'
import { Spinner } from '../../../components/ui/Spinner'
import { useToast } from '../../../components/ui/Toast'
import { useDebounce } from '../../../hooks/useDebounce'
import { useQuery } from '../../../hooks/useQuery'
import type { CandidateListItem } from '../../../types/candidate'

const fullName = (c: Pick<CandidateListItem, 'first_name' | 'last_name'>) => `${c.first_name} ${c.last_name}`

/**
 * Pick an EXISTING candidate and an open job, review, submit. Nothing here creates candidates or
 * jobs, so there is no way to produce a duplicate record from this page.
 */
export function ApplicationCreatePage() {
  const navigate = useNavigate()
  const toast = useToast()
  const [params] = useSearchParams()

  // Ids (not personal data) may arrive in the URL, e.g. from a candidate's or a job's page.
  const presetCandidate = params.get('candidate') ?? ''
  const presetJob = params.get('job') ?? ''

  const [search, setSearch] = useState('') // never put in the URL: it is usually a person's name
  const q = useDebounce(search.trim(), 300)
  const [pickedCandidate, setPickedCandidate] = useState<CandidateListItem | null>(null)
  const [jobId, setJobId] = useState(presetJob)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [existingId, setExistingId] = useState<string | null>(null)

  const preset = useQuery((s) => candidatesApi.get(presetCandidate, s), `preset-${presetCandidate}`, presetCandidate !== '')
  const results = useQuery(
    (s) => candidatesApi.list({ q, page_size: 8 }, s),
    `candidates-${q}`,
    q.length >= 2,
  )
  const jobs = useQuery((s) => jobsApi.list({ status: 'open', page_size: 100 }, s), 'open-jobs')

  const candidate: Pick<CandidateListItem, 'id' | 'first_name' | 'last_name' | 'email'> | null =
    pickedCandidate ?? (preset.data && !preset.error ? preset.data : null)
  const openJobs = jobs.data?.items ?? []
  const job = openJobs.find((j) => j.id === jobId) ?? null

  const submit = async () => {
    if (!candidate || !job) return
    setBusy(true)
    setError(null)
    setExistingId(null)
    try {
      const created = await applicationsApi.create({ candidate_id: candidate.id, job_id: job.id })
      toast.success('Application created.')
      navigate(`/recruitment/applications/${created.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the application.')
      if (err instanceof ApiError && err.status === 409) {
        // Most likely a duplicate: offer a link to the application that already exists.
        try {
          const found = await applicationsApi.list({ candidate_id: candidate.id, job_id: job.id, page_size: 1 })
          setExistingId(found.items[0]?.id ?? null)
        } catch {
          /* the message above is enough */
        }
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <PageHeader
        title="New application"
        description="Add an existing candidate to an open job. To add someone new, create the candidate first."
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-6">
          <Card>
            <CardHeader title="1. Candidate" />
            <div className="space-y-4 p-5 sm:p-6">
              {candidate ? (
                <div className="flex items-center justify-between gap-3 rounded-xl bg-lavender-50 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-navy-900">{fullName(candidate)}</p>
                    <p className="truncate text-xs text-slate-500">{candidate.email}</p>
                  </div>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      setPickedCandidate(null)
                      setSearch('')
                    }}
                  >
                    Change
                  </Button>
                </div>
              ) : (
                <>
                  <div className="relative">
                    <SearchIcon className="pointer-events-none absolute top-3 left-3.5 size-5 text-slate-400" />
                    <input
                      type="text"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Search candidates by name or email"
                      aria-label="Search candidates"
                      autoComplete="off"
                      className="h-11 w-full rounded-xl border border-slate-200 bg-white pr-4 pl-11 text-sm shadow-sm placeholder:text-slate-400 hover:border-slate-300 focus:border-lavender-500 focus:ring-4 focus:ring-lavender-100 focus:outline-none"
                    />
                  </div>
                  {preset.error && (
                    <p className="text-sm text-rose-600">
                      The candidate in the link could not be loaded. Search for them instead.
                    </p>
                  )}
                  {q.length < 2 && <p className="text-xs text-slate-500">Type at least two characters.</p>}
                  {q.length >= 2 && results.loading && !results.data && (
                    <p className="flex items-center gap-2 text-sm text-slate-500">
                      <Spinner className="size-4" /> Searching…
                    </p>
                  )}
                  {q.length >= 2 && results.error && (
                    <p role="alert" className="text-sm text-rose-600">
                      {results.error.message}{' '}
                      <button type="button" onClick={results.reload} className="font-medium underline">
                        Retry
                      </button>
                    </p>
                  )}
                  {q.length >= 2 && results.data && results.data.items.length === 0 && !results.loading && (
                    <p className="text-sm text-slate-500">
                      No candidates found.{' '}
                      <Link to="/recruitment/candidates/new" className="font-medium text-lavender-600 hover:underline">
                        Add a new candidate
                      </Link>
                    </p>
                  )}
                  {q.length >= 2 && results.data && results.data.items.length > 0 && (
                    <ul aria-label="Matching candidates" className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                      {results.data.items.map((c) => (
                        <li key={c.id}>
                          <button
                            type="button"
                            onClick={() => setPickedCandidate(c)}
                            className="flex w-full flex-col px-4 py-3 text-left hover:bg-lavender-50/60"
                          >
                            <span className="text-sm font-medium text-navy-900">{fullName(c)}</span>
                            <span className="text-xs text-slate-500">{c.email}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title="2. Job" />
            <div className="p-5 sm:p-6">
              {jobs.loading && !jobs.data ? (
                <p className="flex items-center gap-2 text-sm text-slate-500">
                  <Spinner className="size-4" /> Loading open jobs…
                </p>
              ) : jobs.error ? (
                <Alert>
                  {jobs.error.message}{' '}
                  <button type="button" onClick={jobs.reload} className="font-medium underline">
                    Retry
                  </button>
                </Alert>
              ) : openJobs.length === 0 ? (
                <p className="text-sm text-slate-500">
                  There are no open jobs. Publish a job before adding applications.
                </p>
              ) : (
                <Select label="Open job" value={job ? jobId : ''} onChange={(e) => setJobId(e.target.value)}>
                  <option value="">Choose a job…</option>
                  {openJobs.map((j) => (
                    <option key={j.id} value={j.id}>
                      {j.title} — {j.department}
                    </option>
                  ))}
                </Select>
              )}
            </div>
          </Card>
        </div>

        <Card className="h-fit">
          <CardHeader title="3. Review" />
          <div className="space-y-4 p-5 sm:p-6">
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">Candidate</dt>
                <dd className="mt-0.5 text-navy-900">{candidate ? fullName(candidate) : <span className="text-slate-400">Not chosen</span>}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">Job</dt>
                <dd className="mt-0.5 text-navy-900">{job ? job.title : <span className="text-slate-400">Not chosen</span>}</dd>
              </div>
            </dl>
            <p className="text-xs text-slate-500">The application starts at “Applied”. Creating it restarts the candidate’s retention period.</p>

            {error && (
              <Alert>
                {error}
                {existingId && (
                  <>
                    {' '}
                    <Link to={`/recruitment/applications/${existingId}`} className="font-medium underline">
                      View the existing application
                    </Link>
                  </>
                )}
              </Alert>
            )}

            <div className="flex flex-col gap-2">
              <Button onClick={() => void submit()} loading={busy} disabled={!candidate || !job}>
                Create application
              </Button>
              <Link to="/recruitment/applications" className={buttonClasses('secondary')}>
                Cancel
              </Link>
            </div>
          </div>
        </Card>
      </div>
    </>
  )
}
