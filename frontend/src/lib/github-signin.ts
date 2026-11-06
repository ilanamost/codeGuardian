import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { API_PATH } from './api.constants'
import { API_URL } from './config'
import { ROUTE_PATH } from './route.constants'
import { AUTH_ERROR_CODE_LIST, AUTH_ERROR_PARAM, type AuthErrorCode } from './session.constants'

// Plan 040: where the browser goes to start GitHub sign-in (a plain navigation to the backend,
// never fetch). `returnTo` is sent only for a page other than the home page; the backend
// validates it again.
export function githubSignInUrl(returnTo: string = ROUTE_PATH.home): string {
  const base = `${(API_URL ?? '').replace(/\/+$/, '')}${API_PATH.githubSignIn}`
  return returnTo === ROUTE_PATH.home ? base : `${base}?returnTo=${encodeURIComponent(returnTo)}`
}

// The code of an `auth_error` value; a value outside the closed list is a provider_error.
export function authErrorOf(value: string | null): AuthErrorCode | null {
  if (value === null) return null
  return (AUTH_ERROR_CODE_LIST as readonly string[]).includes(value) ? (value as AuthErrorCode) : 'provider_error'
}

// Reads `?auth_error=` once, keeps its code, and removes the parameter from the URL (any other
// parameter stays), so a refresh does not show the message again.
export function useAuthError(): AuthErrorCode | null {
  const [searchParams, setSearchParams] = useSearchParams()
  const raw = searchParams.get(AUTH_ERROR_PARAM)
  const [code, setCode] = useState<AuthErrorCode | null>(() => authErrorOf(raw))

  useEffect(() => {
    if (raw === null) return
    setCode(authErrorOf(raw))
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current)
        next.delete(AUTH_ERROR_PARAM)
        return next
      },
      { replace: true }
    )
  }, [raw, setSearchParams])

  return code
}
