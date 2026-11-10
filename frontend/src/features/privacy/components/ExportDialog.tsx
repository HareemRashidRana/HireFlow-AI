import { useState } from 'react'
import { privacyApi } from '../../../api/privacy'
import { Button } from '../../../components/ui/Button'
import { Alert } from '../../../components/ui/Feedback'
import { Select } from '../../../components/ui/Field'
import { Modal } from '../../../components/ui/Modal'
import { useToast } from '../../../components/ui/Toast'
import { saveFile } from '../../../lib/download'
import type { CandidateSource } from '../../../types/candidate'
import type { ExportFormat } from '../../../types/privacy'
import { candidateSourceLabels, candidateSources, retentionFilterLabels } from '../../recruitment/lib/candidateOptions'

export type ExportTarget = { kind: 'one'; id: string; label: string } | { kind: 'bulk' }

interface Props {
  target: ExportTarget | null
  onClose: () => void
}

/** Explains what a file will contain before anything is downloaded. Every export is audited. */
export function ExportDialog({ target, onClose }: Props) {
  return (
    <Modal open={target !== null} onClose={onClose} title="Export candidate data">
      {target && <Body key={target.kind === 'one' ? target.id : 'bulk'} target={target} onClose={onClose} />}
    </Modal>
  )
}

function Body({ target, onClose }: { target: ExportTarget; onClose: () => void }) {
  const toast = useToast()
  const [format, setFormat] = useState<ExportFormat>('csv')
  const [source, setSource] = useState<CandidateSource | ''>('')
  const [retention, setRetention] = useState<'' | 'expiring' | 'expired'>('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = async () => {
    setBusy(true)
    setError(null)
    try {
      const file =
        target.kind === 'one'
          ? await privacyApi.exportOne(target.id, format)
          : await privacyApi.exportMany({
              format,
              ...(source && { source }),
              ...(retention && { retention }),
            })
      saveFile(file.blob, file.filename)
      toast.success('Export downloaded.')
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the export.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        void run()
      }}
    >
      <p>
        {target.kind === 'one' ? (
          <>
            Export the data held about <strong className="text-navy-900">{target.label}</strong>.
          </>
        ) : (
          <>Export current candidates (anonymized people are left out).</>
        )}
      </p>

      <fieldset className="mt-4">
        <legend className="mb-1.5 text-sm font-medium text-navy-800">Format</legend>
        <div className="flex gap-3">
          {(['csv', 'json'] as const).map((f) => (
            <label
              key={f}
              className={`flex flex-1 cursor-pointer items-center gap-2 rounded-xl border px-3.5 py-2.5 text-sm ${
                format === f ? 'border-lavender-400 bg-lavender-50' : 'border-slate-200 hover:border-slate-300'
              }`}
            >
              <input
                type="radio"
                name="format"
                value={f}
                checked={format === f}
                onChange={() => setFormat(f)}
                className="accent-lavender-600"
              />
              {f === 'csv' ? 'CSV (spreadsheet)' : 'JSON'}
            </label>
          ))}
        </div>
      </fieldset>

      {target.kind === 'bulk' && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Select label="Source" value={source} onChange={(e) => setSource(e.target.value as CandidateSource | '')}>
            <option value="">All sources</option>
            {candidateSources.map((s) => (
              <option key={s} value={s}>
                {candidateSourceLabels[s]}
              </option>
            ))}
          </Select>
          <Select
            label="Retention"
            value={retention}
            onChange={(e) => setRetention(e.target.value as '' | 'expiring' | 'expired')}
          >
            <option value="">Any retention date</option>
            <option value="expiring">{retentionFilterLabels.expiring}</option>
            <option value="expired">{retentionFilterLabels.expired}</option>
          </Select>
        </div>
      )}

      <ul className="mt-4 space-y-1 text-xs text-slate-500">
        <li>Included: contact and role details, source, legal basis and dates, retention dates, and each application's job, stage and dates.</li>
        <li>Not included: staff notes and opinions, rejection reasons, account or security data.</li>
        {target.kind === 'bulk' && <li>A single export has a size limit. If it is too large, narrow it with the filters.</li>}
        <li>The file contains personal data: store it securely and delete it when finished. This export is recorded in the audit log.</li>
      </ul>

      {error && (
        <div className="mt-4">
          <Alert>{error}</Alert>
        </div>
      )}

      <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" loading={busy}>
          Download {format.toUpperCase()}
        </Button>
      </div>
    </form>
  )
}
