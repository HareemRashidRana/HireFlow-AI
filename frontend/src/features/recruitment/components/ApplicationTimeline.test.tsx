// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { ApplicationEvent } from '../../../types/application'
import { makeStaff } from '../../../test/fixtures'
import { ApplicationTimeline } from './ApplicationTimeline'

const ev = (over: Partial<ApplicationEvent>): ApplicationEvent => ({
  id: Math.random().toString(),
  event_type: 'stage_changed',
  from_value: 'applied',
  to_value: 'screening',
  note: null,
  actor: makeStaff({ email: 'rana@example.com' }),
  created_at: '2026-11-03T09:00:00Z',
  ...over,
})

describe('ApplicationTimeline', () => {
  it('lists the events in the order given (the server sends oldest first)', () => {
    render(
      <ApplicationTimeline
        events={[
          ev({ id: '1', event_type: 'created', from_value: null, to_value: 'applied' }),
          ev({ id: '2' }),
          ev({ id: '3', event_type: 'rejected', from_value: 'screening', to_value: 'rejected', note: 'Not a fit' }),
        ]}
      />,
    )
    const items = within(screen.getByRole('list', { name: 'Application history' })).getAllByRole('listitem')
    expect(items.map((i) => i.querySelector('p')!.textContent)).toEqual([
      'Application created',
      'Moved from Applied to Screening',
      'Rejected (was in Screening)',
    ])
  })

  it('shows the note, who did it, and when', () => {
    render(<ApplicationTimeline events={[ev({ event_type: 'rejected', to_value: 'rejected', note: 'Missing skills' })]} />)
    expect(screen.getByText('Missing skills')).toBeTruthy()
    expect(screen.getByText(/rana@example\.com/)).toBeTruthy()
    expect(document.querySelector('time')!.getAttribute('datetime')).toBe('2026-11-03T09:00:00Z')
  })

  it('says "a removed user" when the actor no longer exists', () => {
    render(<ApplicationTimeline events={[ev({ actor: null })]} />)
    expect(screen.getByText(/a removed user/)).toBeTruthy()
  })

  it('renders staff-written notes as plain text, never as HTML', () => {
    const evil = '<img src=x onerror="window.__pwned=1"><script>window.__pwned=2</script><b>bold</b>'
    render(<ApplicationTimeline events={[ev({ note: evil })]} />)
    expect(screen.getByText(evil)).toBeTruthy() // shown literally
    expect(document.querySelector('img, script, b')).toBeNull()
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined()
  })

  it('renders emails and assignment values as text too', () => {
    const evil = '<u>x</u>@evil.test'
    render(<ApplicationTimeline events={[ev({ event_type: 'assigned', from_value: null, to_value: evil })]} />)
    expect(screen.getByText(`Assigned to ${evil}`)).toBeTruthy()
    expect(document.querySelector('u')).toBeNull()
  })

  it('has an empty state', () => {
    render(<ApplicationTimeline events={[]} />)
    expect(screen.getByText('No history recorded yet.')).toBeTruthy()
  })
})
