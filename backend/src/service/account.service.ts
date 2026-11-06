import { createHash, randomUUID } from 'node:crypto'
import { avatarUrlOf, isAvatarType, sniffAvatarType } from '../lib/avatar.js'
import { conflictError, notFoundError, tooManyAttemptError, unauthorizedError, validationError } from '../lib/error.js'
import { hashPassword, verifyPassword } from '../lib/password.js'
import { passwordRuleIssue } from '../lib/password-rule.js'
import type { LoginLimiter } from '../lib/rate-limit.js'
import type { SecurityLog } from '../lib/security-log.js'
import type { Account } from '../model/dto.js'
import type { AccountUpdateInput, PasswordChangeInput, RegistrationInput } from '../schema/account.schema.js'
import type { AccountChange, AccountRecord, AvatarRecord, Store } from '../store/store.js'
import { seedSettings } from '../store/seed.js'
import { AVATAR, LogLevel, MEMBER_SINCE_FORMAT, SECURITY_LOG } from '../utils/constants.js'
import { SignInMethod } from '../utils/domain.js'
import { ERROR_MESSAGE, FIELD, ISSUE_MESSAGE } from '../utils/error-messages.js'
import type { RequestContext, SessionService, StartedSession } from './session.service.js'

export type AccountService = ReturnType<typeof createAccountService>

const memberSinceFormat = new Intl.DateTimeFormat(MEMBER_SINCE_FORMAT.locale, MEMBER_SINCE_FORMAT.option)

// The member-since text for a new account, like "October 27, 2026" (UTC).
export function memberSinceOf(time: number): string {
  return memberSinceFormat.format(time)
}

// How the account signs in: a password, a linked GitHub identity, or both (an account always has one).
export function signInMethodOf(record: Pick<AccountRecord, 'passwordHash' | 'githubLogin'>): SignInMethod {
  if (record.passwordHash === null) return SignInMethod.Github
  return record.githubLogin === null ? SignInMethod.Password : SignInMethod.Both
}

export function accountOf(record: AccountRecord): Account {
  return {
    username: record.username,
    fullName: record.fullName,
    email: record.email,
    avatarUrl: avatarUrlOf(record.avatarDigest),
    memberSince: record.memberSince,
    signInMethod: signInMethodOf(record),
    githubLogin: record.githubLogin
  }
}

function noPasswordError(message: string, field: string) {
  return validationError(message, { issue: [{ field, message: ISSUE_MESSAGE.passwordNotSet }] })
}

function avatarIssue(message: string) {
  return validationError(ERROR_MESSAGE.avatarInvalid, { issue: [{ field: FIELD.avatar, message }] })
}

