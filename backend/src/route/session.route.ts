import { Router } from 'express'
import { accountOf, type AccountService } from '../service/account.service.js'
import { asyncHandler } from '../lib/async-handler.js'
import { unauthorizedError } from '../lib/error.js'
import { clientIpOf, readSessionId, sessionOf } from '../lib/session-guard.js'
import { clearSessionCookie, setSessionCookie, type CookieConfig } from '../lib/session.js'
import type { SecurityLog } from '../lib/security-log.js'
import { parse } from '../lib/validate.js'
import { signInSchema } from '../schema/session.schema.js'
import type { SessionService } from '../service/session.service.js'
import { LogLevel, ROUTE, SECURITY_LOG } from '../utils/constants.js'
import { ERROR_MESSAGE, SUBJECT } from '../utils/error-messages.js'
import { HttpStatus } from '../utils/http-status.js'

// /api/session (plan 028, Scope 3): sign in, session restore and sign out.
export function createSessionRouter(service: SessionService, accountService: AccountService, cookie: CookieConfig, log: SecurityLog): Router {
  const router = Router()

  // Public. The same 401 for an unknown user name and a wrong password.
  router.post(ROUTE.root, asyncHandler(async (req, res) => {
    const input = parse(signInSchema, req.body, SUBJECT.signIn)
    const { account, started } = await service.signIn(input, readSessionId(req, cookie), { requestId: req.requestId, ip: clientIpOf(req) })
    setSessionCookie(res, cookie, started.id, started.maxAgeMs)
    res.json(accountOf(account))
  }))

  // Public, so the guard does not answer it: it resolves the cookie itself and never creates a
  // session. The idle expiry rolls like on any other request.
  router.get(ROUTE.root, asyncHandler(async (req, res) => {
    const result = await service.resolve(readSessionId(req, cookie))
    if (!result.ok) {
      log(LogLevel.Warn, { requestId: req.requestId, operation: SECURITY_LOG.operation.session, reason: result.reason })
      throw unauthorizedError(ERROR_MESSAGE.sessionRequired)
    }
    const account = await accountService.get(result.session.orgId)
    res.json({ account, expiresAt: new Date(result.session.expiresAt).toISOString() })
  }))

  // Protected by the guard: deletes this session and clears the cookie.
  router.delete(ROUTE.root, asyncHandler(async (req, res) => {
    const session = sessionOf(req)
    await service.signOut(session.idHash, session.orgId, req.requestId)
    clearSessionCookie(res, cookie)
    res.status(HttpStatus.NoContent).end()
  }))

  return router
}
