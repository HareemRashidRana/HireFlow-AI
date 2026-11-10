import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'

interface ModalProps {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  footer?: ReactNode
  /** For long forms: a wider dialog that scrolls inside the viewport instead of running off it. */
  wide?: boolean
}

/** Built on the native <dialog>: focus trap, Esc to close and aria-modal come for free. */
export function Modal({ open, onClose, title, children, footer, wide = false }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose() // click on the backdrop
      }}
      aria-labelledby="modal-title"
      className={`m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] ${wide ? 'max-w-3xl' : 'max-w-md'} overflow-y-auto rounded-2xl border border-slate-200 bg-white p-0 text-navy-900 shadow-2xl backdrop:bg-navy-950/50 backdrop:backdrop-blur-[2px]`}
    >
      {open && (
        <div className="p-6">
          <h2 id="modal-title" className="text-lg font-semibold">
            {title}
          </h2>
          <div className="mt-2 text-sm leading-relaxed text-slate-600">{children}</div>
          {footer && <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">{footer}</div>}
        </div>
      )}
    </dialog>
  )
}
