import type { Page, Route } from '@playwright/test'
import { API_PATH } from '../../src/lib/api.constants'
import { ROUTE_PATH } from '../../src/lib/route.constants'
import { apiRoute, createReview, expect, failRoute, setReviewFailed, test } from './fixture'

// QA AI-43: root cause of the error-notification.spec.ts failure on PostgreSQL. The store starts
// from the browser's settings cache (`cr.settings`, defaults when it is empty) and only switches
// to the saved preference when GET /api/settings answers. A review failure that arrives first is
// gated with the cached or default preference. These tests make the settings answer slow on
// purpose, as a slow database, a cold pool or a slow network would, so the order is fixed.

const reviewLoadMessage = 'Could not load the review.'
const settingsStorageKey = 'cr.settings'
const toastList = (page: Page) => page.locator('[data-sonner-toast]')

async function delaySettings(page: Page, ms: number) {
  await page.route(apiRoute(API_PATH.settings), async (route: Route) => {
    if (route.request().method() === 'GET') await new Promise((resolve) => setTimeout(resolve, ms))
    await route.fallback()
  })
}

async function cacheSettings(page: Page, reviewFailed: boolean) {
  await page.addInitScript(([key, value]) => {
    window.localStorage.setItem(key, JSON.stringify({ notification: { reviewCompleted: true, reviewFailed: value, criticalFinding: true, email: false } }))
  }, [settingsStorageKey, reviewFailed] as const)
}

let reviewId = ''

test.beforeEach(async ({ request }) => {
  reviewId = (await createReview(request, { title: 'Race' })).id
  await setReviewFailed(request, false)
})

// D3 fixed: preference-gated notices wait for GET /api/settings (store/listener.ts).
// New browser or cleared storage, Review failed saved off.
test('D3 fixed: fresh browser: a server-side review failure before the settings load shows no toast when Review failed is off', async ({ page }) => {
  await delaySettings(page, 800)
  await failRoute(page, API_PATH.reviewById(reviewId), { status: 500 }, 'GET')
  const settingsLoaded = page.waitForResponse((response) => response.url() === apiRoute(API_PATH.settings) && response.request().method() === 'GET')
  await page.goto(ROUTE_PATH.review(reviewId))
  await expect(page.getByRole('heading', { name: 'Review unavailable' })).toBeVisible()
  await settingsLoaded

  expect(await toastList(page).filter({ hasText: reviewLoadMessage }).count()).toBe(0)
})

// D3 fixed: the cache in this browser says on, the saved preference (changed in another
// browser, now kept by the PostgreSQL store) says off.
test('D3 fixed: stale cache: the saved preference wins over this browser\'s cached one', async ({ page }) => {
  await cacheSettings(page, true)
  await delaySettings(page, 800)
  await failRoute(page, API_PATH.reviewById(reviewId), { status: 500 }, 'GET')
  const settingsLoaded = page.waitForResponse((response) => response.url() === apiRoute(API_PATH.settings) && response.request().method() === 'GET')
  await page.goto(ROUTE_PATH.review(reviewId))
  await expect(page.getByRole('heading', { name: 'Review unavailable' })).toBeVisible()
  await settingsLoaded

  expect(await toastList(page).filter({ hasText: reviewLoadMessage }).count()).toBe(0)
})

// Control: the usual case, the same browser that turned the preference off. Passes.
test('same browser: with the preference cached off, no toast even when the settings load is slow', async ({ page }) => {
  await cacheSettings(page, false)
  await delaySettings(page, 800)
  await failRoute(page, API_PATH.reviewById(reviewId), { status: 500 }, 'GET')
  const settingsLoaded = page.waitForResponse((response) => response.url() === apiRoute(API_PATH.settings) && response.request().method() === 'GET')
  await page.goto(ROUTE_PATH.review(reviewId))
  await expect(page.getByRole('heading', { name: 'Review unavailable' })).toBeVisible()
  await settingsLoaded

  expect(await toastList(page).filter({ hasText: reviewLoadMessage }).count()).toBe(0)
})
