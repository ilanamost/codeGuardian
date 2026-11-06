import type { Page } from '@playwright/test'
import { API_PATH } from '../../src/lib/api.constants'
import { ROUTE_PATH } from '../../src/lib/route.constants'
import { createReview, expect, failRoute, setReviewFailed, test } from './fixture'

// The backend starts with no reviews: each test gets one created review to act on.
let reviewId = ''

test.beforeEach(async ({ request }) => {
  reviewId = (await createReview(request, { title: 'Payment API' })).id
})

// Plan 016 and 019: failures reach the user as one error toast through the store and
// notification.service. Review failures follow the "Review failed" preference, except network,
// timeout and storage failures, which always show. The app runs on the HTTP data source against
// the real backend, so failures are forced at the network layer with page.route.
const serverHint = 'The server had a problem, please try again shortly.'
const networkHint = 'Check your internet connection and try again.'

const message = {
  reviewLoad: 'Could not load the review.',
  reviewSave: 'Could not save the review.',
  dashboardLoad: 'Could not load the dashboard.',
  settingsLoad: 'Could not load your settings.',
  accountLoad: 'Could not load your account.',
  sessionRestore: 'Could not check your session.'
}

const toastList = (page: Page) => page.locator('[data-sonner-toast]')

// Lets every load answer (or fail) and the toasts appear, before counting them.
async function settle(page: Page) {
  await page.waitForLoadState('networkidle')
}

test('a forced save failure (HTTP 500) shows one error toast', async ({ page }) => {
  await failRoute(page, API_PATH.reviewById(reviewId), { status: 500 }, 'PUT')
  await page.goto(ROUTE_PATH.review(reviewId))

  await page.getByRole('button', { name: 'Save review' }).click()
  await expect(page.getByText(`${message.reviewSave} ${serverHint}`)).toBeVisible()
  await page.getByRole('button', { name: 'Save review' }).click()

  // The second failure within 2 seconds is collapsed into the first toast.
  await expect(page.getByText(`${message.reviewSave} ${serverHint}`)).toHaveCount(1)
  expect(await page.getByText('Review saved').count()).toBe(0)
})

test('a network failure is still shown when the Review failed notification is off', async ({ page, request }) => {
  // User decision: network, timeout and storage failures always show, even during a review action.
  await setReviewFailed(request, false)
  await failRoute(page, API_PATH.reviewById(reviewId), 'network', 'PUT')
  await page.goto(ROUTE_PATH.review(reviewId))

  await page.getByRole('button', { name: 'Save review' }).click()

  await expect(page.getByText(`${message.reviewSave} ${networkHint}`)).toBeVisible()
  expect(await page.getByText('Review saved').count()).toBe(0)
})

test('Review failed off hides a server-side review failure but not a network failure', async ({ page, request }) => {
  await setReviewFailed(request, false)
  await failRoute(page, API_PATH.reviewById(reviewId), { status: 500 }, 'GET')
  await page.goto(ROUTE_PATH.review(reviewId))

  await expect(page.getByRole('heading', { name: 'Review unavailable' })).toBeVisible()
  await settle(page)
  // Immediate counts: a retrying toHaveCount(0) also passes once a shown toast has expired.
  expect(await toastList(page).filter({ hasText: message.reviewLoad }).count()).toBe(0)

  await page.unrouteAll({ behavior: 'ignoreErrors' })
  await failRoute(page, API_PATH.reviewById(reviewId), 'network', 'GET')
  await page.reload()

  await expect(page.getByText(`${message.reviewLoad} ${networkHint}`)).toBeVisible()
})

// A review failure that is not a connection or storage problem: the PDF library cannot load.
const pdfError = 'Could not create the PDF report. Please try again.'

test('a failed PDF report shows the error toast when Review failed is on', async ({ page }) => {
  await page.route(/jspdf/, (route) => route.abort())
  await page.goto(ROUTE_PATH.review(reviewId))

  await page.getByRole('button', { name: 'Download report' }).click()

  await expect(page.getByText(pdfError)).toBeVisible()
})

test('no toast for a failed PDF report when Review failed is off', async ({ page, request }) => {
  await setReviewFailed(request, false)
  await page.route(/jspdf/, (route) => route.abort())
  await page.goto(ROUTE_PATH.review(reviewId))
  await settle(page)

  await page.getByRole('button', { name: 'Download report' }).click()
  await page.waitForTimeout(1000)

  expect(await page.getByText(pdfError).count()).toBe(0)
})

