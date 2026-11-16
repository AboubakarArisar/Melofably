// A confirmation in the application's own style, in place of the browser's
// confirm(). It is the platform's <dialog> shown as a modal: the browser
// traps focus inside it, closes it on Escape, and gives focus back to what
// opened it.
import { useEffect, useRef } from 'react'

export function ConfirmDialog({ open, title, body, confirmLabel, danger = false, onConfirm, onCancel }: { open: boolean; title: string; body: string; confirmLabel: string; danger?: boolean; onConfirm: () => void; onCancel: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    else if (!open && dialog.open) dialog.close()
  }, [open])
  return (
    <dialog
      ref={ref}
      className="m-dialog m-ivory"
      aria-labelledby="m-dialog-title"
      onCancel={(e) => {
        e.preventDefault() // Escape: the page decides, so that its state and the dialog agree
        onCancel()
      }}
      onClick={(e) => e.target === ref.current && onCancel()} // a click on the backdrop
    >
      <h2 id="m-dialog-title" className="mb-2 text-lg font-semibold">
        {title}
      </h2>
      <p className="mb-5 text-sm text-neutral-400">{body}</p>
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" className="m-btn" onClick={onCancel} autoFocus>
          Cancel
        </button>
        <button type="button" className={`m-btn ${danger ? 'm-btn-danger' : 'm-btn-primary'}`} onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    </dialog>
  )
}
