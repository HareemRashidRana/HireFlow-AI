import type { ApplicationEvent, ApplicationStage } from '../../../types/application'

export const stageLabels: Record<ApplicationStage, string> = {
  applied: 'Applied',
  screening: 'Screening',
  shortlisted: 'Shortlisted',
  interview: 'Interview',
  offer: 'Offer',
  hired: 'Hired',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
}

/** Every stage, in pipeline order. */
export const allStages = Object.keys(stageLabels) as ApplicationStage[]

/** The stages an application moves through, left to right. */
export const pipelineStages: ApplicationStage[] = [
  'applied',
  'screening',
  'shortlisted',
  'interview',
  'offer',
  'hired',
]

/** Stages where the application is over (rejected / withdrawn can be reopened by HR). */
export const closedStages: ApplicationStage[] = ['rejected', 'withdrawn']

export const isValidStage = (value: string): value is ApplicationStage =>
  (allStages as string[]).includes(value)

export const stageShortHelp: Record<ApplicationStage, string> = {
  applied: 'Back to the start',
  screening: 'Reviewing the application',
  shortlisted: 'Selected for further steps',
  interview: 'Being interviewed',
  offer: 'An offer is being made',
  hired: 'Records a hiring decision',
  rejected: 'Ends the application',
  withdrawn: 'The candidate is no longer interested',
}

/** Tailwind classes per stage: lavender for progress, green for hired, rose / slate for the ends. */
export const stageStyles: Record<ApplicationStage, { badge: string; dot: string }> = {
  applied: { badge: 'bg-slate-100 text-slate-700 ring-slate-200', dot: 'bg-slate-400' },
  screening: { badge: 'bg-lavender-50 text-lavender-700 ring-lavender-200', dot: 'bg-lavender-400' },
  shortlisted: { badge: 'bg-lavender-100 text-lavender-700 ring-lavender-300', dot: 'bg-lavender-500' },
  interview: { badge: 'bg-indigo-50 text-indigo-700 ring-indigo-200', dot: 'bg-indigo-500' },
  offer: { badge: 'bg-amber-50 text-amber-700 ring-amber-200', dot: 'bg-amber-500' },
  hired: { badge: 'bg-emerald-50 text-emerald-700 ring-emerald-200', dot: 'bg-emerald-500' },
  rejected: { badge: 'bg-rose-50 text-rose-700 ring-rose-200', dot: 'bg-rose-500' },
  withdrawn: { badge: 'bg-slate-100 text-slate-500 ring-slate-200', dot: 'bg-slate-300' },
}

const label = (value: string | null): string =>
  value && isValidStage(value) ? stageLabels[value] : (value ?? '')

/** One plain-English line per history entry. Values come from the server; nothing is rendered as HTML. */
export function describeEvent(e: ApplicationEvent): string {
  switch (e.event_type) {
    case 'created':
      return 'Application created'
    case 'stage_changed':
      return `Moved from ${label(e.from_value)} to ${label(e.to_value)}`
    case 'rejected':
      return `Rejected (was in ${label(e.from_value)})`
    case 'withdrawn':
      return `Withdrawn (was in ${label(e.from_value)})`
    case 'hired':
      return 'Marked as hired'
    case 'reopened':
      return `Reopened: back to ${label(e.to_value)}`
    case 'notes_updated':
      return 'Internal notes updated'
    case 'assigned':
      if (e.from_value && e.to_value) return `Reassigned from ${e.from_value} to ${e.to_value}`
      if (e.to_value) return `Assigned to ${e.to_value}`
      return `Unassigned${e.from_value ? ` (was ${e.from_value})` : ''}`
  }
}

/** The forward step for an application (the sensible default in the move dialog). */
export function defaultTarget(
  current: ApplicationStage,
  allowed: ApplicationStage[],
): ApplicationStage | null {
  const i = pipelineStages.indexOf(current)
  const forward = i >= 0 ? pipelineStages[i + 1] : undefined
  if (forward && allowed.includes(forward)) return forward
  return allowed[0] ?? null
}
