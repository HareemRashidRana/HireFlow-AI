import type { Candidate } from '../types/candidate'
import type {
  AnonymizationPreview,
  AuditList,
  AuditParams,
  BulkExportBody,
  ExportFormat,
  PurgeResult,
  RetentionList,
  RetentionStatus,
} from '../types/privacy'
import { download, request } from './http'
import { toQuery } from './query'

const cand = (id: string) => `/candidates/${encodeURIComponent(id)}`

export const privacyApi = {
  retention: (params: { status?: RetentionStatus; page?: number; page_size?: number }, signal?: AbortSignal) =>
    request<RetentionList>(`/privacy/retention${toQuery(params)}`, { signal }),

  audit: (params: AuditParams, signal?: AbortSignal) =>
    request<AuditList>(`/privacy/audit${toQuery(params)}`, { signal }),

  anonymizationPreview: (id: string, signal?: AbortSignal) =>
    request<AnonymizationPreview>(`${cand(id)}/anonymization-preview`, { signal }),

  /** Irreversible. The server also demands the explicit confirmation flag. */
  anonymize: (id: string) =>
    request<{ candidate: Candidate; changed: boolean }>(`${cand(id)}/anonymize`, {
      method: 'POST',
      json: { confirm: true },
    }),

  /** Files are requested with POST so filters never appear in a URL. */
  exportOne: (id: string, format: ExportFormat) =>
    download(`${cand(id)}/export`, { method: 'POST', json: { format } }),

  exportMany: (body: BulkExportBody) => download('/candidates/export', { method: 'POST', json: body }),

  /** dry_run defaults to true on the server. A real purge also needs the word PURGE. */
  purgePreview: (limit = 50) =>
    request<PurgeResult>('/privacy/purge', { method: 'POST', json: { dry_run: true, limit } }),

  purge: (confirm: string, limit = 50) =>
    request<PurgeResult>('/privacy/purge', { method: 'POST', json: { dry_run: false, confirm, limit } }),
}
