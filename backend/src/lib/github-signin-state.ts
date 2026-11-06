import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import type { Request, Response } from 'express'
import { readCookie, type CookieConfig } from './session.js'
import { GITHUB_SIGNIN, PATTERN, SESSION } from '../utils/constants.js'

// The `state` and the PKCE verifier of one GitHub sign-in round trip (plan 040). Both are random
// (32 bytes), live only in a short-lived, HttpOnly cookie (SameSite=Lax unless COOKIE_SAMESITE says otherwise, plan 042) of the browser that
// started the round trip, and are single use: the callback deletes the cookie whatever the
// outcome. Nothing is kept on the server, so there is no state table to fill or sweep.

export enum SignInMode {
  // A sign-in or a sign-up: the callback ends in a new session.
  SignIn = 'signin',
  // Linking GitHub to the account that is signed in: the account comes from the session cookie
  // at the callback, never from this cookie.
  Link = 'link'
}

export type SignInState = {
  state: string
  verifier: string
  mode: SignInMode
  // A validated relative app path, or undefined.
  returnTo?: string
}

export type NewSignIn = { cookieValue: string, state: string, challenge: string }

function randomText(): string {
  return randomBytes(GITHUB_SIGNIN.randomByteLength).toString(GITHUB_SIGNIN.randomEncoding)
}

// S256: base64url(SHA-256(verifier)), no padding.
export function challengeOf(verifier: string): string {
  return createHash('sha256').update(verifier).digest(GITHUB_SIGNIN.randomEncoding)
}

// Only a relative app path is accepted: exactly one leading slash, no backslash, no white space
// or control character, and it must still resolve inside the app's own origin. Anything else is
// dropped (the user lands on the default page), so this can never be an open redirect.
export function safeReturnTo(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length === 0 || value.length > GITHUB_SIGNIN.returnToMax) return undefined
  if (!value.startsWith('/') || value.startsWith('//')) return undefined
  if (value.includes('\\') || /\s/.test(value) || PATTERN.controlOrLineSeparator.test(value)) return undefined
  // Printable ASCII only: the value ends up in a `Location` header, which Node rejects for any
  // other character (a 500 at the callback after a good sign-in).
  if (!PATTERN.printableAscii.test(value)) return undefined
  const base = 'http://app.invalid'
  if (!URL.canParse(value, base) || new URL(value, base).origin !== base) return undefined
  return value
}

export function newSignIn(mode: SignInMode, returnTo: string | undefined): NewSignIn {
  const state = randomText()
  const verifier = randomText()
  const payload: Record<string, string> = { s: state, v: verifier, m: mode }
  if (returnTo !== undefined) payload.r = returnTo
  return {
    cookieValue: Buffer.from(JSON.stringify(payload), 'utf8').toString(GITHUB_SIGNIN.randomEncoding),
    state,
    challenge: challengeOf(verifier)
  }
}

// The cookie back into its parts, or undefined when it is missing or not exactly what
// `newSignIn` makes. `returnTo` is checked again here.
export function parseSignInState(cookieValue: string | undefined): SignInState | undefined {
  if (!cookieValue || cookieValue.length > GITHUB_SIGNIN.returnToMax * 3) return undefined
  try {
    const payload = JSON.parse(Buffer.from(cookieValue, GITHUB_SIGNIN.randomEncoding).toString('utf8')) as Record<string, unknown>
    const { s, v, m, r } = payload
    if (typeof s !== 'string' || typeof v !== 'string' || !GITHUB_SIGNIN.randomPattern.test(s) || !GITHUB_SIGNIN.randomPattern.test(v)) return undefined
    if (m !== SignInMode.SignIn && m !== SignInMode.Link) return undefined
    return { state: s, verifier: v, mode: m, returnTo: safeReturnTo(r) }
  } catch {
    return undefined
  }
}

// Constant time: both sides are hashed first, so the comparison length never depends on input.
export function stateMatches(expected: string, given: string | undefined): boolean {
  if (given === undefined) return false
  const a = createHash('sha256').update(expected).digest()
  const b = createHash('sha256').update(given).digest()
  return timingSafeEqual(a, b)
}

export function stateCookieName(config: CookieConfig): string {
  return config.production ? `${SESSION.productionCookiePrefix}${GITHUB_SIGNIN.stateCookieName}` : GITHUB_SIGNIN.stateCookieName
}

export function readStateCookie(req: Request, config: CookieConfig): string | undefined {
  return readCookie(req, stateCookieName(config))
}

function cookieOption(config: CookieConfig, maxAgeMs: number) {
  return { httpOnly: true, sameSite: config.sameSite ?? SESSION.sameSite, path: SESSION.cookiePath, secure: config.production, maxAge: maxAgeMs } as const
}

export function setStateCookie(res: Response, config: CookieConfig, value: string): void {
  res.cookie(stateCookieName(config), value, cookieOption(config, GITHUB_SIGNIN.stateMaxAgeMs))
}

export function clearStateCookie(res: Response, config: CookieConfig): void {
  res.cookie(stateCookieName(config), '', cookieOption(config, 0))
}
