import type { Page } from '@playwright/test'
import { API_PATH } from '../../src/lib/api.constants'
import { SESSION_ERROR_MESSAGE } from '../../src/utils/error-messages'
import { DEMO_PASSWORD, DEMO_USERNAME } from './e2e.constants'
import { apiRoute, csrfRequest, expect, test } from './fixture'

// Plan 028 (the plan's `auth.spec.ts`; renamed for the guardrail hook): sign-in, the route
// guard, session restore on refresh, sign-out and the HttpOnly session cookie, against the real
// backend. The auto fixture signs in unless a describe block turns it off.

const SESSION_COOKIE = 'cr_session'

// A password field stays read-only (no browser autofill) until it is clicked or focused (plan 029
// revision 2), so every spec clicks it before filling it, as a user does.
async function signIn(page: Page, username: string, password: string) {
  await page.getByLabel('User name').fill(username)
  await page.getByLabel('Password', { exact: true }).click()
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
}

test.describe('signed out', () => {
  test.use({ signIn: false })

  test('opening /review/new lands on /login, and signing in returns to /review/new', async ({ page }) => {
    await page.goto('/review/new')

    await expect(page).toHaveURL(/\/login$/)
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'Main' })).toHaveCount(0)
    await signIn(page, DEMO_USERNAME, DEMO_PASSWORD)

    await expect(page).toHaveURL(/\/review\/new$/)
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible()
  })

  test('keeps the search and hash of the asked-for page', async ({ page }) => {
    await page.goto('/settings?section=notifications#top')
    await expect(page).toHaveURL(/\/login$/)
    await signIn(page, DEMO_USERNAME, DEMO_PASSWORD)

    await expect(page).toHaveURL(/\/settings\?section=notifications#top$/)
    await expect(page.getByRole('tab', { name: 'Notifications' })).toHaveAttribute('aria-selected', 'true')
  })

  test('wrong credentials and an unknown user show the same generic message, and the password is cleared', async ({ page }) => {
    await page.goto('/login')

    await signIn(page, DEMO_USERNAME, 'not-the-password1')
    await expect(page.getByRole('alert')).toHaveText(SESSION_ERROR_MESSAGE.signInFailed)
    await expect(page.getByLabel('Password', { exact: true })).toHaveValue('')

    await signIn(page, 'nobody.here', 'not-the-password1')
    await expect(page.getByRole('alert')).toHaveText(SESSION_ERROR_MESSAGE.signInFailed)
    await expect(page).toHaveURL(/\/login$/)
  })

  test('empty fields show the required messages and send no request', async ({ page }) => {
    let sent = 0
    page.on('request', (request) => {
      if (request.url() === apiRoute(API_PATH.session) && request.method() === 'POST') sent += 1
    })
    await page.goto('/login')
    await page.getByRole('button', { name: 'Sign in' }).click()

    await expect(page.getByText('Enter your user name.')).toBeVisible()
    await expect(page.getByText('Enter your password.')).toBeVisible()
    expect(sent).toBe(0)
  })

  test('the session cookie is HttpOnly and not readable by the page', async ({ page, context }) => {
    await page.goto('/login')
    await signIn(page, DEMO_USERNAME, DEMO_PASSWORD)
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible()

    const cookie = (await context.cookies()).find((item) => item.name === SESSION_COOKIE)
    expect(cookie).toBeDefined()
    expect(cookie?.httpOnly).toBe(true)
    expect(cookie?.sameSite).toBe('Lax')
    expect(await page.evaluate(() => document.cookie)).not.toContain(SESSION_COOKIE)
  })
})

