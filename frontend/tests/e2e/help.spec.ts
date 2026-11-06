import { expect, test } from './fixture'

for (const width of [375, 1280]) {
  test(`help page has no horizontal overflow at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 })
    await page.goto('/help?topic=error-messages')
    await expect(page.getByRole('heading', { name: 'Help & Support' })).toBeVisible()
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
    expect(overflow).toBe(false)
  })
}

test('help is reachable from the navigation', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/')
  await page.getByRole('link', { name: 'Help' }).first().click()
  await expect(page).toHaveURL(/\/help/)
})
