export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md'

const base =
  'inline-flex items-center justify-center gap-2 rounded-xl font-medium transition-colors ' +
  'disabled:cursor-not-allowed disabled:opacity-60'

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-navy-900 text-white shadow-sm hover:bg-navy-800',
  secondary: 'border border-slate-200 bg-white text-navy-900 hover:bg-lavender-50',
  ghost: 'text-navy-700 hover:bg-lavender-100',
  danger: 'bg-rose-600 text-white shadow-sm hover:bg-rose-700',
}

const sizes: Record<ButtonSize, string> = {
  sm: 'h-9 px-3 text-sm',
  md: 'h-11 px-4 text-sm',
}

/** Class string so <Link> elements can look like buttons too. */
export function buttonClasses(variant: ButtonVariant = 'primary', size: ButtonSize = 'md', extra = '') {
  return `${base} ${variants[variant]} ${sizes[size]} ${extra}`.trim()
}
