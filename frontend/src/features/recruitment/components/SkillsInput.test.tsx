// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { SkillsInput } from './SkillsInput'

/** A tiny stateful wrapper, because SkillsInput is a controlled component. */
function Harness({ initial = [], onSubmit = vi.fn(), error }: { initial?: string[]; onSubmit?: () => void; error?: string }) {
  const [skills, setSkills] = useState<string[]>(initial)
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit()
      }}
    >
      <SkillsInput label="Required skills" value={skills} onChange={setSkills} error={error} placeholder="Add a skill" />
      <output data-testid="state">{JSON.stringify(skills)}</output>
    </form>
  )
}

const state = () => JSON.parse(screen.getByTestId('state').textContent ?? '[]') as string[]
const input = () => screen.getByLabelText('Required skills')

describe('SkillsInput', () => {
  it('adds a skill with Enter and clears the box', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.type(input(), 'Python{Enter}')
    expect(state()).toEqual(['Python'])
    expect((input() as HTMLInputElement).value).toBe('')
    expect(screen.getByText('Python')).toBeTruthy()
  })

  it('adds a skill with a comma', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.type(input(), 'SQL,')
    expect(state()).toEqual(['SQL'])
  })

  it('does NOT submit the surrounding form when Enter is pressed', async () => {
    const onSubmit = vi.fn()
    const user = userEvent.setup()
    render(<Harness onSubmit={onSubmit} />)
    await user.type(input(), 'Go{Enter}')
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('ignores duplicates regardless of case', async () => {
    const user = userEvent.setup()
    render(<Harness initial={['Python']} />)
    await user.type(input(), 'python{Enter}')
    expect(state()).toEqual(['Python'])
  })

  it('adds the pending text when the field loses focus', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.type(input(), 'Docker')
    await user.tab()
    expect(state()).toEqual(['Docker'])
  })

  it('splits pasted lists into separate skills', () => {
    render(<Harness />)
    fireEvent.paste(input(), { clipboardData: { getData: () => 'react, vue\nsvelte' } })
    expect(state()).toEqual(['react', 'vue', 'svelte'])
  })

  it('removes a skill with its remove button', async () => {
    const user = userEvent.setup()
    render(<Harness initial={['a', 'b', 'c']} />)
    await user.click(screen.getByRole('button', { name: 'Remove b' }))
    expect(state()).toEqual(['a', 'c'])
  })

  it('removes the last skill with Backspace on an empty box', async () => {
    const user = userEvent.setup()
    render(<Harness initial={['a', 'b']} />)
    await user.click(input())
    await user.keyboard('{Backspace}')
    expect(state()).toEqual(['a'])
  })

  it('does not remove anything with Backspace while text is being typed', async () => {
    const user = userEvent.setup()
    render(<Harness initial={['a']} />)
    await user.type(input(), 'xy{Backspace}')
    expect(state()).toEqual(['a'])
    expect((input() as HTMLInputElement).value).toBe('x')
  })

  it('shows an error for an overly long skill and keeps the text so it can be fixed', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(input())
    await user.paste('x'.repeat(51))
    await user.keyboard('{Enter}')
    expect(state()).toEqual([])
    expect(screen.getByText(/at most 50 characters/i)).toBeTruthy()
  })

  it('refuses to go past 30 skills', async () => {
    const user = userEvent.setup()
    const full = Array.from({ length: 30 }, (_, i) => `s${i}`)
    render(<Harness initial={full} />)
    await user.type(input(), 'extra{Enter}')
    expect(state()).toHaveLength(30)
    expect(screen.getByText(/at most 30 skills/i)).toBeTruthy()
  })

  it('shows an error passed in from the form (e.g. from the server)', () => {
    render(<Harness error="Each skill must be at most 50 characters" />)
    expect(screen.getByText('Each skill must be at most 50 characters')).toBeTruthy()
    expect(input().getAttribute('aria-invalid')).toBe('true')
  })

  it('shows the placeholder while the list is empty and hides it once there are skills', () => {
    const empty = render(<Harness />)
    expect(input().getAttribute('placeholder')).toBe('Add a skill')
    empty.unmount()
    render(<Harness initial={['a']} />)
    expect(input().getAttribute('placeholder')).toBeNull()
  })

  it('has accessible remove buttons for every skill', () => {
    render(<Harness initial={['Python', 'SQL']} />)
    expect(screen.getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['Remove Python', 'Remove SQL'])
  })
})
