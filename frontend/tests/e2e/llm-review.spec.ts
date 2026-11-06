import type { Route } from '@playwright/test'
import { API_PATH } from '../../src/lib/api.constants'
import { AI_NOTICE_TEXT, FAILURE_TEXT } from '../../src/lib/review.constants'
import { ROUTE_PATH } from '../../src/lib/route.constants'
import { apiRoute, createReview, expect, fulfillJson, MONACO_LOAD, test } from './fixture'

// Plan 039 (AI-88): the backend runs without an Anthropic key here, so it uses the stub analyzer.
// A failed review with a reason and the "claude" notice are forced at the network layer, which
// rewrites the page's own API bodies: plain run only.
let reviewId = ''

test.beforeEach(async ({ request }) => {
  reviewId = (await createReview(request, { title: 'Payment API' })).id
})

test('without a key the Review page says the stub analyzer is in use, not that code is sent', async ({ page }) => {
  await page.goto(ROUTE_PATH.review(reviewId))
  await expect(page.getByTestId('ai-notice-stub')).toHaveText(AI_NOTICE_TEXT.stub, MONACO_LOAD)
  await expect(page.getByTestId('ai-notice-claude')).toHaveCount(0)
})

test('with the claude analyzer the Review page says code is sent to Anthropic', async ({ page }) => {
  await page.route(apiRoute(API_PATH.health), (route: Route) => fulfillJson(route, 200, { status: 'ok', analyzer: 'claude' }))
  await page.goto(ROUTE_PATH.review(reviewId))
  await expect(page.getByTestId('ai-notice-claude')).toHaveText(AI_NOTICE_TEXT.claude, MONACO_LOAD)
  await expect(page.getByTestId('ai-notice-stub')).toHaveCount(0)
})

test('a failed review with ai_timeout shows the timeout message and the Run review hint', async ({ page }) => {
  await page.route(apiRoute(API_PATH.reviewById(reviewId)), async (route: Route) => {
    if (route.request().method() !== 'GET') return route.continue()
    const response = await route.fetch()
    if (!response.ok()) return route.fulfill({ response })
    return route.fulfill({ response, json: { ...(await response.json()), status: 'failed', failureReason: 'ai_timeout' } })
  })
  await page.goto(ROUTE_PATH.review(reviewId))
  const message = page.getByTestId('failure-reason')
  await expect(message).toHaveText(FAILURE_TEXT.ai_timeout, MONACO_LOAD)
  await expect(message).toContainText('Run review')
  await expect(page.getByText('Something went wrong')).toHaveCount(0)
})
