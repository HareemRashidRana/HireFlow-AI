// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../../api/errors'
import { makeApplication, makeApplicationItem } from '../../../test/fixtures'
import { renderAs } from '../../../test/render'
import { ReopenDialog } from './ReopenDialog'

const reopen = vi.fn()
vi.mock('../../../api/applications', () => ({ applicationsApi: { reopen: (...a: unknown[]) => reopen(...a) } }))

beforeEach(() => {
  reopen.mockReset()
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.removeAttribute('open')
  }
})

function open(stage: 'rejected' | 'withdrawn' = 'rejected') {
  const onClose = vi.fn()
  const onChanged = vi.fn()
  const onStale = vi.fn()
  renderAs(
    <ReopenDialog
      application={makeApplicationItem({ stage, can_reopen: true })}
      onClose={onClose}
      onChanged={onChanged}
      onStale={onStale}
    />,
  )
  return { onClose, onChanged, onStale, user: userEvent.setup() }
}

describe('ReopenDialog', () => {
  it('explains what reopening does for a rejected application', () => {
    open('rejected')
    expect(screen.getByText(/application is rejected\. Reopening puts it back at the stage it was rejected from/)).toBeTruthy()
  })

  it('explains it for a withdrawn application', () => {
    open('withdrawn')
    expect(screen.getByText(/the stage it was withdrawn from/)).toBeTruthy()
  })

  it('reopens, optionally with a note', async () => {
    reopen.mockResolvedValue(makeApplication({ stage: 'interview' }))
    const { user, onChanged, onClose } = open()
    await user.type(screen.getByLabelText(/Note/), 'Available again')
    await user.click(screen.getByRole('button', { name: 'Reopen application' }))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    expect(reopen).toHaveBeenCalledWith('app-1', 'Available again')
    expect(onClose).toHaveBeenCalled()
  })

  it('sends no note when none was written', async () => {
    reopen.mockResolvedValue(makeApplication())
    const { user } = open()
    await user.click(screen.getByRole('button', { name: 'Reopen application' }))
    await waitFor(() => expect(reopen).toHaveBeenCalledWith('app-1', undefined))
  })

  it('shows a refusal and stays open', async () => {
    reopen.mockRejectedValue(new ApiError('This job is closed. Reopen the job first.', 409))
    const { user, onClose, onChanged, onStale } = open()
    await user.click(screen.getByRole('button', { name: 'Reopen application' }))
    expect((await screen.findByRole('alert')).textContent).toContain('This job is closed')
    expect(onClose).not.toHaveBeenCalled()
    expect(onChanged).not.toHaveBeenCalled()
    expect(onStale).toHaveBeenCalled()
  })
})
