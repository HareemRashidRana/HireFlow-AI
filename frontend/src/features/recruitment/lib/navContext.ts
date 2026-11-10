/**
 * Keeping the user's place while moving between the board, the list and a record.
 *
 * Only NON-SENSITIVE filters are carried in URLs (ids, enums and dates). The search box is never
 * part of this: it usually holds a person's name or email.
 */

import { isValidStage } from './applicationStages'
import { candidateSources } from './candidateOptions'

const DATE = /^\d{4}-\d{2}-\d{2}$/
const ID = /^[A-Za-z0-9-]{1,64}$/

/** The filter names shared by the applications list and the pipeline board. */
export const SHARED_FILTER_KEYS = ['job', 'recruiter', 'source', 'from', 'to'] as const
export type SharedFilterKey = (typeof SHARED_FILTER_KEYS)[number]

export function cleanFilterValue(key: SharedFilterKey | 'stage', value: string | null): string {
  if (!value) return ''
  if (key === 'job' || key === 'recruiter') return ID.test(value) ? value : ''
  if (key === 'source') return (candidateSources as string[]).includes(value) ? value : ''
  if (key === 'stage') return isValidStage(value) ? value : ''
  return DATE.test(value) ? value : ''
}

/** "?job=..&source=.." with only the valid shared filters, or "" when none are set. */
export function sharedFilterQuery(params: URLSearchParams, extra: Record<string, string> = {}): string {
  const out = new URLSearchParams()
  for (const key of SHARED_FILTER_KEYS) {
    const value = cleanFilterValue(key, params.get(key))
    if (value) out.set(key, value)
  }
  for (const [k, v] of Object.entries(extra)) if (v) out.set(k, v)
  const text = out.toString()
  return text ? `?${text}` : ''
}

export function countActiveFilters(values: Record<string, string>, searching: boolean): number {
  return Object.values(values).filter(Boolean).length + (searching ? 1 : 0)
}

/** State passed with a link so the next page can offer "back to where you were". */
export interface FromState {
  from: string
}

export const fromState = (path: string): { from: FromState['from'] } => ({ from: path })

/** Only in-app recruitment paths are honoured, never an external or protocol-relative URL. */
export function safeFrom(state: unknown): string | null {
  const from = (state as Partial<FromState> | null)?.from
  return typeof from === 'string' && from.startsWith('/recruitment/') && !from.startsWith('//')
    ? from
    : null
}

export function backLabel(from: string | null, fallback: string): string {
  if (!from) return fallback
  if (from.startsWith('/recruitment/pipeline')) return 'Back to pipeline'
  if (from.startsWith('/recruitment/applications')) return 'Back to applications'
  if (from.startsWith('/recruitment/candidates')) return 'Back to candidate'
  return fallback
}
