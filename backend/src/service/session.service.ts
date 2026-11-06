import { tooManyAttemptError, unauthorizedError } from '../lib/error.js'
import { hashPassword, verifyPassword } from '../lib/password.js'
import type { LoginLimiter } from '../lib/rate-limit.js'
import type { SecurityLog } from '../lib/security-log.js'
import { createSessionId, hashSessionId, isSessionIdFormat } from '../lib/session.js'
import type { SignInInput } from '../schema/session.schema.js'
import type { AccountRecord, SessionRecord, Store } from '../store/store.js'
import { LogLevel, SECURITY_LOG, SESSION } from '../utils/constants.js'
import { ERROR_MESSAGE } from '../utils/error-messages.js'

export type SessionService = ReturnType<typeof createSessionService>

// Who is asking, for the rate limits and the log. Never the cookie or the password.
export type RequestContext = { requestId: string, ip: string }

// Why a session id did not resolve, for the 401 log line.
export type ResolveResult =
  | { ok: true, session: SessionRecord }
  | { ok: false, reason: typeof SECURITY_LOG.reason.noCookie | typeof SECURITY_LOG.reason.malformedId
    | typeof SECURITY_LOG.reason.unknownSession | typeof SECURITY_LOG.reason.expired }

// A new session: the id goes in the cookie (once), only its hash in the store.
export type StartedSession = { id: string, session: SessionRecord, maxAgeMs: number }

// An unknown user name is checked against this hash, so it takes about as long as a real check.
// It is built when the service is created (QA plan 028, D5), never during a sign-in, so the
// first unknown-user sign-in is not slower than the next ones. Hashing is slow, so it is built
// once per process.
let dummyHash: string | undefined

function dummyHashOf(): string {
  dummyHash ??= hashPassword(SESSION.dummyPassword)
  return dummyHash
}

// Server-side sessions (plan 028, Scopes 1, 3 and 8; Open Question 3, answer A): 8 hours idle
// (rolling, written at most once a minute) and 7 days at most.
export function createSessionService(store: Store, limiter: LoginLimiter, now: () => number, log: SecurityLog) {
  const timingHash = dummyHashOf()

  async function resolve(rawId: string | undefined): Promise<ResolveResult> {
    if (!rawId) return { ok: false, reason: SECURITY_LOG.reason.noCookie }
    if (!isSessionIdFormat(rawId)) return { ok: false, reason: SECURITY_LOG.reason.malformedId }
    const idHash = hashSessionId(rawId)
    const session = await store.findSession(idHash)
    if (!session) return { ok: false, reason: SECURITY_LOG.reason.unknownSession }
    const time = now()
    if (session.expiresAt <= time || session.absoluteExpiresAt <= time) {
      // Expired sessions are deleted when read.
      await store.deleteSession(idHash)
      return { ok: false, reason: SECURITY_LOG.reason.expired }
    }
    if (time - session.lastSeenAt < SESSION.touchIntervalMs) return { ok: true, session }
    const expiresAt = Math.min(time + SESSION.idleMs, session.absoluteExpiresAt)
    await store.touchSession(idHash, time, expiresAt)
    return { ok: true, session: { ...session, lastSeenAt: time, expiresAt } }
  }

  // Starts a new session for the org. Any id the browser already had is discarded first, so a
  // planted id can never become a signed-in one (no session fixation).
  async function start(orgId: string, previousRawId: string | undefined): Promise<StartedSession> {
    if (previousRawId && isSessionIdFormat(previousRawId)) await store.deleteSession(hashSessionId(previousRawId))
    const id = createSessionId()
    const time = now()
    const session: SessionRecord = {
      idHash: hashSessionId(id),
      orgId,
      createdAt: time,
      lastSeenAt: time,
      expiresAt: time + SESSION.idleMs,
      absoluteExpiresAt: time + SESSION.absoluteMs
    }
    await store.createSession(session)
    return { id, session, maxAgeMs: SESSION.absoluteMs }
  }

  // The 429 when the user name has used up its failures, or the IP its attempts. The same
  // answer whether or not the user name exists.
  function limitOrThrow(key: string, context: RequestContext, operation: typeof SECURITY_LOG.operation.signIn | typeof SECURITY_LOG.operation.passwordChange, ip: boolean): void {
    const wait = Math.max(limiter.userFailure.retryAfter(key) ?? 0, ip ? limiter.signInIp.retryAfter(context.ip) ?? 0 : 0)
    if (wait === 0) return
    log(LogLevel.Warn, { requestId: context.requestId, operation, reason: SECURITY_LOG.reason.rateLimited, username: key })
    throw tooManyAttemptError(wait)
  }

  return {
    resolve,
    start,

    // A failed check of the current password counts like a failed sign-in of that user name.
    checkPasswordLimit(username: string, context: RequestContext): void {
      limitOrThrow(username.toLowerCase(), context, SECURITY_LOG.operation.passwordChange, false)
    },

    countPasswordFailure(username: string): void {
      limiter.userFailure.hit(username.toLowerCase())
    },

    async signIn(input: SignInInput, previousRawId: string | undefined, context: RequestContext): Promise<{ account: AccountRecord, started: StartedSession }> {
      const key = input.username.toLowerCase()
      limitOrThrow(key, context, SECURITY_LOG.operation.signIn, true)
      limiter.signInIp.hit(context.ip)

      const found = await store.findAccountByUsername(input.username)
      // A GitHub-only account (no password hash, plan 040) is checked against the timing hash
      // too and fails like a wrong password: the same generic 401.
      const hash = found?.account.passwordHash ?? timingHash
      const valid = verifyPassword(input.password, hash) && found?.account.passwordHash != null
      if (!found || !valid) {
        limiter.userFailure.hit(key)
        log(LogLevel.Warn, {
          requestId: context.requestId,
          operation: SECURITY_LOG.operation.signIn,
          reason: !found ? SECURITY_LOG.reason.unknownUser : found.account.passwordHash === null ? SECURITY_LOG.reason.noPassword : SECURITY_LOG.reason.wrongPassword,
          username: key
        })
        throw unauthorizedError(ERROR_MESSAGE.signInFailed)
      }

      await store.deleteExpiredSession(now())
      const started = await start(found.orgId, previousRawId)
      log(LogLevel.Info, { requestId: context.requestId, operation: SECURITY_LOG.operation.signIn, reason: SECURITY_LOG.reason.success, orgId: found.orgId, username: key })
      return { account: found.account, started }
    },

    async signOut(idHash: string, orgId: string, requestId: string): Promise<void> {
      await store.deleteSession(idHash)
      log(LogLevel.Info, { requestId, operation: SECURITY_LOG.operation.signOut, reason: SECURITY_LOG.reason.success, orgId })
    },

    // A password change ends every session of the account, then starts the current one again
    // under a new id.
    async rotate(orgId: string): Promise<StartedSession> {
      await store.deleteOrgSession(orgId)
      return start(orgId, undefined)
    }
  }
}
