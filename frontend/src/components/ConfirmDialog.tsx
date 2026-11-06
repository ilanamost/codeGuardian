import { useEffect, useId, useRef, type KeyboardEvent } from 'react'

type Props = {
  open: boolean
  title: string
  detail?: string
  confirmLabel: string
  cancelLabel: string
  // While the confirmed action runs: both buttons are disabled and the dialog stays open.
  pending?: boolean
  pendingLabel?: string
  onConfirm: () => void
  onCancel: () => void
}

const focusableSelector = 'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])'

// A modal confirmation (plan 028, the Sign Out dialog): `role="dialog"` with `aria-modal`, focus
// moved to Cancel when it opens and back to the element that opened it when it closes; Escape
// and Cancel close it, and Tab stays inside it.
export default function ConfirmDialog({ open, title, detail, confirmLabel, cancelLabel, pending = false, pendingLabel, onConfirm, onCancel }: Props) {
  const titleId = useId()
  const detailId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    cancelRef.current?.focus()
    return () => {
      if (opener?.isConnected) opener.focus()
    }
  }, [open])

  if (!open) return null

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.stopPropagation()
      if (!pending) onCancel()
      return
    }
    if (event.key !== 'Tab' || !dialogRef.current) return
    const list = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(focusableSelector))
    if (list.length === 0) return
    const first = list[0]
    const last = list[list.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={detail ? detailId : undefined}
        onKeyDown={handleKeyDown}
        className="flex w-full max-w-sm flex-col gap-4 rounded-md border border-border bg-card p-5 text-text shadow-card"
      >
        <h2 id={titleId} className="text-lg font-semibold">
          {title}
        </h2>
        {detail && (
          <p id={detailId} className="text-sm text-text-muted">
            {detail}
          </p>
        )}
        <div className="flex justify-end gap-3">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-page-bg disabled:opacity-60"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={pending}
            className="rounded-md bg-danger px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
          >
            {pending && pendingLabel ? pendingLabel : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
