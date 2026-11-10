import type { InterviewStatus } from '../../../types/interview'
import { statusLabels, statusTone } from '../lib/interviews'

/** The status is always spelled out: colour is only decoration. */
export function InterviewStatusBadge({ status }: { status: InterviewStatus }) {
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${statusTone[status]}`}>
      {statusLabels[status]}
    </span>
  )
}
