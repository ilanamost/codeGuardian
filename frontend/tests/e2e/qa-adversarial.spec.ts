import type { APIRequestContext, Page, Request } from '@playwright/test'
import { API_PATH } from '../../src/lib/api.constants'
import { ROUTE_PATH } from '../../src/lib/route.constants'
import { FAKE_GITHUB_FILE_ID, FAKE_GITHUB_REPO, FAKE_GITHUB_USER } from './e2e.constants'
import { apiRoute, connectFakeGithub, createReview, expect, failRoute, setReviewFailed, showReviewAs, test } from './fixture'

// QA (AI-35, plan 019): tries to break the integration against the real backend.
// Tests marked test.fail are KNOWN DEFECTs: they describe the expected behaviour and fail today.

const toastList = (page: Page) => page.locator('[data-sonner-toast]')
const editorArea = (page: Page) => page.locator('.monaco-editor .view-lines').first()
const mainNav = (page: Page) => page.getByRole('navigation', { name: 'Main' })

// Plan 019 addendum: the backend starts with no reviews. These stand in for the former seed: r1
// is a created, completed review; r5, r6 and r7 are created too and shown as in progress, queued
// and pending at the network layer (the stub analyzer finishes every review at once).
const review = { r1: '', r5: '', r6: '', r7: '' }

async function createQaReviews(page: Page, request: APIRequestContext) {
  review.r1 = (await createReview(request, { title: 'Authentication Service' })).id
  review.r5 = (await createReview(request, { title: 'Notification Worker' })).id
  review.r6 = (await createReview(request, { title: 'Billing Export' })).id
  review.r7 = (await createReview(request, { title: 'Search Indexer' })).id
  await showReviewAs(page, review.r5, 'in_progress')
  await showReviewAs(page, review.r6, 'queued')
  await showReviewAs(page, review.r7, 'pending')
}

function counter(page: Page, method: string, path: string) {
  const list: Request[] = []
  page.on('request', (request) => {
    if (request.method() === method && request.url() === apiRoute(path)) list.push(request)
  })
  return {
    get count() {
      return list.length
    },
    reset() {
      list.length = 0
    }
  }
}

async function typeCode(page: Page, text: string) {
  await editorArea(page).click()
  await page.keyboard.insertText(text)
}

// Large inputs are pasted: typed or inserted, Monaco needs minutes for 100 000 characters.
// One line, because Monaco on Windows turns each pasted line feed into CR LF (one more character).
function bigCode(length: number): string {
  return 'a'.repeat(length)
}

async function pasteCode(page: Page, text: string) {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.evaluate((value) => navigator.clipboard.writeText(value), text)
  await editorArea(page).click()
  await page.keyboard.press('ControlOrMeta+V')
}

function sentContentLength(request: Request): number {
  return (JSON.parse(request.postData() ?? '{}') as { content?: string }).content?.length ?? -1
}

