import type { Page, PlaywrightWorkerArgs, Route } from '@playwright/test'
import { API_PATH, AUTH_CODE_PATTERN, SESSION_TOKEN_PATTERN, SESSION_TOKEN_STORAGE_KEY } from '../../src/lib/api.constants'
import { AUTH_ERROR_TEXT, SESSION_TEXT } from '../../src/lib/session.constants'
import { BACKEND_URL } from './e2e.constants'
import { apiRoute, expect, test } from './fixture'

// Plan 048: "Continue with GitHub" ends signed in when the browser drops the session cookie of the
// redirect (Safari). The backend runs with SESSION_TOKEN_FALLBACK=on and the fake GitHub sign-in
// (GITHUB_OAUTH_FAKE, playwright.config.ts). The "GitHub" page is not reached: the navigation to
// github.com is answered with the redirect to the backend callback, as GitHub would.

test.use({ signIn: false })

const callbackPath = '/api/auth/github/callback'
const startUrl = new RegExp(`^${BACKEND_URL.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}${API_PATH.githubSignIn}(\\?.*)?$`)

// The start route is real (it sets the state cookie and picks the state). Its redirect to
// github.com is replaced by what GitHub would send back, the callback (a fake user's code, or an
// error): a hop of a redirect cannot be intercepted, so the start request itself is answered.
// With `drop`, the callback is called here instead of by the browser and its Set-Cookie (the
// session cookie a Safari tab would drop) is removed from the answer; `drop.seen` receives the
// Location of the real redirect (the return address with its code).
interface Drop {
  playwright: PlaywrightWorkerArgs['playwright']
  seen: string[]
}

async function answerGithub(page: Page, drop?: Drop, query: (state: string) => string = (state) => `code=fake-octocat&state=${state}`) {
  await page.route(startUrl, async (route: Route) => {
    const start = await route.fetch({ maxRedirects: 0 })
    const state = new URL(start.headers().location ?? '').searchParams.get('state') ?? ''
    const callback = `${BACKEND_URL}${callbackPath}?${query(state)}`
    if (!drop) {
      const cookie = start.headers()['set-cookie']
      return route.fulfill({ status: 302, headers: { Location: callback, ...(cookie ? { 'set-cookie': cookie } : {}) } })
    }
    const stateCookie = (start.headers()['set-cookie'] ?? '').split(';')[0]
    const api = await drop.playwright.request.newContext()
    const answer = await api.fetch(callback, { headers: { cookie: stateCookie }, maxRedirects: 0 })
    const location = answer.headers().location ?? ''
    await api.dispose()
    drop.seen.push(location)
    return route.fulfill({ status: 302, headers: { Location: location } })
  })
}

const storedToken = (page: Page) => page.evaluate((key) => window.localStorage.getItem(key), SESSION_TOKEN_STORAGE_KEY)
const mainNav = (page: Page) => page.getByRole('navigation', { name: 'Main' })

// Records every address the page shows, from before any script runs (history writes included).
async function watchAddress(page: Page) {
  await page.addInitScript(() => {
    const seen: string[] = [location.href]
    for (const name of ['pushState', 'replaceState'] as const) {
      const original = history[name]
      history[name] = function (this: History, ...args: Parameters<History['pushState']>) {
        original.apply(this, args)
        seen.push(location.href)
      }
    }
    ;(window as unknown as { __seen: string[] }).__seen = seen
  })
}

