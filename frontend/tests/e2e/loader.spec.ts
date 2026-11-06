import type { Page, Route } from '@playwright/test'
import { API_PATH } from '../../src/lib/api.constants'
import { DASHBOARD_LOADING_TEXT } from '../../src/lib/dashboard.constants'
import { ROUTE_PATH } from '../../src/lib/route.constants'
import { PAGE_ERROR_MESSAGE } from '../../src/utils/error-messages'
import { apiRoute, createReview, expect, setSettings, test } from './fixture'

// Plan 037: the global loader and the area loaders, against the real backend, with one route
// slowed by the test (page.route) until the test lets it answer.

const viewportList = [
  { name: 'desktop', viewport: { width: 1280, height: 900 } },
  { name: 'phone', viewport: { width: 390, height: 844 } }
] as const

const themeList = ['light', 'dark'] as const

// Holds GET /api/dashboard until `release()` is called; its CORS preflight (if any) goes through.
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

for (const { name, viewport } of viewportList) {
  for (const theme of themeList) {
    test.describe(`${name}, ${theme} theme`, () => {
      test.use({ viewport })

      test('the loaders show during a slow Dashboard load and are gone after the answer', async ({ page, request }) => {
        await setSettings(request, { theme })
        const { release } = await holdDashboard(page)

        await page.goto(ROUTE_PATH.home)

        const statLoader = page.getByRole('status', { name: DASHBOARD_LOADING_TEXT.stat })
        await expect(statLoader).toBeVisible()
        await expect(page.getByTestId('global-loader')).toBeVisible()
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
        // Readable in both themes: the label has its own color, not the card's.
        const [labelColor, cardColor] = await statLoader.evaluate((element) => [
          getComputedStyle(element).color,
          getComputedStyle(element.parentElement as HTMLElement).backgroundColor
        ])
        expect(labelColor).not.toBe(cardColor)
        const loadingBox = await page.getByTestId('stat-bar').boundingBox()

        release()

        await expect(page.getByTestId('stat-total')).toBeVisible()
        await expect(page.getByTestId('loader')).toHaveCount(0)
        await expect(page.getByTestId('global-loader')).toHaveCount(0)
        // Validation 6: on desktop the stat bar keeps its size when the data replaces the Loader
        // (on a phone the four stats take two rows).
        if (name === 'desktop') {
          const loadedBox = await page.getByTestId('stat-bar').boundingBox()
          expect(loadedBox?.height).toBe(loadingBox?.height)
          expect(loadedBox?.width).toBe(loadingBox?.width)
        }
      })
    })
  }

  test.describe(`${name}, failed call`, () => {
    test.use({ viewport })

    test('a failed Dashboard load ends with the error and no loader left', async ({ page }) => {
      await page.route(apiRoute(API_PATH.dashboard), async (route: Route) => {
        if (route.request().method() !== 'GET') return route.continue()
        // Long enough for the global loader to appear first.
        await new Promise((resolve) => setTimeout(resolve, 600))
        await route.abort('failed')
      })

      await page.goto(ROUTE_PATH.home)
      await expect(page.getByTestId('global-loader')).toBeVisible()

      await expect(page.getByRole('alert').filter({ hasText: PAGE_ERROR_MESSAGE.dashboardUnavailable })).toBeVisible()
      await expect(page.getByTestId('loader')).toHaveCount(0)
      await expect(page.getByTestId('global-loader')).toHaveCount(0)
    })
  })
}

// Validation 6 (QA 037): every Dashboard block keeps its height when its data, or its empty
// state, replaces the Loader, at four widths, on a fresh backend and with reviews.
const blockList = ['findings-severity-title', 'findings-category-title', 'review-activity-title', 'recent-reviews-title'] as const

async function blockHeightList(page: Page) {
  const heightList: number[] = []
  for (const id of blockList) heightList.push((await page.locator(`section[aria-labelledby="${id}"]`).boundingBox())?.height ?? -1)
  return heightList
}

