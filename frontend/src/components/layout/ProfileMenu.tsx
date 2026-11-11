import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { roleLabels } from '../../auth/permissions'
import { useAuth } from '../../auth/useAuth'
import { Avatar } from '../ui/Avatar'
import { ChevronDownIcon, KeyIcon, LogoutIcon, UserIcon } from '../ui/icons'
import { Spinner } from '../ui/Spinner'
import { useToast } from '../ui/Toast'

/**
 * Who is signed in, with My profile, Change password and Sign out. It lives in the top bar of every
 * panel, so it is on screen at any window size. Signing out asks the server to end the session first;
 * if that fails the person stays signed in and is told, rather than being sent to a login page they
 * could walk straight back out of.
 */
export function ProfileMenu() {
  const { user, logout } = useAuth()
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    const onClick = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onClick)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onClick)
    }
  }, [open])

  if (!user) return null

  const signOut = async () => {
    setSigningOut(true)
    try {
      await logout() // on success the auth state changes and the router sends us to the login page
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not sign out. Please try again.')
      setSigningOut(false)
    }
  }

  const itemClass = 'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-navy-900 hover:bg-lavender-50 disabled:opacity-60'
  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-xl py-1 pr-2 pl-1 hover:bg-lavender-50"
      >
        <Avatar initials={user.email.slice(0, 2).toUpperCase()} size="sm" />
        <span className="hidden min-w-0 text-left sm:block">
          <span className="block max-w-40 truncate text-sm font-medium text-navy-900">{user.email}</span>
          <span className="block text-xs text-slate-500">{roleLabels[user.role]}</span>
        </span>
        <ChevronDownIcon className="size-4 text-slate-500" />
      </button>

      {open && (
        <div role="menu" aria-label="Account" className="absolute right-0 z-50 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-2xl border border-slate-200 bg-white p-2 shadow-xl">
          <div className="px-3 py-2">
            <p className="truncate text-sm font-semibold text-navy-900" title={user.email}>{user.email}</p>
            <p className="text-xs text-slate-500">{roleLabels[user.role]}</p>
          </div>
          <div className="my-1 border-t border-slate-100" />
          {(user.employee_id !== null || user.role === 'employee') && (
            <Link to="/profile" role="menuitem" onClick={() => setOpen(false)} className={itemClass}>
              <UserIcon className="size-[18px] text-slate-500" /> My profile
            </Link>
          )}
          <Link to="/change-password" role="menuitem" onClick={() => setOpen(false)} className={itemClass}>
            <KeyIcon className="size-[18px] text-slate-500" /> Change password
          </Link>
          <button type="button" role="menuitem" onClick={() => void signOut()} disabled={signingOut} className={`${itemClass} text-rose-700`}>
            {signingOut ? <Spinner className="size-[18px]" /> : <LogoutIcon className="size-[18px]" />}
            {signingOut ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      )}
    </div>
  )
}
