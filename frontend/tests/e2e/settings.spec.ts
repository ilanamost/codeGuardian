import { expect, test } from './fixture'

test('dark theme persists after reload', async ({ page }) => {
  await page.goto('/settings')
  await page.getByRole('tab', { name: 'Appearance' }).click()
  await page.getByRole('radio', { name: 'Dark' }).check()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')

  await page.reload()

  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
})

for (const [label, value] of [['Dark', 'dark'], ['Light', 'light'], ['System', 'system']] as const) {
  test(`${label} theme is stored in cr.theme and used on the sign-in pages after sign-out`, async ({ page }) => {
    await page.goto('/settings')
    await page.getByRole('tab', { name: 'Appearance' }).click()
    await page.getByRole('radio', { name: label }).check()
    expect(await page.evaluate(() => window.localStorage.getItem('cr.theme'))).toBe(JSON.stringify(value))

    await page.reload()
    expect(await page.evaluate(() => window.localStorage.getItem('cr.theme'))).toBe(JSON.stringify(value))

    await page.goto('/settings?section=security')
    await page.getByRole('button', { name: 'Sign Out' }).click()
    await page.getByRole('dialog', { name: 'Sign out?' }).getByRole('button', { name: 'Sign out' }).click()
    await expect(page).toHaveURL(/\/login$/)
    expect(await page.evaluate(() => window.localStorage.getItem('cr.settings'))).toBeNull()
    expect(await page.evaluate(() => window.localStorage.getItem('cr.theme'))).toBe(JSON.stringify(value))
    const resolved = value === 'system' ? 'light' : value
    await expect(page.locator('html')).toHaveAttribute('data-theme', resolved)
    await page.goto('/register')
    await expect(page.locator('html')).toHaveAttribute('data-theme', resolved)
  })
}
