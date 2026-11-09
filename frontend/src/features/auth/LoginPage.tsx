import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ApiError } from '../../api/errors'
import { useAuth } from '../../auth/useAuth'
import { Button } from '../../components/ui/Button'
import { Alert } from '../../components/ui/Feedback'
import { Input } from '../../components/ui/Field'
import { InfoIcon } from '../../components/ui/icons'
import { PasswordInput } from '../../components/ui/PasswordInput'
import { AuthLayout } from './AuthLayout'

const NOTICES: Record<string, string> = {
  expired: 'Your session has expired. Please sign in again.',
  'signed-out': 'You have been signed out.',
  'password-changed': 'Your password was changed. Please sign in with your new password.',
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function formatCountdown(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export function LoginPage() {
  const { login } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  // Show the notice once: remember it, then drop it from the history entry so a reload doesn't repeat it.
  const [notice] = useState(() => (location.state as { notice?: string | null } | null)?.notice ?? null)
  useEffect(() => {
    const state = location.state as { from?: unknown; notice?: unknown } | null
    if (state?.notice) navigate(location.pathname, { replace: true, state: { from: state.from ?? null } })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({})
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [lockedUntil, setLockedUntil] = useState<number | null>(null)
  const [secondsLeft, setSecondsLeft] = useState(0)
  const formRef = useRef<HTMLFormElement>(null)

  // Count down the "too many attempts" lockout so the user knows when to try again.
  useEffect(() => {
    if (lockedUntil === null) return
    const tick = () => {
      const left = Math.ceil((lockedUntil - Date.now()) / 1000)
      if (left <= 0) {
        setLockedUntil(null)
        setSecondsLeft(0)
        setError(null)
      } else {
        setSecondsLeft(left)
      }
    }
    tick()
    const timer = setInterval(tick, 1000)
    return () => clearInterval(timer)
  }, [lockedUntil])

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (submitting || lockedUntil !== null) return
    setError(null)

    const errors: { email?: string; password?: string } = {}
    if (!EMAIL_RE.test(email.trim())) errors.email = 'Enter your work email address.'
    if (!password) errors.password = 'Enter your password.'
    setFieldErrors(errors)
    if (errors.email || errors.password) return

    setSubmitting(true)
    try {
      await login(email.trim(), password)
      // On success the router moves on automatically (see PublicOnly).
    } catch (err) {
      setPassword('') // never keep a rejected password in the form
      if (err instanceof ApiError && err.status === 429) {
        setError(err.message)
        if (err.retryAfterSeconds) setLockedUntil(Date.now() + err.retryAfterSeconds * 1000)
      } else if (err instanceof ApiError && err.status === 401) {
        setError('Invalid email or password.')
      } else if (err instanceof ApiError && err.status === 422 && err.fieldErrors.email) {
        setFieldErrors({ email: err.fieldErrors.email }) // e.g. a reserved/invalid email domain
      } else if (err instanceof ApiError && err.status === 403) {
        setError('Sign-in was blocked. Please reload the page and try again.')
      } else {
        setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
      }
      setSubmitting(false)
      requestAnimationFrame(() => formRef.current?.querySelector<HTMLInputElement>('[autocomplete="current-password"]')?.focus())
    }
  }

  const locked = lockedUntil !== null

  return (
    <AuthLayout>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-navy-900">Welcome back</h1>
        <p className="mt-1.5 text-sm text-slate-500">Sign in to your HireFlow AI workspace.</p>
      </div>

      {notice && NOTICES[notice] && !error && (
        <div role="status" className="mt-6 flex items-start gap-2.5 rounded-xl border border-lavender-200 bg-lavender-50 px-4 py-3 text-sm text-lavender-700">
          <InfoIcon className="mt-0.5 size-4 shrink-0" />
          <div>{NOTICES[notice]}</div>
        </div>
      )}

      <form ref={formRef} onSubmit={handleSubmit} noValidate className="mt-8 space-y-5">
        {error && <Alert>{error}</Alert>}

        <Input
          label="Work email"
          type="email"
          name="email"
          autoComplete="username"
          autoFocus
          placeholder="name@company.com"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value)
            if (fieldErrors.email) setFieldErrors((f) => ({ ...f, email: undefined }))
          }}
          error={fieldErrors.email}
          disabled={submitting}
        />

        <PasswordInput
          label="Password"
          name="password"
          autoComplete="current-password"
          placeholder="Enter your password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value)
            if (fieldErrors.password) setFieldErrors((f) => ({ ...f, password: undefined }))
          }}
          error={fieldErrors.password}
          disabled={submitting}
        />

        <Button type="submit" className="w-full" loading={submitting} disabled={locked}>
          {locked ? `Try again in ${formatCountdown(secondsLeft)}` : 'Sign in'}
        </Button>
      </form>

      <p className="mt-8 text-center text-sm text-slate-500">
        Forgot your password? Ask an administrator to reset it for you.
      </p>
    </AuthLayout>
  )
}