test.describe('QA new review', () => {
  test('whitespace-only code keeps Save disabled', async ({ page }) => {
    await page.goto('/review/new')
    await typeCode(page, '   \n\t  \n')
    await expect(page.getByRole('button', { name: 'Run review' })).toBeDisabled()
  })

  test('a double-click on Save creates exactly one review', async ({ page }) => {
    const create = counter(page, 'POST', API_PATH.review)
    await page.goto('/review/new')
    await typeCode(page, 'const once = 1')
    await page.getByRole('button', { name: 'Run review' }).dblclick()
    await expect(page).toHaveURL(/\/review\/[0-9a-f-]{36}$/)
    await expect(page.getByText('Completed', { exact: true })).toBeVisible()
    expect(create.count).toBe(1)
    await page.goto('/history')
    await expect(page.getByTestId('review-row').filter({ hasText: 'New review' })).toHaveCount(1)
  })

  test('exactly 100 000 characters is saved and completes; it is listed in History and on the Dashboard', async ({ page }) => {
    test.setTimeout(90_000)
    await page.goto('/review/new')
    await pasteCode(page, bigCode(100_000))
    const created = page.waitForResponse((response) => response.request().method() === 'POST' && response.url() === apiRoute(API_PATH.review))
    await page.getByRole('button', { name: 'Run review' }).click()
    const response = await created
    expect(sentContentLength(response.request())).toBe(100_000)
    expect(response.status()).toBe(202)
    await expect(page).toHaveURL(/\/review\/[0-9a-f-]{36}$/)
    await expect(page.getByText('Completed', { exact: true })).toBeVisible()
    await page.goto('/history')
    await expect(page.getByTestId('review-row').getByRole('link', { name: /New review/ })).toBeVisible()
    await page.goto('/')
    await expect(page.getByRole('region', { name: 'Recent Reviews' }).getByRole('link', { name: /New review/ })).toBeVisible()
  })

  // QA round 1 (L-6): the client now checks the 100 000-character limit before sending, so 100 001
  // characters never reach the backend; the backend's own 422 is checked with a direct request.
  test('100 001 characters is blocked in the browser (the limit is named, nothing is sent) and the backend would answer 422', async ({ page, request }) => {
    test.setTimeout(90_000)
    const create = counter(page, 'POST', API_PATH.review)
    await page.goto('/review/new')
    await pasteCode(page, bigCode(100_001))
    await expect(page.getByText('Code is too long: 100,001 characters. Use at most 100,000 characters.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Run review' })).toBeDisabled()
    await page.getByRole('button', { name: 'Run review' }).click({ force: true })
    await page.waitForTimeout(500)
    expect(create.count).toBe(0)
    await expect(page).toHaveURL(/\/review\/new$/)
    const direct = await request.post(apiRoute(API_PATH.review), {
      data: { source_type: 'snippet', language: 'TypeScript', content: bigCode(100_001) }
    })
    expect(direct.status()).toBe(422)
  })

  test('a create failure (500) shows one toast and stays on the blank review', async ({ page }) => {
    await failRoute(page, API_PATH.review, { status: 500 }, 'POST')
    await page.goto('/review/new')
    await typeCode(page, 'const x = 1')
    await page.getByRole('button', { name: 'Run review' }).click()
    await expect(page.getByText(/^Could not start the review\./)).toBeVisible()
    await page.waitForTimeout(500)
    await expect(toastList(page)).toHaveCount(1)
    await expect(page).toHaveURL(/\/review\/new$/)
  })

  // FIXED in QA round 1 (D1), was a test.fail KNOWN DEFECT.
  test('leaving the page while Save runs does not pull the user back to the review', async ({ page }) => {
    await page.route(apiRoute(API_PATH.review), async (route) => {
      if (route.request().method() !== 'POST') return route.continue()
      await new Promise((done) => setTimeout(done, 1500))
      await route.continue()
    })
    await page.goto('/review/new')
    await typeCode(page, 'const slow = 1')
    await page.getByRole('button', { name: 'Run review' }).click()
    await mainNav(page).getByRole('link', { name: 'Review History' }).click()
    await expect(page).toHaveURL(/\/history$/)
    // The create answers after the user left; ReviewPage.saveNew must not navigate any more.
    await page.waitForTimeout(3000)
    await expect(page).toHaveURL(/\/history$/)
  })
})

