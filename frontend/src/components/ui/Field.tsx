import { useId } from 'react'
import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react'
import { controlClasses } from './fieldStyles'

interface FieldShellProps {
  label: string
  error?: string
  hint?: string
  required?: boolean
  id: string
  children: ReactNode
}

export function FieldShell({ label, error, hint, required, id, children }: FieldShellProps) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-navy-800">
        {label}
        {required && <span className="ml-0.5 text-lavender-600">*</span>}
      </label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="mt-1.5 text-xs font-medium text-rose-600">
          {error}
        </p>
      ) : (
        hint && <p className="mt-1.5 text-xs text-slate-500">{hint}</p>
      )}
    </div>
  )
}

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string
  error?: string
  hint?: string
}

export function Input({ label, error, hint, required, className = '', ...props }: InputProps) {
  const id = useId()
  return (
    <FieldShell label={label} error={error} hint={hint} required={required} id={id}>
      <input
        id={id}
        required={required}
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-error` : undefined}
        className={`${controlClasses(!!error)} ${className}`}
        {...props}
      />
    </FieldShell>
  )
}

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string
  error?: string
  hint?: string
}

export function Select({ label, error, hint, required, className = '', children, ...props }: SelectProps) {
  const id = useId()
  return (
    <FieldShell label={label} error={error} hint={hint} required={required} id={id}>
      <select
        id={id}
        required={required}
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-error` : undefined}
        className={`${controlClasses(!!error)} ${className}`}
        {...props}
      >
        {children}
      </select>
    </FieldShell>
  )
}
