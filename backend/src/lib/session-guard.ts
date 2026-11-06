import type { NextFunction, Request, RequestHandler, Response } from 'express'
import { unauthorizedError } from './error.js'
import type { SecurityLog } from './security-log.js'
import { readCookie, sessionCookieName, type CookieConfig } from './session.js'
import type { SessionService } from '../service/session.service.js'
import { LogLevel, SECURITY_LOG } from '../utils/constants.js'
import { ERROR_MESSAGE } from '../utils/error-messages.js'

// The central session middleware (plan 028, Scope 4). Every route needs a valid session except
// the public list; the guard resolves the cookie and puts the session's org on the request, so
// every route reads and writes only that org. Unknown paths need a session too (401 before 404).

export type SessionContext = {
  orgId: string
  idHash: string
  expiresAt: number
}

declare module 'express-serve-static-core' {
  interface Request {
    // Set by the session guard on every protected route.
    sessionContext?: SessionContext
  }
}

export type PublicRoute = { method: string, path: string }

const headMethod = 'HEAD'
const getMethod = 'GET'

// `/api/session/` is `/api/session`. Express also routes HEAD to GET handlers.
function isPublic(req: Request, publicList: readonly PublicRoute[]): boolean {
  const path = req.path.length > 1 && req.path.endsWith('/') ? req.path.slice(0, -1) : req.path
  const method = req.method === headMethod ? getMethod : req.method
  return publicList.some((route) => route.method === method && route.path === path)
}

export function readSessionId(req: Request, cookie: CookieConfig): string | undefined {
  return readCookie(req, sessionCookieName(cookie))
}

export function createSessionGuard(sessionService: SessionService, publicList: readonly PublicRoute[], cookie: CookieConfig, log: SecurityLog): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (isPublic(req, publicList)) {
      next()
      return
    }
    sessionService.resolve(readSessionId(req, cookie)).then((result) => {
      if (!result.ok) {
        log(LogLevel.Warn, { requestId: req.requestId, operation: SECURITY_LOG.operation.session, reason: result.reason })
        next(unauthorizedError(ERROR_MESSAGE.sessionRequired))
        return
      }
      req.sessionContext = { orgId: result.session.orgId, idHash: result.session.idHash, expiresAt: result.session.expiresAt }
      next()
    }, next)
  }
}

// The session's org; a protected route never runs without it, so a missing one is a 401.
export function orgOf(req: Request): string {
  const orgId = req.sessionContext?.orgId
  if (!orgId) throw unauthorizedError(ERROR_MESSAGE.sessionRequired)
  return orgId
}

export function sessionOf(req: Request): SessionContext {
  if (!req.sessionContext) throw unauthorizedError(ERROR_MESSAGE.sessionRequired)
  return req.sessionContext
}

// The client IP for the rate limits (one backend, no proxy: the socket address).
export function clientIpOf(req: Request): string {
  return req.ip ?? req.socket.remoteAddress ?? ''
}
