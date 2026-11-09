import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { AlertIcon, CheckCircleIcon, CloseIcon, InfoIcon } from './icons'

type ToastKind = 'success' | 'error' | 'info'
interface ToastItem {
  id: number
  kind: ToastKind
  message: string
}

interface ToastApi {
  success: (message: string) => void
  error: (message: string) => void
  info: (message: string) => void
}

const ToastContext = createContext<ToastApi | null>(null)

// eslint-disable-next-line react-refresh/only-export-components
export function useToast(): ToastApi {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>')
  return ctx
}

const styles: Record<ToastKind, { box: string; icon: ReactNode }> = {
  success: { box: 'border-emerald-200', icon: <CheckCircleIcon className="size-5 text-emerald-600" /> },
  error: { box: 'border-rose-200', icon: <AlertIcon className="size-5 text-rose-600" /> },
  info: { box: 'border-lavender-300', icon: <InfoIcon className="size-5 text-lavender-600" /> },
}

let nextId = 1

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const dismiss = useCallback((id: number) => {
    setToasts((list) => list.filter((t) => t.id !== id))
  }, [])

  const push = useCallback(
    (kind: ToastKind, message: string) => {
      const id = nextId++
      setToasts((list) => [...list, { id, kind, message }])
      setTimeout(() => dismiss(id), 5000)
    },
    [dismiss],
  )

  const api = useMemo<ToastApi>(
    () => ({
      success: (m) => push('success', m),
      error: (m) => push('error', m),
      info: (m) => push('info', m),
    }),
    [push],
  )

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-4 bottom-4 z-[100] flex flex-col items-end gap-2 sm:inset-x-auto sm:right-6 sm:bottom-6"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={`pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border bg-white p-4 shadow-lg ${styles[t.kind].box}`}
          >
            {styles[t.kind].icon}
            <p className="flex-1 text-sm font-medium text-navy-900">{t.message}</p>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              aria-label="Dismiss notification"
              className="text-slate-400 hover:text-navy-900"
            >
              <CloseIcon className="size-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