test.describe('the browser drops the session cookie of the GitHub redirect', () => {
  test('Continue with GitHub ends signed in, a reload keeps the session, and the code leaves the address', async ({ page, playwright }) => {
    const locationList: string[] = []
    await answerGithub(page, { playwright, seen: locationList })
    await watchAddress(page)
    await page.goto('/login')

    await page.getByRole('link', { name: SESSION_TEXT.continueWithGithub }).click()

    await expect(mainNav(page)).toBeVisible()
    // The redirect really carried a code in the fragment, never in the query.
    expect(locationList).toHaveLength(1)
    const redirect = new URL(locationList[0])
    expect(redirect.search).toBe('')
    const code = new URLSearchParams(redirect.hash.slice(1)).get('auth_code') ?? ''
    expect(code).toMatch(AUTH_CODE_PATTERN)

    // Gone from the address bar and from every address the app wrote.
    expect(page.url()).not.toContain('auth_code')
    expect(page.url()).not.toContain(code)
    expect(await page.evaluate(() => window.location.hash)).toBe('')
    // The first entry is the landing address as the browser loaded it; everything the app wrote after it is clean.
    const [landing, ...written] = await page.evaluate(() => (window as unknown as { __seen: string[] }).__seen)
    expect(landing).toContain(code)
    expect(written.length).toBeGreaterThan(0)
    expect(written.filter((url) => url.includes('auth_code') || url.includes(code))).toEqual([])

    // The token is kept (the cookie did not stick) and no session cookie exists.
    expect(JSON.parse((await storedToken(page)) ?? 'null')).toMatch(SESSION_TOKEN_PATTERN)
    expect((await page.context().cookies(BACKEND_URL)).filter((one) => /session/i.test(one.name))).toEqual([])

    await page.reload()
    await expect(mainNav(page)).toBeVisible()
    await expect(page).not.toHaveURL(/\/login/)
  })

  test('the same return address opened again fails with the invalid_state message and stores no token', async ({ page, playwright }) => {
    const locationList: string[] = []
    await answerGithub(page, { playwright, seen: locationList })
    await page.goto('/login')
    await page.getByRole('link', { name: SESSION_TEXT.continueWithGithub }).click()
    await expect(mainNav(page)).toBeVisible()

    // Signed out on this device, the already used return address is opened a second time.
    await page.evaluate((key) => window.localStorage.removeItem(key), SESSION_TOKEN_STORAGE_KEY)
    await page.goto('about:blank')
    await page.goto(locationList[0])

    await expect(page.getByRole('alert')).toHaveText(AUTH_ERROR_TEXT.invalid_state)
    await expect(page).toHaveURL(/\/login$/)
    expect(await storedToken(page)).toBeNull()
  })

  test('a failed exchange (the endpoint is unreachable) shows the invalid_state message and stores no token', async ({ page }) => {
    await page.route(apiRoute(API_PATH.githubExchange), (route: Route) => route.abort('failed'))
    await page.goto(`/#auth_code=${'A'.repeat(43)}`)

    await expect(page.getByRole('alert')).toHaveText(AUTH_ERROR_TEXT.invalid_state)
    await expect(page).toHaveURL(/\/login$/)
    expect(await storedToken(page)).toBeNull()
  })

  test('without an auth_code in the address nothing is exchanged', async ({ page }) => {
    let exchanged = 0
    await page.route(apiRoute(API_PATH.githubExchange), (route: Route) => {
      exchanged += 1
      return route.abort('failed')
    })
    await page.goto('/login#top')
    await expect(page.getByRole('button', { name: SESSION_TEXT.signIn })).toBeVisible()
    await expect(page.getByRole('alert')).toHaveCount(0)
    expect(exchanged).toBe(0)
    expect(await storedToken(page)).toBeNull()
  })
})

test.describe('the session cookie works', () => {
  test('Continue with GitHub ends signed in and cr.sessionToken is never written', async ({ page }) => {
    await page.addInitScript((key) => {
      const original = Storage.prototype.setItem
      Storage.prototype.setItem = function (name: string, value: string) {
        if (name === key) window.sessionStorage.setItem('tokenWritten', 'yes')
        return original.call(this, name, value)
      }
    }, SESSION_TOKEN_STORAGE_KEY)
    await answerGithub(page)
    const exchangeList: number[] = []
    page.on('response', (response) => {
      if (response.url().endsWith(API_PATH.githubExchange) && response.request().method() === 'POST') exchangeList.push(response.status())
    })
    await page.goto('/login')

    await page.getByRole('link', { name: SESSION_TEXT.continueWithGithub }).click()

    await expect(mainNav(page)).toBeVisible()
    expect(exchangeList).toEqual([200])
    expect(page.url()).not.toContain('auth_code')
    await page.reload()
    await expect(mainNav(page)).toBeVisible()
    expect(await storedToken(page)).toBeNull()
    expect(await page.evaluate(() => window.sessionStorage.getItem('tokenWritten'))).toBeNull()
  })

  test('a cancelled GitHub sign-in (access_denied) shows its message and creates no token', async ({ page }) => {
    await answerGithub(page, undefined, (state) => `error=access_denied&state=${state}`)
    await page.goto('/login')

    await page.getByRole('link', { name: SESSION_TEXT.continueWithGithub }).click()

    await expect(page.getByRole('alert')).toHaveText(AUTH_ERROR_TEXT.access_denied)
    expect(await storedToken(page)).toBeNull()
  })
})
