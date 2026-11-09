export const controlClasses = (hasError: boolean) =>
  'block h-11 w-full rounded-xl border bg-white px-3.5 text-sm text-navy-900 shadow-sm ' +
  'placeholder:text-slate-400 transition-colors focus:outline-none focus:ring-4 ' +
  (hasError
    ? 'border-rose-400 focus:border-rose-500 focus:ring-rose-100'
    : 'border-slate-200 hover:border-slate-300 focus:border-lavender-500 focus:ring-lavender-100')
