import type { APIRequestContext, Page, Route } from '@playwright/test'
import { API_PATH } from '../../src/lib/api.constants'
import { ROUTE_PATH } from '../../src/lib/route.constants'
import { apiRoute, createReview, expect, failRoute, test } from './fixture'

// QA AI-43 round 2: the D3 fix end to end, for the cases qa-ai43-settings-race.spec.ts does not
// cover. Preference-gated notices wait for GET /api/settings; network failures do not.

const reviewLoadMessage = 'Could not load the review.'
const networkHint = 'Check your internet connection and try again.'
const completedMessage = 'Review completed'
const settingsStorageKey = 'cr.settings'
const toastList = (page: Page) => page.locator('[data-sonner-toast]')

async function setNotification(request: APIRequestContext, change: Record<string, boolean>) {
  const current = await (await request.get(apiRoute(API_PATH.settings))).json()
  const response = await request.put(apiRoute(API_PATH.settings), { data: { ...current, notification: { ...current.notification, ...change } } })
  expect(response.status()).toBe(204)
}

async function slowSettings(page: Page, ms: number) {
  await page.route(apiRoute(API_PATH.settings), async (route: Route) => {
    if (route.request().method() === 'GET') await new Promise((resolve) => setTimeout(resolve, ms))
    return route.fallback()
  })
}

function settingsAnswered(page: Page) {
  return page.waitForResponse((response) => response.url() === apiRoute(API_PATH.settings) && response.request().method() === 'GET')
}

async function cacheNotification(page: Page, notification: Record<string, boolean>) {
  await page.addInitScript(([key, value]) => {
    window.localStorage.setItem(key, JSON.stringify({ notification: value }))
  }, [settingsStorageKey, { reviewCompleted: true, reviewFailed: true, criticalFinding: true, email: false, ...notification }] as const)
}

// The review reads as pending until `until`, then as the backend has it (completed).
async function pendingUntil(page: Page, id: string, until: number) {
  await page.route(apiRoute(API_PATH.reviewById(id)), async (route: Route) => {
    if (route.request().method() !== 'GET') return route.fallback()
    const response = await route.fetch()
    if (Date.now() >= until) return route.fulfill({ response })
    return route.fulfill({ response, json: { ...(await response.json()), status: 'pending' } })
  })
}

let reviewId = ''

test.beforeEach(async ({ request }) => {
  reviewId = (await createReview(request, { title: 'Gate R2' })).id
})

test('stale "off" cache, saved preference on: the review failure toast is shown once the settings load', async ({ page, request }) => {
  await setNotification(request, { reviewFailed: true })
  await cacheNotification(page, { reviewFailed: false })
  await slowSettings(page, 800)
  await failRoute(page, API_PATH.reviewById(reviewId), { status: 500 }, 'GET')
  const loaded = settingsAnswered(page)
  await page.goto(ROUTE_PATH.review(reviewId))
  await loaded

  await expect(toastList(page).filter({ hasText: reviewLoadMessage })).toHaveCount(1)
})

test('a failed settings load: the review failure is shown although the saved preference is off (by design)', async ({ page, request }) => {
  await setNotification(request, { reviewFailed: false })
  await failRoute(page, API_PATH.settings, { status: 500 }, 'GET')
  await failRoute(page, API_PATH.reviewById(reviewId), { status: 500 }, 'GET')
  await page.goto(ROUTE_PATH.review(reviewId))

  await expect(toastList(page).filter({ hasText: reviewLoadMessage })).toHaveCount(1)
})

test('a network failure is shown at once, without waiting for a slow settings load', async ({ page, request }) => {
  await setNotification(request, { reviewFailed: false })
  await slowSettings(page, 6000)
  await failRoute(page, API_PATH.reviewById(reviewId), 'network', 'GET')
  const started = Date.now()
  await page.goto(ROUTE_PATH.review(reviewId))

  await expect(page.getByText(`${reviewLoadMessage} ${networkHint}`)).toBeVisible({ timeout: 3000 })
  expect(Date.now() - started).toBeLessThan(5000)
})

for (const enabled of [false, true]) {
  test(`fresh browser, Review completed ${enabled ? 'on' : 'off'}: a completion before the slow settings load ${enabled ? 'shows' : 'shows no'} notice`, async ({ page, request }) => {
    await setNotification(request, { reviewCompleted: enabled })
    await slowSettings(page, 4500)
    await pendingUntil(page, reviewId, Date.now() + 1500)
    const loaded = settingsAnswered(page)
    await page.goto(ROUTE_PATH.review(reviewId))
    await expect(page.getByText('Completed', { exact: true })).toBeVisible({ timeout: 8000 })
    await loaded
    await page.waitForTimeout(500)

    expect(await toastList(page).filter({ hasText: completedMessage }).count()).toBe(enabled ? 1 : 0)
  })
}
