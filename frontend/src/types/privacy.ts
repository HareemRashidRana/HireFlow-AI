// Mirrors backend/app/schemas/privacy.py. None of these types hold anything the audit trail is
// forbidden to hold: ids, field NAMES, counts and enum-like facts.

import type { CandidateSource, ConsentBasis, RetentionFilter } from './candidate'
import type { StaffSummary } from './application'

export type RetentionStatus = 'all' | 'expiring' | 'expired' | 'anonymized'
export type RetentionRowStatus = 'active' | 'expiring' | 'expired' | 'anonymized'

export interface RetentionItem {
  id: string
  first_name: string
  last_name: string
  email: string
  consent_basis: ConsentBasis
  consent_date: string
  last_activity_at: string
  retain_until: string
  anonymized_at: string | null
  application_count: number
  status: RetentionRowStatus
  purge_eligible: boolean
}

export interface RetentionSummary {
  expiring: number
  expired: number
  anonymized: number
  purge_eligible: number
  expired_with_applications: number
  retention_months: number
  expiring_window_days: number
  purge_enabled: boolean
}

export interface RetentionList {
  summary: RetentionSummary
  items: RetentionItem[]
  total: number
  page: number
  page_size: number
}

export interface AnonymizationPreview {
  candidate_id: string
  already_anonymized: boolean
  fields_cleared: string[]
  fields_replaced: string[]
  fields_kept: string[]
  application_count: number
  application_notes_cleared: number
  history_notes_cleared: number
}

export type AuditEventType =
  | 'candidate_viewed'
  | 'candidate_created'
  | 'candidate_updated'
  | 'consent_changed'
  | 'candidate_exported'
  | 'candidate_anonymized'
  | 'candidate_deleted'
  | 'candidate_purged'

export interface AuditEvent {
  id: string
  event_type: AuditEventType
  candidate_id: string | null
  actor: StaffSummary | null
  metadata: Record<string, string | number | boolean | string[] | null>
  request_id: string | null
  created_at: string
}

export interface AuditList {
  items: AuditEvent[]
  total: number
  page: number
  page_size: number
}

export interface AuditParams {
  candidate_id?: string
  event_type?: AuditEventType | ''
  page?: number
  page_size?: number
}

export interface PurgeResult {
  dry_run: boolean
  purge_enabled: boolean
  eligible_total: number
  batch_size: number
  candidate_ids: string[]
  deleted: number
  remaining_eligible: number
  expired_with_applications: number
}

export type ExportFormat = 'csv' | 'json'

export interface BulkExportBody {
  format: ExportFormat
  source?: CandidateSource
  retention?: Exclude<RetentionFilter, ''>
}
