import { describe, expect, it } from 'vitest'
import type { AuditEvent, AuditEventType } from '../../../types/privacy'
import { auditEventLabels, auditEventTypes, describeAudit } from './audit'

const ev = (event_type: AuditEventType, metadata: AuditEvent['metadata'] = {}): AuditEvent => ({
  id: 'e1', event_type, candidate_id: 'c1', actor: null, metadata, request_id: null, created_at: '2026-11-10T09:00:00Z',
})

describe('audit labels', () => {
  it('has a label for every event type the server can send', () => {
    expect(auditEventTypes).toEqual([
      'candidate_viewed', 'candidate_created', 'candidate_updated', 'consent_changed',
      'candidate_exported', 'candidate_anonymized', 'candidate_deleted', 'candidate_purged',
      'resume_uploaded', 'resume_downloaded', 'resume_viewed', 'resume_parsed', 'resume_parse_retried',
      'resume_reviewed', 'resume_activated', 'resume_updated', 'resume_deleted',
      'screening_created', 'screening_viewed', 'screening_reviewed', 'screening_scrubbed',
      'interview_created', 'interview_updated', 'interview_confirmed', 'interview_completed',
      'interview_cancelled', 'interview_rescheduled', 'interviewers_changed', 'feedback_draft_saved',
      'feedback_submitted', 'feedback_edited', 'interview_scrubbed',
    ])
    for (const t of auditEventTypes) expect(auditEventLabels[t]).toBeTruthy()
  })
})

describe('describeAudit', () => {
  it.each([
    [ev('candidate_viewed'), 'Profile viewed'],
    [ev('screening_created', { assessment_number: 2, assessment_id: 'a' }), 'Requirements Coverage assessed (#2)'],
    [ev('screening_created'), 'Requirements Coverage assessed'],
    [ev('screening_viewed'), 'Requirements Coverage opened'],
    [ev('screening_reviewed', { judgement: 'agree', has_note: true }), 'Requirements Coverage reviewed'],
    [ev('screening_scrubbed', { reason: 'anonymized', assessments: 1, reviews: 0 }), 'Requirements Coverage details removed (anonymized)'],
    [ev('screening_scrubbed', { reason: 'resume_deleted', assessments: 1, reviews: 0 }), 'Requirements Coverage details removed (resume deleted)'],
    [ev('resume_uploaded', { version: 3, resume_id: 'r' }), 'Resume uploaded (version 3)'],
    [ev('resume_uploaded'), 'Resume uploaded'],
    [ev('resume_parsed', { status: 'no_text' }), 'Resume read: no text'],
    [ev('resume_parse_retried', { status: 'parsed' }), 'Resume read again: parsed'],
    [ev('resume_downloaded', { version: 1 }), 'Resume downloaded'],
    [ev('resume_reviewed'), 'Resume details reviewed'],
    [ev('resume_deleted', { version: 2 }), 'Resume deleted'],
    [ev('candidate_created', { consent_basis: 'consent' }), 'Candidate added'],
    [ev('candidate_updated', { fields: ['phone', 'current_title'] }), 'Details edited: phone, current title'],
    [ev('candidate_updated', { fields: ['mystery_field'] }), 'Details edited: mystery_field'],
    [ev('candidate_updated'), 'Details edited'],
    [ev('consent_changed', { from_basis: 'consent', to_basis: 'legitimate_interest' }), 'Consent basis changed: Consent → Legitimate interest'],
    [ev('candidate_exported', { format: 'csv', scope: 'bulk' }), 'Exported as CSV (part of a bulk export)'],
    [ev('candidate_exported', { format: 'json', scope: 'single' }), 'Exported as JSON (single candidate)'],
    [ev('candidate_anonymized', { applications: 2 }), 'Anonymized (2 applications kept)'],
    [ev('candidate_anonymized', { applications: 1 }), 'Anonymized (1 application kept)'],
    [ev('candidate_anonymized', { applications: 0 }), 'Anonymized'],
    [ev('candidate_deleted'), 'Removed (entered by mistake)'],
    [ev('candidate_purged', { reason: 'retention_expired' }), 'Permanently deleted: retention period had expired'],
  ])('%#', (e, text) => expect(describeAudit(e)).toBe(text))

  it('shows text as text: nothing in the metadata is treated as markup', () => {
    expect(describeAudit(ev('candidate_updated', { fields: ['<img src=x onerror=alert(1)>'] }))).toBe(
      'Details edited: <img src=x onerror=alert(1)>',
    )
  })
})
