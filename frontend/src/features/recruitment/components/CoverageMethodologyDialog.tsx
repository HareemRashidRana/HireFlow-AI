import { screeningApi } from '../../../api/screening'
import { Button } from '../../../components/ui/Button'
import { Alert } from '../../../components/ui/Feedback'
import { Modal } from '../../../components/ui/Modal'
import { Spinner } from '../../../components/ui/Spinner'
import { useQuery } from '../../../hooks/useQuery'
import { PRODUCT_NAME } from '../lib/coverage'

interface Props {
  open: boolean
  onClose: () => void
}

/** How Requirements Coverage works, what it does not use, and its limits: always one click away. */
export function CoverageMethodologyDialog({ open, onClose }: Props) {
  return (
    <Modal open={open} onClose={onClose} title={`How ${PRODUCT_NAME} works`} wide>
      {open && <Body onClose={onClose} />}
    </Modal>
  )
}

function Body({ onClose }: { onClose: () => void }) {
  const { data, error, loading, reload } = useQuery((s) => screeningApi.methodology(s), 'methodology')
  if (loading && !data)
    return (
      <p className="flex items-center gap-3 py-6 text-sm text-slate-500">
        <Spinner /> Loading…
      </p>
    )
  if (error && !data)
    return (
      <>
        <Alert>{error.message}</Alert>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          <Button onClick={reload}>Try again</Button>
        </div>
      </>
    )
  if (!data) return null
  return (
    <div className="space-y-5 text-sm leading-relaxed text-slate-700">
      <p>{data.summary}</p>
      <section>
        <h3 className="font-semibold text-navy-900">How it is calculated</h3>
        <ul className="mt-2 list-disc space-y-1.5 pl-5">
          {data.how_it_works.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-slate-500">
          Weights: required skills {data.weights.required_skills}%, preferred skills {data.weights.preferred_skills}%.
        </p>
      </section>
      <section>
        <h3 className="font-semibold text-navy-900">What is not used</h3>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          {data.not_used.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </section>
      <section>
        <h3 className="font-semibold text-navy-900">Limitations</h3>
        <ul className="mt-2 list-disc space-y-1.5 pl-5">
          {data.limitations.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <p className="mt-2">
          Names with a version number (for example "Python 3.11") are different from "Python" and show as not listed.
        </p>
      </section>
      <p className="text-xs text-slate-500">
        Methodology {data.scoring_version}, alias table {data.alias_table_version}. Each assessment keeps the version it
        was made with.
      </p>
      <div className="flex justify-end">
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      </div>
    </div>
  )
}
