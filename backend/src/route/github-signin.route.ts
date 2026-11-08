import { Router, type Request, type Response } from 'express'
import { asyncHandler } from '../lib/async-handler.js'
import { AppError } from '../lib/error.js'
import { clearStateCookie, readStateCookie, setStateCookie } from '../lib/github-signin-state.js'
import { clientIpOf, orgOf, readSessionId } from '../lib/session-guard.js'
import { setSessionCookie, type CookieConfig } from '../lib/session.js'
import type { CallbackQuery, GithubSignInService } from '../service/github-signin.service.js'
import type { RequestContext } from '../service/session.service.js'
import { GITHUB_SIGNIN, HEADER, PATTERN, ROUTE, SESSION_CODE } from '../utils/constants.js'
import { HttpStatus } from '../utils/http-status.js'

function contextOf(req: Request): RequestContext {
  return { requestId: req.requestId, ip: clientIpOf(req) }
}

// A query value that is one short string, or undefined (an array, an object or a long value is
// treated as absent, so it can only end in a refusal).
function queryValueOf(value: unknown): string | undefined {
  return typeof value === 'string' && value.length <= GITHUB_SIGNIN.queryValueMax ? value : undefined
}

// A redirect with no body: the contract documents none, and the browser follows `Location`.
function redirect(res: Response, location: string): void {
  // `new URL().href` percent-encodes any character a header cannot carry, so this never throws.
  const safe = PATTERN.printableAscii.test(location) ? location : new URL(location).href
  res.status(HttpStatus.Found).set({ [HEADER.location]: safe, [HEADER.cacheControl]: GITHUB_SIGNIN.cacheControl }).end()
}

// Plan 048: the redirect with the one-time code in the fragment (never the query). Any fragment
// already on the address is dropped first.
function withAuthCode(location: string, authCode: string): string {
  const base = location.split('#')[0] ?? location
  return `${base}#${SESSION_CODE.fragmentParam}=${authCode}`
}

// The two navigation routes answer a rate limit with a redirect the login page can show; any
// other error is left to the error handler.
function isRateLimit(error: unknown): boolean {
  return error instanceof AppError && error.status === HttpStatus.TooManyRequests
}

// /api/auth/github (plan 040). Start and callback are public browser navigations; link and
// unlink are JSON calls behind the session guard. Mounted only when GitHub sign-in is configured.
export function createGithubSignInRouter(service: GithubSignInService, cookie: CookieConfig, tokenFallback = false): Router {
  const router = Router()

  // Sets the single-use state cookie and sends the browser to GitHub.
  router.get(ROUTE.root, (req, res) => {
    try {
      const started = service.start(queryValueOf(req.query.returnTo), contextOf(req))
      setStateCookie(res, cookie, started.cookieValue)
      redirect(res, started.location)
    } catch (error) {
      if (!isRateLimit(error)) throw error
      redirect(res, service.rateLimitedRedirect())
    }
  })

  // GitHub sends the browser back here. The state cookie is deleted whatever the outcome.
  router.get(ROUTE.callback, asyncHandler(async (req, res) => {
    const query: CallbackQuery = {
      code: queryValueOf(req.query.code),
      state: queryValueOf(req.query.state),
      error: queryValueOf(req.query.error)
    }
    let result: Awaited<ReturnType<GithubSignInService['callback']>>
    try {
      result = await service.callback(query, readStateCookie(req, cookie), readSessionId(req, cookie), contextOf(req))
    } catch (error) {
      if (!isRateLimit(error)) throw error
      redirect(res, service.rateLimitedRedirect())
      return
    }
    clearStateCookie(res, cookie)
    if (result.started) setSessionCookie(res, cookie, result.started.id, result.started.maxAgeMs)
    redirect(res, result.started && result.authCode ? withAuthCode(result.redirect, result.authCode) : result.redirect)
  }))

  // Plan 048, public: the one-time code for the session token. Mounted only with the token
  // fallback on. The answer is never cached, an error included.
  if (tokenFallback) {
    router.post(ROUTE.exchange, (req, res) => {
      res.set(HEADER.cacheControl, GITHUB_SIGNIN.cacheControl)
      const body: unknown = req.body
      const code = typeof body === 'object' && body !== null ? (body as { code?: unknown }).code : undefined
      res.json({ sessionToken: service.exchange(code, contextOf(req)) })
    })
  }

  // Signed in: where to send the browser to link GitHub (a fetch cannot follow that redirect).
  router.post(ROUTE.link, asyncHandler(async (req, res) => {
    const started = await service.startLink(orgOf(req), contextOf(req))
    setStateCookie(res, cookie, started.cookieValue)
    res.json({ url: started.location })
  }))

  router.delete(ROUTE.link, asyncHandler(async (req, res) => {
    res.json(await service.unlink(orgOf(req), contextOf(req)))
  }))

  return router
}
