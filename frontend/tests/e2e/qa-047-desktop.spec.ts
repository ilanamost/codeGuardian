import { expect, test } from './fixture'

// QA plan 047: from 640px up the inputs stay 14px (desktop unchanged); below it they are 16px.
test.use({ signIn: false })

for (const [width, expected] of [[1280, 14], [640, 14], [639, 16]] as const) {
  test(`login inputs are ${expected}px at ${width}px wide`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 })
    await page.goto('/login')
    await expect(page.locator('main input').first()).toBeVisible()
    const fontList = await page.evaluate(() => Array.from(document.querySelectorAll('main input:not([hidden])')).map((el) => parseFloat(getComputedStyle(el).fontSize)))
    expect(fontList.length).toBeGreaterThan(1)
    for (const font of fontList) expect(font).toBe(expected)
  })
}
