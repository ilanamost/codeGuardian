import { useId } from 'react'

type Props = {
  label: string
  value: string
  onChange: (value: string) => void
  type?: 'text' | 'email'
  autoComplete?: string
  // An error for this field, shown under it.
  error?: string
  // Focus the field when it appears (plan 034 QA F-A1: the Account edit form's first field).
  autoFocus?: boolean
}

// One labelled text input with its error, for the login and register forms.
export default function TextField({ label, value, onChange, type = 'text', autoComplete, error, autoFocus = false }: Props) {
  const id = useId()
  const errorId = `${id}-error`

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        autoCapitalize="none"
        spellCheck={false}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-md border border-input-border bg-surface px-3 py-2 text-base sm:text-sm outline-none focus:outline-2 focus:outline-primary"
      />
      {error && (
        <p id={errorId} role="alert" className="text-sm text-error-text">
          {error}
        </p>
      )}
    </div>
  )
}