test.describe('QA buttons: failure paths', () => {
  test.beforeEach(async ({ page, request }) => {
    await createQaReviews(page, request)
  })

  // QA round 1 (L-3): Regenerate is disabled until the review is completed, so the button must
  // send nothing. The backend's 409 for a review that is not completed cannot be reached here any
  // more (the stub analyzer completes every review at once, plan 019 addendum); it is covered in
  // tests/unit/cross-stack.test.ts with an analyzer that holds a review pending.
  test('Regenerate on an in-progress review is disabled and sends nothing', async ({ page }) => {
    const regenerate = counter(page, 'POST', API_PATH.generatedTest(review.r5))
    await page.goto(ROUTE_PATH.review(review.r5))
    await page.getByRole('tab', { name: /Generated tests/ }).click()
    await expect(page.getByRole('button', { name: 'Regenerate' })).toBeDisabled()
    await expect(page.getByText('Tests can be regenerated once the review is completed.')).toBeVisible()
    await page.getByRole('button', { name: 'Regenerate' }).click({ force: true })
    await page.waitForTimeout(500)
    expect(regenerate.count).toBe(0)
    expect(await toastList(page).count()).toBe(0)
  })

  for (const failure of [{ status: 500 }, 'network'] as const) {
    const label = failure === 'network' ? 'network drop' : '500'
    test(`Regenerate ${label}: one toast, no success`, async ({ page }) => {
      await failRoute(page, API_PATH.generatedTest(review.r1), failure, 'POST')
      await page.goto(ROUTE_PATH.review(review.r1))
      await page.getByRole('tab', { name: /Generated tests/ }).click()
      await page.getByRole('button', { name: 'Regenerate' }).click()
      await expect(page.getByText(/^Could not regenerate the tests\./)).toHaveCount(1)
      expect(await page.getByText('Tests regenerated').count()).toBe(0)
      await expect(page.getByRole('button', { name: 'Regenerate' })).toBeEnabled()
    })

    test(`Switch account ${label}: one toast and the account stays`, async ({ page }) => {
      await failRoute(page, API_PATH.githubDisconnect, failure, 'POST')
      await page.goto('/github')
      await connectFakeGithub(page)
      await page.getByRole('button', { name: 'Switch account' }).click()
      await expect(page.getByText(/^Could not switch the GitHub account\./)).toHaveCount(1)
      await expect(page.getByText(`Connected as ${FAKE_GITHUB_USER}`)).toBeVisible()
    })

    test(`Import ${label}: one toast and the wizard stays`, async ({ page }) => {
      await failRoute(page, API_PATH.githubFile(FAKE_GITHUB_REPO, FAKE_GITHUB_FILE_ID), failure, 'GET')
      await page.goto('/github')
      await connectFakeGithub(page)
      await page.getByRole('radio', { name: FAKE_GITHUB_REPO }).click()
      await page.getByRole('button', { name: 'Next' }).click()
      await page.getByRole('checkbox', { name: 'src/greet.ts' }).check()
      await page.getByRole('button', { name: 'Approve' }).click()
      await expect(page.getByText(/^Could not import the file\./)).toHaveCount(1)
      await expect(page).toHaveURL(/\/github$/)
    })

    test(`Password change ${label}: one toast, no field error`, async ({ page }) => {
      await failRoute(page, API_PATH.accountPassword, failure, 'PUT')
      await page.goto('/settings')
      await page.getByRole('tab', { name: 'Security' }).click()
      await page.getByRole('button', { name: 'Update password' }).click()
      await page.getByLabel('Current password', { exact: true }).click()
      await page.getByLabel('Current password', { exact: true }).fill('mock-password')
      await page.getByLabel('New password', { exact: true }).click()
      await page.getByLabel('New password', { exact: true }).fill('long-enough-1')
      await page.getByLabel('Confirm password', { exact: true }).click()
      await page.getByLabel('Confirm password', { exact: true }).fill('long-enough-1')
      await page.getByRole('button', { name: 'Save password' }).click()
      await expect(page.getByText(/^Could not update your password\./)).toHaveCount(1)
      expect(await page.getByText('Password updated').count()).toBe(0)
      expect(await page.getByRole('alert').count()).toBe(0)
    })

    test(`Sign out ${label}: one toast, no success`, async ({ page }) => {
      await failRoute(page, API_PATH.session, failure, 'DELETE')
      await page.goto('/settings')
      await page.getByRole('tab', { name: 'Security' }).click()
      await page.getByRole('button', { name: 'Sign Out' }).click()
      await page.getByRole('dialog').getByRole('button', { name: 'Sign out' }).click()
      await expect(page.getByText(/^Could not sign out\./)).toHaveCount(1)
      expect(await page.getByText('Signed out', { exact: true }).count()).toBe(0)
      await expect(page.getByRole('button', { name: 'Sign Out' })).toBeEnabled()
    })
  }

  test('password reuse shows the new-password field error and no toast', async ({ page, request }) => {
    await page.goto('/settings')
    await page.getByRole('tab', { name: 'Security' }).click()
    // Plan 028: the demo password has no digit, so the client rules would refuse it as a new
    // password before sending; change it to a valid one first, then reuse that one.
    const changed = await request.put(apiRoute(API_PATH.accountPassword), { data: { currentPassword: 'mock-password', newPassword: 'long-enough-1' } })
    expect(changed.status()).toBe(204)
    await page.getByRole('button', { name: 'Update password' }).click()
    await page.getByLabel('Current password', { exact: true }).click()
    await page.getByLabel('Current password', { exact: true }).fill('long-enough-1')
    await page.getByLabel('New password', { exact: true }).click()
    await page.getByLabel('New password', { exact: true }).fill('long-enough-1')
    await page.getByLabel('Confirm password', { exact: true }).click()
    await page.getByLabel('Confirm password', { exact: true }).fill('long-enough-1')
    const call = page.waitForResponse((response) => response.url() === apiRoute(API_PATH.accountPassword))
    await page.getByRole('button', { name: 'Save password' }).click()
    expect((await call).status()).toBe(422)
    await expect(page.getByText('Choose a new password that is different from the current one.')).toBeVisible()
    await page.waitForTimeout(500)
    expect(await toastList(page).count()).toBe(0)
  })

  // FIXED in QA round 1 (D3), was a test.fail KNOWN DEFECT.
  test('with Review failed off, a 500 on Regenerate shows no toast (test_regenerate follows Review failed)', async ({ page, request }) => {
    await setReviewFailed(request, false)
    await failRoute(page, API_PATH.generatedTest(review.r1), { status: 500 }, 'POST')
    await page.goto(ROUTE_PATH.review(review.r1))
    await page.waitForLoadState('networkidle')
    await page.getByRole('tab', { name: /Generated tests/ }).click()
    await page.getByRole('button', { name: 'Regenerate' }).click()
    await page.waitForTimeout(2000)
    expect(await page.getByText(/^Could not regenerate the tests\./).count()).toBe(0)
  })
})

