import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { toast } from 'sonner'
import { Camera, Link2, Pencil, Trash2, Unlink } from 'lucide-react'
import { AUTH_ERROR_TEXT } from '../lib/session.constants'
import { ACCOUNT_TEXT, type AvatarType } from '../lib/account.constants'
import { checkAvatarFile, readBytes, toDataUrl } from '../lib/avatarFile'
import { useAccount } from '../lib/useAccount'
import { signInMethodOf } from '../models/account.model'
import { avatarRefusal, linkGithub, removeAvatar, selectAccountState, unlinkGithub, uploadAvatar } from '../store/account.slice'
import { useAppDispatch, useAppSelector } from '../store/hooks'
import { errorReported } from '../store/listener'
import { fetchGithubSignIn, selectGithubSignIn } from '../store/session.slice'
import { useAuthError } from '../lib/github-signin'
import { PAGE_ERROR_MESSAGE } from '../utils/error-messages'
import AccountDetailsForm from './AccountDetailsForm'
import Loader from './Loader'
import ProfilePhoto from './ProfilePhoto'

interface Preview {
  file: Blob
  type: AvatarType
  src: string
}

// The account's data (full name, user name, email, member since) and the profile photo (plan
// 028): a picked file is checked like on the server (PNG, JPEG or WebP by its magic bytes, at
// most 2 MB) and previewed; Save photo uploads it, and the sidebar shows it at once.
export default function AccountPanel() {
  const dispatch = useAppDispatch()
  const { account, status } = useAccount()
  const { avatarStatus, githubStatus } = useAppSelector(selectAccountState)
  const githubAvailable = useAppSelector(selectGithubSignIn)
  // Plan 040: a failed link comes back as /settings?section=account&auth_error=<code>.
  const authError = useAuthError()
  const inputRef = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  // Plan 034: the user name and email Edit mode (AccountDetailsForm).
  const [editing, setEditing] = useState(false)
  // QA 034 F-A1: when the form closes (Save or Cancel) the focus goes back to the Edit button.
  const editButtonRef = useRef<HTMLButtonElement>(null)
  const returnFocus = useRef(false)
  useEffect(() => {
    if (editing || !returnFocus.current) return
    returnFocus.current = false
    editButtonRef.current?.focus()
  }, [editing])
  const busy = avatarStatus === 'loading'
  const githubBusy = githubStatus === 'loading'

  useEffect(() => {
    dispatch(fetchGithubSignIn())
  }, [dispatch])

  if (!account) {
    return (
      <div className="flex flex-col gap-5">
        <h2 className="text-lg font-semibold">{ACCOUNT_TEXT.heading}</h2>
        {status === 'failed' ? (
          <p role="status" className="text-sm text-text-muted">
            {PAGE_ERROR_MESSAGE.accountUnavailable}
          </p>
        ) : (
          <Loader label={ACCOUNT_TEXT.loading} align="start" className="py-2" />
        )}
      </div>
    )
  }

  async function handlePick(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    // The same file can be picked again after a refusal or a cancel.
    event.target.value = ''
    if (!file) return
    const check = await checkAvatarFile(file)
    if (!check.ok) {
      dispatch(errorReported(avatarRefusal(check.reason)))
      return
    }
    setPreview({ file, type: check.type, src: toDataUrl(await readBytes(file), check.type) })
  }

  const method = signInMethodOf(account)
  const githubLogin = account.githubLogin ?? null

  async function handleSave() {
    if (!preview) return
    const result = await dispatch(uploadAvatar({ file: preview.file, contentType: preview.type }))
    if (uploadAvatar.fulfilled.match(result)) {
      setPreview(null)
      toast.success(ACCOUNT_TEXT.photoUpdated)
    }
  }

  async function handleLinkGithub() {
    const result = await dispatch(linkGithub())
    // The browser leaves for GitHub; the callback brings it back to this page.
    if (linkGithub.fulfilled.match(result)) window.location.assign(result.payload)
  }

  async function handleUnlinkGithub() {
    const result = await dispatch(unlinkGithub())
    if (unlinkGithub.fulfilled.match(result)) toast.success(ACCOUNT_TEXT.githubUnlinked)
  }

  async function handleRemove() {
    const result = await dispatch(removeAvatar())
    if (removeAvatar.fulfilled.match(result)) toast.success(ACCOUNT_TEXT.photoRemoved)
  }

  const buttonClass =
    'inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-page-bg disabled:opacity-60'

  return (
    <div className="flex flex-col gap-5">
      <h2 className="text-lg font-semibold">{ACCOUNT_TEXT.heading}</h2>
      {authError && (
        <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-error-text">
          {AUTH_ERROR_TEXT[authError]}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-4">
        <ProfilePhoto
          account={account}
          size="large"
          previewSrc={preview?.src}
          alt={preview ? ACCOUNT_TEXT.photoPreview : ACCOUNT_TEXT.profileImage}
        />
        <div className="flex min-w-0 flex-col gap-2">
          <p className="text-base font-semibold">{account.fullName}</p>
          <input
            ref={inputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            aria-label={account.avatarUrl ? ACCOUNT_TEXT.changePhoto : ACCOUNT_TEXT.uploadPhoto}
            onChange={handlePick}
            className="hidden"
          />
          {preview ? (
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={handleSave} disabled={busy} className={`${buttonClass} border-primary bg-primary text-white hover:bg-primary-hover`}>
                {busy ? ACCOUNT_TEXT.savingPhoto : ACCOUNT_TEXT.savePhoto}
              </button>
              <button type="button" onClick={() => setPreview(null)} disabled={busy} className={buttonClass}>
                {ACCOUNT_TEXT.cancelPhoto}
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => inputRef.current?.click()} disabled={busy} className={buttonClass}>
                <Camera size={16} aria-hidden="true" />
                {account.avatarUrl ? ACCOUNT_TEXT.changePhoto : ACCOUNT_TEXT.uploadPhoto}
              </button>
              {account.avatarUrl && (
                <button type="button" onClick={handleRemove} disabled={busy} className={buttonClass}>
                  <Trash2 size={16} aria-hidden="true" />
                  {ACCOUNT_TEXT.removePhoto}
                </button>
              )}
            </div>
          )}
          <p className="text-xs text-text-muted">{ACCOUNT_TEXT.photoHint}</p>
        </div>
      </div>
      {editing ? (
        <AccountDetailsForm
          account={account}
          onDone={() => {
            returnFocus.current = true
            setEditing(false)
          }}
        />
      ) : (
        <div className="flex flex-col gap-3">
          <dl className="grid gap-4 xs:grid-cols-2">
            <div>
              <dt className="text-xs text-text-muted">{ACCOUNT_TEXT.username}</dt>
              <dd data-testid="account-username" className="break-all text-sm">
                {account.username}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-text-muted">{ACCOUNT_TEXT.email}</dt>
              <dd data-testid="account-email" className="break-all text-sm">
                {account.email}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-text-muted">{ACCOUNT_TEXT.memberSince}</dt>
              <dd className="text-sm">{account.memberSince}</dd>
            </div>
          </dl>
          {method === 'github' ? (
            <p className="text-xs text-text-muted">{ACCOUNT_TEXT.githubNoEdit}</p>
          ) : (
            <button ref={editButtonRef} type="button" onClick={() => setEditing(true)} aria-label={ACCOUNT_TEXT.editDetailsLabel} className={`${buttonClass} self-start`}>
              <Pencil size={16} aria-hidden="true" />
              {ACCOUNT_TEXT.editDetails}
            </button>
          )}
        </div>
      )}
      {(githubLogin || githubAvailable) && (
        <section aria-label={ACCOUNT_TEXT.githubHeading} className="flex flex-col gap-2 border-t border-border pt-5">
          <h3 className="text-sm font-semibold">{ACCOUNT_TEXT.githubHeading}</h3>
          <p data-testid="github-sign-in-state" className="break-all text-sm">
            {githubLogin ? ACCOUNT_TEXT.githubConnectedAs(githubLogin) : ACCOUNT_TEXT.githubNotConnected}
          </p>
          {githubLogin ? (
            <>
              <button type="button" onClick={handleUnlinkGithub} disabled={githubBusy || method === 'github'} className={`${buttonClass} self-start`}>
                <Unlink size={16} aria-hidden="true" />
                {githubBusy ? ACCOUNT_TEXT.githubUnlinking : ACCOUNT_TEXT.githubUnlink}
              </button>
              {method === 'github' && <p className="text-xs text-text-muted">{ACCOUNT_TEXT.githubOnlyHint}</p>}
            </>
          ) : (
            <button type="button" onClick={handleLinkGithub} disabled={githubBusy} className={`${buttonClass} self-start`}>
              <Link2 size={16} aria-hidden="true" />
              {githubBusy ? ACCOUNT_TEXT.githubLinking : ACCOUNT_TEXT.githubLink}
            </button>
          )}
        </section>
      )}
    </div>
  )
}
