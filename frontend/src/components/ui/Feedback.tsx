import type { ReactNode } from 'react'
import { AlertIcon } from './icons'
import { Button } from './Button'

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode
  title: string
  description: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center px-6 py-16 text-center">
      <div className="flex size-14 items-center justify-center rounded-2xl bg-lavender-100 text-lavender-600">
        {icon}
      </div>
      <h3 className="mt-4 text-base font-semibold text-navy-900">{title}</h3>
      <p className="mt-1 max-w-sm text-sm text-slate-500">{description}</p>
      {action && <div className="mt-6">{action}</div>}
    </div>
  )
}

export function ErrorState({
  title = 'Something went wrong',
  message,
  onRetry,
}: {
  title?: string
  message: string
  onRetry?: () => void
}) {
  return (
    <div role="alert" className="flex flex-col items-center px-6 py-16 text-center">
      <div className="flex size-14 items-center justify-center rounded-2xl bg-rose-50 text-rose-600">
        <AlertIcon className="size-7" />
      </div>
      <h3 className="mt-4 text-base font-semibold text-navy-900">{title}</h3>
      <p className="mt-1 max-w-sm text-sm text-slate-500">{message}</p>
      {onRetry && (
        <Button variant="secondary" className="mt-6" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  )
}

/** Inline banner, e.g. a form-level error. */
export function Alert({ children }: { children: ReactNode }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2.5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"
    >
      <AlertIcon className="mt-0.5 size-4 shrink-0" />
      <div>{children}</div>
    </div>
  )
}