test.describe('signed in', () => {
  test('a refresh on /settings?section=security stays signed in on the same section, with no /login flash', async ({ page }) => {
    // Records every path the app shows and whether the login form ever renders.
    await page.addInitScript(() => {
      const seen: string[] = []
      ;(window as unknown as { seenPath: string[] }).seenPath = seen
      const record = () => seen.push(location.pathname)
      for (const name of ['pushState', 'replaceState'] as const) {
        const original = history[name].bind(history)
        history[name] = (...arg: Parameters<History['pushState']>) => {
          original(...arg)
          record()
        }
      }
      new MutationObserver(() => {
        if (document.querySelector('form[aria-label="Sign in"]')) record()
      }).observe(document, { childList: true, subtree: true })
    })
    await page.goto('/settings?section=security')
    await expect(page.getByRole('button', { name: 'Sign Out' })).toBeVisible()

    await page.reload()
    await expect(page.getByRole('tab', { name: 'Security' })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('button', { name: 'Sign Out' })).toBeVisible()
    await expect(page).toHaveURL(/\/settings\?section=security$/)
    const seenPath = await page.evaluate(() => (window as unknown as { seenPath: string[] }).seenPath)
    expect(seenPath).not.toContain('/login')
  })

  test('Sign Out shows the dialog, then /login and "Signed out"; Back does not reopen the app', async ({ page, context }) => {
    // In-app navigation only, so Back has an app page of the same document to go to.
    await page.goto('/')
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Review History' }).click()
    await page.getByRole('link', { name: 'Settings' }).first().click()
    await page.getByRole('tab', { name: 'Security' }).click()
    await page.getByRole('button', { name: 'Sign Out' }).click()
    const dialog = page.getByRole('dialog', { name: 'Sign out?' })
    await expect(dialog).toBeVisible()

    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog).toHaveCount(0)
    await page.getByRole('button', { name: 'Sign Out' }).click()
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)

    await page.getByRole('button', { name: 'Sign Out' }).click()
    await dialog.getByRole('button', { name: 'Sign out' }).click()
    await expect(page).toHaveURL(/\/login$/)
    await expect(page.getByText('Signed out', { exact: true })).toBeVisible()
    expect((await context.cookies()).some((item) => item.name === SESSION_COOKIE)).toBe(false)

    await page.goBack()
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'Main' })).toHaveCount(0)
    // The server ended the session too: an API call with the old cookie is 401.
    expect((await csrfRequest(page.request).get(apiRoute(API_PATH.account))).status()).toBe(401)
  })

  test('a session ended elsewhere: the next request goes to /login with one toast, and sign-in returns to the page', async ({ page, request }) => {
    await page.goto('/history')
    await expect(page.getByRole('heading', { name: 'Review History' })).toBeVisible()
    // Sign out through the shared cookie jar behind the page's back.
    expect((await request.delete(apiRoute(API_PATH.session))).status()).toBe(204)

    await page.getByRole('link', { name: 'Dashboard' }).first().click()
    await expect(page).toHaveURL(/\/login$/)
    await expect(page.getByText(SESSION_ERROR_MESSAGE.sessionEnded)).toHaveCount(1)
    await signIn(page, DEMO_USERNAME, DEMO_PASSWORD)
    await expect(page).toHaveURL(/\/$/)
  })

  test('password change in the browser: "Password updated", then sign out; the old password fails and the new one signs in', async ({ page }) => {
    const newPassword = 'brand-new-pass-1'
    await page.goto('/settings?section=security')
    await page.getByRole('button', { name: 'Update password' }).click()
    await page.getByLabel('Current password', { exact: true }).click()
    await page.getByLabel('Current password', { exact: true }).fill(DEMO_PASSWORD)
    await page.getByLabel('New password', { exact: true }).click()
    await page.getByLabel('New password', { exact: true }).fill(newPassword)
    await page.getByLabel('Confirm password', { exact: true }).click()
    await page.getByLabel('Confirm password', { exact: true }).fill(newPassword)
    await page.getByRole('button', { name: 'Save password' }).click()
    await expect(page.getByText('Password updated')).toBeVisible()
    // The rotated cookie keeps this browser signed in.
    await page.reload()
    await expect(page.getByRole('button', { name: 'Sign Out' })).toBeVisible()

    await page.getByRole('button', { name: 'Sign Out' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Sign out' }).click()
    await expect(page).toHaveURL(/\/login$/)

    await signIn(page, DEMO_USERNAME, DEMO_PASSWORD)
    await expect(page.getByRole('alert')).toHaveText(SESSION_ERROR_MESSAGE.signInFailed)
    await signIn(page, DEMO_USERNAME, newPassword)
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible()
  })

  test('the login page sends a signed-in visitor to /', async ({ page }) => {
    await page.goto('/login')

    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible()
  })
})
