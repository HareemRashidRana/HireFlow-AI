// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { RetentionBadge } from './RetentionBadge'

const today = new Date(2026, 2, 15, 12, 0)

describe('RetentionBadge', () => {
  it('shows the retention date when it is far off', () => {
    render(<RetentionBadge retainUntil="2027-03-15" today={today} />)
    expect(screen.getByText('Until 15 Mar 2027')).toBeTruthy()
  })

  it('warns in the final 30 days with a day count', () => {
    render(<RetentionBadge retainUntil="2026-04-01" today={today} />)
    expect(screen.getByText('Review in 17 days')).toBeTruthy()
  })

  it('uses the singular for a single day', () => {
    render(<RetentionBadge retainUntil="2026-03-16" today={today} />)
    expect(screen.getByText('Review in 1 day')).toBeTruthy()
  })

  it('says "Review in 0 days" on the retention date itself', () => {
    render(<RetentionBadge retainUntil="2026-03-15" today={today} />)
    expect(screen.getByText('Review in 0 days')).toBeTruthy()
  })

  it('flags a passed retention date', () => {
    render(<RetentionBadge retainUntil="2026-03-14" today={today} />)
    expect(screen.getByText('Past retention date')).toBeTruthy()
  })

  it('always exposes the exact date as a tooltip', () => {
    render(<RetentionBadge retainUntil="2026-03-14" today={today} />)
    expect(screen.getByText('Past retention date').getAttribute('title')).toBe('Retention date: 14 Mar 2026')
  })
})
