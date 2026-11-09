import type { HTMLAttributes, ReactNode } from 'react'

export function Card({ className = '', ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`rounded-2xl border border-slate-200/80 bg-white shadow-card ${className}`}
      {...props}
    />
  )
}

export function CardHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 sm:px-6">
      <h2 className="text-sm font-semibold text-navy-900">{title}</h2>
      {action}
    </div>
  )
}
