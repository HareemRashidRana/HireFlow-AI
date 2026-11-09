import { useId, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { FieldShell } from '../../../components/ui/Field'
import { controlClasses } from '../../../components/ui/fieldStyles'
import { CloseIcon } from '../../../components/ui/icons'
import { MAX_SKILLS, addSkills, removeSkill } from '../lib/skills'

interface Props {
  label: string
  value: string[]
  onChange: (skills: string[]) => void
  hint?: string
  error?: string
  placeholder?: string
}

/** Tag input: type a skill and press Enter or comma; paste "a, b, c" to add several. */
export function SkillsInput({ label, value, onChange, hint, error, placeholder }: Props) {
  const id = useId()
  const [text, setText] = useState('')
  const [localError, setLocalError] = useState<string | null>(null)

  const commit = (raw: string) => {
    if (!raw.trim()) return
    const result = addSkills(value, raw)
    setLocalError(result.error)
    if (result.skills.length !== value.length) onChange(result.skills)
    if (!result.error) setText('')
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault() // Enter must not submit the whole form
      commit(text)
    } else if (e.key === 'Backspace' && text === '' && value.length > 0) {
      onChange(removeSkill(value, value.length - 1))
    }
  }

  const shownError = error ?? localError ?? undefined

  return (
    <FieldShell
      label={label}
      id={id}
      error={shownError}
      hint={hint ?? `Press Enter or comma to add. Up to ${MAX_SKILLS} skills.`}
    >
      <div
        className={`${controlClasses(!!shownError)} flex !h-auto min-h-11 flex-wrap items-center gap-1.5 py-1.5 focus-within:ring-4 ${
          shownError ? 'focus-within:ring-rose-100' : 'focus-within:border-lavender-500 focus-within:ring-lavender-100'
        }`}
      >
        {value.map((skill, index) => (
          <span
            key={skill}
            className="inline-flex items-center gap-1 rounded-lg bg-lavender-100 py-1 pr-1 pl-2.5 text-xs font-medium text-lavender-700 ring-1 ring-lavender-200 ring-inset"
          >
            {skill}
            <button
              type="button"
              aria-label={`Remove ${skill}`}
              onClick={() => onChange(removeSkill(value, index))}
              className="rounded p-0.5 text-lavender-600 hover:bg-lavender-200"
            >
              <CloseIcon className="size-3.5" />
            </button>
          </span>
        ))}
        <input
          id={id}
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            if (localError) setLocalError(null)
          }}
          onKeyDown={onKeyDown}
          onBlur={() => commit(text)}
          onPaste={(e) => {
            const pasted = e.clipboardData.getData('text')
            if (/[,\n;]/.test(pasted)) {
              e.preventDefault()
              commit(pasted)
            }
          }}
          placeholder={value.length === 0 ? placeholder : undefined}
          aria-invalid={!!shownError}
          aria-describedby={shownError ? `${id}-error` : undefined}
          className="min-w-32 flex-1 bg-transparent px-1.5 py-1 text-sm outline-none placeholder:text-slate-400"
        />
      </div>
    </FieldShell>
  )
}
