import type { AuditEvent, AuditEventType } from '../../../types/privacy'
import { consentBasisLabels } from '../../recruitment/lib/candidateOptions'
import type { ConsentBasis } from '../../../types/candidate'

export const auditEventLabels: Record<AuditEventType, string> = {
  candidate_viewed: 'Profile viewed',
  candidate_created: 'Candidate added',
  candidate_updated: 'Details edited',
  consent_changed: 'Consent basis changed',
  candidate_exported: 'Data exported',
  candidate_anonymized: 'Anonymized',
  candidate_deleted: 'Removed (entered by mistake)',
  candidate_purged: 'Permanently deleted',
}

export const auditEventTypes = Object.keys(auditEventLabels) as AuditEventType[]

const fieldLabels: Record<string, string> = {
  first_name: 'first name',
  last_name: 'last name',
  email: 'email',
  phone: 'phone',
  location: 'location',
  current_title: 'current title',
  current_company: 'current company',
  source: 'source',
  consent_basis: 'consent basis',
  consent_basis_note: 'basis explanation',
  consent_date: 'basis date',
}

const basis = (v: unknown): string =>
  typeof v === 'string' && v in consentBasisLabels ? consentBasisLabels[v as ConsentBasis] : String(v ?? '')

const plural = (n: unknown, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/** One plain-English line per audit entry. The metadata only ever holds field NAMES and counts. */
export function describeAudit(e: AuditEvent): string {
  const m = e.metadata
  switch (e.event_type) {
    case 'candidate_updated': {
      const fields = Array.isArray(m.fields) ? m.fields.map((f) => fieldLabels[f] ?? f).join(', ') : ''
      return fields ? `Details edited: ${fields}` : 'Details edited'
    }
    case 'consent_changed':
      return `Consent basis changed: ${basis(m.from_basis)} → ${basis(m.to_basis)}`
    case 'candidate_exported':
      return `Exported as ${String(m.format ?? '').toUpperCase()} (${m.scope === 'bulk' ? 'part of a bulk export' : 'single candidate'})`
    case 'candidate_anonymized':
      return m.applications
        ? `Anonymized (${plural(m.applications, 'application')} kept)`
        : 'Anonymized'
    case 'candidate_purged':
      return 'Permanently deleted: retention period had expired'
    default:
      return auditEventLabels[e.event_type]
  }
}
