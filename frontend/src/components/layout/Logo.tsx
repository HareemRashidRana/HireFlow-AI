export function LogoMark({ className = 'size-9' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect width="32" height="32" rx="9" fill="#7C6BD6" />
      <path d="M10 8v16M22 8v16M10 16h12" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

export function Logo({ light = false }: { light?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <LogoMark />
      <span className={`text-lg font-semibold tracking-tight ${light ? 'text-white' : 'text-navy-900'}`}>
        HireFlow <span className="text-lavender-400">AI</span>
      </span>
    </div>
  )
}
