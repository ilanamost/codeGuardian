import { useState, type FormEvent } from 'react'
import { GitBranch } from 'lucide-react'
import { GITHUB_TEXT } from '../lib/github.constants'
import { initialsOf } from '../models/account.model'
import { githubDisplayNameOf, isGithubUsername } from '../models/github.model'
import type { GithubAccount } from '../types'
import { FORM_ERROR_MESSAGE } from '../utils/error-messages'

type Props = {
  account: GithubAccount | null
  // Connect is in progress (POST /api/github/connect and the first repository list).
  connecting?: boolean
  // Switch account is in progress (POST /api/github/disconnect).
  switching?: boolean
  // Plan 030: the card asks for a GitHub user name before Connect; this gets the trimmed,
  // checked user name.
  onConnect: (username: string) => void
  onSwitch: () => void
}

const inputId = 'github-username'
const errorId = 'github-username-error'
const hintId = 'github-username-hint'

// The same rule as the backend (contract GithubConnect); the backend checks again.
function usernameError(value: string): string | undefined {
  const text = value.trim()
  if (!text) return FORM_ERROR_MESSAGE.githubUsernameRequired
  return isGithubUsername(text) ? undefined : FORM_ERROR_MESSAGE.githubUsernameInvalid
}

const connectButtonClass =
  'shrink-0 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50'

export default function GithubConnectCard({ account, connecting = false, switching = false, onConnect, onSwitch }: Props) {
  const [username, setUsername] = useState('')
  const [error, setError] = useState<string | undefined>()

  function change(next: string) {
    setUsername(next)
    // Once shown, the field error follows the text, so it clears as soon as the name is fixed.
    if (error) setError(usernameError(next))
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (connecting) return
    const issue = usernameError(username)
    setError(issue)
    if (!issue) onConnect(username.trim())
  }

  const connectLabel = connecting ? GITHUB_TEXT.connecting : GITHUB_TEXT.connect

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border bg-card p-3">
      <div className="flex items-center gap-3">
        {account ? (
          <span
            aria-hidden="true"
            className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary-soft text-sm font-semibold text-primary"
          >
            {initialsOf(githubDisplayNameOf(account))}
          </span>
        ) : (
          <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-code-bg text-white">
            <GitBranch size={20} aria-hidden="true" />
          </span>
        )}
        <div className="min-w-0 flex-1 text-left">
          <p className="truncate text-sm font-semibold">{account ? githubDisplayNameOf(account) : 'GitHub'}</p>
          <p className="truncate text-xs text-text-muted">{account ? GITHUB_TEXT.connectedAs(account.login) : GITHUB_TEXT.notConnected}</p>
        </div>
        {account && (
          <button
            type="button"
            onClick={onSwitch}
            disabled={switching}
            className="text-xs font-medium text-primary hover:text-primary-hover disabled:opacity-60"
          >
            {GITHUB_TEXT.switchAccount}
          </button>
        )}
      </div>
      {!account && (
        <form noValidate onSubmit={submit} className="flex flex-col gap-2 xs:flex-row xs:items-start">
          <div className="min-w-0 flex-1">
            <label htmlFor={inputId} className="sr-only">
              {GITHUB_TEXT.usernameLabel}
            </label>
            <input
              id={inputId}
              type="text"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              value={username}
              placeholder={GITHUB_TEXT.usernamePlaceholder}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? `${errorId} ${hintId}` : hintId}
              onChange={(event) => change(event.target.value)}
              className="w-full rounded-md border border-input-border bg-surface px-3 py-1.5 text-sm outline-none focus:outline-2 focus:outline-primary aria-invalid:border-critical"
            />
            {error && (
              <p id={errorId} role="alert" className="mt-1 text-xs break-words text-critical">
                {error}
              </p>
            )}
            <p id={hintId} className="mt-1 text-xs text-text-muted">
              {GITHUB_TEXT.publicOnly}
            </p>
          </div>
          <button type="submit" disabled={connecting} className={connectButtonClass}>
            {connectLabel}
          </button>
        </form>
      )}
    </div>
  )
}
