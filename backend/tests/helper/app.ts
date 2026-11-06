import { env } from 'node:process'
import express from 'express'
import request from 'supertest'
import { expect } from 'vitest'
import { createApp, type AppOption, type AppRuntimeConfig } from '../../src/app.js'
import { createGithubClient, type FetchLike } from '../../src/lib/github-fetch.js'
import { createSessionId, hashSessionId } from '../../src/lib/session.js'
import type { Review } from '../../src/model/dto.js'
import { createMemoryStore, type MemoryStore, type ReviewRecord } from '../../src/store/memory-store.js'
import type { Store } from '../../src/store/store.js'

export const frontendUrl = env.FRONTEND_URL ?? 'http://localhost:5173'
export const fixedNow = Date.parse('2026-10-22T10:00:00.000Z')

// The demo account (plan 028, Open Question 8). Local demo credentials, not secrets.
export const demoUsername = 'john.doe'
export const demoPassword = 'mock-password'
export const demoOrgId = 'default'
export const sessionCookieName = 'cr_session'
export const csrfHeader = 'X-CSRF-Protection'

// Security log lines are silent unless a test passes its own logger.
const silentLogger = { info: () => undefined, warn: () => undefined }

// No test may reach the real network (plan 023): unless a test passes its own GitHub client,
// every GitHub call fails here as an unreachable upstream.
const offlineFetch: FetchLike = () => Promise.reject(new TypeError('network is disabled in tests'))

// Puts a session for `orgId` straight into the memory store and returns its raw id. It never
// expires and never rolls, so tests that move a fake clock by days stay signed in; the session
// tests use real sign-ins on `rawApp` instead.
export function plantSession(store: MemoryStore, orgId = demoOrgId): string {
  const id = createSessionId()
  // The last valid ISO date, so restore can still print expiresAt.
  const forever = Date.parse('9999-12-31T00:00:00.000Z')
  store.sessionMap.set(hashSessionId(id), { idHash: hashSessionId(id), orgId, createdAt: fixedNow, lastSeenAt: forever, expiresAt: forever, absoluteExpiresAt: forever })
  return id
}

// A fresh store and a fixed clock per call, so no test sees another test's writes. The test-only
// reset route is off, as in production, unless a test turns it on.
//
// `app` is the signed-in client of the existing suites (plan 028, "every existing test needs a
// session"): every request is sent as the demo account, with the session cookie and the
// `X-CSRF-Protection` header, unless the test sets its own cookie or CSRF header. When the
// session is gone (reset, sign-out, password change) a new one is planted, like a browser that
// signs in again. `rawApp` is the app itself, with no session and no header: the session,
// CSRF and boundary tests use it with real sign-ins.
// `githubOAuth` (plan 040) turns GitHub sign-in on: the three settings, with the client in `githubSignInClient`.
export function buildApp(option: Omit<AppOption, 'store'> & { store?: MemoryStore, githubOAuth?: AppRuntimeConfig['githubOAuth'] } = {}, enableTestRoute = false) {
  const { githubOAuth, ...appOption } = option
  const store = appOption.store ?? createMemoryStore()
  const githubClient = appOption.githubClient ?? createGithubClient({ fetch: offlineFetch })
  const plainApp = createApp({ frontendUrl, enableTestRoute, githubOAuth }, { now: () => fixedNow, securityLogger: silentLogger, ...appOption, store, githubClient })

  let sessionId: string | undefined
  const signIn = (req: express.Request) => {
    if (!sessionId || !store.sessionMap.has(hashSessionId(sessionId))) sessionId = plantSession(store)
    if (req.headers.cookie === undefined) req.headers.cookie = `${sessionCookieName}=${sessionId}`
    if (req.headers['x-csrf-protection'] === undefined) req.headers['x-csrf-protection'] = '1'
  }
  const app = express()
  app.disable('x-powered-by')
  app.use((req, _res, next) => {
    signIn(req)
    next()
  })
  app.use(plainApp)
  return { app, rawApp: plainApp, store }
}

// The same signed-in client over any store (the PostgreSQL suite): the session is created
// through the store before a request whenever it is missing. If the store cannot be reached the
// request goes on without one, so the app itself answers (and logs) the failure.
export function signedInClient(rawApp: ReturnType<typeof createApp>, store: Store, orgId = demoOrgId) {
  let sessionId: string | undefined
  const forever = Date.parse('9999-12-31T00:00:00.000Z')

  async function ensure(): Promise<void> {
    if (sessionId && await store.findSession(hashSessionId(sessionId))) return
    const id = createSessionId()
    await store.createSession({ idHash: hashSessionId(id), orgId, createdAt: fixedNow, lastSeenAt: forever, expiresAt: forever, absoluteExpiresAt: forever })
    sessionId = id
  }

  const app = express()
  app.disable('x-powered-by')
  app.use((req, _res, next) => {
    ensure().catch(() => undefined).finally(() => {
      if (req.headers.cookie === undefined && sessionId) req.headers.cookie = `${sessionCookieName}=${sessionId}`
      if (req.headers['x-csrf-protection'] === undefined) req.headers['x-csrf-protection'] = '1'
      next()
    })
  })
  app.use(rawApp)
  return app
}

