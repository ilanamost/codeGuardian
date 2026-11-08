import express from 'express'
import cors from 'cors'
import type { AppConfig } from './config.js'
import { attachRequestId, errorHandler, notFoundError, payloadTooLargeError } from './lib/error.js'
import type { Analyzer } from './analyzer/analyzer.js'
import { createStubAnalyzer } from './analyzer/stub-analyzer.js'
import { createCsrfGuard } from './lib/csrf.js'
import { frontendBasePathOf } from './lib/frontend-base.js'
import { createGithubSignInClient, type GithubSignInClient } from './lib/github-signin-client.js'
import { createLoginLimiter, createRateLimiter } from './lib/rate-limit.js'
import { createSessionCodeStore } from './lib/session-code.js'
import { createSecurityLog, type SecurityLogger } from './lib/security-log.js'
import { createSessionGuard, type PublicRoute } from './lib/session-guard.js'
import { exceedsCharLimit } from './lib/validate.js'
import { createMemoryStore } from './store/memory-store.js'
import type { Store } from './store/store.js'
import { createAccountRouter } from './route/account.route.js'
import { createDashboardRouter } from './route/dashboard.route.js'
import { createGithubRouter } from './route/github.route.js'
import { createGithubSignInRouter } from './route/github-signin.route.js'
import { createReviewRouter } from './route/review.route.js'
import { createSessionRouter } from './route/session.route.js'
import { createSettingsRouter } from './route/settings.route.js'
import { createSupportRouter } from './route/support.route.js'
import { createTestRouter } from './route/test.route.js'
import { createAccountService } from './service/account.service.js'
import { createDashboardService } from './service/dashboard.service.js'
import { createGithubService } from './service/github.service.js'
import { createGithubSignInService } from './service/github-signin.service.js'
import { createGithubImportService, type GithubImportOption } from './service/github-import.service.js'
import { createGithubClient, type GithubClient } from './lib/github-fetch.js'
import { createReviewService, type ReviewService } from './service/review.service.js'
import { createSessionService } from './service/session.service.js'
import { createSettingsService } from './service/settings.service.js'
import { createSupportService } from './service/support.service.js'
import { createTestService } from './service/test.service.js'
import { API_PATH, DEFAULT_CHARSET, HEADER, HEALTH_STATUS_OK, ROUTE, SESSION_CODE, STATE_CHANGING_METHOD_LIST } from './utils/constants.js'
import { AnalyzerKind } from './utils/domain.js'
import { ERROR_MESSAGE } from './utils/error-messages.js'
import { LIMIT } from './utils/limits.js'

// Dependencies are injected so every test gets a fresh store, a fake analyzer or a fixed clock.
export type AppOption = {
  // Defaults to a new `MemoryStore`; `index.ts` passes a `PgStore` when `DATABASE_URL` is set.
  store?: Store
  analyzer?: Analyzer
  // The review service to mount (plan 039): `index.ts` builds it once, so the start-up resume
  // shares the analysis quota and the provider concurrency cap with the routes. Built over
  // `store` and `analyzer` when absent.
  reviewService?: ReviewService
  now?: () => number
  // Two body limits, both answered with 413 (QA round 1, D2); defaults in `utils/limits.ts`.
  bodyLimit?: string
  bodyCharLimit?: number
  // GitHub link import (plan 023) and wizard (plan 030). Defaults to the real client on Node's `fetch`; tests pass a
  // client over a fake `fetch`, and `index.ts` passes the fake GitHub when GITHUB_FAKE is on.
  githubClient?: GithubClient
  githubImport?: GithubImportOption
  // Where the security log lines go (plan 028); defaults to the console.
  securityLogger?: SecurityLogger
  // GitHub sign-in (plan 040): used only when `config.githubOAuth` is set. Defaults to the real
  // client on Node's `fetch`; tests pass the fake, and `index.ts` passes it when GITHUB_OAUTH_FAKE is on.
  githubSignInClient?: GithubSignInClient
}

// `production` is optional so tests that do not care get development cookies.
export type AppRuntimeConfig = Pick<AppConfig, 'frontendUrl' | 'enableTestRoute'> & Partial<Pick<AppConfig, 'production' | 'githubOAuth' | 'cookieSameSite' | 'sessionTokenFallback'>>

