import type { Page, Route } from '@playwright/test'
import { API_PATH } from '../../src/lib/api.constants'
import { REVIEW_PLACEHOLDER_TAB, REVIEW_PLACEHOLDER_TEXT, reviewPlaceholderTestId, type ReviewPlaceholderText } from '../../src/lib/review.constants'
import { ROUTE_PATH } from '../../src/lib/route.constants'
import { REVIEW_STATUS } from '../../src/models/review.model'
import { apiRoute, createReview, expect, FINDING_CODE, test } from './fixture'

// QA (AI-37, plan 020): adversarial e2e checks on the review tab placeholders against the backend.
// The known defects (test.fail) were fixed in QA round 1; those tests are named "D<n> fixed".

const CLEAN_CODE = 'export function add(a: number, b: number): number {\n  return a + b\n}\n'
const findingId = reviewPlaceholderTestId(REVIEW_PLACEHOLDER_TAB.finding)
const suggestionId = reviewPlaceholderTestId(REVIEW_PLACEHOLDER_TAB.suggestion)
const generatedTestId = reviewPlaceholderTestId(REVIEW_PLACEHOLDER_TAB.generatedTest)
// Dev StrictMode fetches twice on mount (the first is aborted), so a few answers stay unfinished
// before the backend's real (finished) answer comes through on a later poll.
const UNFINISHED_ANSWER = 3
// Polls back off 1 s, 2 s, 4 s: the finished answer arrives within a few seconds.
const POLL_TIMEOUT = 15_000

async function expectPlaceholder(page: Page, testId: string, text: ReviewPlaceholderText, timeout?: number) {
  const placeholder = page.getByRole('tabpanel').getByTestId(testId)
  await expect(placeholder).toBeVisible({ timeout })
  await expect(placeholder.getByText(text.title, { exact: true })).toBeVisible({ timeout })
  await expect(placeholder.getByText(text.detail, { exact: true })).toBeVisible({ timeout })
}

// The first `count` GET answers of the review are rewritten to `status` with empty lists (an
// unfinished review has no result yet); later answers come from the backend unchanged.
async function unfinishedFor(page: Page, id: string, status: string, count: number) {
  let seen = 0
  await page.route(apiRoute(API_PATH.reviewById(id)), async (route: Route) => {
    if (route.request().method() !== 'GET') return route.continue()
    const response = await route.fetch()
    if (seen >= count || !response.ok()) return route.fulfill({ response })
    seen += 1
    const body = await response.json()
    return route.fulfill({
      response,
      json: { ...body, status, finding: [], suggestion: [], generatedTest: [], findingCount: [] }
    })
  })
}

