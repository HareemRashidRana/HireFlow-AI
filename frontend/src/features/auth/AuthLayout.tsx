import type { ReactNode } from 'react'
import { Logo } from '../../components/layout/Logo'
import { ShieldIcon } from '../../components/ui/icons'

/** Split-screen layout shared by the sign-in and change-password pages. */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-screen bg-white lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <aside className="relative hidden overflow-hidden bg-navy-900 p-12 text-white lg:flex lg:flex-col lg:justify-between">
        {/* soft lavender glow */}
        <div aria-hidden="true" className="pointer-events-none absolute -top-24 -right-24 size-96 rounded-full bg-lavender-500/25 blur-3xl" />
        <div aria-hidden="true" className="pointer-events-none absolute -bottom-32 -left-20 size-96 rounded-full bg-lavender-400/10 blur-3xl" />

        <div className="relative">
          <Logo light />
        </div>

        <div className="relative max-w-md">
          <h2 className="text-4xl leading-tight font-semibold tracking-tight">
            Your people, <span className="text-lavender-300">organised.</span>
          </h2>
          <p className="mt-4 text-base leading-relaxed text-slate-300">
            One secure place to manage your team's records, from the first day to the last.
          </p>
        </div>

        <div className="relative flex items-center gap-3 text-sm text-slate-300">
          <span className="flex size-9 items-center justify-center rounded-xl bg-white/10 text-lavender-300">
            <ShieldIcon className="size-5" />
          </span>
          Short-lived access tokens and automatic session protection.
        </div>
      </aside>

      <main className="flex items-center justify-center px-4 py-10 sm:px-8">
        <div className="w-full max-w-md">
          <div className="mb-8 lg:hidden">
            <Logo />
          </div>
          {children}
        </div>
      </main>
    </div>
  )
}
