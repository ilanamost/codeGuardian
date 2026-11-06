import type { Page, Route } from '@playwright/test'
import { API_PATH } from '../../src/lib/api.constants'
import { DASHBOARD_LOADING_TEXT } from '../../src/lib/dashboard.constants'
import { ROUTE_PATH } from '../../src/lib/route.constants'
import { apiRoute, createReview, expect, setSettings, test } from './fixture'

// QA plan 037: adversarial checks the implementing agent's loader.spec.ts does not make —
// the size of every Dashboard area while loading versus loaded, horizontal overflow at the
// narrowest phone width, the stat cards on a phone, and the loaders under reduced motion.

async function holdDashboard(page: Page) {
  let release = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route(apiRoute(API_PATH.dashboard), async (route: Route) => {
    if (route.request().method() === 'GET') await gate
    await route.continue()
  })
  return { release }
}

// Holds GET /api/review (the list behind Recent Reviews) until `release()` is called.
async function holdReviewList(page: Page) {
  let release = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route(
    (url) => url.pathname === API_PATH.review,
    async (route: Route) => {
      if (route.request().method() === 'GET') await gate
      await route.continue()
    }
  )
  return { release }
}

const areaList = [
  { id: 'findings-severity-title', label: 'severity' },
  { id: 'findings-category-title', label: 'category' },
  { id: 'review-activity-title', label: 'activity' },
  { id: 'recent-reviews-title', label: 'recent' }
] as const

const qaViewportList = [
  { name: 'desktop', width: 1280, height: 900 },
  { name: 'tablet-768', width: 768, height: 1024 },
  { name: 'phone-390', width: 390, height: 844 },
  { name: 'phone-320', width: 320, height: 640 }
]

async function areaHeights(page: Page) {
  const heightBy: Record<string, number> = {}
  for (const area of areaList) {
    heightBy[area.label] = (await page.locator(`section[aria-labelledby="${area.id}"]`).boundingBox())?.height ?? -1
  }
  return heightBy
}

// A heavy user: all five categories and every severity counted (the most bars the contract allows).
async function heavyDashboard(page: Page) {
  const categoryList = ['security', 'bug', 'performance', 'readability', 'maintainability']
  await page.route(apiRoute(API_PATH.dashboard), async (route: Route) => {
    if (route.request().method() !== 'GET') return route.continue()
    await gateHeavy
    const response = await route.fetch()
    const body = await response.json()
    const json = {
      ...body,
      severityCountList: body.severityCountList.map((item: { count: number }, index: number) => ({ ...item, count: 3 + index * 7 })),
      categoryCountList: categoryList.map((id, index) => ({ id, label: id[0].toUpperCase() + id.slice(1), count: 40 - index * 6 }))
    }
    await route.fulfill({ response, json })
  })
}
let releaseHeavy = () => {}
let gateHeavy = Promise.resolve()

