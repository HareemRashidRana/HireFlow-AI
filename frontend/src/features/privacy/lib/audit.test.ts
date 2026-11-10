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
    ])
    for (const t of auditEventTypes) expect(auditEventLabels[t]).toBeTruthy()
  })
})

describe('describeAudit', () => {
  it.each([
    [ev('candidate_viewed'), 'Profile viewed'],
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
