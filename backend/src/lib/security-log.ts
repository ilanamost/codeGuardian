import { createHash } from 'node:crypto'
import { LogLevel, SECURITY_LOG, SESSION } from '../utils/constants.js'

// Structured security log lines (plan 028, Scope 23): sign in, sign up, password change,
// rate-limit hits, CSRF and Origin refusals, and 401s on protected routes. Each line has the
// request id, the org when known, the operation and a reason code. Never the password, the
// session id or its hash, the cookie header or image bytes; the user name only as a short hash.

export type SecurityLogger = Pick<Console, 'info' | 'warn'>

export type SecurityEvent = {
  requestId: string
  operation: (typeof SECURITY_LOG.operation)[keyof typeof SECURITY_LOG.operation]
  reason: (typeof SECURITY_LOG.reason)[keyof typeof SECURITY_LOG.reason]
  orgId?: string
  // The user name as typed; only its short hash is logged.
  username?: string
}

export function userHashOf(username: string): string {
  return createHash(SESSION.hashAlgorithm).update(username.trim().toLowerCase()).digest(SESSION.hashEncoding).slice(0, SESSION.userHashLength)
}

export type SecurityLog = (level: LogLevel.Info | LogLevel.Warn, event: SecurityEvent) => void

export function createSecurityLog(logger: SecurityLogger): SecurityLog {
  return (level, event) => {
    const line = JSON.stringify({
      level,
      operation: event.operation,
      requestId: event.requestId,
      reason: event.reason,
      ...(event.orgId === undefined ? {} : { orgId: event.orgId }),
      ...(event.username === undefined ? {} : { userHash: userHashOf(event.username) })
    })
    if (level === LogLevel.Warn) logger.warn(line)
    else logger.info(line)
  }
}
