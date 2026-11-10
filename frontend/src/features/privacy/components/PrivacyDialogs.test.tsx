// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../../api/errors'
import { renderAs } from '../../../test/render'
import type { UserRole } from '../../../types/auth'
import type { AnonymizationPreview, PurgeResult } from '../../../types/privacy'
import { AnonymizeDialog } from './AnonymizeDialog'
import { ExportDialog } from './ExportDialog'
import type { ExportTarget } from './ExportDialog'
import { PurgeDialog } from './PurgeDialog'

const api = {
  anonymizationPreview: vi.fn(),
  anonymize: vi.fn(),
  exportOne: vi.fn(),
  exportMany: vi.fn(),
  purgePreview: vi.fn(),
  purge: vi.fn(),
}
vi.mock('../../../api/privacy', () => ({ privacyApi: new Proxy({}, { get: (_t, k) => (api as Record<string, unknown>)[k as string] }) }))
const saveFile = vi.fn()
vi.mock('../../../lib/download', () => ({ saveFile: (...a: unknown[]) => saveFile(...a) }))

beforeEach(() => {
  for (const m of Object.values(api)) m.mockReset()
  saveFile.mockReset()
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) { this.removeAttribute('open') }
})

const preview = (over: Partial<AnonymizationPreview> = {}): AnonymizationPreview => ({
  candidate_id: 'c1', already_anonymized: false,
  fields_cleared: ['phone', 'location', 'current_title', 'current_company', 'consent_basis_note'],
  fields_replaced: ['first_name', 'last_name', 'email'],
  fields_kept: ['source', 'consent_basis', 'consent_date', 'retain_until'],
  application_count: 2, application_notes_cleared: 1, history_notes_cleared: 3, resumes_removed: 0, assessments_scrubbed: 0, interviews_scrubbed: 0, ...over,
})

