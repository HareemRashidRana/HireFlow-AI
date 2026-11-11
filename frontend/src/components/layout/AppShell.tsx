import { useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../../auth/useAuth'
import { CloseIcon, MenuIcon } from '../ui/icons'
import { Logo } from './Logo'
import { panelFor } from './navigation'
import { ProfileMenu } from './ProfileMenu'
import { Sidebar } from './Sidebar'

export function AppShell() {
  const { pathname } = useLocation()
  const { user } = useAuth()
  const panel = user ? panelFor(user.role) : null
  // The menu counts as open only on the page where it was opened, so navigating closes it.
  const [openAt, setOpenAt] = useState<string | null>(null)
  const menuOpen = openAt === pathname
  const setMenuOpen = (open: boolean) => setOpenAt(open ? pathname : null)

  useEffect(() => {
    if (!menuOpen) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpenAt(null)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [menuOpen])

  return (
    <div className="min-h-screen bg-white">
      {/* Desktop sidebar: the navigation of this person's own panel */}
      <aside className="fixed inset-y-0 left-0 hidden w-64 lg:block">
        <Sidebar />
      </aside>

      {/* Top bar on every screen size: always visible, and it holds the account menu with Sign out */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-slate-200 bg-white/90 px-4 backdrop-blur sm:px-6 lg:ml-64 lg:px-10">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            aria-label="Open menu"
            className="rounded-lg p-2 text-navy-900 hover:bg-lavender-100 lg:hidden"
          >
            <MenuIcon />
          </button>
          <div className="lg:hidden">
            <Logo />
          </div>
          {panel && <p className="hidden truncate text-sm font-medium text-slate-500 lg:block">{panel.title}</p>}
        </div>
        <ProfileMenu />
      </header>

      {/* Mobile drawer */}
      {menuOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-navy-950/50" onClick={() => setMenuOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[85%] shadow-2xl">
            <Sidebar onNavigate={() => setMenuOpen(false)} />
            <button
              type="button"
              onClick={() => setMenuOpen(false)}
              aria-label="Close menu"
              className="absolute top-5 right-4 rounded-lg p-1.5 text-slate-300 hover:bg-white/10"
            >
              <CloseIcon className="size-5" />
            </button>
          </aside>
        </div>
      )}

      <main className="lg:pl-64">
        <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-10 lg:py-10">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
