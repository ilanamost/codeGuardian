import { API_PATH } from '../../src/lib/api.constants'
import { apiRoute, createReview, csrfRequest, expect, setSettings, test } from './fixture'

// QA (plan 028): two accounts one after the other in the same browser tab. After A signs out
// through the dialog, B registers in the same tab and must see none of A's data, A's settings
// cache must be gone, and the page must never read the session cookie.

test('A signs out, B registers in the same tab: no review, theme or profile of A is left', async ({ page }) => {
  // A is the demo account (signed in by the fixture), with a review and a non-default theme.
  const review = await createReview(page.request, { title: 'Only for John' })
  await setSettings(page.request, { theme: 'dark' })

  await page.goto('/history')
  await expect(page.getByText(review.title)).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  expect(await page.evaluate(() => document.cookie)).not.toContain('cr_session')
  expect(await page.evaluate(() => window.localStorage.getItem('cr.settings'))).not.toBeNull()

  await page.goto('/settings?section=security')
  await page.getByRole('button', { name: 'Sign Out' }).click()
  await page.getByRole('dialog', { name: 'Sign out?' }).getByRole('button', { name: 'Sign out' }).click()
  await expect(page).toHaveURL(/\/login$/)
  expect(await page.evaluate(() => window.localStorage.getItem('cr.settings'))).toBeNull()

  await page.getByRole('link', { name: 'Create an account' }).click()
  await expect(page.getByRole('heading', { name: 'Create an account' })).toBeVisible()
  await page.getByLabel('User name').fill('second.user')
  await page.getByLabel('Email address').fill('second@example.com')
  await page.getByLabel('Password', { exact: true }).click()
  await page.getByLabel('Password', { exact: true }).fill('second-user-42')
  await page.getByLabel('Confirm password', { exact: true }).click()
  await page.getByLabel('Confirm password', { exact: true }).fill('second-user-42')
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page).toHaveURL(/\/$/)

  await expect(page.getByTestId('sidebar-profile')).toContainText('second@example.com')
  await expect(page.getByTestId('sidebar-profile')).not.toContainText('john')
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Review History' }).click()
  await expect(page).toHaveURL(/\/history$/)
  await expect(page.getByText(review.title)).toHaveCount(0)
  // B's own theme (the default) is applied, not A's dark theme.
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', 'dark')
  expect((await csrfRequest(page.request).get(apiRoute(API_PATH.reviewById(review.id)))).status()).toBe(404)
  expect(await page.evaluate(() => document.cookie)).not.toContain('cr_session')
})
