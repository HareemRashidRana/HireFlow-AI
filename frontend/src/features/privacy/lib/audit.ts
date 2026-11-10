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
  resume_uploaded: 'Resume uploaded',
  resume_downloaded: 'Resume downloaded',
  resume_viewed: 'Resume details viewed',
  resume_parsed: 'Resume read',
  resume_parse_retried: 'Resume read again',
  resume_reviewed: 'Resume details reviewed',
  resume_activated: 'Resume made active',
  resume_updated: 'Resume updated',
  resume_deleted: 'Resume deleted',
  screening_created: 'Requirements Coverage assessed',
  screening_viewed: 'Requirements Coverage opened',
  screening_reviewed: 'Requirements Coverage reviewed',
  screening_scrubbed: 'Requirements Coverage details removed',
  interview_created: 'Interview scheduled',
  interview_updated: 'Interview details changed',
  interview_confirmed: 'Interview confirmed',
  interview_completed: 'Interview completed',
  interview_cancelled: 'Interview cancelled',
  interview_rescheduled: 'Interview rescheduled',
  interviewers_changed: 'Interviewers changed',
  feedback_draft_saved: 'Interview feedback draft saved',
  feedback_submitted: 'Interview feedback submitted',
  feedback_edited: 'Interview feedback edited',
  interview_scrubbed: 'Interview notes and feedback removed',
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
    case 'resume_uploaded':
      return typeof m.version === 'number' ? `Resume uploaded (version ${m.version})` : 'Resume uploaded'
    case 'screening_scrubbed':
      return m.reason === 'anonymized'
        ? 'Requirements Coverage details removed (anonymized)'
        : 'Requirements Coverage details removed (resume deleted)'
    case 'screening_created':
      return typeof m.assessment_number === 'number'
        ? `Requirements Coverage assessed (#${m.assessment_number})`
        : 'Requirements Coverage assessed'
    case 'resume_parsed':
    case 'resume_parse_retried':
      return typeof m.status === 'string'
        ? `${auditEventLabels[e.event_type]}: ${String(m.status).replace('_', ' ')}`
        : auditEventLabels[e.event_type]
    default:
      return auditEventLabels[e.event_type]
  }
}
