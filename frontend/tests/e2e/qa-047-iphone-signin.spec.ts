import type { Page } from '@playwright/test'
import { devices } from '@playwright/test'
import { expect, test } from './fixture'

// Plan 047: on an iPhone 13 (WebKit, 390x844) iOS Safari zooms into any focused field below 16px
// and stays zoomed, which also pushes the sign-in card against the screen edges.

test.use({ ...devices['iPhone 13'], signIn: false })

const MIN_FONT_PX = 16
const MIN_SIDE_PX = 16
const pageList = ['/login', '/register']

async function inputFontList(page: Page) {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLInputElement>('main input:not([hidden])')).map((input) => parseFloat(getComputedStyle(input).fontSize))
  )
}

for (const path of pageList) {
  test.describe(path, () => {
    test.beforeEach(async ({ page }) => {
      await page.goto(path)
      await expect(page.locator('main input').first()).toBeVisible()
    })

    test('every input has a font size of at least 16px', async ({ page }) => {
      const fontList = await inputFontList(page)
      expect(fontList.length).toBeGreaterThan(1)
      for (const font of fontList) expect(font).toBeGreaterThanOrEqual(MIN_FONT_PX)
    })

    test('focusing the fields does not zoom, and the card keeps its side margin', async ({ page }) => {
      const inputList = page.locator('main input:not([hidden])')
      const count = await inputList.count()
      for (let index = 0; index < count; index++) await inputList.nth(index).focus()

      const scale = await page.evaluate(() => window.visualViewport?.scale ?? 1)
      expect(scale).toBe(1)
      const card = await page.locator('main > div').boundingBox()
      const width = await page.evaluate(() => window.innerWidth)
      expect(card).not.toBeNull()
      expect(card!.x).toBeGreaterThanOrEqual(MIN_SIDE_PX)
      expect(width - (card!.x + card!.width)).toBeGreaterThanOrEqual(MIN_SIDE_PX)
    })

    test('the page does not scroll sideways', async ({ page }) => {
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
      expect(overflow).toBeLessThanOrEqual(0)
    })
  })
}
