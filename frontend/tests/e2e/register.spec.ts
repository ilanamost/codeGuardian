import type { Page } from '@playwright/test'
import { API_PATH } from '../../src/lib/api.constants'
import { SESSION_ERROR_MESSAGE } from '../../src/utils/error-messages'
import { apiRoute, createReview, expect, test } from './fixture'

// Plan 028: registration at /register. A new account is signed in at once (Open Question 6) and
// gets its own, empty data; the demo account's reviews are never visible to it.

async function register(page: Page, value: { username: string; email: string; password: string }) {
  await page.getByLabel('User name').fill(value.username)
  await page.getByLabel('Email address').fill(value.email)
  await page.getByLabel('Password', { exact: true }).click()
  await page.getByLabel('Password', { exact: true }).fill(value.password)
  await page.getByLabel('Confirm password', { exact: true }).click()
  await page.getByLabel('Confirm password', { exact: true }).fill(value.password)
  await page.getByRole('button', { name: 'Create account' }).click()
}

test.describe('registration', () => {
  test.use({ signIn: false })

  test('from /login, "Create an account" leads to /register and "Sign in" back', async ({ page }) => {
    await page.goto('/login')
    await page.getByRole('link', { name: 'Create an account' }).click()

    await expect(page).toHaveURL(/\/register$/)
    await expect(page.getByRole('heading', { name: 'Create an account' })).toBeVisible()
    await page.getByRole('link', { name: 'Sign in' }).click()
    await expect(page).toHaveURL(/\/login$/)
  })

  test('a new account is signed in, the Account panel and the sidebar show it, and its History is empty', async ({ page, request }) => {
    // The demo account has a review; sign it out of the shared cookie jar again afterwards.
    expect((await request.post(apiRoute(API_PATH.session), { data: { username: 'john.doe', password: 'mock-password' } })).status()).toBe(200)
    const demo = await createReview(request, { title: 'Demo account review' })
    expect((await request.delete(apiRoute(API_PATH.session))).status()).toBe(204)

    await page.goto('/register')
    await register(page, { username: 'ada.lovelace', email: 'ada@example.com', password: 'analytical-engine1' })

    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByTestId('sidebar-profile')).toContainText('ada@example.com')
    await page.goto('/settings')
    const panel = page.getByRole('tabpanel')
    // The full name defaults to the user name (editing it is out of scope): both show it.
    await expect(panel.getByText('ada.lovelace', { exact: true })).toHaveCount(2)
    await expect(panel.getByText('ada@example.com')).toBeVisible()

    await page.goto('/history')
    await expect(page.getByText(demo.title)).toHaveCount(0)
    expect(await (await request.get(apiRoute(API_PATH.review))).json()).toEqual([])
    expect((await request.get(apiRoute(API_PATH.reviewById(demo.id)))).status()).toBe(404)
  })

  test('keeps the asked-for page: /history signed out, register, lands on /history', async ({ page }) => {
    await page.goto('/history')
    await expect(page).toHaveURL(/\/login$/)
    await page.getByRole('link', { name: 'Create an account' }).click()
    await expect(page.getByRole('heading', { name: 'Create an account' })).toBeVisible()
    await register(page, { username: 'grace.h', email: 'grace@example.com', password: 'compiler-first1' })

    await expect(page).toHaveURL(/\/history$/)
  })

  test('the same user name again (in any case) shows the generic message', async ({ page }) => {
    await page.goto('/register')
    await register(page, { username: 'John.Doe', email: 'someone@example.com', password: 'analytical-engine1' })

    await expect(page.getByRole('alert')).toHaveText(SESSION_ERROR_MESSAGE.registerConflict)
    await expect(page).toHaveURL(/\/register$/)
  })

  test('the checklist follows the password, and a weak one is refused before sending', async ({ page }) => {
    let sent = 0
    page.on('request', (request) => {
      if (request.url() === apiRoute(API_PATH.account) && request.method() === 'POST') sent += 1
    })
    await page.goto('/register')
    const rule = (id: string) => page.locator(`[data-rule="${id}"]`)

    await page.getByLabel('Password', { exact: true }).click()
    await page.getByLabel('Password', { exact: true }).fill('password123')
    await expect(rule('length')).toHaveAttribute('data-met', 'true')
    await expect(rule('letterDigit')).toHaveAttribute('data-met', 'true')
    await expect(rule('common')).toHaveAttribute('data-met', 'false')
    await register(page, { username: 'weak.one', email: 'weak@example.com', password: 'password123' })

    await expect(page.getByText('This password is too common. Choose another one.')).toBeVisible()
    expect(sent).toBe(0)
  })
})