// WCAG contrast of an element's text against the first opaque background up its ancestors.
async function contrastOf(page: Page, testId: string, text: string) {
  return page.getByTestId(testId).getByText(text).evaluate((element) => {
    const parse = (value: string) => (value.match(/[\d.]+/g) ?? []).map(Number)
    const channel = (value: number) => {
      const c = value / 255
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
    }
    const luminance = ([r, g, b]: number[]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
    const fg = parse(getComputedStyle(element).color)
    let node: Element | null = element
    let bg = [255, 255, 255]
    while (node) {
      const value = parse(getComputedStyle(node).backgroundColor)
      if (value.length >= 3 && (value.length === 3 || value[3] > 0)) {
        bg = value
        break
      }
      node = node.parentElement
    }
    const [hi, lo] = [luminance(fg), luminance(bg)].sort((a, b) => b - a)
    return (hi + 0.05) / (lo + 0.05)
  })
}

test.describe('QA AI-37 review tab placeholders', () => {
  test('polling: pending -> completed while the Findings tab is open switches analyzing to completed', async ({ page, request }) => {
    const { id } = await createReview(request, { title: 'QA poll', content: CLEAN_CODE })
    await unfinishedFor(page, id, REVIEW_STATUS.pending, UNFINISHED_ANSWER)
    await page.goto(ROUTE_PATH.review(id))
    await expectPlaceholder(page, findingId, REVIEW_PLACEHOLDER_TEXT.analyzing.finding)
    await page.getByRole('tab', { name: /^Findings/ }).click()
    await expectPlaceholder(page, findingId, REVIEW_PLACEHOLDER_TEXT.analyzing.finding)

    await expectPlaceholder(page, findingId, REVIEW_PLACEHOLDER_TEXT.completed.finding, POLL_TIMEOUT)
    await expect(page.getByRole('tab', { name: 'Findings (0)' })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByText(REVIEW_PLACEHOLDER_TEXT.analyzing.finding.title)).toHaveCount(0)
  })

  test('polling: in_progress -> completed with findings removes every placeholder', async ({ page, request }) => {
    const { id } = await createReview(request, { title: 'QA poll items', content: FINDING_CODE })
    await unfinishedFor(page, id, REVIEW_STATUS.inProgress, UNFINISHED_ANSWER)
    await page.goto(ROUTE_PATH.review(id))
    await page.getByRole('tab', { name: /^Suggested refactors/ }).click()
    await expectPlaceholder(page, suggestionId, REVIEW_PLACEHOLDER_TEXT.analyzing.suggestion)

    await expect(page.getByTestId(suggestionId)).toHaveCount(0, { timeout: POLL_TIMEOUT })
    await expect(page.getByRole('tab', { name: /^Suggested refactors \([1-9]/ })).toBeVisible()
    for (const label of [/^Summary/, /^Findings/, /^Generated tests/]) {
      await page.getByRole('tab', { name: label }).click()
      await expect(page.getByTestId(/-placeholder$/)).toHaveCount(0)
    }
  })

  test('polling: pending -> failed shows the stopped placeholder', async ({ page, request }) => {
    const { id } = await createReview(request, { title: 'QA poll failed', content: CLEAN_CODE })
    let seen = 0
    await page.route(apiRoute(API_PATH.reviewById(id)), async (route: Route) => {
      if (route.request().method() !== 'GET') return route.continue()
      const response = await route.fetch()
      const body = await response.json()
      const status = seen++ < UNFINISHED_ANSWER ? REVIEW_STATUS.pending : REVIEW_STATUS.failed
      return route.fulfill({ response, json: { ...body, status, finding: [], suggestion: [], generatedTest: [] } })
    })
    await page.goto(ROUTE_PATH.review(id))
    await expectPlaceholder(page, findingId, REVIEW_PLACEHOLDER_TEXT.analyzing.finding)
    await expectPlaceholder(page, findingId, REVIEW_PLACEHOLDER_TEXT.stopped.finding, POLL_TIMEOUT)
    await page.getByRole('tab', { name: /^Generated tests/ }).click()
    await expectPlaceholder(page, generatedTestId, REVIEW_PLACEHOLDER_TEXT.stopped.generated_test)
  })

  test('generated tests off in Settings: the tab is hidden and the page still works', async ({ page, request }) => {
    const current = await (await request.get(apiRoute(API_PATH.settings))).json()
    const saved = await request.put(apiRoute(API_PATH.settings), { data: { ...current, generatedTest: false } })
    expect(saved.status()).toBe(204)
    const { id } = await createReview(request, { title: 'QA tests off', content: CLEAN_CODE })
    const errorList: string[] = []
    page.on('pageerror', (error) => errorList.push(error.message))

    await page.goto(ROUTE_PATH.review(id))
    await expectPlaceholder(page, findingId, REVIEW_PLACEHOLDER_TEXT.completed.finding)
    await expect(page.getByRole('tab', { name: /Generated tests/ })).toHaveCount(0)
    await page.getByRole('tab', { name: /^Suggested refactors/ }).click()
    await expectPlaceholder(page, suggestionId, REVIEW_PLACEHOLDER_TEXT.completed.suggestion)
    await page.goto('/review/new')
    await expect(page.getByRole('tab', { name: /Generated tests/ })).toHaveCount(0)
    await expectPlaceholder(page, findingId, REVIEW_PLACEHOLDER_TEXT.notRun.finding)
    expect(errorList).toEqual([])
  })

  for (const viewport of [
    { width: 390, height: 844 },
    { width: 1280, height: 800 }
  ]) {
    test(`${viewport.width}px: placeholders are visible, inside the viewport and cause no horizontal overflow`, async ({ page }) => {
      await page.setViewportSize(viewport)
      await page.goto('/review/new')
      for (const [label, testId] of [
        [/^Summary/, findingId],
        [/^Findings/, findingId],
        [/^Suggested refactors/, suggestionId],
        [/^Generated tests/, generatedTestId]
      ] as const) {
        await page.getByRole('tab', { name: label }).click()
        const placeholder = page.getByRole('tabpanel').getByTestId(testId)
        await expect(placeholder).toBeVisible()
        const box = await placeholder.boundingBox()
        expect(box).not.toBeNull()
        expect(box!.x).toBeGreaterThanOrEqual(0)
        expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width)
        const overflow = await page.evaluate(() => {
          const main = document.querySelector('main')
          return document.documentElement.scrollWidth > window.innerWidth || (main !== null && main.scrollWidth > main.clientWidth)
        })
        expect(overflow).toBe(false)
        // The icon is hidden from assistive technology.
        await expect(placeholder.locator('svg')).toHaveAttribute('aria-hidden', 'true')
      }
    })
  }

  test('D1 fixed: Findings tab placeholder detail meets WCAG AA contrast (4.5:1) on the page background', async ({ page }) => {
    await page.goto('/review/new')
    await page.getByRole('tab', { name: /^Findings/ }).click()
    const text = REVIEW_PLACEHOLDER_TEXT.notRun.finding
    expect(await contrastOf(page, findingId, text.title)).toBeGreaterThanOrEqual(4.5)
    expect(await contrastOf(page, findingId, text.detail)).toBeGreaterThanOrEqual(4.5)
  })

  test('D1 fixed: Summary Key issues placeholder detail meets WCAG AA contrast (4.5:1) on the card', async ({ page }) => {
    await page.goto('/review/new')
    const text = REVIEW_PLACEHOLDER_TEXT.notRun.finding
    expect(await contrastOf(page, findingId, text.detail)).toBeGreaterThanOrEqual(4.5)
  })
})
