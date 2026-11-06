import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { LogOut } from 'lucide-react'
import { PASSWORD_FIELD, SECURITY_TEXT } from '../lib/account.constants'
import { signInMethodOf } from '../models/account.model'
import { passwordRuleError } from '../lib/password-rule'
import { ROUTE_PATH } from '../lib/route.constants'
import { useAccount } from '../lib/useAccount'
import { changePassword, passwordErrorCleared, selectAccountState } from '../store/account.slice'
import { useAppDispatch, useAppSelector } from '../store/hooks'
import { selectSession, signOut } from '../store/session.slice'
import { FIELD_ERROR_MESSAGE, FORM_ERROR_MESSAGE } from '../utils/error-messages'
import ConfirmDialog from './ConfirmDialog'
import PasswordField from './PasswordField'

// Update password sends PUT /api/account/password; the new password follows the password rules
// (plan 028) before it is sent. A rejected field (422 `details.issue[]`, such as a wrong current
// password) is shown under that field; other failures are error toasts. With the real backend
// the other sessions end and this one's cookie is rotated by the server.
// Sign Out asks first, then sends DELETE /api/session; the store resets and the app goes to /login.
export default function SecurityPanel() {
  const dispatch = useAppDispatch()
  const navigate = useNavigate()
  // The user name and email the password rules compare with (a background load).
  const { account } = useAccount({ silent: true })
  const { passwordStatus, passwordError } = useAppSelector(selectAccountState)
  const { signOutStatus } = useAppSelector(selectSession)
  const [editing, setEditing] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [confirming, setConfirming] = useState(false)
  const saving = passwordStatus === 'loading'
  // Plan 040: a GitHub-only account has no password, so there is nothing to change.
  const hasPassword = !account || signInMethodOf(account) !== 'github'
  const signingOut = signOutStatus === 'loading'

  const fieldError = (field: string) => {
    const issue = passwordError?.issueList?.find((item) => item.field === field)
    return issue ? FIELD_ERROR_MESSAGE[issue.field] : undefined
  }

  function edit(setValue: (value: string) => void) {
    return (value: string) => {
      setValue(value)
      if (passwordError) dispatch(passwordErrorCleared())
    }
  }

  function close() {
    setEditing(false)
    setCurrentPassword('')
    setNewPassword('')
    setConfirmPassword('')
    setError('')
    dispatch(passwordErrorCleared())
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!currentPassword) {
      setError(FORM_ERROR_MESSAGE.currentPasswordRequired)
      return
    }
    const ruleError = passwordRuleError(newPassword, { username: account?.username ?? '', email: account?.email ?? '' })
    if (ruleError) {
      setError(ruleError)
      return
    }
    if (newPassword !== confirmPassword) {
      setError(FORM_ERROR_MESSAGE.passwordMismatch)
      return
    }
    setError('')
    const result = await dispatch(changePassword({ currentPassword, newPassword }))
    if (changePassword.fulfilled.match(result)) {
      toast.success(SECURITY_TEXT.passwordUpdated)
      close()
    }
  }

  async function handleSignOut() {
    const result = await dispatch(signOut())
    setConfirming(false)
    if (signOut.fulfilled.match(result)) {
      navigate(ROUTE_PATH.login, { replace: true })
      toast.success(SECURITY_TEXT.signedOut)
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <h2 className="text-lg font-semibold">{SECURITY_TEXT.heading}</h2>
      <div className="flex max-w-md flex-col gap-4">
        {!hasPassword && <p className="text-sm text-text-muted">{SECURITY_TEXT.githubOnly}</p>}
        {hasPassword && !editing && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="self-start rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover"
          >
            {SECURITY_TEXT.updatePassword}
          </button>
        )}
        {hasPassword && editing && (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
            {/* Plan 029 revision 2: names the signed-in account for password managers, so a saved
                password is offered (and updated) for this account and not for another one. */}
            <input type="text" name="username" autoComplete="username" value={account?.username ?? ''} readOnly hidden />
            <PasswordField
              label={SECURITY_TEXT.currentPassword}
              value={currentPassword}
              onChange={edit(setCurrentPassword)}
              autoComplete="current-password"
              error={fieldError(PASSWORD_FIELD.current)}
            />
            <PasswordField
              label={SECURITY_TEXT.newPassword}
              value={newPassword}
              onChange={edit(setNewPassword)}
              autoComplete="new-password"
              error={fieldError(PASSWORD_FIELD.new)}
            />
            <PasswordField
              label={SECURITY_TEXT.confirmPassword}
              value={confirmPassword}
              onChange={edit(setConfirmPassword)}
              autoComplete="new-password"
            />
            {error && (
              <p role="alert" className="text-sm text-error-text">
                {error}
              </p>
            )}
            <div className="flex gap-3">
              <button
                type="submit"
                disabled={saving}
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover disabled:opacity-60"
              >
                {saving ? SECURITY_TEXT.savingPassword : SECURITY_TEXT.savePassword}
              </button>
              <button
                type="button"
                onClick={close}
                className="rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-page-bg"
              >
                {SECURITY_TEXT.cancel}
              </button>
            </div>
          </form>
        )}
      </div>
      <div className="border-t border-border pt-5">
        <button
          type="button"
          onClick={() => setConfirming(true)}
          disabled={signingOut}
          className="inline-flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm font-medium text-danger hover:bg-page-bg disabled:opacity-60"
        >
          <LogOut size={16} aria-hidden="true" />
          {signingOut ? SECURITY_TEXT.signingOut : SECURITY_TEXT.signOut}
        </button>
      </div>
      <ConfirmDialog
        open={confirming}
        title={SECURITY_TEXT.signOutTitle}
        detail={SECURITY_TEXT.signOutDetail}
        confirmLabel={SECURITY_TEXT.signOutConfirm}
        cancelLabel={SECURITY_TEXT.cancel}
        pending={signingOut}
        pendingLabel={SECURITY_TEXT.signingOut}
        onConfirm={handleSignOut}
        onCancel={() => setConfirming(false)}
      />
    </div>
  )
}
