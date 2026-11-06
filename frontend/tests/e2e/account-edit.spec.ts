import type { Page } from '@playwright/test'
import { ACCOUNT_TEXT } from '../../src/lib/account.constants'
import { API_PATH } from '../../src/lib/api.constants'
import { SESSION_ERROR_MESSAGE } from '../../src/utils/error-messages'
import { DEMO_PASSWORD, DEMO_USERNAME } from './e2e.constants'
import { apiRoute, csrfRequest, expect, test } from './fixture'

// Plan 034, Workstream A, on the real backend: the user name and email are edited in Settings >
// Account with the current password, and the sidebar profile is a link to that panel.

const sidebarProfile = (page: Page) => page.getByTestId('sidebar-profile')

async function openEdit(page: Page) {
  await page.goto('/settings?section=account')
  await page.getByRole('button', { name: ACCOUNT_TEXT.editDetailsLabel }).click()
  return page.getByRole('form', { name: ACCOUNT_TEXT.editHeading })
}

test('edit the user name and email; the panel and the sidebar update at once and the session stays', async ({ page, browser }) => {
  const form = await openEdit(page)
  await form.getByLabel(ACCOUNT_TEXT.username, { exact: true }).fill('john.edited')
  await form.getByLabel(ACCOUNT_TEXT.email, { exact: true }).fill('John.Edited@Example.com')
  await form.getByLabel(ACCOUNT_TEXT.currentPassword, { exact: true }).click()
  await form.getByLabel(ACCOUNT_TEXT.currentPassword, { exact: true }).fill(DEMO_PASSWORD)
  await form.getByRole('button', { name: ACCOUNT_TEXT.saveDetails }).click()

  await expect(page.getByText(ACCOUNT_TEXT.detailsUpdated)).toBeVisible()
  await expect(page.getByTestId('account-username')).toHaveText('john.edited')
  await expect(page.getByTestId('account-email')).toHaveText('john.edited@example.com')
  await expect(sidebarProfile(page)).toContainText('john.edited@example.com')

  // Still signed in after a reload; the new values come from the server.
  await page.reload()
  await expect(page.getByTestId('account-username')).toHaveText('john.edited')

  // Sign-in takes the new user name; the old one no longer works.
  const context = await browser.newContext()
  const api = csrfRequest(context.request)
  expect((await api.post(apiRoute(API_PATH.session), { data: { username: DEMO_USERNAME, password: DEMO_PASSWORD } })).status()).toBe(401)
  expect((await api.post(apiRoute(API_PATH.session), { data: { username: 'john.edited', password: DEMO_PASSWORD } })).status()).toBe(200)
  await context.close()
})

test('a wrong current password is shown under its field and nothing changes', async ({ page }) => {
  const form = await openEdit(page)
  await form.getByLabel(ACCOUNT_TEXT.username, { exact: true }).fill('john.other')
  await form.getByLabel(ACCOUNT_TEXT.currentPassword, { exact: true }).click()
  await form.getByLabel(ACCOUNT_TEXT.currentPassword, { exact: true }).fill('not-the-password')
  await form.getByRole('button', { name: ACCOUNT_TEXT.saveDetails }).click()

  await expect(form.getByText('Current password is not correct.')).toBeVisible()
  await form.getByRole('button', { name: ACCOUNT_TEXT.cancelDetails }).click()
  await expect(page.getByTestId('account-username')).toHaveText(DEMO_USERNAME)
})

test('a user name another account has gives the generic conflict message', async ({ page, browser }) => {
  const context = await browser.newContext()
  const created = await csrfRequest(context.request).post(apiRoute(API_PATH.account), {
    data: { username: 'ada.lovelace', email: 'ada@example.com', password: 'analytical-engine-77' }
  })
  expect(created.status()).toBe(201)
  await context.close()

  const form = await openEdit(page)
  await form.getByLabel(ACCOUNT_TEXT.username, { exact: true }).fill('ADA.lovelace')
  await form.getByLabel(ACCOUNT_TEXT.currentPassword, { exact: true }).click()
  await form.getByLabel(ACCOUNT_TEXT.currentPassword, { exact: true }).fill(DEMO_PASSWORD)
  await form.getByRole('button', { name: ACCOUNT_TEXT.saveDetails }).click()

  await expect(form.getByRole('alert').filter({ hasText: SESSION_ERROR_MESSAGE.registerConflict })).toBeVisible()
})

test('the sidebar profile is a link to Settings > Account (mouse and keyboard)', async ({ page }) => {
  await page.goto('/history')
  const link = page.getByRole('link', { name: /Open account settings for/ })
  await expect(link).toBeVisible()
  await expect(link).toHaveCSS('cursor', 'pointer')

  await link.click()
  await expect(page).toHaveURL(/\/settings\?section=account$/)
  await expect(page.getByRole('tab', { name: 'Account' })).toHaveAttribute('aria-selected', 'true')

  await page.goto('/history')
  await link.focus()
  await expect(link).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/settings\?section=account$/)
})
