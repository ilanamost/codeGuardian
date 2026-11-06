import { test as base, expect, type APIRequestContext, type Page, type Route } from '@playwright/test'
import { API_PATH, CSRF_HEADER, SNIPPET_SOURCE_TYPE } from '../../src/lib/api.constants'
import { unfinishedStatusList } from '../../src/models/review.model'
import type { ReviewStatus } from '../../src/models/dto'
import { BACKEND_URL, DEMO_PASSWORD, DEMO_USERNAME, FAKE_GITHUB_USER, FRONTEND_URL, TEST_RESET_PATH } from './e2e.constants'

// Every spec imports `test` from here: an automatic fixture restores the backend's store to its
// seed before each test (POST /api/test/reset, plan 019 Open Question 4), so no test depends on
// what another one wrote.
//
// Plan 028: the reset ends every session, so the fixture then signs in as the demo account
// through the browser context's own request context (`page.request`): the context holds the
// HttpOnly session cookie, and every page of the test starts signed in. A spec that needs a
// signed-out browser uses `test.use({ signIn: false })`.
// The `request` fixture is that same signed-in context, and it adds X-CSRF-Protection to every
// state-changing call, so the direct API helpers (createReview, setReviewFailed, ...) work.

type WriteOption = { headers?: Record<string, string> } & Record<string, unknown>

function withCsrf<T extends WriteOption | undefined>(option: T): T & { headers: Record<string, string> } {
  return { ...option, headers: { [CSRF_HEADER.name]: CSRF_HEADER.value, ...option?.headers } } as T & { headers: Record<string, string> }
}

// The context's request object, with the CSRF header on POST, PUT, PATCH and DELETE.
export function csrfRequest(api: APIRequestContext): APIRequestContext {
  const writeList = ['post', 'put', 'patch', 'delete']
  return new Proxy(api, {
    get(target, property, receiver) {
      if (typeof property === 'string' && writeList.includes(property)) {
        const send = Reflect.get(target, property, receiver) as (url: string, option?: WriteOption) => unknown
        return (url: string, option?: WriteOption) => send.call(target, url, withCsrf(option))
      }
      if (property === 'fetch') {
        return (input: Parameters<APIRequestContext['fetch']>[0], option?: WriteOption & { method?: string }) =>
          target.fetch(input, option?.method && option.method.toUpperCase() !== 'GET' ? withCsrf(option) : option)
      }
      const value = Reflect.get(target, property, receiver)
      return typeof value === 'function' ? value.bind(target) : value
    }
  })
}

// POST /api/session as the demo account through `api` (a context's request object).
export async function signInAs(api: APIRequestContext, username = DEMO_USERNAME, password = DEMO_PASSWORD) {
  const response = await csrfRequest(api).post(apiRoute(API_PATH.session), { data: { username, password } })
  expect(response.status(), `sign-in as ${username}`).toBe(200)
}

export const test = base.extend<{ signIn: boolean; resetBackend: void }>({
  signIn: [true, { option: true }],
  request: async ({ context }, provide) => {
    await provide(csrfRequest(context.request))
  },
  resetBackend: [
    async ({ request, signIn }, use) => {
      const response = await request.post(`${BACKEND_URL}${TEST_RESET_PATH}`)
      expect(response.status(), 'the backend must run with ENABLE_TEST_ROUTE=true (see playwright.config.ts)').toBe(204)
      if (signIn) await signInAs(request)
      await use()
    },
    { auto: true }
  ]
})

export { expect }

// Monaco comes from a CDN; its first load takes about 7 s on a busy machine (plan 029 QA, I1).
// Every spec waits this long for the editor to first appear.
export const MONACO_LOAD = { timeout: 30_000 }

// A backend route as a Playwright URL glob, e.g. apiRoute('/api/review/r1').
export function apiRoute(path: string): string {
  return `${BACKEND_URL}${path}`
}

// Requests send credentials (plan 028), so a forced answer names the frontend origin exactly
// and allows credentials, as the backend does; `*` would be refused by the browser.
const corsHeader = {
  'Access-Control-Allow-Origin': FRONTEND_URL,
  'Access-Control-Allow-Credentials': 'true',
  'Access-Control-Allow-Headers': `Content-Type, ${CSRF_HEADER.name}`,
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS'
}

// Plan 034: answers a backend request with this status and JSON body, and its CORS preflight.
export async function fulfillJson(route: Route, status: number, json: unknown) {
  if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: corsHeader })
  return route.fulfill({ status, headers: corsHeader, contentType: 'application/json', body: JSON.stringify(json) })
}

