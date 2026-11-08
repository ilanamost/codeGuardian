import { randomUUID } from 'node:crypto'
import { conflictError, notFoundError, tooManyAttemptError, unauthorizedError } from '../lib/error.js'
import type { GithubProfile, GithubSignInClient } from '../lib/github-signin-client.js'
import { newSignIn, parseSignInState, safeReturnTo, SignInMode, stateMatches } from '../lib/github-signin-state.js'
import type { RateLimiter } from '../lib/rate-limit.js'
import type { SessionCodeStore } from '../lib/session-code.js'
import type { SecurityLog } from '../lib/security-log.js'
import type { Account } from '../model/dto.js'
import { seedSettings } from '../store/seed.js'
import type { IdentityRecord, Store } from '../store/store.js'
import { GITHUB_SIGNIN, LogLevel, PATTERN, SECURITY_LOG } from '../utils/constants.js'
import { AuthErrorCode, IdentityProvider } from '../utils/domain.js'
import { ERROR_MESSAGE } from '../utils/error-messages.js'
import { LIMIT } from '../utils/limits.js'
import { accountOf, memberSinceOf } from './account.service.js'
import type { RequestContext, SessionService, StartedSession } from './session.service.js'

export type GithubSignInService = ReturnType<typeof createGithubSignInService>

// What the GitHub OAuth App settings give the service (the secret stays in the client).
// `frontendBasePath` (plan 043) is '' or `/segment...` with no trailing slash (see `lib/frontend-base.ts`).
export type GithubSignInSetting = { clientId: string, redirectUrl: string, frontendOrigin: string, frontendBasePath: string }

// The query of GitHub's redirect to the callback, each value a string of at most
// `queryValueMax` characters or undefined (the route drops anything else).
export type CallbackQuery = { code?: string, state?: string, error?: string }

// Where the browser goes next, and the new session when the callback signed someone in. `authCode`
// (plan 048) is set only with a new session and only when the token fallback is on.
export type CallbackResult = { redirect: string, started?: StartedSession, authCode?: string }

// The start of a round trip: the cookie value to set and the URL to send the browser to.
export type StartResult = { cookieValue: string, location: string }

const provider = IdentityProvider.Github

// The log reason of each failure code (the reason list is closed, so an enum value is mapped).
const reasonOf = {
  [AuthErrorCode.InvalidState]: SECURITY_LOG.reason.invalidState,
  [AuthErrorCode.AccessDenied]: SECURITY_LOG.reason.accessDenied,
  [AuthErrorCode.ProviderError]: SECURITY_LOG.reason.providerError,
  [AuthErrorCode.EmailUnverified]: SECURITY_LOG.reason.emailUnverified,
  [AuthErrorCode.EmailInUse]: SECURITY_LOG.reason.emailInUse,
  [AuthErrorCode.IdentityInUse]: SECURITY_LOG.reason.identityInUse,
  [AuthErrorCode.RateLimited]: SECURITY_LOG.reason.rateLimited
} as const

// A user name from a GitHub login (plan 040, Open Question 3 A): the login already fits the user
// name rules except for its length; a login under the minimum gets a fixed suffix, and the n-th
// try after a collision adds `-n` (cut so the whole name stays within the maximum).
function usernameOf(login: string, attempt: number): string {
  const base = login.length < LIMIT.username.min ? `${login}${GITHUB_SIGNIN.shortLoginSuffix}` : login
  if (attempt === 0) return base
  const suffix = `-${attempt + 1}`
  return `${base.slice(0, LIMIT.username.max - suffix.length)}${suffix}`
}

// Free text from the GitHub profile as a plain, storable name: no control character, no unpaired
// surrogate, trimmed and cut. Blank falls back to the login.
function fullNameOf(profile: GithubProfile): string {
  const cleaned = (profile.name ?? '')
    .replace(PATTERN.controlOrLineSeparator, ' ')
    .replace(GITHUB_SIGNIN.unpairedSurrogate, '')
    .trim()
    .slice(0, GITHUB_SIGNIN.fullNameMax)
    .trim()
  return cleaned === '' ? profile.login : cleaned
}