for (const width of [1280, 768, 390, 320]) {
  for (const withData of [false, true]) {
    test.describe(`Dashboard blocks at ${width} px, ${withData ? 'with reviews' : 'fresh backend'}`, () => {
      test.use({ viewport: { width, height: 900 } })

      test('every block keeps its height when the Loader is replaced', async ({ page, request }) => {
        if (withData) {
          await createReview(request, { title: 'Loader block one' })
          await createReview(request, { title: 'Loader block two' })
        }
        const dashboard = await holdDashboard(page)
        let releaseList = () => {}
        const listGate = new Promise<void>((resolve) => {
          releaseList = resolve
        })
        await page.route(apiRoute(API_PATH.review), async (route: Route) => {
          if (route.request().method() === 'GET') await listGate
          await route.continue()
        })

        await page.goto(ROUTE_PATH.home)
        await expect(page.getByTestId('loader')).toHaveCount(5)
        const loadingList = await blockHeightList(page)

        dashboard.release()
        releaseList()
        await expect(page.getByTestId('stat-total')).toBeVisible()
        await expect(page.getByTestId('loader')).toHaveCount(0)
        // Recharts sizes its responsive charts after the first paint.
        await page.waitForTimeout(300)
        const loadedList = await blockHeightList(page)

        for (const [index, id] of blockList.entries()) {
          expect.soft(Math.abs(loadedList[index] - loadingList[index]), `${id}: loading ${loadingList[index]}, loaded ${loadedList[index]}`).toBeLessThanOrEqual(1)
        }
      })
    })
  }
}

// One live region per page (plan 037 Risks): only the stat bar's Loader is announced.
test('the Dashboard first load announces one loader, the other blocks show theirs silently', async ({ page }) => {
  const { release } = await holdDashboard(page)
  await page.goto(ROUTE_PATH.home)

  await expect(page.getByTestId('loader')).toHaveCount(5)
  await expect(page.getByRole('status')).toHaveCount(1)
  await expect(page.getByRole('status', { name: DASHBOARD_LOADING_TEXT.stat })).toBeVisible()
  await expect(page.getByText(DASHBOARD_LOADING_TEXT.severity)).toBeVisible()
  release()
})

// Validation 7: the review status poll is background work and never turns the global loader on,
// even when each poll answer is slow.
test('the review status poll does not show the global loader', async ({ page, request }) => {
  const { id } = await createReview(request, { title: 'Loader poll' })
  let getCount = 0
  let answeredCount = 0
  await page.route(apiRoute(API_PATH.reviewById(id)), async (route: Route) => {
    if (route.request().method() !== 'GET') return route.continue()
    getCount += 1
    const response = await route.fetch()
    const json = { ...(await response.json()), status: 'in_progress' }
    // Every poll answer takes longer than the loader's 200 ms delay.
    if (getCount > 1) await new Promise((resolve) => setTimeout(resolve, 700))
    await route.fulfill({ response, json })
    answeredCount += 1
  })

  await page.goto(ROUTE_PATH.review(id))
  await expect(page.getByRole('heading', { name: 'Review Results' })).toBeVisible()
  await expect(page.getByTestId('global-loader')).toHaveCount(0)
  await page.evaluate(() => {
    const flag = window as unknown as { globalLoaderSeen?: boolean }
    flag.globalLoaderSeen = false
    new MutationObserver(() => {
      if (document.querySelector('[data-testid="global-loader"]')) flag.globalLoaderSeen = true
    }).observe(document.body, { childList: true, subtree: true })
  })

  // The first load and two slow poll answers.
  await expect.poll(() => answeredCount, { timeout: 20_000 }).toBeGreaterThanOrEqual(3)

  expect(await page.evaluate(() => (window as unknown as { globalLoaderSeen?: boolean }).globalLoaderSeen)).toBe(false)
  await page.unrouteAll({ behavior: 'ignoreErrors' })
})