export type TestApp = Parameters<typeof request>[0]

// A Supertest agent that keeps cookies like a browser and sends the CSRF header on every
// request.
export function newAgent(app: TestApp) {
  return request.agent(app).set(csrfHeader, '1')
}

// A real sign-in (POST /api/session) on a new agent.
export async function signInAgent(app: TestApp, username = demoUsername, password = demoPassword) {
  const agent = newAgent(app)
  const response = await agent.post('/api/session').send({ username, password })
  expect(response.status, `sign-in of ${username} failed`).toBe(200)
  return agent
}

// A real sign-in that returns the `Cookie` header value (`cr_session=<id>`) to set by hand.
export async function signInCookie(app: TestApp, username = demoUsername, password = demoPassword): Promise<string> {
  const response = await request(app).post('/api/session').set(csrfHeader, '1').send({ username, password })
  expect(response.status, `sign-in of ${username} failed`).toBe(200)
  return (sessionCookieOf(response) ?? '').split(';')[0] ?? ''
}

export type Registration = { username: string, email: string, password: string }

export function registrationOf(name: string): Registration {
  return { username: name, email: `${name}@example.com`, password: `${name}-Secret-42` }
}

// A real registration (POST /api/account) on a new agent; the agent is then signed in.
export async function registerAgent(app: TestApp, registration: Registration) {
  const agent = newAgent(app)
  const response = await agent.post('/api/account').send(registration)
  expect(response.status, `registration of ${registration.username} failed`).toBe(201)
  return agent
}

// The `cr_session` Set-Cookie line of a response, or undefined.
export function sessionCookieOf(response: { headers: Record<string, unknown> }): string | undefined {
  const header = response.headers['set-cookie']
  const list = Array.isArray(header) ? header as string[] : typeof header === 'string' ? [header] : []
  return list.find((line) => line.startsWith(`${sessionCookieName}=`))
}

// Polls until the background analysis has moved the review out of `pending`.
export async function waitForStatus(app: TestApp, id: string, status: string) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const response = await request(app).get(`/api/review/${id}`)
    if (response.body.status === status) return response
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  expect.fail(`Review ${id} never reached status ${status}.`)
}

// The same, through a signed-in agent (its own session and org).
export async function waitForAgentStatus(agent: ReturnType<typeof newAgent>, id: string, status: string) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const response = await agent.get(`/api/review/${id}`)
    if (response.body.status === status) return response
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  expect.fail(`Review ${id} never reached status ${status}.`)
}

export const validSettings = {
  notification: { reviewCompleted: false, reviewFailed: true, criticalFinding: true, email: true },
  theme: 'dark',
  editorFontSize: 'large',
  historyDensity: 'compact',
  reviewFocus: 'security',
  strictness: 'comprehensive',
  explanation: 'concise',
  generatedTest: false,
  language: 'TypeScript'
}

// The store starts with no reviews (plan 019 addendum). Tests that need a review with a known
// id and known content put one in through the store (the demo org unless another is named);
// tests of the create flow use the API.
export function addReview(store: MemoryStore, override: Partial<Review> & { id: string, createdAt?: number }, orgId = demoOrgId): ReviewRecord {
  const { id, createdAt = fixedNow, ...review } = override
  const record: ReviewRecord = {
    id,
    createdAt,
    analyzedAt: createdAt,
    run: 0,
    saved: null,
    deleted: false,
    review: {
      title: `Review ${id}`,
      status: 'completed',
      language: 'TypeScript',
      analyzedAgo: 'just now',
      qualityScore: 72,
      content: 'const value: any = 1\n',
      findingCount: [
        { severity: 'critical', count: 1 }, { severity: 'high', count: 1 },
        { severity: 'medium', count: 1 }, { severity: 'low', count: 0 }
      ],
      finding: [
        { id: 'f1', severity: 'critical', category: 'security', message: 'Injection', detail: 'Line 1', line_start: 1 },
        { id: 'f2', severity: 'high', category: 'bug', message: 'No error check', detail: 'Line 1', line_start: 1 },
        { id: 'f3', severity: 'medium', category: 'maintainability', message: 'Untyped value', detail: 'Line 1', line_start: 1 }
      ],
      suggestion: [{ id: 's1', title: 'Type the value', detail: 'Replace any' }],
      generatedTest: [
        { id: `${id}-t1`, sourceFile: 'a.ts', testFile: 'a.test.ts', language: 'TypeScript', code: 'first a', altCode: 'second a' },
        { id: `${id}-t2`, sourceFile: 'b.ts', testFile: 'b.test.ts', language: 'TypeScript', code: 'first b', altCode: 'second b' }
      ],
      ...review
    }
  }
  const org = store.orgMap.get(orgId)
  if (!org) throw new Error(`No org ${orgId} in the store.`)
  org.reviewList.unshift(record)
  return record
}
