import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { resolve } from 'node:path'
import { unfinishedStatusList } from '../../src/models/review.model'
import type { NewReviewDto, ReviewDetailDto, ReviewDto } from '../../src/models/dto'
import { createApiService, type FetchFn } from '../../src/services/api.service'
import { createSessionService } from '../../src/services/session.service'
import type { StorageService } from '../../src/services/storage.service'
import type { DataSource } from '../../src/services/data-source'
import type { ReviewService } from '../../src/services/review.service'

// The real backend app (backend/src/app.ts) on an ephemeral port, in process, for the
// cross-stack Vitest suites (plan 019), signed in as the demo account through a cookie jar
// (plan 028). Since the addendum of 2026-10-23 the backend starts with
// no reviews, so tests create every review they use (createCompletedReview).
//
// Backend modules are imported by path at run time: the backend source is typechecked by the
// backend (its compiler options differ), so the frontend typecheck must not pull it in. The
// types below are the small part of the backend API these tests use.

type AnalyzerInput = { reviewId: string; title: string; language: string; content: string }
export type BackendAnalyzer = {
  analyze: (input: AnalyzerInput) => Promise<unknown>
  // Plan 034: the test configuration (framework and kinds) passes through to the stub.
  regenerateTest: (fileList: unknown[], testConfig?: unknown) => Promise<unknown[]>
}
type BackendRecord = { id: string; review: ReviewDto; createdAt: number; saved: null; deleted: boolean }
export type BackendStore = { state: { reviewList: BackendRecord[] } }
type BackendApp = { listen: (port: number, host: string, done: () => void) => Server }

const backendSrc = resolve(__dirname, '../../../backend/src')
const host = '127.0.0.1'
const frontendUrl = 'http://localhost'

// Content that contains this marker stays `pending` with holdingAnalyzer (the stub analyzer
// otherwise completes a review at once, so a not-completed review cannot be made through the API).
export const HOLD_MARKER = 'HOLD-ANALYSIS'

export async function createStubAnalyzer(): Promise<BackendAnalyzer> {
  const module = (await import(/* @vite-ignore */ resolve(backendSrc, 'analyzer/stub-analyzer.ts'))) as {
    createStubAnalyzer: () => BackendAnalyzer
  }
  return module.createStubAnalyzer()
}

// The stub analyzer, except that a review whose content has HOLD_MARKER never finishes.
export async function createHoldingAnalyzer(): Promise<BackendAnalyzer> {
  const stub = await createStubAnalyzer()
  return {
    analyze: (input) => (input.content.includes(HOLD_MARKER) ? new Promise(() => {}) : stub.analyze(input)),
    regenerateTest: (fileList, testConfig) => stub.regenerateTest(fileList, testConfig)
  }
}

export async function createBackendStore(): Promise<BackendStore> {
  const module = (await import(/* @vite-ignore */ resolve(backendSrc, 'store/memory-store.ts'))) as {
    createMemoryStore: () => BackendStore
  }
  return module.createMemoryStore()
}

// The backend's GitHub client over its test-only fake GitHub (backend/src/lib/github-fake.ts,
// plan 023), so POST /api/github/import never reaches the network from a test.
export async function createFakeGithubClient(): Promise<unknown> {
  const fake = (await import(/* @vite-ignore */ resolve(backendSrc, 'lib/github-fake.ts'))) as { createFakeGithubFetch: () => unknown }
  const client = (await import(/* @vite-ignore */ resolve(backendSrc, 'lib/github-fetch.ts'))) as {
    createGithubClient: (option: { fetch: unknown }) => unknown
  }
  return client.createGithubClient({ fetch: fake.createFakeGithubFetch() })
}

// The demo account the backend seeds (plan 028, Open Question 8). Local demo credentials, not secrets.
export const DEMO_USERNAME = 'john.doe'
export const DEMO_PASSWORD = 'mock-password'

// A cookie jar for the HTTP data source in node (plan 028): node's fetch keeps no cookies, so
// this fetch stores every `Set-Cookie` (a `Max-Age=0` one deletes it) and sends them back,
// as a browser does with `credentials: 'include'`. The CSRF header comes from api.service itself.
export interface CookieJar {
  fetchFn: FetchFn
  // The cookies as `name=value` pairs, e.g. to check that the session cookie was rotated.
  get: (name: string) => string | undefined
  clear: () => void
  set: (name: string, value: string) => void
}