type Failure = { status: number } | 'network'

// Forces a failure at the network layer: a backend error status in the standard error shape, or
// a dropped connection. Only `method` requests fail (all when omitted); the CORS preflight of a
// failed request is answered so the browser sees the failure itself, not a CORS error.
// `exceptList`: backend paths the route lets through untouched (e.g. API_PATH.session, so the
// session restore still signs the page in while every other /api route fails).
export async function failRoute(page: Page, path: string, failure: Failure, method?: string, exceptList: string[] = []) {
  await page.route(apiRoute(path), async (route: Route) => {
    const requestMethod = route.request().method()
    const requestPath = new URL(route.request().url()).pathname
    if (exceptList.includes(requestPath)) return route.continue()
    if (requestMethod === 'OPTIONS') return route.fulfill({ status: 204, headers: corsHeader })
    if (method && requestMethod !== method) return route.continue()
    if (failure === 'network') return route.abort('failed')
    return route.fulfill({
      status: failure.status,
      headers: corsHeader,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'internal_error', message: 'Forced by the e2e test.' }, requestId: 'e2e' })
    })
  })
}

// Plan 030: on /github, types the user name of the backend's fake GitHub and connects, then
// waits for its repository list.
export async function connectFakeGithub(page: Page, username = FAKE_GITHUB_USER) {
  await page.getByRole('textbox', { name: 'GitHub user name' }).fill(username)
  await page.getByRole('button', { name: 'Connect GitHub' }).click()
  await expect(page.getByText(`Connected as ${username}`)).toBeVisible()
}

// Sets the "Review failed" notification preference on the backend, where the app reads it.
export async function setReviewFailed(request: APIRequestContext, enabled: boolean) {
  await setNotification(request, { reviewFailed: enabled })
}

// Changes notification preferences on the backend (the signed-in account's settings).
export async function setNotification(request: APIRequestContext, change: Record<string, boolean>) {
  const current = await (await csrfRequest(request).get(apiRoute(API_PATH.settings))).json()
  const response = await csrfRequest(request).put(apiRoute(API_PATH.settings), {
    data: { ...current, notification: { ...current.notification, ...change } }
  })
  expect(response.status()).toBe(204)
}

// Changes other settings on the backend (e.g. review focus, generated tests).
export async function setSettings(request: APIRequestContext, change: Record<string, unknown>) {
  const current = await (await csrfRequest(request).get(apiRoute(API_PATH.settings))).json()
  const response = await csrfRequest(request).put(apiRoute(API_PATH.settings), { data: { ...current, ...change } })
  expect(response.status()).toBe(204)
}

// Code the backend's stub analyzer turns into findings in two categories: security (eval) and
// maintainability (any, TODO), so a created review has findings, suggestions and generated tests.
export const FINDING_CODE = 'const value: any = eval(input)\n// TODO remove the eval\n'

export interface CreatedReview {
  id: string
  title: string
}

// Plan 019 addendum: the backend starts with no reviews, so a test creates every review it uses.
// POST /api/review, then GET /api/review/{id} until the stub analyzer has finished it.
export async function createReview(
  request: APIRequestContext,
  input: { title: string; language?: string; content?: string }
): Promise<CreatedReview> {
  const response = await csrfRequest(request).post(apiRoute(API_PATH.review), {
    data: { source_type: SNIPPET_SOURCE_TYPE, title: input.title, language: input.language ?? 'TypeScript', content: input.content ?? FINDING_CODE }
  })
  expect(response.status()).toBe(202)
  const { id } = (await response.json()) as { id: string }
  await expect
    .poll(async () => ((await (await csrfRequest(request).get(apiRoute(API_PATH.reviewById(id)))).json()) as { status: ReviewStatus }).status)
    .not.toMatch(new RegExp(`^(${unfinishedStatusList.join('|')})$`))
  return { id, title: input.title }
}

// Shows an existing review as `status` (for example pending) by rewriting its GET answers: the
// stub analyzer finishes every review at once, so an unfinished one cannot be made otherwise.
export async function showReviewAs(page: Page, id: string, status: ReviewStatus) {
  await page.route(apiRoute(API_PATH.reviewById(id)), async (route: Route) => {
    if (route.request().method() !== 'GET') return route.continue()
    const response = await route.fetch()
    if (!response.ok()) return route.fulfill({ response })
    return route.fulfill({ response, json: { ...(await response.json()), status } })
  })
}
