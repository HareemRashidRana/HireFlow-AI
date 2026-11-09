import { useId, useState } from 'react'
import type { InputHTMLAttributes } from 'react'
import { FieldShell } from './Field'
import { controlClasses } from './fieldStyles'
import { EyeIcon, EyeOffIcon } from './icons'

interface Props extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: string
  error?: string
  hint?: string
}

/** Password field with a working show/hide toggle. */
export function PasswordInput({ label, error, hint, required, className = '', ...props }: Props) {
  const id = useId()
  const [visible, setVisible] = useState(false)
  return (
    <FieldShell label={label} error={error} hint={hint} required={required} id={id}>
      <div className="relative">
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          required={required}
          aria-invalid={!!error}
          aria-describedby={error ? `${id}-error` : undefined}
          className={`${controlClasses(!!error)} pr-11 ${className}`}
          {...props}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? 'Hide password' : 'Show password'}
          aria-pressed={visible}
          className="absolute top-1.5 right-1.5 rounded-lg p-1.5 text-slate-400 hover:bg-lavender-100 hover:text-navy-900"
        >
          {visible ? <EyeOffIcon className="size-5" /> : <EyeIcon className="size-5" />}
        </button>
      </div>
    </FieldShell>
  )
}
