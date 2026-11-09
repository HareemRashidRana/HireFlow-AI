const sizes = {
  sm: 'size-9 text-xs',
  md: 'size-11 text-sm',
  lg: 'size-16 text-xl',
}

export function Avatar({ initials, size = 'md' }: { initials: string; size?: keyof typeof sizes }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center rounded-full bg-lavender-100 font-semibold text-lavender-700 ring-1 ring-lavender-200 ${sizes[size]}`}
    >
      {initials}
    </span>
  )
}
