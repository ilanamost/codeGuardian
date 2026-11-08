import type { Page, PlaywrightWorkerArgs, Route } from '@playwright/test'
import { API_PATH, AUTH_CODE_PATTERN, SESSION_TOKEN_STORAGE_KEY } from '../../src/lib/api.constants'
import { AUTH_ERROR_TEXT, SESSION_TEXT } from '../../src/lib/session.constants'
import { BACKEND_URL } from './e2e.constants'
import { expect, test } from './fixture'

// QA plan 048: try to break the GitHub return in a real browser (cookie stripped, as on Safari).

test.use({ signIn: false })

const startUrl = new RegExp('^' + BACKEND_URL.split('.').join('[.]') + API_PATH.githubSignIn + '([?].*)?$')
const mainNav = (page: Page) => page.getByRole('navigation', { name: 'Main' })
const storedToken = (page: Page) => page.evaluate((key) => window.localStorage.getItem(key), SESSION_TOKEN_STORAGE_KEY)

// Answers the start route with the real callback, called outside the browser with its session cookie dropped.
async function stripCookieFlow(page: Page, playwright: PlaywrightWorkerArgs['playwright'], seen: string[]) {
  await page.route(startUrl, async (route: Route) => {
    const start = await route.fetch({ maxRedirects: 0 })
    const state = new URL(start.headers().location ?? '').searchParams.get('state') ?? ''
    const stateCookie = (start.headers()['set-cookie'] ?? '').split(';')[0]
    const api = await playwright.request.newContext()
    const answer = await api.fetch(`${BACKEND_URL}/api/auth/github/callback?code=fake-octocat&state=${state}`, { headers: { cookie: stateCookie }, maxRedirects: 0 })
    const location = answer.headers().location ?? ''
    await api.dispose()
    seen.push(location)
    return route.fulfill({ status: 302, headers: { Location: location } })
  })
}

// A fresh one-time code (the callback is real) without opening it in the browser.
async function freshReturn(playwright: PlaywrightWorkerArgs['playwright']): Promise<string> {
  const start = await playwright.request.newContext()
  const first = await start.fetch(`${BACKEND_URL}${API_PATH.githubSignIn}`, { maxRedirects: 0 })
  const state = new URL(first.headers().location ?? '').searchParams.get('state') ?? ''
  const stateCookie = (first.headers()['set-cookie'] ?? '').split(';')[0]
  const answer = await start.fetch(`${BACKEND_URL}/api/auth/github/callback?code=fake-octocat&state=${state}`, { headers: { cookie: stateCookie }, maxRedirects: 0 })
  await start.dispose()
  return answer.headers().location ?? ''
}

test('no request, Referer or console line carries the code or the token; Back and Forward never bring it back', async ({ page, playwright }) => {
  const seen: string[] = []
  const urlList: string[] = []
  const refererList: string[] = []
  const consoleList: string[] = []
  const exchangeList: number[] = []
  page.on('request', (request) => {
    urlList.push(request.url())
    const referer = request.headers().referer
    if (referer) refererList.push(referer)
  })
  page.on('console', (message) => consoleList.push(message.text()))
  page.on('pageerror', (error) => consoleList.push(error.message))
  page.on('response', (response) => {
    if (response.url().endsWith(API_PATH.githubExchange)) exchangeList.push(response.status())
  })
  await stripCookieFlow(page, playwright, seen)
  await page.goto('/login')

  await page.getByRole('link', { name: SESSION_TEXT.continueWithGithub }).click()
  await expect(mainNav(page)).toBeVisible()

  const code = new URLSearchParams(new URL(seen[0]).hash.slice(1)).get('auth_code') ?? ''
  expect(code).toMatch(AUTH_CODE_PATTERN)
  const token = JSON.parse((await storedToken(page)) ?? 'null') as string
  expect(token).toBeTruthy()

  // No URL ever carried the code (a fragment is not sent) or the token; no Referer did either.
  expect(urlList.filter((url) => url.includes(code) || url.includes(token))).toEqual([])
  expect(refererList.filter((url) => url.includes(code) || url.includes('auth_code') || url.includes(token))).toEqual([])
  expect(consoleList.filter((line) => line.includes(code) || line.includes(token))).toEqual([])
  // Page text and attributes show neither.
  const html = await page.content()
  expect(html).not.toContain(code)
  expect(html).not.toContain(token)

  // Back to the login page and Forward again: the address has no code, and no second exchange happens.
  await page.goBack().catch(() => undefined)
  expect(page.url()).not.toContain('auth_code')
  await page.goForward().catch(() => undefined)
  expect(page.url()).not.toContain('auth_code')
  expect(exchangeList).toEqual([200])
  await page.reload()
  await expect(mainNav(page)).toBeVisible()
  expect(exchangeList).toEqual([200])
})

test('a return address with extra fragment content still signs in, and every auth_code is removed', async ({ page, playwright }) => {
  const location = await freshReturn(playwright)
  const code = new URLSearchParams(new URL(location).hash.slice(1)).get('auth_code') ?? ''
  expect(code).toMatch(AUTH_CODE_PATTERN)
  const base = location.split('#')[0]

  await page.goto(`${base}#keep&auth_code=nope&auth_code=${code}&other=1`)

  await expect(mainNav(page)).toBeVisible()
  expect(page.url()).not.toContain('auth_code')
  expect(page.url()).not.toContain(code)
})

test('a code that is past its 60 seconds (waited out) is refused with the invalid_state message and stores no token', async ({ page, playwright }) => {
  test.setTimeout(120_000)
  const location = await freshReturn(playwright)
  await page.waitForTimeout(61_000)

  await page.goto(location)

  await expect(page.getByRole('alert')).toHaveText(AUTH_ERROR_TEXT.invalid_state)
  expect(await storedToken(page)).toBeNull()
})

test('a code in the query string (wrong place) is not exchanged and not stripped', async ({ page, playwright }) => {
  const location = await freshReturn(playwright)
  const code = new URLSearchParams(new URL(location).hash.slice(1)).get('auth_code') ?? ''
  let exchanged = 0
  page.on('request', (request) => {
    if (request.url().endsWith(API_PATH.githubExchange)) exchanged += 1
  })

  await page.goto(`/login?auth_code=${code}`)

  await expect(page.getByRole('button', { name: SESSION_TEXT.signIn })).toBeVisible()
  expect(exchanged).toBe(0)
  expect(await storedToken(page)).toBeNull()
})

test('a garbage 5000-character fragment does not break the login page', async ({ page }) => {
  await page.goto(`/login#${'z'.repeat(5000)}&auth_code=${'x'.repeat(5000)}`)
  await expect(page.getByRole('button', { name: SESSION_TEXT.signIn })).toBeVisible()
  expect(await storedToken(page)).toBeNull()
})
