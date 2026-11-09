import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { authApi } from '../../api/auth'
import { ApiError } from '../../api/errors'
import { homePath } from '../../auth/permissions'
import { useAuth } from '../../auth/useAuth'
import { Button } from '../../components/ui/Button'
import { buttonClasses } from '../../components/ui/buttonStyles'
import { Alert } from '../../components/ui/Feedback'
import { InfoIcon } from '../../components/ui/icons'
import { PasswordInput } from '../../components/ui/PasswordInput'
import { useToast } from '../../components/ui/Toast'
import { AuthLayout } from './AuthLayout'

const MIN_LENGTH = 12 // mirrors the server rule; the server is still the authority
const MAX_LENGTH = 128

type Errors = Partial<Record<'current' | 'next' | 'confirm', string>>

export function ChangePasswordPage() {
  const { user, logout } = useAuth()
  const toast = useToast()
  const forced = user?.must_change_password ?? false

  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [errors, setErrors] = useState<Errors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [signingOut, setSigningOut] = useState(false)

  const clear = (key: keyof Errors) => errors[key] && setErrors((e) => ({ ...e, [key]: undefined }))

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setFormError(null)

    const found: Errors = {}
    if (!current) found.current = 'Enter your current password.'
    if (next.length < MIN_LENGTH) found.next = `Use at least ${MIN_LENGTH} characters.`
    else if (next.length > MAX_LENGTH) found.next = `Use at most ${MAX_LENGTH} characters.`
    else if (next === current) found.next = 'Choose a password that is different from the current one.'
    if (next !== confirm) found.confirm = 'The two passwords do not match.'
    setErrors(found)
    if (Object.keys(found).length > 0) return

    setSubmitting(true)
    try {
      await authApi.changePassword(current, next)
      // The server ended every session, so we are signed out now: the router shows the login
      // page with a confirmation message. Nothing more to do here.
    } catch (err) {
      setSubmitting(false)
      if (err instanceof ApiError) {
        if (err.fieldErrors.new_password) setErrors({ next: err.fieldErrors.new_password })
        else if (err.fieldErrors.current_password) setErrors({ current: err.fieldErrors.current_password })
        else if (err.status === 422 && /current password/i.test(err.message)) setErrors({ current: err.message })
        else if (err.status === 422 && /password/i.test(err.message)) setErrors({ next: err.message })
        else setFormError(err.message) // includes 429 lockout and 401 "session ended"
      } else {
        setFormError('Something went wrong. Please try again.')
      }
    }
  }

  const handleSignOut = async () => {
    setSigningOut(true)
    try {
      await logout()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not sign out.')
      setSigningOut(false)
    }
  }

  return (
    <AuthLayout>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-navy-900">
          {forced ? 'Choose a new password' : 'Change your password'}
        </h1>
        <p className="mt-1.5 text-sm text-slate-500">
          {forced
            ? 'An administrator set a temporary password for you. Pick your own to continue.'
            : 'You will be signed out everywhere and asked to sign in with the new password.'}
        </p>
      </div>

      {forced && (
        <div role="status" className="mt-6 flex items-start gap-2.5 rounded-xl border border-lavender-200 bg-lavender-50 px-4 py-3 text-sm text-lavender-700">
          <InfoIcon className="mt-0.5 size-4 shrink-0" />
          <div>You need to set a new password before you can use HireFlow AI.</div>
        </div>
      )}

      <form onSubmit={handleSubmit} noValidate className="mt-8 space-y-5">
        {formError && <Alert>{formError}</Alert>}

        <PasswordInput
          label="Current password"
          autoComplete="current-password"
          autoFocus
          value={current}
          onChange={(e) => {
            setCurrent(e.target.value)
            clear('current')
          }}
          error={errors.current}
          disabled={submitting}
        />
        <PasswordInput
          label="New password"
          autoComplete="new-password"
          hint={`At least ${MIN_LENGTH} characters. A long passphrase is best.`}
          value={next}
          onChange={(e) => {
            setNext(e.target.value)
            clear('next')
          }}
          error={errors.next}
          disabled={submitting}
        />
        <PasswordInput
          label="Confirm new password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => {
            setConfirm(e.target.value)
            clear('confirm')
          }}
          error={errors.confirm}
          disabled={submitting}
        />

        <Button type="submit" className="w-full" loading={submitting}>
          Update password
        </Button>
      </form>

      <div className="mt-6 flex items-center justify-between text-sm">
        {user && !forced ? (
          <Link to={homePath(user)} className={buttonClasses('ghost', 'sm')}>
            Cancel
          </Link>
        ) : (
          <span />
        )}
        <Button variant="ghost" size="sm" onClick={handleSignOut} loading={signingOut}>
          Sign out
        </Button>
      </div>
    </AuthLayout>
  )
}