// Exported without listening so Supertest can mount it directly. The frontend URL comes from
// the server configuration (`config.ts`), never from a default here.
// `enableTestRoute` mounts the test-only reset route; it is off unless the config turns it on.
// Order (plan 028): request id, CORS (credentials, FRONTEND_URL only), CSRF, the session guard,
// then the body parser and the routers, so a refused request is never parsed.
export function createApp(config: AppRuntimeConfig, option: AppOption = {}) {
  const store = option.store ?? createMemoryStore()
  const analyzer = option.analyzer ?? createStubAnalyzer()
  const now = option.now ?? Date.now
  const cookie = { production: config.production ?? false, sameSite: config.cookieSameSite }
  // Plan 047: off unless the config turns it on.
  const tokenFallback = config.sessionTokenFallback ?? false
  const frontendOrigin = new URL(config.frontendUrl).origin
  const log = createSecurityLog(option.securityLogger ?? console)
  const limiter = createLoginLimiter(now)
  // Support requests per account (plan 031, kept by plan 032).
  const supportLimiter = createRateLimiter({ ...LIMIT.rateLimit.supportRequestOrg, now })
  const reviewService = option.reviewService ?? createReviewService(store, analyzer, now)
  const sessionService = createSessionService(store, limiter, now, log)
  const accountService = createAccountService(store, sessionService, limiter, now, log)
  // GitHub sign-in start, callback and link per client IP (plan 040).
  const githubSignInLimiter = createRateLimiter({ ...LIMIT.rateLimit.githubSignInIp, now })

  // Plan 048: one-time sign-in codes, only with the token fallback on.
  const sessionCodeStore = tokenFallback ? createSessionCodeStore({ now, ttlMs: SESSION_CODE.ttlMs, maxCount: SESSION_CODE.maxCount }) : undefined

  const publicList: PublicRoute[] = [
    { method: 'GET', path: API_PATH.health },
    { method: 'POST', path: API_PATH.account },
    { method: 'POST', path: API_PATH.session },
    { method: 'GET', path: API_PATH.session },
    // Plan 040: the GitHub sign-in redirects. Public even when the feature is off, where they are a 404.
    { method: 'GET', path: API_PATH.githubSignIn },
    { method: 'GET', path: `${API_PATH.githubSignIn}${ROUTE.callback}` },
    // Plan 048: public even when the switch is off, where it is a 404.
    { method: 'POST', path: `${API_PATH.githubSignIn}${ROUTE.exchange}` },
    ...(config.enableTestRoute ? [{ method: 'POST', path: `${API_PATH.test}${ROUTE.reset}` }] : [])
  ]

  const app = express()
  app.disable(HEADER.poweredBy)

  // The request id comes first so every refusal (403, 401, 400, 413) carries it too.
  app.use(attachRequestId)
  // Exactly FRONTEND_URL with credentials; any other origin gets no CORS header at all.
  app.use(cors({
    origin: (origin, callback) => callback(null, origin === frontendOrigin ? frontendOrigin : false),
    credentials: true,
    methods: ['GET', 'HEAD', ...STATE_CHANGING_METHOD_LIST],
    allowedHeaders: [HEADER.contentType, HEADER.csrf, HEADER.authorization, HEADER.sessionMode],
    // Not a CORS-safelisted header, so the login page could not read the wait time otherwise.
    exposedHeaders: [HEADER.retryAfter]
  }))
  app.use(createCsrfGuard(frontendOrigin, log))
  app.use(createSessionGuard(sessionService, publicList, cookie, log))
  const bodyCharLimit = option.bodyCharLimit ?? LIMIT.bodyChar
  const bodyLimit = option.bodyLimit ?? LIMIT.bodyByte
  app.use(express.json({
    limit: bodyLimit,
    verify: (_req, _res, buffer, encoding) => {
      const charset = Buffer.isEncoding(encoding) ? encoding : DEFAULT_CHARSET
      if (exceedsCharLimit(buffer.toString(charset), bodyCharLimit)) {
        throw payloadTooLargeError(ERROR_MESSAGE.bodyTooLarge)
      }
    }
  }))

  // Contract 0.15.0: `githubOAuth` is true when all three GITHUB_OAUTH_* settings are set.
  const githubSignInEnabled = config.githubOAuth !== undefined
  app.get(API_PATH.health, (_req, res) => {
    // Which analyzer reviews use (contract 0.14.0); an analyzer without a kind is the stub.
    res.json({ status: HEALTH_STATUS_OK, analyzer: analyzer.kind ?? AnalyzerKind.Stub, githubOAuth: githubSignInEnabled })
  })

  app.use(API_PATH.session, createSessionRouter(sessionService, accountService, cookie, log, tokenFallback))
  if (config.githubOAuth) {
    const githubSignInClient = option.githubSignInClient ?? createGithubSignInClient({ fetch: globalThis.fetch, ...config.githubOAuth })
    const githubSignInService = createGithubSignInService(
      store, sessionService, githubSignInClient,
      { clientId: config.githubOAuth.clientId, redirectUrl: config.githubOAuth.redirectUrl, frontendOrigin, frontendBasePath: frontendBasePathOf(config.frontendUrl) },
      githubSignInLimiter, now, log, sessionCodeStore
    )
    app.use(API_PATH.githubSignIn, createGithubSignInRouter(githubSignInService, cookie, tokenFallback))
  }
  app.use(API_PATH.review, createReviewRouter(reviewService))
  app.use(API_PATH.dashboard, createDashboardRouter(createDashboardService(store, now)))
  const githubClient = option.githubClient ?? createGithubClient({ fetch: globalThis.fetch })
  // One client for the link import and the wizard (plan 030): they share GitHub's rate limit.
  app.use(API_PATH.github, createGithubRouter(
    createGithubService(store, githubClient, option.githubImport),
    createGithubImportService(githubClient, option.githubImport)
  ))
  app.use(API_PATH.settings, createSettingsRouter(createSettingsService(store)))
  app.use(API_PATH.supportRequest, createSupportRouter(createSupportService(store, now, { limiter: supportLimiter })))
  app.use(API_PATH.account, createAccountRouter(accountService, cookie, tokenFallback))
  if (config.enableTestRoute) {
    app.use(API_PATH.test, createTestRouter(createTestService(store, [limiter, supportLimiter, githubSignInLimiter, reviewService, ...(sessionCodeStore ? [sessionCodeStore] : [])])))
  }

  app.use((req, _res, next) => {
    next(notFoundError(ERROR_MESSAGE.noRoute(req.method, req.path)))
  })

  app.use(errorHandler)

  return app
}