test.describe('QA notification policy', () => {
  test.beforeEach(async ({ page, request }) => {
    await createQaReviews(page, request)
  })

  // error-notification.spec.ts asserts this with toHaveCount(0), which retries for 5 seconds and
  // also passes when a toast was shown and expired (sonner closes it after about 4 seconds).
  test('a 404 review id shows Review not found and no toast at any moment', async ({ page }) => {
    await page.goto('/review/nope')
    await expect(page.getByRole('heading', { name: 'Review not found' })).toBeVisible()
    await page.waitForLoadState('networkidle')
    expect(await toastList(page).count()).toBe(0)
  })

  test('a review deleted while its page polls turns into Review not found, with no toast', async ({ page, request }) => {
    await page.goto(ROUTE_PATH.review(review.r7))
    await expect(page.getByTestId('review-name')).toBeVisible()
    expect((await request.delete(apiRoute(API_PATH.reviewById(review.r7)))).status()).toBe(204)
    await expect(page.getByRole('heading', { name: 'Review not found' })).toBeVisible({ timeout: 3000 })
    expect(await toastList(page).count()).toBe(0)
  })
})

test.describe('QA polling', () => {
  test.beforeEach(async ({ page, request }) => {
    await createQaReviews(page, request)
  })

  // QA AI-43 D5: the timing is measured from the review's own requests, not from a window that
  // starts when the page has rendered (a slow first render, e.g. a cold dev server, used to move
  // the first poll out of that window). The page asks once to load, then polls after
  // REVIEW_POLL_INTERVAL_MS (1 s) and, with the status unchanged, after twice that (backoff).
  test('polls an unfinished review about once a second and stops on leaving the page', async ({ page }) => {
    // Answered requests only: in the dev server React StrictMode may start and cancel a duplicate load.
    const sentAt: number[] = []
    page.on('requestfinished', (request) => {
      if (request.method() === 'GET' && request.url() === apiRoute(API_PATH.reviewById(review.r7))) sentAt.push(Date.now())
    })
    await page.goto(ROUTE_PATH.review(review.r7))
    await expect(page.getByTestId('review-name')).toBeVisible()
    // The load and the first two polls.
    await expect.poll(() => sentAt.length, { timeout: 8000 }).toBeGreaterThanOrEqual(3)
    const [firstGap, secondGap] = [sentAt[1] - sentAt[0], sentAt[2] - sentAt[1]]
    // Never faster than planned, and not much slower (the gap also holds the answer's round trip).
    expect(firstGap).toBeGreaterThanOrEqual(950)
    expect(firstGap).toBeLessThan(2500)
    expect(secondGap).toBeGreaterThanOrEqual(1950)
    expect(secondGap).toBeLessThan(3500)

    const poll = counter(page, 'GET', API_PATH.reviewById(review.r7))

    await mainNav(page).getByRole('link', { name: 'Review History' }).click()
    await expect(page).toHaveURL(/\/history$/)
    poll.reset()
    await page.waitForTimeout(2500)
    expect(poll.count).toBe(0)
  })

  test('switching between unfinished reviews never leaves a second poll running', async ({ page }) => {
    const r6Poll = counter(page, 'GET', API_PATH.reviewById(review.r6))
    const r7Poll = counter(page, 'GET', API_PATH.reviewById(review.r7))
    await page.goto('/history')
    for (let round = 0; round < 3; round += 1) {
      await page.getByTestId('review-row').getByRole('link', { name: /Search Indexer/ }).click()
      await expect(page).toHaveURL(new RegExp(`/review/${review.r7}$`))
      await page.goBack()
      await page.getByTestId('review-row').getByRole('link', { name: /Billing Export/ }).click()
      await expect(page).toHaveURL(new RegExp(`/review/${review.r6}$`))
      await page.goBack()
    }
    await page.getByTestId('review-row').getByRole('link', { name: /Search Indexer/ }).click()
    await expect(page.getByTestId('review-name')).toBeVisible()
    r6Poll.reset()
    r7Poll.reset()
    await page.waitForTimeout(3500)
    expect(r6Poll.count).toBe(0)
    expect(r7Poll.count).toBeLessThanOrEqual(5)
  })

  test('stops polling once a new review is completed, and says Review completed once', async ({ page }) => {
    await page.goto('/review/new')
    await typeCode(page, 'const done = 1')
    await page.getByRole('button', { name: 'Run review' }).click()
    await expect(page).toHaveURL(/\/review\/[0-9a-f-]{36}$/)
    await expect(page.getByText('Completed', { exact: true })).toBeVisible()
    const id = page.url().split('/').pop() ?? ''
    const poll = counter(page, 'GET', API_PATH.reviewById(id))
    await page.waitForTimeout(2500)
    expect(poll.count).toBe(0)
    await expect(page.getByText('Review completed', { exact: true })).toHaveCount(1)
  })

  // FIXED in QA round 1 (D2), was a test.fail KNOWN DEFECT: polling resumes after a failed poll.
  test('one failed poll does not stop polling (it retries; the status does not stay stale)', async ({ page }) => {
    let failed = 0
    await page.goto(ROUTE_PATH.review(review.r7))
    await expect(page.getByTestId('review-name')).toBeVisible()
    await page.route(apiRoute(API_PATH.reviewById(review.r7)), async (route) => {
      if (route.request().method() === 'GET' && failed === 0) {
        failed += 1
        return route.abort('failed')
      }
      // Fallback, not continue: the GET still goes through showReviewAs (shown as pending).
      return route.fallback()
    })
    await expect.poll(() => failed).toBe(1)
    const poll = counter(page, 'GET', API_PATH.reviewById(review.r7))
    // The retry waits REVIEW_POLL_RETRY_MS (3 s) after a failure.
    await page.waitForTimeout(4500)
    expect(poll.count).toBeGreaterThan(0)
  })
})
