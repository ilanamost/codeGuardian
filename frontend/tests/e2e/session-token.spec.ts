import type { Page } from '@playwright/test'
import { SESSION_TOKEN_PATTERN, SESSION_TOKEN_STORAGE_KEY } from '../../src/lib/api.constants'
import { BACKEND_URL, DEMO_PASSWORD, DEMO_USERNAME } from './e2e.constants'
import { expect, test } from './fixture'

// Plan 047: the bearer-token fallback in a real browser against the real backend (started with
// SESSION_TOKEN_FALLBACK=on, see playwright.config.ts). One block strips every Set-Cookie, as
// Safari does for a cross-site API; the other leaves the cookie alone.

test.use({ signIn: false })

async function signIn(page: Page) {
  await page.goto('/login')
  await page.getByLabel('User name').fill(DEMO_USERNAME)
  await page.getByLabel('Password', { exact: true }).click()
  await page.getByLabel('Password', { exact: true }).fill(DEMO_PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
}

const storedToken = (page: Page) => page.evaluate((key) => window.localStorage.getItem(key), SESSION_TOKEN_STORAGE_KEY)

test.describe('the browser blocks the session cookie', () => {
  test.beforeEach(async ({ page, playwright }) => {
    await page.route(`${BACKEND_URL}/**`, async (route) => {
      if (route.request().method() === 'OPTIONS') return route.continue()
      // A fresh request context per call: route.fetch would share the browser's cookie jar.
      const api = await playwright.request.newContext()
      const response = await api.fetch(route.request())
      const headers = { ...response.headers() }
      delete headers['set-cookie']
      const body = await response.body()
      await api.dispose()
      return route.fulfill({ status: response.status(), headers, body })
    })
  })

  test('sign-in works, a reload keeps the user signed in, and the token is stored', async ({ page }) => {
    await signIn(page)
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible()

    const token = JSON.parse((await storedToken(page)) ?? 'null') as string
    expect(token).toMatch(SESSION_TOKEN_PATTERN)
    expect(await page.context().cookies()).toEqual([])

    await page.reload()
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible()
    await expect(page).not.toHaveURL(/\/login/)
  })

  test('sign-out clears the stored token', async ({ page }) => {
    await signIn(page)
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible()

    await page.goto('/settings')
    await page.getByRole('tab', { name: 'Security' }).click()
    await page.getByRole('button', { name: 'Sign Out' }).click()
    await page.getByRole('dialog', { name: 'Sign out?' }).getByRole('button', { name: 'Sign out' }).click()

    await expect(page).toHaveURL(/\/login$/)
    expect(await storedToken(page)).toBeNull()
  })

  test('a 401 clears the stored token and returns to /login', async ({ page }) => {
    await signIn(page)
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible()
    await page.evaluate((key) => window.localStorage.setItem(key, JSON.stringify('a'.repeat(43))), SESSION_TOKEN_STORAGE_KEY)

    await page.reload()

    await expect(page).toHaveURL(/\/login/)
    expect(await storedToken(page)).toBeNull()
  })
})

test.describe('the session cookie works', () => {
  test('cr.sessionToken is never written', async ({ page }) => {
    await page.addInitScript((key) => {
      const original = Storage.prototype.setItem
      Storage.prototype.setItem = function (name: string, value: string) {
        if (name === key) window.sessionStorage.setItem('tokenWritten', 'yes')
        return original.call(this, name, value)
      }
    }, SESSION_TOKEN_STORAGE_KEY)

    await signIn(page)
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible()
    await page.reload()
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible()

    expect(await storedToken(page)).toBeNull()
    expect(await page.evaluate(() => window.sessionStorage.getItem('tokenWritten'))).toBeNull()
  })
})
