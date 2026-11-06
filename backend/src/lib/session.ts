import { createHash, randomBytes } from 'node:crypto'
import type { CookieOptions, Request, Response } from 'express'
import { type CookieSameSite, HEADER, SESSION } from '../utils/constants.js'

// Session ids and the session cookie (plan 028, Scope 1). The id is 32 random bytes in
// base64url; only its SHA-256 hash is stored, so a leaked database row cannot be replayed. The
// id, its hash and the cookie header are never logged.

export type CookieConfig = {
  // NODE_ENV=production: Secure, and the `__Host-` name prefix.
  production: boolean
  // Plan 042: SameSite of the cookies; lax when absent.
  sameSite?: CookieSameSite
}

export function sessionCookieName(config: CookieConfig): string {
  return config.production ? `${SESSION.productionCookiePrefix}${SESSION.cookieName}` : SESSION.cookieName
}

export function createSessionId(): string {
  return randomBytes(SESSION.idByteLength).toString(SESSION.idEncoding)
}

export function hashSessionId(id: string): string {
  return createHash(SESSION.hashAlgorithm).update(id).digest(SESSION.hashEncoding)
}

export function isSessionIdFormat(value: string): boolean {
  return SESSION.idPattern.test(value)
}

// The value of one cookie from the Cookie header, or undefined. No dependency: the header is
// `name=value; name2=value2`. A repeated name keeps the first value, as browsers send the most
// specific one first.
export function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers[HEADER.cookie]
  if (typeof header !== 'string') return undefined
  for (const part of header.split(';')) {
    const separator = part.indexOf('=')
    if (separator < 0) continue
    if (part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim()
  }
  return undefined
}

function cookieOption(config: CookieConfig, maxAgeMs: number): CookieOptions {
  return {
    httpOnly: true,
    sameSite: config.sameSite ?? SESSION.sameSite,
    path: SESSION.cookiePath,
    secure: config.production,
    maxAge: maxAgeMs
  }
}

// `Max-Age` is the time left until the absolute expiry; the idle expiry is enforced by the server.
export function setSessionCookie(res: Response, config: CookieConfig, id: string, maxAgeMs: number): void {
  res.cookie(sessionCookieName(config), id, cookieOption(config, maxAgeMs))
}

// An empty value with Max-Age=0, so the browser drops the cookie at once.
export function clearSessionCookie(res: Response, config: CookieConfig): void {
  res.cookie(sessionCookieName(config), '', cookieOption(config, 0))
}