describe('AnonymizeDialog', () => {
  function open() {
    const onClose = vi.fn(); const onDone = vi.fn()
    renderAs(<AnonymizeDialog candidate={{ id: 'c1', first_name: 'Sana', last_name: 'Iqbal' }} onClose={onClose} onDone={onDone} />)
    return { onClose, onDone, user: userEvent.setup() }
  }

  it('shows what will be replaced, removed and kept before anything happens', async () => {
    api.anonymizationPreview.mockResolvedValue(preview())
    open()
    expect(await screen.findByText(/First name, Last name, Email address/)).toBeTruthy()
    expect(screen.getByText(/Phone number, Location, Current job title, Current company/)).toBeTruthy()
    expect(screen.getByText(/Source, Consent \/ legal basis/)).toBeTruthy()
    expect(screen.getByText(/2 applications and every stage change are kept/)).toBeTruthy()
    expect(screen.getByText(/1 on applications, 3 in the history/)).toBeTruthy()
    expect(api.anonymize).not.toHaveBeenCalled()
  })

  it('warns that resume files are permanently deleted, with the right count', async () => {
    api.anonymizationPreview.mockResolvedValue(preview({ resumes_removed: 2 }))
    open()
    expect(await screen.findByText(/2 resume files are permanently deleted, along with what was read from them/)).toBeTruthy()
  })

  it('uses the singular for one resume file and says nothing when there are none', async () => {
    api.anonymizationPreview.mockResolvedValue(preview({ resumes_removed: 1 }))
    const first = open()
    expect(await screen.findByText(/1 resume file is permanently deleted/)).toBeTruthy()
    first.onClose()
  })

  it('says Requirements Coverage assessments lose their resume-derived details but keep their numbers', async () => {
    api.anonymizationPreview.mockResolvedValue(preview({ assessments_scrubbed: 2 }))
    open()
    expect(await screen.findByText(/2 assessments lose their resume-derived details, reviewer notes and adjustments. Their numbers are kept./)).toBeTruthy()
    expect(screen.getByText('Requirements Coverage')).toBeTruthy()
  })

  it('does not mention Requirements Coverage when there are no assessments', async () => {
    api.anonymizationPreview.mockResolvedValue(preview({ assessments_scrubbed: 0 }))
    open()
    await screen.findByText(/First name, Last name, Email address/)
    expect(screen.queryByText('Requirements Coverage')).toBeNull()
  })

  it('does not mention resumes when the candidate has none', async () => {
    api.anonymizationPreview.mockResolvedValue(preview({ resumes_removed: 0 }))
    open()
    await screen.findByText(/First name, Last name, Email address/)
    expect(screen.queryByText('Resumes')).toBeNull()
  })

  it('says so when there are no applications', async () => {
    api.anonymizationPreview.mockResolvedValue(preview({ application_count: 0 }))
    open()
    expect(await screen.findByText('This candidate has no applications.')).toBeTruthy()
  })

  it('cannot be confirmed until the "I understand" box is ticked', async () => {
    api.anonymizationPreview.mockResolvedValue(preview())
    const { user } = open()
    const button = (await screen.findByRole('button', { name: 'Anonymize candidate' })) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    await user.click(button)
    expect(api.anonymize).not.toHaveBeenCalled()
    await user.click(screen.getByLabelText(/I understand this cannot be undone/))
    expect(button.disabled).toBe(false)
  })

  it('anonymizes after confirmation, then reports and closes', async () => {
    api.anonymizationPreview.mockResolvedValue(preview())
    api.anonymize.mockResolvedValue({ changed: true, candidate: {} })
    const { user, onDone, onClose } = open()
    await user.click(await screen.findByLabelText(/I understand/))
    await user.click(screen.getByRole('button', { name: 'Anonymize candidate' }))
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(api.anonymize).toHaveBeenCalledWith('c1')
    expect(onClose).toHaveBeenCalled()
  })

  it('shows a server refusal and stays open', async () => {
    api.anonymizationPreview.mockResolvedValue(preview())
    api.anonymize.mockRejectedValue(new ApiError('You do not have permission to perform this action.', 403))
    const { user, onDone, onClose } = open()
    await user.click(await screen.findByLabelText(/I understand/))
    await user.click(screen.getByRole('button', { name: 'Anonymize candidate' }))
    expect((await screen.findByRole('alert')).textContent).toContain('do not have permission')
    expect(onDone).not.toHaveBeenCalled(); expect(onClose).not.toHaveBeenCalled()
  })

  it('offers no action for someone who is already anonymized', async () => {
    api.anonymizationPreview.mockResolvedValue(preview({ already_anonymized: true }))
    open()
    expect(await screen.findByText(/already been anonymized/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Anonymize candidate' })).toBeNull()
  })

  it('shows a preview error with retry instead of an action', async () => {
    api.anonymizationPreview.mockRejectedValueOnce(new ApiError('Preview failed', 500)).mockResolvedValueOnce(preview())
    const { user } = open()
    expect((await screen.findByRole('alert')).textContent).toContain('Preview failed')
    expect(screen.queryByRole('button', { name: 'Anonymize candidate' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('button', { name: 'Anonymize candidate' })).toBeTruthy()
  })

  it('warns that it cannot be undone and is audited', async () => {
    api.anonymizationPreview.mockResolvedValue(preview())
    open()
    expect(await screen.findByText(/cannot be restored/)).toBeTruthy()
    expect(screen.getByText(/recorded in the audit log/)).toBeTruthy()
  })
})

describe('ExportDialog', () => {
  const one: ExportTarget = { kind: 'one', id: 'c1', label: 'Sana Iqbal' }
  function open(target: ExportTarget) {
    const onClose = vi.fn()
    renderAs(<ExportDialog target={target} onClose={onClose} />)
    return { onClose, user: userEvent.setup() }
  }

  it('says what is and is not included, and that it is audited, before downloading', () => {
    open(one)
    expect(screen.getByText(/Export the data held about/)).toBeTruthy()
    expect(screen.getByText(/Not included: staff notes and opinions/)).toBeTruthy()
    expect(screen.getByText(/recorded in the audit log/)).toBeTruthy()
    expect(api.exportOne).not.toHaveBeenCalled()
  })

  it('downloads one candidate as CSV by default and hands the file to the browser', async () => {
    const blob = new Blob(['x'])
    api.exportOne.mockResolvedValue({ blob, filename: 'candidates-2026-11-10.csv', contentType: 'text/csv' })
    const { user, onClose } = open(one)
    await user.click(screen.getByRole('button', { name: 'Download CSV' }))
    await waitFor(() => expect(saveFile).toHaveBeenCalledWith(blob, 'candidates-2026-11-10.csv'))
    expect(api.exportOne).toHaveBeenCalledWith('c1', 'csv')
    expect(onClose).toHaveBeenCalled()
  })

  it('can export JSON instead', async () => {
    api.exportOne.mockResolvedValue({ blob: new Blob(['{}']), filename: 'c.json', contentType: 'application/json' })
    const { user } = open(one)
    await user.click(screen.getByRole('radio', { name: /JSON/ }))
    await user.click(screen.getByRole('button', { name: 'Download JSON' }))
    await waitFor(() => expect(api.exportOne).toHaveBeenCalledWith('c1', 'json'))
  })

  it('bulk export sends only the filters that were chosen', async () => {
    api.exportMany.mockResolvedValue({ blob: new Blob(['x']), filename: 'candidates.csv', contentType: 'text/csv' })
    const { user } = open({ kind: 'bulk' })
    expect(screen.getByText(/size limit/)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Download CSV' }))
    await waitFor(() => expect(api.exportMany).toHaveBeenCalledWith({ format: 'csv' }))
    api.exportMany.mockClear()
  })

  it('bulk export passes source and retention filters', async () => {
    api.exportMany.mockResolvedValue({ blob: new Blob(['x']), filename: 'c.csv', contentType: 'text/csv' })
    const { user } = open({ kind: 'bulk' })
    await user.selectOptions(screen.getByLabelText('Source'), 'agency')
    await user.selectOptions(screen.getByLabelText('Retention'), 'expired')
    await user.click(screen.getByRole('button', { name: 'Download CSV' }))
    await waitFor(() => expect(api.exportMany).toHaveBeenCalledWith({ format: 'csv', source: 'agency', retention: 'expired' }))
  })

  it('shows the server message when an export is too large, and does not save a file', async () => {
    api.exportMany.mockRejectedValue(new ApiError('This export would contain more than 500 candidates. Narrow it with the filters and export in parts.', 422))
    const { user, onClose } = open({ kind: 'bulk' })
    await user.click(screen.getByRole('button', { name: 'Download CSV' }))
    expect((await screen.findByRole('alert')).textContent).toContain('more than 500 candidates')
    expect(saveFile).not.toHaveBeenCalled(); expect(onClose).not.toHaveBeenCalled()
  })

  it('has no filters for a single-candidate export', () => {
    open(one)
    expect(screen.queryByLabelText('Source')).toBeNull()
  })
})

describe('PurgeDialog', () => {
  const result = (over: Partial<PurgeResult> = {}): PurgeResult => ({
    dry_run: true, purge_enabled: true, eligible_total: 3, batch_size: 3, candidate_ids: ['a', 'b', 'c'],
    deleted: 0, remaining_eligible: 3, expired_with_applications: 2, ...over,
  })
  function open(role: UserRole = 'admin') {
    const onClose = vi.fn(); const onDone = vi.fn()
    renderAs(<PurgeDialog open onClose={onClose} onDone={onDone} />, { role })
    return { onClose, onDone, user: userEvent.setup() }
  }

  it('starts with a dry run that deletes nothing', async () => {
    api.purgePreview.mockResolvedValue(result())
    open()
    expect(await screen.findByText(/past their retention date and hold no applications/)).toBeTruthy()
    expect(api.purgePreview).toHaveBeenCalledTimes(1)
    expect(api.purge).not.toHaveBeenCalled()
  })

  it('explains that candidates with hiring history are never deleted', async () => {
    api.purgePreview.mockResolvedValue(result())
    open()
    expect(await screen.findByText(/2 expired candidates have hiring history. They are never deleted/)).toBeTruthy()
  })

  it('requires the exact word before the delete button works', async () => {
    api.purgePreview.mockResolvedValue(result())
    const { user } = open()
    const button = (await screen.findByRole('button', { name: /Permanently delete 3/ })) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    await user.type(screen.getByLabelText(/Type PURGE to confirm/), 'purge')
    expect(button.disabled).toBe(true)
    await user.clear(screen.getByLabelText(/Type PURGE/))
    await user.type(screen.getByLabelText(/Type PURGE/), 'PURGE')
    expect(button.disabled).toBe(false)
  })

  it('deletes, reports the outcome and says if more remain', async () => {
    api.purgePreview.mockResolvedValue(result())
    api.purge.mockResolvedValue(result({ dry_run: false, deleted: 3, remaining_eligible: 4 }))
    const { user, onDone } = open()
    await user.type(await screen.findByLabelText(/Type PURGE/), 'PURGE')
    await user.click(screen.getByRole('button', { name: /Permanently delete 3/ }))
    expect(await screen.findByText(/permanently deleted\. 4 more are still eligible/)).toBeTruthy()
    expect(api.purge).toHaveBeenCalledWith('PURGE')
    expect(onDone).toHaveBeenCalled()
  })

  it('HR can review but is not offered the delete controls', async () => {
    api.purgePreview.mockResolvedValue(result())
    open('hr_manager')
    expect(await screen.findByText(/Only administrators can permanently delete/)).toBeTruthy()
    expect(screen.queryByLabelText(/Type PURGE/)).toBeNull()
    expect(screen.queryByRole('button', { name: /Permanently delete/ })).toBeNull()
  })

  it('shows that deletion is switched off, with no delete controls even for an admin', async () => {
    api.purgePreview.mockResolvedValue(result({ purge_enabled: false }))
    open('admin')
    expect(await screen.findByText(/switched off for this deployment/)).toBeTruthy()
    expect(screen.queryByLabelText(/Type PURGE/)).toBeNull()
  })

  it('offers nothing to delete when nobody is eligible', async () => {
    api.purgePreview.mockResolvedValue(result({ eligible_total: 0, batch_size: 0, candidate_ids: [], expired_with_applications: 0 }))
    open()
    expect(await screen.findByText(/0/)).toBeTruthy()
    expect(screen.queryByLabelText(/Type PURGE/)).toBeNull()
  })

  it('shows a server refusal and keeps the dialog open', async () => {
    api.purgePreview.mockResolvedValue(result())
    api.purge.mockRejectedValue(new ApiError('Permanent deletion is turned off for this deployment (PRIVACY_PURGE_ENABLED).', 409))
    const { user, onDone, onClose } = open()
    await user.type(await screen.findByLabelText(/Type PURGE/), 'PURGE')
    await user.click(screen.getByRole('button', { name: /Permanently delete 3/ }))
    expect((await screen.findByRole('alert')).textContent).toContain('turned off')
    expect(onDone).not.toHaveBeenCalled(); expect(onClose).not.toHaveBeenCalled()
  })

  it('does not claim legal compliance', async () => {
    api.purgePreview.mockResolvedValue(result())
    open()
    expect(await screen.findByText(/does not make it legally compliant by itself/)).toBeTruthy()
  })

  it('shows a preview error with retry', async () => {
    api.purgePreview.mockRejectedValueOnce(new ApiError('Boom', 500)).mockResolvedValueOnce(result())
    const { user } = open()
    expect((await screen.findByRole('alert')).textContent).toContain('Boom')
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText(/past their retention date/)).toBeTruthy()
  })
})
