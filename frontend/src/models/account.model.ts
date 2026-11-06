import type { AccountDto, SessionDto, SignInMethod } from './dto'
import { hasFields, isOneOf, isOptional, isRecord, isString, type Guard } from './guard'

const isNullableString = (value: unknown) => value === null || isString(value)

const isSignInMethod = isOneOf<SignInMethod>(['password', 'github', 'both'])

export const isAccountDto: Guard<AccountDto> = (value): value is AccountDto =>
  hasFields(value, {
    username: isString,
    fullName: isString,
    email: isString,
    avatarUrl: isNullableString,
    memberSince: isString,
    signInMethod: isOptional(isSignInMethod),
    githubLogin: isOptional(isNullableString)
  })

// GET /api/health `githubOAuth`: only `true` turns GitHub sign-in on.
export function githubOAuthOf(value: unknown): boolean {
  return isRecord(value) && value.githubOAuth === true
}

// How the account signs in; a payload without the field is a password account (contract 0.15.0).
export function signInMethodOf(account: Pick<AccountDto, 'signInMethod'>): SignInMethod {
  return account.signInMethod ?? 'password'
}

export const isSessionDto: Guard<SessionDto> = (value): value is SessionDto =>
  hasFields(value, { account: isAccountDto, expiresAt: isString })

// Up to two capital letters from the first and last word of the name ("John Doe" -> "JD").
export function initialsOf(fullName: string): string {
  const wordList = fullName.trim().split(/\s+/).filter(Boolean)
  if (wordList.length === 0) return ''
  const first = wordList[0]
  const last = wordList.length > 1 ? wordList[wordList.length - 1] : ''
  return `${first[0] ?? ''}${last[0] ?? ''}`.toUpperCase()
}

// The backend's photo path (`/api/account/avatar`, optionally with a query such as `?v=<digest>`).
export function isAvatarPath(avatarUrl: string): boolean {
  return /^\/api\/account\/avatar(\?|$)/.test(avatarUrl)
}

// The `src` of the profile photo: the backend sends a relative API path, which is resolved
// against the API base URL; a data URL (the preview) is used as it is. Any other value (a foreign
// or script URL) is never used, so the UI shows the initials instead.
export function avatarSrcOf(avatarUrl: string | null, apiBaseUrl: string | undefined): string | null {
  if (!avatarUrl) return null
  if (isAvatarPath(avatarUrl)) return `${(apiBaseUrl ?? '').replace(/\/+$/, '')}${avatarUrl}`
  if (/^data:image\/(png|jpeg|webp);base64,/.test(avatarUrl)) return avatarUrl
  return null
}
