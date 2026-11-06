import { useId, useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'

type Props = {
  label: string
  value: string
  onChange?: (value: string) => void
  readOnly?: boolean
  autoComplete?: string
  // An error for this field (for example from the server), shown under it.
  error?: string
  // The id of a hint that describes the field (for example the password checklist).
  describedBy?: string
}

export default function PasswordField({ label, value, onChange, readOnly = false, autoComplete, error, describedBy }: Props) {
  const id = useId()
  const errorId = `${id}-error`
  const description = [error ? errorId : undefined, describedBy].filter(Boolean).join(' ') || undefined
  const [visible, setVisible] = useState(false)
  // Plan 029 revision 2: the field starts empty. Browsers do not autofill a read-only field, so it
  // stays read-only until the user touches or focuses it; a saved password (possibly another
  // account's) is then only offered, never filled in on load. The pointer handler runs before the
  // focus, so a tap on a phone still opens the keyboard.
  const [touched, setTouched] = useState(false)
  const arm = () => setTouched(true)
  const Icon = visible ? EyeOff : Eye

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <div className="flex items-center rounded-md border border-input-border bg-surface focus-within:outline-2 focus-within:outline-primary">
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          value={value}
          readOnly={readOnly || !touched}
          onPointerDown={arm}
          onFocus={arm}
          autoComplete={autoComplete}
          aria-invalid={error ? true : undefined}
          aria-describedby={description}
          onChange={(event) => onChange?.(event.target.value)}
          className="min-w-0 flex-1 bg-transparent px-3 py-2 text-sm outline-none"
        />
        <button
          type="button"
          aria-label={`${visible ? 'Hide' : 'Show'} ${label.toLowerCase()}`}
          aria-pressed={visible}
          onClick={() => setVisible((current) => !current)}
          className="px-3 py-2 text-text-muted hover:text-text"
        >
          <Icon size={18} aria-hidden="true" />
        </button>
      </div>
      {error && (
        <p id={errorId} role="alert" className="text-sm text-error-text">
          {error}
        </p>
      )}
    </div>
  )
}
