import type { Page } from '@playwright/test'
import { API_PATH } from '../../src/lib/api.constants'
import { REVIEW_TEXT } from '../../src/lib/review.constants'
import { ROUTE_PATH } from '../../src/lib/route.constants'
import { apiRoute, createReview, expect, FINDING_CODE, MONACO_LOAD, showReviewAs, test } from './fixture'

// QA, plan 025: tries to break the stale flag after a reload and the Run again hint layout.
const runButton = (page: Page) => page.getByRole('button', { name: REVIEW_TEXT.runButton })
const viewLines = (page: Page) => page.locator('.monaco-editor .view-lines').first()
const glyph = (page: Page) => page.locator('.monaco-editor .editor-finding-glyph')
const hint = (page: Page) => page.getByTestId('run-again-hint')

const PLAIN_CODE = 'export const sum = (a: number, b: number) => a + b\n'

test('QA: a saved edit that only differs by CR LF and trailing whitespace keeps the markers after reload', async ({ page, request }) => {
  const { id } = await createReview(request, { title: 'CRLF only', content: FINDING_CODE })
  const saved = await request.put(apiRoute(API_PATH.reviewById(id)), {
    data: { language: 'TypeScript', code: `${FINDING_CODE.replace(/\n/g, '\r\n')}   \r\n` }
  })
  expect(saved.ok()).toBe(true)

  await page.goto(ROUTE_PATH.review(id))
  await expect(page.getByText('Completed', { exact: true })).toBeVisible()
  await expect(viewLines(page)).toContainText('eval(input)')
  await expect.poll(() => glyph(page).count()).toBeGreaterThan(0)
  await expect(runButton(page)).toBeDisabled()
})

test('QA: a typed, unsaved edit keeps the markers', async ({ page, request }) => {
  const { id } = await createReview(request, { title: 'Typed edit', content: FINDING_CODE })
  await page.goto(ROUTE_PATH.review(id))
  await expect(viewLines(page)).toContainText('eval(input)', MONACO_LOAD)
  await expect.poll(() => glyph(page).count()).toBeGreaterThan(0)

  await viewLines(page).click()
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.insertText('// typed')
  await expect(runButton(page)).toBeEnabled()
  await expect.poll(() => glyph(page).count()).toBeGreaterThan(0)
})

for (const width of [320, 375, 768, 1024]) {
  test(`QA: the Run again hint wraps inside the viewport at ${width}px`, async ({ page, request }) => {
    await page.setViewportSize({ width, height: 800 })
    const { id } = await createReview(request, { title: 'Hint layout', content: PLAIN_CODE })
    await showReviewAs(page, id, 'cancelled')
    await page.goto(ROUTE_PATH.review(id))
    await expect(hint(page)).toBeVisible()
    await expect(runButton(page)).toBeDisabled()

    const box = await hint(page).boundingBox()
    expect(box).not.toBeNull()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(width)
    // The hint sits under the action buttons, not beside or over them.
    const runBox = await runButton(page).boundingBox()
    expect(box!.y).toBeGreaterThanOrEqual(runBox!.y + runBox!.height)
    // No sideways scroll on the page.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow).toBeLessThanOrEqual(0)
  })
}
