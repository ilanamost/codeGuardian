import { useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { ACCOUNT_TEXT } from '../lib/account.constants'
import {
  accountUpdateFieldErrorOf,
  accountUpdateMessageOf,
  hasFieldError,
  validateAccountUpdate,
  type AccountUpdateFieldError,
  type AccountUpdateInput
} from '../lib/sessionForm'
import type { AccountDto } from '../models/dto'
import { selectAccountState, updateAccount, updateErrorCleared } from '../store/account.slice'
import { useAppDispatch, useAppSelector } from '../store/hooks'
import PasswordField from './PasswordField'
import TextField from './TextField'

type Props = {
  account: AccountDto
  // The form closed: saved or cancelled.
  onDone: () => void
}

// Plan 034: the Account panel's Edit mode for the user name and email. Checked here with the
// registration rules first; Save sends PUT /api/account with the current password (Open
// Question 1). A taken name or email (409, one generic text), a wait (429) and the fields the
// server names (422, such as a wrong current password) are shown under the form; other failures
// are error toasts. The answer is the updated account, so the panel and the sidebar change at
// once.
// QA 034 F-A1: the first field takes the focus when the form opens; the panel gives it back to
// the Edit button when the form closes (Save or Cancel).
export default function AccountDetailsForm({ account, onDone }: Props) {
  const dispatch = useAppDispatch()
  const { updateStatus, updateError } = useAppSelector(selectAccountState)
  const [input, setInput] = useState<AccountUpdateInput>({ username: account.username, email: account.email, currentPassword: '' })
  const [fieldError, setFieldError] = useState<AccountUpdateFieldError>({})
  const saving = updateStatus === 'loading'
  const message = accountUpdateMessageOf(updateError)
  const serverField = accountUpdateFieldErrorOf(updateError).field

  function edit(field: keyof AccountUpdateInput) {
    return (value: string) => {
      setInput((current) => ({ ...current, [field]: value }))
      if (fieldError[field]) setFieldError((current) => ({ ...current, [field]: undefined }))
      if (updateError) dispatch(updateErrorCleared())
    }
  }

  function close() {
    dispatch(updateErrorCleared())
    onDone()
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (saving) return
    const error = validateAccountUpdate(input)
    setFieldError(error)
    if (hasFieldError(error)) return
    const result = await dispatch(updateAccount({ username: input.username.trim(), email: input.email.trim(), currentPassword: input.currentPassword }))
    if (updateAccount.fulfilled.match(result)) {
      toast.success(ACCOUNT_TEXT.detailsUpdated)
      close()
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate aria-label={ACCOUNT_TEXT.editHeading} className="flex max-w-md flex-col gap-4">
      <TextField
        label={ACCOUNT_TEXT.username}
        value={input.username}
        onChange={edit('username')}
        autoComplete="username"
        error={fieldError.username ?? serverField.username}
        autoFocus
      />
      <TextField
        label={ACCOUNT_TEXT.email}
        type="email"
        value={input.email}
        onChange={edit('email')}
        autoComplete="email"
        error={fieldError.email ?? serverField.email}
      />
      <div className="flex flex-col gap-1">
        <PasswordField
          label={ACCOUNT_TEXT.currentPassword}
          value={input.currentPassword}
          onChange={edit('currentPassword')}
          autoComplete="current-password"
          error={fieldError.currentPassword ?? serverField.currentPassword}
        />
        <p className="text-xs text-text-muted">{ACCOUNT_TEXT.currentPasswordHint}</p>
      </div>
      {message && (
        <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-error-text">
          {message}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <button
          type="submit"
          disabled={saving}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover disabled:opacity-60"
        >
          {saving ? ACCOUNT_TEXT.savingDetails : ACCOUNT_TEXT.saveDetails}
        </button>
        <button
          type="button"
          onClick={close}
          disabled={saving}
          className="rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-page-bg disabled:opacity-60"
        >
          {ACCOUNT_TEXT.cancelDetails}
        </button>
      </div>
    </form>
  )
}