// The signed-in account (plan 028): the profile, registration, the password change and the
// profile photo. Each account has its own org; every method takes the session's org.
export function createAccountService(store: Store, sessionService: SessionService, limiter: LoginLimiter, now: () => number, log: SecurityLog) {
  async function recordOrThrow(orgId: string): Promise<AccountRecord> {
    const record = await store.getAccount(orgId)
    // A session always points at an existing account (the FK cascades); this is defense only.
    if (!record) throw unauthorizedError(ERROR_MESSAGE.sessionRequired)
    return record
  }

  return {
    async get(orgId: string): Promise<Account> {
      return accountOf(await recordOrThrow(orgId))
    },

    // POST /api/account (Scope 2, Open Question 6 answer A): creates the org, the account, the
    // default settings and the GitHub row in one step, then signs the new account in.
    async register(input: RegistrationInput, previousRawId: string | undefined, context: RequestContext): Promise<{ account: Account, started: StartedSession }> {
      const wait = limiter.signUpIp.retryAfter(context.ip)
      if (wait !== undefined) {
        log(LogLevel.Warn, { requestId: context.requestId, operation: SECURITY_LOG.operation.register, reason: SECURITY_LOG.reason.rateLimited })
        throw tooManyAttemptError(wait)
      }
      limiter.signUpIp.hit(context.ip)

      const issue = passwordRuleIssue(input.password, input)
      if (issue) {
        log(LogLevel.Info, { requestId: context.requestId, operation: SECURITY_LOG.operation.register, reason: SECURITY_LOG.reason.weakPassword })
        throw validationError(ERROR_MESSAGE.passwordWeak, { issue: [{ field: FIELD.password, message: issue }] })
      }

      const orgId = randomUUID()
      const account: AccountRecord = {
        username: input.username,
        // Editing the full name is out of scope, so it starts as the user name.
        fullName: input.username,
        email: input.email,
        memberSince: memberSinceFormat.format(now()),
        passwordHash: hashPassword(input.password),
        avatarDigest: null,
        githubLogin: null
      }
      const { avatarDigest: _none, githubLogin: _login, ...stored } = account
      const result = await store.createAccount({ orgId, orgName: input.username, account: stored, settings: seedSettings() })
      if (!result.ok) {
        log(LogLevel.Warn, { requestId: context.requestId, operation: SECURITY_LOG.operation.register, reason: SECURITY_LOG.reason.conflict, username: input.username })
        throw conflictError(ERROR_MESSAGE.accountUnavailable)
      }

      const started = await sessionService.start(orgId, previousRawId)
      log(LogLevel.Info, { requestId: context.requestId, operation: SECURITY_LOG.operation.register, reason: SECURITY_LOG.reason.success, orgId, username: input.username })
      return { account: accountOf(account), started }
    },

    // Scope 15: the new password follows the password rules; on success every other session
    // ends and the current one gets a new id. A wrong current password counts toward the
    // user name's failure limit.
    async changePassword(orgId: string, input: PasswordChangeInput, context: RequestContext): Promise<StartedSession> {
      const record = await recordOrThrow(orgId)
      // A GitHub-only account has no password to change (plan 040): 422, nothing is counted.
      if (record.passwordHash === null) throw noPasswordError(ERROR_MESSAGE.passwordNotSet, FIELD.currentPassword)
      sessionService.checkPasswordLimit(record.username, context)
      if (!verifyPassword(input.currentPassword, record.passwordHash)) {
        sessionService.countPasswordFailure(record.username)
        log(LogLevel.Warn, { requestId: context.requestId, operation: SECURITY_LOG.operation.passwordChange, reason: SECURITY_LOG.reason.wrongPassword, orgId })
        throw validationError(ERROR_MESSAGE.currentPasswordWrong, { issue: [{ field: FIELD.currentPassword, message: ISSUE_MESSAGE.passwordWrong }] })
      }
      if (input.newPassword === input.currentPassword) {
        throw validationError(ERROR_MESSAGE.newPasswordSame, { issue: [{ field: FIELD.newPassword, message: ISSUE_MESSAGE.passwordSame }] })
      }
      const issue = passwordRuleIssue(input.newPassword, record)
      if (issue) throw validationError(ERROR_MESSAGE.newPasswordWeak, { issue: [{ field: FIELD.newPassword, message: issue }] })

      await store.setPasswordHash(orgId, hashPassword(input.newPassword))
      const started = await sessionService.rotate(orgId)
      log(LogLevel.Info, { requestId: context.requestId, operation: SECURITY_LOG.operation.passwordChange, reason: SECURITY_LOG.reason.success, orgId })
      return started
    },

    // PUT /api/account (plan 034, Open Question 1 answer A): the current password is checked
    // like at the password change (the same failure limit of the account's user name, 429 once
    // reached), and a missing one counts like a wrong one. A taken user name or email is the
    // generic 409 of registration. The session is kept: it is tied to the org, not the name.
    async update(orgId: string, input: AccountUpdateInput, context: RequestContext): Promise<Account> {
      const record = await recordOrThrow(orgId)
      // A GitHub-only account has no password to confirm the change with (plan 040): 422 on
      // currentPassword, nothing is counted, nothing changes. The UI hides Edit for it.
      if (record.passwordHash === null) throw noPasswordError(ERROR_MESSAGE.accountNoPassword, FIELD.currentPassword)
      sessionService.checkPasswordLimit(record.username, context)
      const password = input.currentPassword
      if (!password || !verifyPassword(password, record.passwordHash)) {
        sessionService.countPasswordFailure(record.username)
        log(LogLevel.Warn, { requestId: context.requestId, operation: SECURITY_LOG.operation.accountUpdate, reason: SECURITY_LOG.reason.wrongPassword, orgId })
        const message = password ? ISSUE_MESSAGE.passwordWrong : ISSUE_MESSAGE.passwordMissing
        throw validationError(ERROR_MESSAGE.currentPasswordWrong, { issue: [{ field: FIELD.currentPassword, message }] })
      }

      const change: AccountChange = {
        ...(input.username === undefined ? {} : { username: input.username }),
        ...(input.email === undefined ? {} : { email: input.email })
      }
      const result = await store.updateAccount(orgId, change)
      if (!result.ok) {
        if (result.reason === 'not_found') throw unauthorizedError(ERROR_MESSAGE.sessionRequired)
        log(LogLevel.Warn, { requestId: context.requestId, operation: SECURITY_LOG.operation.accountUpdate, reason: SECURITY_LOG.reason.conflict, orgId })
        throw conflictError(ERROR_MESSAGE.accountUnavailable)
      }
      log(LogLevel.Info, { requestId: context.requestId, operation: SECURITY_LOG.operation.accountUpdate, reason: SECURITY_LOG.reason.success, orgId })
      return accountOf(await recordOrThrow(orgId))
    },

    async getAvatar(orgId: string): Promise<AvatarRecord> {
      const avatar = await store.getAvatar(orgId)
      if (!avatar) throw notFoundError(ERROR_MESSAGE.avatarNotFound)
      return avatar
    },

    // Scope 17: the type is the sniffed one, and it must match the declared Content-Type.
    async setAvatar(orgId: string, contentType: string | undefined, body: unknown): Promise<Account> {
      if (!contentType || !isAvatarType(contentType) || !Buffer.isBuffer(body)) throw avatarIssue(ISSUE_MESSAGE.avatarType)
      if (body.length === 0) throw validationError(ERROR_MESSAGE.avatarEmpty, { issue: [{ field: FIELD.avatar, message: ISSUE_MESSAGE.avatarEmpty }] })
      if (sniffAvatarType(body) !== contentType) throw avatarIssue(ISSUE_MESSAGE.avatarType)
      const digest = createHash(AVATAR.digestAlgorithm).update(body).digest('hex')
      await store.setAvatar(orgId, { contentType, data: Buffer.from(body), digest, updatedAt: now() })
      return accountOf(await recordOrThrow(orgId))
    },

    async removeAvatar(orgId: string): Promise<Account> {
      await store.deleteAvatar(orgId)
      return accountOf(await recordOrThrow(orgId))
    }
  }
}