test('a forced delete failure keeps the row and shows the error toast', async ({ page }) => {
  await failRoute(page, '/api/review/*', { status: 500 }, 'DELETE')
  await page.goto('/history')
  await expect(page.getByTestId('review-row').first()).toBeVisible()
  const rowCount = await page.getByTestId('review-row').count()

  await page.getByRole('button', { name: /^Delete review / }).first().click()
  await page.getByRole('button', { name: 'Delete', exact: true }).click()

  await expect(page.getByText(/^Could not delete the review\./)).toBeVisible()
  await expect(page.getByTestId('review-row')).toHaveCount(rowCount)
})

test('a 404 review id shows Review not found with no toast', async ({ page }) => {
  const response = page.waitForResponse((item) => item.url().endsWith(API_PATH.reviewById('nope')))
  await page.goto('/review/nope')

  expect((await response).status()).toBe(404)
  await expect(page.getByRole('heading', { name: 'Review not found' })).toBeVisible()
  await settle(page)
  expect(await toastList(page).count()).toBe(0)
})

test('a review can still be saved, restored and deleted when the backend works', async ({ page }) => {
  await page.goto(ROUTE_PATH.review(reviewId))
  await page.getByRole('button', { name: 'Edit review name' }).click()
  await page.getByRole('textbox', { name: 'Review name' }).fill('Saved through the store')
  await page.keyboard.press('Enter')
  await page.getByRole('button', { name: 'Save review' }).click()
  await expect(page.getByText('Review saved')).toBeVisible()

  await page.goto('/history')
  await expect(page.getByRole('link', { name: /Saved through the store/ })).toBeVisible()
  await page.getByRole('button', { name: 'Delete review Saved through the store' }).click()
  await page.getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(page.getByText('Review deleted')).toBeVisible()

  await page.goto(ROUTE_PATH.review(reviewId))
  await expect(page.getByRole('heading', { name: 'Review not found' })).toBeVisible()
})

// Every load of a page fails the same way: each failed load shows its own toast exactly once.
// Plan 028: the session restore (GET /api/session) is let through, so the page is signed in and
// loads; it also brings the account, so /settings sends no GET /api/account on load (the
// account-load failure is covered by the Settings panel below).
const pageLoadList: { path: string; failedList: string[] }[] = [
  { path: '/', failedList: [message.dashboardLoad, message.reviewLoad, message.settingsLoad] },
  { path: '/history', failedList: [message.reviewLoad, message.settingsLoad] },
  { path: ROUTE_PATH.review('any-review'), failedList: [message.reviewLoad, message.settingsLoad] },
  { path: '/github', failedList: [message.settingsLoad] },
  { path: '/settings', failedList: [message.settingsLoad] }
]

for (const failure of [{ status: 500 }, 'network'] as const) {
  const hint = failure === 'network' ? networkHint : serverHint
  const label = failure === 'network' ? 'the network fails' : 'the backend returns 500'
  for (const { path, failedList } of pageLoadList) {
    test(`${path} shows each error toast once when ${label}`, async ({ page }) => {
      await failRoute(page, '/api/**', failure, undefined, [API_PATH.session])
      await page.goto(path)
      await settle(page)

      for (const text of failedList) {
        await expect(toastList(page).filter({ hasText: `${text} ${hint}` })).toHaveCount(1)
      }
      await expect(toastList(page)).toHaveCount(failedList.length)
    })
  }

  test(`a failing session restore shows Retry and one toast, and loads nothing else, when ${label}`, async ({ page }) => {
    const otherApiList: string[] = []
    page.on('request', (request) => {
      const { pathname } = new URL(request.url())
      if (pathname.startsWith('/api/') && pathname !== API_PATH.session) otherApiList.push(pathname)
    })
    await failRoute(page, '/api/**', failure)
    await page.goto('/history')
    await settle(page)

    await expect(page.getByRole('alert')).toHaveText(/Could not check your session/)
    await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible()
    await expect(toastList(page)).toHaveCount(1)
    await expect(toastList(page).filter({ hasText: `${message.sessionRestore} ${hint}` })).toHaveCount(1)
    expect(otherApiList).toEqual([])

    // Once the backend answers again, Retry signs the page in where it was.
    await page.unrouteAll({ behavior: 'ignoreErrors' })
    await page.getByRole('button', { name: 'Retry' }).click()
    await expect(page.getByRole('heading', { name: 'Review History' })).toBeVisible()
  })
}

test('on /settings the account comes from the session restore: a failing GET /api/account is never hit on load', async ({ page }) => {
  await failRoute(page, API_PATH.account, { status: 500 }, 'GET')
  await page.goto('/settings')
  await expect(page.getByRole('tabpanel').getByText('John Doe')).toBeVisible()
  // The account came with the session restore; nothing is fetched again, so nothing fails.
  await settle(page)
  expect(await toastList(page).filter({ hasText: message.accountLoad }).count()).toBe(0)
})