// The verified primary email in the shape registration stores, or undefined when it is not usable.
function emailOf(profile: GithubProfile): string | undefined {
  if (!profile.emailVerified || !profile.email) return undefined
  const email = profile.email.trim().toLowerCase()
  if (email.length > LIMIT.email.max || !PATTERN.email.test(email) || PATTERN.controlOrLineSeparator.test(email)) return undefined
  return email
}

// "Continue with GitHub" (plan 040): the OAuth authorization code flow with PKCE, a single-use
// `state` kept in the browser's own cookie, and no stored GitHub token. A returning GitHub user
// signs in, a new one gets an account (no password), and a signed-in account can link or unlink
// GitHub from Settings. An email is never used to take over an existing account (Open Question 2
// A): a verified email that already belongs to an account is refused with `email_in_use`.
export function createGithubSignInService(
  store: Store,
  sessionService: SessionService,
  client: GithubSignInClient,
  setting: GithubSignInSetting,
  limiter: RateLimiter,
  now: () => number,
  log: SecurityLog,
  // Plan 048: present only when SESSION_TOKEN_FALLBACK is on.
  codeStore?: SessionCodeStore
) {
  function limitOrThrow(context: RequestContext, operation: typeof SECURITY_LOG.operation.githubStart | typeof SECURITY_LOG.operation.githubCallback | typeof SECURITY_LOG.operation.githubLink | typeof SECURITY_LOG.operation.githubExchange): void {
    const wait = limiter.retryAfter(context.ip)
    if (wait !== undefined) {
      log(LogLevel.Warn, { requestId: context.requestId, operation, reason: SECURITY_LOG.reason.rateLimited })
      throw tooManyAttemptError(wait)
    }
    limiter.hit(context.ip)
  }

  // GitHub's authorize URL: the scopes are fixed, the challenge is S256 of the verifier in the cookie.
  function authorizeUrlOf(state: string, challenge: string): string {
    const url = new URL(GITHUB_SIGNIN.authorizeUrl)
    url.searchParams.set('client_id', setting.clientId)
    url.searchParams.set('redirect_uri', setting.redirectUrl)
    url.searchParams.set('scope', GITHUB_SIGNIN.scope)
    url.searchParams.set('state', state)
    url.searchParams.set('code_challenge', challenge)
    url.searchParams.set('code_challenge_method', GITHUB_SIGNIN.challengeMethod)
    return url.toString()
  }

  // The one place a frontend address is built (plan 043): origin + base + an app path that starts
  // with `/`. The base ends without a slash and the path starts with one, so there is never a
  // double or a missing slash. A path with dot segments that would climb out of the base (the
  // browser resolves `/repo/../x` to `/x`) lands on the base root instead.
  function frontendRedirect(path: string): string {
    const target = `${setting.frontendOrigin}${setting.frontendBasePath}${path}`
    if (setting.frontendBasePath === '') return target
    const resolved = new URL(target).pathname
    return resolved.startsWith(`${setting.frontendBasePath}/`) ? target : `${setting.frontendOrigin}${setting.frontendBasePath}/`
  }

  function loginRedirect(code: AuthErrorCode): string {
    return frontendRedirect(`${GITHUB_SIGNIN.loginPath}?${GITHUB_SIGNIN.errorParam}=${code}`)
  }

  function settingsRedirect(code?: AuthErrorCode): string {
    const error = code ? `&${GITHUB_SIGNIN.errorParam}=${code}` : ''
    return frontendRedirect(`${GITHUB_SIGNIN.settingsPath}?${GITHUB_SIGNIN.settingsQuery}${error}`)
  }

  // Plan 048: the one-time code for a session this callback just started.
  function codeOf(started: StartedSession): { authCode?: string } {
    return codeStore ? { authCode: codeStore.issue(started.id) } : {}
  }

  async function signInTo(orgId: string, previousRawId: string | undefined, returnTo: string | undefined, context: RequestContext): Promise<CallbackResult> {
    await store.deleteExpiredSession(now())
    const started = await sessionService.start(orgId, previousRawId)
    log(LogLevel.Info, { requestId: context.requestId, operation: SECURITY_LOG.operation.githubCallback, reason: SECURITY_LOG.reason.success, orgId })
    return { redirect: frontendRedirect(returnTo ?? '/'), started, ...codeOf(started) }
  }

  // The account of this GitHub id: the sign-in. The login is refreshed (it may have been renamed).
  async function signInIdentity(identity: IdentityRecord, profile: GithubProfile, previousRawId: string | undefined, returnTo: string | undefined, context: RequestContext): Promise<CallbackResult> {
    if (identity.login !== profile.login) await store.setIdentityLogin(provider, identity.providerUserId, profile.login)
    return signInTo(identity.orgId, previousRawId, returnTo, context)
  }

  return {
    // Where a rate-limited browser navigation (start or callback) is sent instead of a JSON 429.
    rateLimitedRedirect(): string {
      return loginRedirect(AuthErrorCode.RateLimited)
    },

    // GET /api/auth/github: a new state and verifier for a sign-in or sign-up.
    start(returnTo: unknown, context: RequestContext): StartResult {
      limitOrThrow(context, SECURITY_LOG.operation.githubStart)
      const started = newSignIn(SignInMode.SignIn, safeReturnTo(returnTo))
      log(LogLevel.Info, { requestId: context.requestId, operation: SECURITY_LOG.operation.githubStart, reason: SECURITY_LOG.reason.success })
      return { cookieValue: started.cookieValue, location: authorizeUrlOf(started.state, started.challenge) }
    },

    // POST /api/auth/github/link: the same round trip for the signed-in account. A second link is refused.
    async startLink(orgId: string, context: RequestContext): Promise<StartResult> {
      limitOrThrow(context, SECURITY_LOG.operation.githubLink)
      if (await store.findIdentityByOrg(orgId, provider)) {
        log(LogLevel.Warn, { requestId: context.requestId, operation: SECURITY_LOG.operation.githubLink, reason: SECURITY_LOG.reason.alreadyLinked, orgId })
        throw conflictError(ERROR_MESSAGE.githubAlreadyLinked)
      }
      const started = newSignIn(SignInMode.Link, undefined)
      log(LogLevel.Info, { requestId: context.requestId, operation: SECURITY_LOG.operation.githubLink, reason: SECURITY_LOG.reason.success, orgId })
      return { cookieValue: started.cookieValue, location: authorizeUrlOf(started.state, started.challenge) }
    },

    // DELETE /api/auth/github/link: refused when the account would have no way left to sign in.
    async unlink(orgId: string, context: RequestContext): Promise<Account> {
      const identity = await store.findIdentityByOrg(orgId, provider)
      if (!identity) throw notFoundError(ERROR_MESSAGE.githubNotLinked)
      const record = await store.getAccount(orgId)
      if (!record) throw notFoundError(ERROR_MESSAGE.githubNotLinked)
      if (record.passwordHash === null) {
        log(LogLevel.Warn, { requestId: context.requestId, operation: SECURITY_LOG.operation.githubUnlink, reason: SECURITY_LOG.reason.lastSignInMethod, orgId })
        throw conflictError(ERROR_MESSAGE.githubUnlinkLast)
      }
      await store.deleteIdentity(orgId, provider)
      log(LogLevel.Info, { requestId: context.requestId, operation: SECURITY_LOG.operation.githubUnlink, reason: SECURITY_LOG.reason.success, orgId })
      return accountOf({ ...record, githubLogin: null })
    },

    // POST /api/auth/github/exchange (plan 048): the session id behind a one-time code. Shares the
    // GitHub sign-in rate limit. Every invalid code is the same generic 401; the code is never logged.
    exchange(code: unknown, context: RequestContext): string {
      limitOrThrow(context, SECURITY_LOG.operation.githubExchange)
      const sessionId = codeStore?.consume(code)
      if (sessionId === undefined) {
        log(LogLevel.Warn, { requestId: context.requestId, operation: SECURITY_LOG.operation.githubExchange, reason: SECURITY_LOG.reason.invalidAuthCode })
        throw unauthorizedError(ERROR_MESSAGE.authCodeInvalid)
      }
      log(LogLevel.Info, { requestId: context.requestId, operation: SECURITY_LOG.operation.githubExchange, reason: SECURITY_LOG.reason.success })
      return sessionId
    },

    // GET /api/auth/github/callback. Every failure is a redirect with a code from the closed list
    // (never a message from GitHub, never a session); only a rate limit is a 429.
    async callback(query: CallbackQuery, stateCookie: string | undefined, previousRawId: string | undefined, context: RequestContext): Promise<CallbackResult> {
      limitOrThrow(context, SECURITY_LOG.operation.githubCallback)

      const pending = parseSignInState(stateCookie)
      const isLink = pending?.mode === SignInMode.Link
      const fail = (code: AuthErrorCode, orgId?: string): CallbackResult => {
        log(LogLevel.Warn, { requestId: context.requestId, operation: SECURITY_LOG.operation.githubCallback, reason: reasonOf[code], ...(orgId ? { orgId } : {}) })
        return { redirect: isLink ? settingsRedirect(code) : loginRedirect(code) }
      }

      // The state first: a missing, wrong, reused or expired one ends here, whatever else came.
      if (!pending || !stateMatches(pending.state, query.state)) return fail(AuthErrorCode.InvalidState)
      if (query.error !== undefined) return fail(query.error === GITHUB_SIGNIN.deniedError ? AuthErrorCode.AccessDenied : AuthErrorCode.ProviderError)
      if (!query.code) return fail(AuthErrorCode.ProviderError)

      // The access token exists only inside this block.
      let profile: GithubProfile
      try {
        const accessToken = await client.exchangeCode(query.code, pending.verifier)
        profile = await client.fetchProfile(accessToken)
      } catch {
        return fail(AuthErrorCode.ProviderError)
      }
      if (!GITHUB_SIGNIN.idPattern.test(profile.id) || !GITHUB_SIGNIN.loginPattern.test(profile.login)) return fail(AuthErrorCode.ProviderError)

      const existing = await store.findIdentity(provider, profile.id)

      if (isLink) {
        // The account is the one of the current session, never one named by the cookie.
        const resolved = await sessionService.resolve(previousRawId)
        if (!resolved.ok) return fail(AuthErrorCode.InvalidState)
        const orgId = resolved.session.orgId
        if (existing && existing.orgId !== orgId) return fail(AuthErrorCode.IdentityInUse, orgId)
        if (existing) {
          if (existing.login !== profile.login) await store.setIdentityLogin(provider, profile.id, profile.login)
        } else {
          const created = await store.createIdentity({ provider, providerUserId: profile.id, orgId, login: profile.login })
          if (!created.ok) return fail(AuthErrorCode.IdentityInUse, orgId)
        }
        log(LogLevel.Info, { requestId: context.requestId, operation: SECURITY_LOG.operation.githubCallback, reason: SECURITY_LOG.reason.success, orgId })
        return { redirect: settingsRedirect() }
      }

      if (existing) return signInIdentity(existing, profile, previousRawId, pending.returnTo, context)

      // A new GitHub user: a verified email is required, and it must not belong to an account.
      const email = emailOf(profile)
      if (!email) return fail(AuthErrorCode.EmailUnverified)
      if (await store.findAccountByEmail(email)) return fail(AuthErrorCode.EmailInUse)

      for (let attempt = 0; attempt < GITHUB_SIGNIN.usernameAttemptMax; attempt += 1) {
        const username = usernameOf(profile.login, attempt)
        if (await store.findAccountByUsername(username)) continue
        const orgId = randomUUID()
        const created = await store.createAccount({
          orgId,
          orgName: username,
          account: { username, fullName: fullNameOf(profile), email, memberSince: memberSinceOf(now()), passwordHash: null },
          settings: seedSettings(),
          identity: { provider, providerUserId: profile.id, login: profile.login }
        })
        if (created.ok) {
          log(LogLevel.Info, { requestId: context.requestId, operation: SECURITY_LOG.operation.githubCallback, reason: SECURITY_LOG.reason.success, orgId })
          const started = await sessionService.start(orgId, previousRawId)
          return { redirect: frontendRedirect(pending.returnTo ?? '/'), started, ...codeOf(started) }
        }
        // A conflict: a parallel callback took the GitHub id, the email or this name.
        const raced = await store.findIdentity(provider, profile.id)
        if (raced) return signInIdentity(raced, profile, previousRawId, pending.returnTo, context)
        if (await store.findAccountByEmail(email)) return fail(AuthErrorCode.EmailInUse)
      }
      return fail(AuthErrorCode.ProviderError)
    }
  }
}
