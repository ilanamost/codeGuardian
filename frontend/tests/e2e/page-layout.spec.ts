import type { Page } from '@playwright/test'
import { ROUTE_PATH } from '../../src/lib/route.constants'
import { createReview, expect, test } from './fixture'

// Plan 029: only <main> scrolls, never the document beside it (two scrollbars on a short
// viewport), and the sign-in pages have a darker background behind the card.

const viewportList = [
  { width: 768, height: 1024 },
  { width: 820, height: 1180 },
  { width: 1024, height: 768 },
  { width: 800, height: 600 },
  { width: 1000, height: 600 },
  { width: 1023, height: 700 },
  { width: 375, height: 667 },
  { width: 667, height: 375 }
]

async function documentOverflow(page: Page) {
  return page.evaluate(() => ({
    height: document.documentElement.scrollHeight - window.innerHeight,
    width: document.documentElement.scrollWidth - window.innerWidth
  }))
}

for (const viewport of viewportList) {
  test.describe(`${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport })

    test('no page makes the document scroll beside <main>', async ({ page, request }) => {
      const review = await createReview(request, { title: 'Layout check' })
      const routeList = ['/', '/review/new', ROUTE_PATH.review(review.id), '/history', '/github', '/settings', '/help']
      for (const route of routeList) {
        await page.goto(route)
        await page.waitForLoadState('networkidle')
        await expect(page.locator('main')).toBeVisible()
        expect(await documentOverflow(page), route).toEqual({ height: 0, width: 0 })
      }
    })
  })
}

test.describe('short tablet viewport', () => {
  test.use({ viewport: { width: 800, height: 600 } })

  test('the Dashboard scrolls inside <main> only', async ({ page, request }) => {
    await createReview(request, { title: 'Dashboard content' })
    await page.goto('/')
    await expect(page.getByRole('region', { name: 'Recent Reviews' })).toBeVisible()
    const scroll = await page.evaluate(() => {
      const main = document.querySelector('main') as HTMLElement
      return { main: main.scrollHeight > main.clientHeight, document: document.documentElement.scrollHeight > window.innerHeight }
    })
    expect(scroll).toEqual({ main: true, document: false })
  })
})

// Relative luminance and contrast ratio (WCAG 2) of two `rgb(r, g, b)` colours.
function contrast(first: string, second: string) {
  const luminance = (color: string) => {
    const [r, g, b] = (color.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map((value) => {
      const channel = Number(value) / 255
      return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  const [light, dark] = [luminance(first), luminance(second)].sort((a, b) => b - a)
  return (light + 0.05) / (dark + 0.05)
}

async function signInColor(page: Page) {
  return page.evaluate(() => {
    const main = document.querySelector('main') as HTMLElement
    const card = main.firstElementChild as HTMLElement
    const title = card.querySelector('h1') as HTMLElement
    const muted = card.querySelector('header p') as HTMLElement
    return {
      page: getComputedStyle(main).backgroundColor,
      card: getComputedStyle(card).backgroundColor,
      title: getComputedStyle(title).color,
      muted: getComputedStyle(muted).color
    }
  })
}

test.describe('sign-in background', () => {
  test.use({ signIn: false })

  for (const route of ['/login', '/register']) {
    test(`${route} has the darker tint in the light theme and keeps the dark page colour`, async ({ page }) => {
      await page.goto(route)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'))
      const light = await signInColor(page)
      expect(light.page).toBe('rgb(223, 229, 241)')
      expect(light.card).toBe('rgb(255, 255, 255)')
      expect(contrast(light.title, light.card)).toBeGreaterThanOrEqual(4.5)
      expect(contrast(light.muted, light.card)).toBeGreaterThanOrEqual(4.5)

      await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'))
      const dark = await signInColor(page)
      expect(dark.page).toBe('rgb(12, 20, 38)')
      expect(dark.card).toBe('rgb(22, 33, 59)')
      expect(contrast(dark.title, dark.card)).toBeGreaterThanOrEqual(4.5)
      expect(contrast(dark.muted, dark.card)).toBeGreaterThanOrEqual(4.5)
    })
  }
})
