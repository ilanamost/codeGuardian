import type { Page } from '@playwright/test'
import { ROUTE_PATH } from '../../src/lib/route.constants'
import { createReview, expect, test } from './fixture'

// `createdReview` stands for the review page of a review the test creates first (the backend
// starts with no reviews).
const createdReview = 'a created review'
const routeList = ['/', '/review/new', createdReview, '/history', '/github', '/settings']

async function hasHorizontalOverflow(page: Page) {
  // The app shell clips overflow, so also check the page's own <main> scroll container.
  return page.evaluate(() => {
    const main = document.querySelector('main')
    return document.documentElement.scrollWidth > window.innerWidth || (main !== null && main.scrollWidth > main.clientWidth)
  })
}

const viewportList = [
  { name: 'mobile', width: 375, height: 667 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1280, height: 800 }
]

for (const viewport of viewportList) {
  test.describe(`${viewport.name} ${viewport.width}px`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } })

    for (const route of routeList) {
      test(`no horizontal overflow on ${route}`, async ({ page, request }) => {
        await createReview(request, { title: 'Responsive check' })
        await page.goto(route === createdReview ? ROUTE_PATH.review((await createReview(request, { title: 'Layout' })).id) : route)
        await page.waitForLoadState('networkidle')
        expect(await hasHorizontalOverflow(page)).toBe(false)
      })
    }
  })
}

test.describe('mobile 375px', () => {
  test.use({ viewport: { width: 375, height: 667 } })

  test('shows the bottom nav and hides the sidebar', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('navigation', { name: 'Mobile' })).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeHidden()
  })

  test('dashboard blocks are stacked one per row', async ({ page }) => {
    await page.goto('/')
    const boxList = await Promise.all(
      ['Findings by Severity', 'Findings by Category', 'Review Activity', 'Recent Reviews'].map(async (name) =>
        page.getByRole('region', { name }).boundingBox()
      )
    )
    for (let i = 1; i < boxList.length; i++) {
      expect(boxList[i]!.y).toBeGreaterThan(boxList[i - 1]!.y)
      expect(boxList[i]!.x).toBeCloseTo(boxList[0]!.x, 0)
    }
  })

  test('editor is visible and nearly full width', async ({ page }) => {
    await page.goto('/review/new')
    const editor = page.locator('.monaco-editor').first()
    await expect(editor).toBeVisible()
    const box = await editor.boundingBox()
    expect(box!.width).toBeGreaterThan(375 * 0.8)
  })

  test('bottom nav navigates', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('link', { name: 'Review History' }).click()
    await expect(page).toHaveURL(/\/history$/)
  })
})

test.describe('desktop 1280px', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test('shows the sidebar and hides the bottom nav', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'Mobile' })).toBeHidden()
  })
})
