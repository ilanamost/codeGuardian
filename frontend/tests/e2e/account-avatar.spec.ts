import type { Page } from '@playwright/test'
import { expect, test } from './fixture'

// Plan 028, Scope 17: the profile photo, uploaded in the Account tab and shown in the sidebar.
// The photo is served by GET /api/account/avatar with the session cookie. The page
// loads it through its API request path and shows it from an object URL (`blob:`).

// A real 1x1 PNG, so the browser can draw it.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')

const photoInput = (page: Page) => page.locator('input[type="file"]')
const accountPhoto = (page: Page) => page.getByRole('tabpanel').getByRole('img', { name: 'Profile image' })
const sidebarPhoto = (page: Page) => page.getByTestId('sidebar-profile').getByRole('img')

// The <img> finished loading the photo (not the initials, and not a broken image).
async function expectLoadedPhoto(locator: ReturnType<Page['locator']>) {
  await expect(locator).toHaveAttribute('src', /^blob:/)
  await expect.poll(() => locator.evaluate((node) => (node as HTMLImageElement).complete && (node as HTMLImageElement).naturalWidth)).toBe(1)
}

test('upload a PNG: the Account panel and the sidebar show it, also after a reload; remove it and the initials come back', async ({ page }) => {
  await page.goto('/settings')
  await expect(accountPhoto(page)).toHaveText('JD')

  await photoInput(page).setInputFiles({ name: 'me.png', mimeType: 'image/png', buffer: PNG })
  await expect(page.getByRole('img', { name: 'New profile photo preview' })).toBeVisible()
  await page.getByRole('button', { name: 'Save photo' }).click()
  await expect(page.getByText('Photo updated')).toBeVisible()

  await expectLoadedPhoto(accountPhoto(page))
  await expectLoadedPhoto(sidebarPhoto(page))

  await page.reload()
  await expectLoadedPhoto(accountPhoto(page))
  await expectLoadedPhoto(sidebarPhoto(page))

  await page.getByRole('button', { name: 'Remove photo' }).click()
  await expect(page.getByText('Photo removed')).toBeVisible()
  await expect(accountPhoto(page)).toHaveText('JD')
  await expect(sidebarPhoto(page)).toHaveText('JD')
})

test('a .txt file is refused with a message and nothing is uploaded', async ({ page }) => {
  let uploaded = 0
  page.on('request', (request) => {
    if (request.url().includes('/api/account/avatar') && request.method() === 'PUT') uploaded += 1
  })
  await page.goto('/settings')

  await photoInput(page).setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('not an image') })

  await expect(page.getByText('Could not upload the photo. Use a PNG, JPEG or WebP image.')).toBeVisible()
  await expect(accountPhoto(page)).toHaveText('JD')
  expect(uploaded).toBe(0)
})

test('HTML renamed to .png is refused by its bytes', async ({ page }) => {
  await page.goto('/settings')

  await photoInput(page).setInputFiles({ name: 'evil.png', mimeType: 'image/png', buffer: Buffer.from('<html><script>alert(1)</script></html>') })

  await expect(page.getByText('Could not upload the photo. Use a PNG, JPEG or WebP image.')).toBeVisible()
})