export function createCookieJar(): CookieJar {
  const cookieMap = new Map<string, string>()
  const fetchFn: FetchFn = async (input, init) => {
    const headers = new Headers(init.headers)
    if (cookieMap.size > 0) headers.set('Cookie', [...cookieMap].map(([name, value]) => `${name}=${value}`).join('; '))
    const response = await globalThis.fetch(input, { ...init, headers })
    for (const line of response.headers.getSetCookie()) {
      const [pair, ...attributeList] = line.split(';').map((part) => part.trim())
      const index = pair.indexOf('=')
      const name = pair.slice(0, index)
      const value = pair.slice(index + 1)
      const expired = attributeList.some((attribute) => /^max-age=0$/i.test(attribute)) || value === ''
      if (expired) cookieMap.delete(name)
      else cookieMap.set(name, value)
    }
    return response
  }
  return {
    fetchFn,
    get: (name) => cookieMap.get(name),
    clear: () => cookieMap.clear(),
    set: (name, value) => {
      cookieMap.set(name, value)
    }
  }
}

export interface RunningBackend {
  source: DataSource
  store: BackendStore
  jar: CookieJar
  baseUrl: string
  close: () => Promise<void>
}

// Since plan 028 every route but a few public ones needs a session: unless `signIn` is false,
// the harness signs in as the demo account first (POST /api/session through the cookie jar).
// `wrapFetch` sees every call on the wire (after the cookie jar).
export interface StartBackendOption {
  analyzer?: BackendAnalyzer
  store?: BackendStore
  signIn?: boolean
  wrapFetch?: (fetchFn: FetchFn) => FetchFn
  // Plan 047: the backend's SESSION_TOKEN_FALLBACK switch (off by default).
  sessionTokenFallback?: boolean
  // Plan 047: where the HTTP source keeps the session token (the real localStorage by default).
  storage?: StorageService
  // Plan 047: the browser drops every Set-Cookie (Safari with a cross-site API).
  blockCookie?: boolean
}

export async function startBackend(option: StartBackendOption = {}): Promise<RunningBackend> {
  const { createApp } = (await import(/* @vite-ignore */ resolve(backendSrc, 'app.ts'))) as {
    createApp: (config: { frontendUrl: string; enableTestRoute: boolean; sessionTokenFallback?: boolean }, appOption?: object) => BackendApp
  }
  const store = option.store ?? (await createBackendStore())
  // A new app per test is a new in-memory store: no reviews, the GitHub mock, account and settings.
  const app = createApp(
    { frontendUrl, enableTestRoute: false, sessionTokenFallback: option.sessionTokenFallback ?? false },
    { store, analyzer: option.analyzer, githubClient: await createFakeGithubClient() }
  )
  let server: Server | undefined
  await new Promise<void>((done) => {
    server = app.listen(0, host, done)
  })
  const { port } = server!.address() as AddressInfo
  const baseUrl = `http://${host}:${port}`
  const jar = createCookieJar()
  // A blocked cookie: the jar never sees a Set-Cookie, so no cookie is ever sent back.
  const jarFetch: FetchFn = option.blockCookie
    ? async (input, init) => {
        const response = await globalThis.fetch(input, init)
        const headers = new Headers(response.headers)
        headers.delete('set-cookie')
        return new Response(response.body, { status: response.status, headers })
      }
    : jar.fetchFn
  const fetchFn = option.wrapFetch ? option.wrapFetch(jarFetch) : jarFetch
  const source = createApiService({ baseUrl, fetchFn, storage: option.storage })
  if (option.signIn !== false) await createSessionService(source).signIn({ username: DEMO_USERNAME, password: DEMO_PASSWORD })
  return {
    source,
    store,
    jar,
    baseUrl,
    close: () => new Promise<void>((done) => server!.close(() => done()))
  }
}

// Creates a review through POST /api/review and polls GET /api/review/{id} until it finishes.
export async function createCompletedReview(review: ReviewService, input: NewReviewDto): Promise<ReviewDetailDto> {
  const created = await review.create(input)
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const detail = await review.get(created.id)
    if (detail && !unfinishedStatusList.includes(detail.review.status)) return detail
    await new Promise((done) => setTimeout(done, 10))
  }
  throw new Error(`review ${created.id} never finished`)
}
