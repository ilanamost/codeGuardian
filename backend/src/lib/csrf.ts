import type { NextFunction, Request, RequestHandler, Response } from 'express'
import { forbiddenError } from './error.js'
import type { SecurityLog } from './security-log.js'
import { HEADER, LogLevel, SECURITY_LOG, SESSION, STATE_CHANGING_METHOD_LIST } from '../utils/constants.js'
import { ERROR_MESSAGE } from '../utils/error-messages.js'

// CSRF protection without a token store (plan 028, Scope 6). The session cookie is
// SameSite=Lax, and every state-changing request (public ones too) must carry the custom header
// `X-CSRF-Protection: 1`. A custom header is not a "simple" header, so a cross-site page cannot
// send it without a CORS preflight, and only FRONTEND_URL passes the preflight. When the
// browser sends an `Origin`, it must also be exactly FRONTEND_URL's origin. Otherwise 403
// `forbidden`, before the body is read or anything changes.
export function createCsrfGuard(frontendOrigin: string, log: SecurityLog): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!STATE_CHANGING_METHOD_LIST.includes(req.method)) {
      next()
      return
    }
    if (req.get(HEADER.csrf) !== SESSION.csrfValue) {
      log(LogLevel.Warn, { requestId: req.requestId, operation: SECURITY_LOG.operation.csrf, reason: SECURITY_LOG.reason.csrfHeader })
      next(forbiddenError(ERROR_MESSAGE.csrfHeaderMissing))
      return
    }
    const origin = req.get(HEADER.origin)
    if (origin !== undefined && origin !== frontendOrigin) {
      log(LogLevel.Warn, { requestId: req.requestId, operation: SECURITY_LOG.operation.csrf, reason: SECURITY_LOG.reason.foreignOrigin })
      next(forbiddenError(ERROR_MESSAGE.originRefused))
      return
    }
    next()
  }
}
