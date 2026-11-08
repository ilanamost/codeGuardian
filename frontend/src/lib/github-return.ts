import { AUTH_CODE_PARAM, AUTH_CODE_PATTERN, GITHUB_EXCHANGE_TIMEOUT_MS } from './api.constants'
import { ROUTER_BASENAME } from './basePath'
import { ROUTE_PATH } from './route.constants'
import { AUTH_ERROR_PARAM } from './session.constants'

// Plan 048 (contract 0.19.0): the return from "Continue with GitHub" when the session cookie may
// have been dropped (Safari, a different site for the API). The backend redirects to
// <app><path>#auth_code=<one-time code>. Before the router renders anything, the code is read and
// removed from the address bar and the history entry, then swapped for a session token (the
// data source keeps it only when the cookie did not stick, plan 047). The code and the token are
// never put in state, a toast, a log or a URL.

// Reads `auth_code` from the URL fragment and removes it with history.replaceState (the path,
// the query and any other fragment content stay). A value that is not 43 URL-safe characters is
// removed too, and read as no code. Without an `auth_code` the URL is not touched.
export function takeAuthCode(): string | undefined {
  const hash = window.location.hash.replace(/^#/, '')
  if (!hash) return undefined
  const part = hash.split('&')
  const isCode = (item: string) => item === AUTH_CODE_PARAM || item.startsWith(`${AUTH_CODE_PARAM}=`)
  const found = part.filter(isCode)
  if (found.length === 0) return undefined

  const rest = part.filter((item) => !isCode(item)).join('&')
  const { pathname, search } = window.location
  window.history.replaceState(window.history.state, '', `${pathname}${search}${rest ? `#${rest}` : ''}`)

  for (const item of found) {
    const value = item.slice(AUTH_CODE_PARAM.length + 1)
    if (AUTH_CODE_PATTERN.test(value)) return value
  }
  return undefined
}

// What the exchange needs from the session service.
export interface CodeExchanger {
  exchangeGithubCode(code: string, signal?: AbortSignal): Promise<void>
}

// A failed exchange (a used or expired code, the switch off, a network failure): the login page
// with the existing `invalid_state` message, through the same `?auth_error=` it already reads.
function showLoginFailure() {
  const base = ROUTER_BASENAME === '/' ? '' : ROUTER_BASENAME
  window.history.replaceState(window.history.state, '', `${base}${ROUTE_PATH.login}?${AUTH_ERROR_PARAM}=invalid_state`)
}

// Runs at app start, before the router. Resolves once the token is settled; never throws.
export async function completeGithubReturn(session: CodeExchanger): Promise<void> {
  const code = takeAuthCode()
  if (!code) return
  // The exchange is bounded: on timeout the request is aborted (a late answer stores nothing) and
  // the app renders on the login failure address. The code is never retried.
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), GITHUB_EXCHANGE_TIMEOUT_MS)
  const timedOut = new Promise<never>((_, reject) => controller.signal.addEventListener('abort', () => reject(new Error('timeout')), { once: true }))
  try {
    await Promise.race([session.exchangeGithubCode(code, controller.signal), timedOut])
  } catch {
    showLoginFailure()
  } finally {
    clearTimeout(timer)
  }
}
