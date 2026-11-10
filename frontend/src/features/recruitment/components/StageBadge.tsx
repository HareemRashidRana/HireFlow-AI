import type { ApplicationStage } from '../../../types/application'
import { stageLabels, stageStyles } from '../lib/applicationStages'

export function StageBadge({ stage }: { stage: ApplicationStage }) {
  const s = stageStyles[stage]
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${s.badge}`}
    >
      <span className={`size-1.5 rounded-full ${s.dot}`} aria-hidden="true" />
      {stageLabels[stage]}
    </span>
  )
}