for (const viewport of qaViewportList) {
  test.describe(`QA 037 heavy data ${viewport.name}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } })

    test('a user with many reviews and all categories: the four blocks keep their height', async ({ page, request }) => {
      test.setTimeout(90_000)
      for (let i = 0; i < 5; i++) await createReview(request, { title: `QA heavy ${i} with a rather long review title to wrap` })
      await setSettings(request, { theme: 'dark' })
      gateHeavy = new Promise<void>((resolve) => {
        releaseHeavy = resolve
      })
      await heavyDashboard(page)
      const list = await holdReviewList(page)
      await page.goto(ROUTE_PATH.home)
      await expect(page.getByRole('status', { name: DASHBOARD_LOADING_TEXT.stat })).toBeVisible()
      await expect(page.getByTestId('loader')).toHaveCount(5)
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
      const loading = await areaHeights(page)

      releaseHeavy()
      list.release()
      await expect(page.getByTestId('loader')).toHaveCount(0)
      await expect(page.getByTestId('legend-critical')).toBeVisible()
      const loaded = await areaHeights(page)
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      console.log(`[qa-037 heavy] ${viewport.name} loading ${JSON.stringify(loading)} loaded ${JSON.stringify(loaded)} overflow ${overflow}`)
      expect.soft(overflow, 'no sideways scroll (dark, heavy data)').toBeLessThanOrEqual(0)
      for (const area of areaList) {
        expect.soft(Math.abs(loaded[area.label] - loading[area.label]), `${area.label} area height shift (heavy data)`).toBeLessThanOrEqual(1)
      }
    })
  })
}

// Realistic: short titles, 1 to 4 reviews (Recent Reviews previews at most 4 rows).
for (const viewport of [qaViewportList[0], qaViewportList[2]]) {
  for (const reviewCount of [1, 2, 3, 4]) {
    test(`QA 037 realistic ${viewport.name}, ${reviewCount} review(s): Recent Reviews keeps its height`, async ({ page, request }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      for (let i = 0; i < reviewCount; i++) await createReview(request, { title: `Review ${i + 1}` })
      const list = await holdReviewList(page)
      await page.goto(ROUTE_PATH.home)
      await expect(page.getByRole('status', { name: DASHBOARD_LOADING_TEXT.stat })).toBeVisible()
      await expect(page.getByText(DASHBOARD_LOADING_TEXT.recent)).toBeVisible()
      const loading = await areaHeights(page)
      list.release()
      await expect(page.getByTestId('loader')).toHaveCount(0)
      const loaded = await areaHeights(page)
      console.log(`[qa-037 realistic] ${viewport.name} n=${reviewCount} recent ${loading.recent} -> ${loaded.recent}, activity ${loading.activity} -> ${loaded.activity}`)
      expect.soft(Math.abs(loaded.recent - loading.recent), 'recent area height shift').toBeLessThanOrEqual(1)
    })
  }
}

for (const viewport of qaViewportList) {
  test.describe(`QA 037 ${viewport.name}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } })

    test('each Dashboard chart area keeps its height and the page never scrolls sideways', async ({ page }) => {
      const { release } = await holdDashboard(page)
      const list = await holdReviewList(page)
      await page.goto(ROUTE_PATH.home)
      await expect(page.getByRole('status', { name: DASHBOARD_LOADING_TEXT.stat })).toBeVisible()

      const overflowLoading = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      const loadingHeight: Record<string, number | undefined> = {}
      for (const area of areaList) {
        loadingHeight[area.label] = (await page.locator(`section[aria-labelledby="${area.id}"]`).boundingBox())?.height
      }

      // Plan 037 Risks: one live region at a time while the five blocks load.
      await expect(page.getByTestId('loader')).toHaveCount(5)
      expect.soft(await page.locator('main [role="status"], main [aria-live]').count(), 'announced loaders on first load').toBe(1)

      release()
      list.release()
      await expect(page.getByTestId('stat-total')).toBeVisible()
      await expect(page.getByTestId('loader')).toHaveCount(0)

      const overflowLoaded = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      expect.soft(overflowLoading, 'no sideways scroll while loading').toBeLessThanOrEqual(0)
      expect.soft(overflowLoaded, 'no sideways scroll once loaded').toBeLessThanOrEqual(0)
      for (const area of areaList) {
        const loadedHeight = (await page.locator(`section[aria-labelledby="${area.id}"]`).boundingBox())?.height
        console.log(`[qa-037] ${viewport.name} ${area.label}: loading ${loadingHeight[area.label]} loaded ${loadedHeight}`)
        expect.soft(Math.abs((loadedHeight ?? 0) - (loadingHeight[area.label] ?? 0)), `${area.label} area height shift`).toBeLessThanOrEqual(1)
      }

      // The stat cards (min-h-26) stay inside their grid cell and do not clip their value.
      for (const id of ['total', 'passed', 'failed', 'quality']) {
        const card = page.getByTestId(`stat-${id}`)
        if ((await card.count()) === 0) continue
        const clip = await card.evaluate((element) => ({
          x: element.scrollWidth - element.clientWidth,
          y: element.scrollHeight - element.clientHeight,
          height: element.getBoundingClientRect().height
        }))
        console.log(`[qa-037] ${viewport.name} stat-${id}: ${JSON.stringify(clip)}`)
        expect.soft(clip.x, `stat-${id} overflows sideways`).toBeLessThanOrEqual(0)
        expect.soft(clip.y, `stat-${id} overflows down`).toBeLessThanOrEqual(0)
        expect.soft(clip.height, `stat-${id} min height`).toBeGreaterThanOrEqual(104)
      }
    })
  })
}

test.describe('QA 037 reduced motion', () => {
  test('no loader animates under prefers-reduced-motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const { release } = await holdDashboard(page)
    await page.goto(ROUTE_PATH.home)
    await expect(page.getByTestId('global-loader')).toBeVisible()
    await expect(page.getByTestId('loader').first()).toBeVisible()

    const animationList = await page.evaluate(() =>
      [...document.querySelectorAll('[data-testid="loader-icon"], [data-testid="global-loader"] *')].map(
        (element) => getComputedStyle(element).animationName
      )
    )
    release()
    expect(animationList.length).toBeGreaterThan(0)
    expect(animationList.every((name) => name === 'none')).toBe(true)
  })

  test('the global bar is outside the accessibility tree while it shows', async ({ page }) => {
    const { release } = await holdDashboard(page)
    await page.goto(ROUTE_PATH.home)
    await expect(page.getByTestId('global-loader')).toBeVisible()
    const snapshot = await page.locator('body').ariaSnapshot()
    release()
    // Only the area loaders (named) appear as status; the bar adds no nameless status or progressbar.
    expect(snapshot).not.toMatch(/progressbar/)
    expect(snapshot).not.toMatch(/- status\s*$/m)
  })
})
