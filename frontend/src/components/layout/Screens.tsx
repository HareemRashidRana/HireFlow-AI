import { Link } from 'react-router-dom'
import { buttonClasses } from '../ui/buttonStyles'
import { Button } from '../ui/Button'
import { AlertIcon, LockIcon } from '../ui/icons'
import { Spinner } from '../ui/Spinner'
import { Logo } from './Logo'

/** Full-screen placeholder while the session is being restored on page load. */
export function SplashScreen() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-white">
      <Logo />
      <div className="flex items-center gap-3 text-sm text-slate-500">
        <Spinner /> Restoring your session…
      </div>
    </div>
  )
}

/** Shown when the server cannot be reached while restoring (not the same as being signed out). */
export function ConnectionProblem({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="flex min-h-screen flex-col items-center justify-center gap-4 bg-white px-6 text-center">
      <Logo />
      <div className="mt-4 flex size-14 items-center justify-center rounded-2xl bg-rose-50 text-rose-600">
        <AlertIcon className="size-7" />
      </div>
      <h1 className="text-lg font-semibold text-navy-900">Can't reach HireFlow AI</h1>
      <p className="max-w-sm text-sm text-slate-500">{message}</p>
      <Button onClick={onRetry}>Try again</Button>
    </div>
  )
}

/** Shown inside the app shell when a signed-in user opens a page their role cannot use. */
export function AccessDenied() {
  return (
    <div role="alert" className="flex flex-col items-center px-6 py-24 text-center">
      <div className="flex size-14 items-center justify-center rounded-2xl bg-lavender-100 text-lavender-600">
        <LockIcon className="size-7" />
      </div>
      <h1 className="mt-4 text-lg font-semibold text-navy-900">You don't have access to this page</h1>
      <p className="mt-1 max-w-sm text-sm text-slate-500">
        Your role doesn't include this area. If you think that's a mistake, ask an administrator.
      </p>
      <Link to="/" className={`${buttonClasses('primary')} mt-6`}>
        Go to my home page
      </Link>
    </div>
  )
}
