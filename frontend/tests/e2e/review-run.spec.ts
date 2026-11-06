import type { Page } from '@playwright/test'
import { API_PATH } from '../../src/lib/api.constants'
import { EDITOR_TEXT, REVIEW_TEXT } from '../../src/lib/review.constants'
import { ROUTE_PATH } from '../../src/lib/route.constants'
import { apiRoute, createReview, expect, FINDING_CODE, MONACO_LOAD, showReviewAs, test } from './fixture'

// Plan 021 revision 1 (AI-41): Run review on an existing review re-analyzes it in place
// (POST /api/review/{id}/run), enabled only when the code or language differs from what was analyzed.
const runButton = (page: Page) => page.getByRole('button', { name: REVIEW_TEXT.runButton })
const saveButton = (page: Page) => page.getByRole('button', { name: REVIEW_TEXT.saveButton })
const viewLines = (page: Page) => page.locator('.monaco-editor .view-lines').first()
const glyph = (page: Page) => page.locator('.monaco-editor .editor-finding-glyph')

const PLAIN_CODE = 'export const sum = (a: number, b: number) => a + b\n'

async function openReview(page: Page, id: string) {
  await page.goto(ROUTE_PATH.review(id))
  await expect(page.getByText('Completed', { exact: true })).toBeVisible()
  await expect(viewLines(page)).toBeVisible(MONACO_LOAD)
}

test('an unchanged completed review has Run review disabled and Save review enabled', async ({ page, request }) => {
  const { id } = await createReview(request, { title: 'Unchanged', content: PLAIN_CODE })
  await openReview(page, id)

  await expect(runButton(page)).toBeDisabled()
  await expect(saveButton(page)).toBeEnabled()
})

test('upload on a completed review, Run review: same id, pending then completed, new findings marked', async ({ page, request }) => {
  const { id } = await createReview(request, { title: 'Run in place', content: PLAIN_CODE })
  await openReview(page, id)
  const url = page.url()

  await page.getByLabel(EDITOR_TEXT.fileInput).setInputFiles({ name: 'svc.ts', mimeType: 'text/plain', buffer: Buffer.from(FINDING_CODE) })
  await expect(viewLines(page)).toContainText('eval(input)')
  await expect(runButton(page)).toBeEnabled()
  await expect(glyph(page)).toHaveCount(0)

  await runButton(page).click()
  await expect(page.getByText(REVIEW_TEXT.started)).toBeVisible()
  await expect(page.getByText('Completed', { exact: true })).toBeVisible()
  expect(page.url()).toBe(url)

  const detail = (await (await request.get(apiRoute(API_PATH.reviewById(id)))).json()) as {
    analyzedContent: string
    finding: { line_start: number }[]
  }
  expect(detail.analyzedContent).toBe(FINDING_CODE)
  expect(detail.finding.length).toBeGreaterThan(0)
  await expect.poll(() => glyph(page).count()).toBeGreaterThan(0)
  await expect(runButton(page)).toBeDisabled()
})

// Plan 025 (1A): a failed review is run again only after an edit or an upload, and says so.
test('a failed review with no change: Run review disabled with a hint; an edit enables it', async ({ page, request }) => {
  const { id } = await createReview(request, { title: 'Stopped run', content: PLAIN_CODE })
  await showReviewAs(page, id, 'failed')
  await page.goto(ROUTE_PATH.review(id))
  await expect(page.getByText('Failed', { exact: true })).toBeVisible()
  await expect(viewLines(page)).toBeVisible(MONACO_LOAD)

  await expect(runButton(page)).toBeDisabled()
  await expect(page.getByText(REVIEW_TEXT.runAgainHint)).toBeVisible()

  await viewLines(page).click()
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.insertText('// edited')
  await expect(runButton(page)).toBeEnabled()
  await expect(page.getByText(REVIEW_TEXT.runAgainHint)).toHaveCount(0)
})

// Plan 025: the old findings never mark a saved edit they were not produced from.
test('upload, Save, reload: no markers and Run review enabled; Run review marks the new code', async ({ page, request }) => {
  const { id } = await createReview(request, { title: 'Stale after reload', content: FINDING_CODE })
  await openReview(page, id)
  await expect.poll(() => glyph(page).count()).toBeGreaterThan(0)

  const uploaded = `// header\n// moved\n${FINDING_CODE}`
  await page.getByLabel(EDITOR_TEXT.fileInput).setInputFiles({ name: 'moved.ts', mimeType: 'text/plain', buffer: Buffer.from(uploaded) })
  await expect(viewLines(page)).toContainText('// moved')
  await saveButton(page).click()
  await expect(page.getByText(REVIEW_TEXT.saved)).toBeVisible()

  await page.reload()
  await expect(viewLines(page)).toContainText('// moved')
  await expect(runButton(page)).toBeEnabled()
  await expect(glyph(page)).toHaveCount(0)

  await runButton(page).click()
  await expect(page.getByText(REVIEW_TEXT.started)).toBeVisible()
  await expect(page.getByText('Completed', { exact: true })).toBeVisible()
  await expect.poll(() => glyph(page).count()).toBeGreaterThan(0)
  await expect(runButton(page)).toBeDisabled()
})

test('edit, Save, reload: Run review is still enabled because the edit was not analyzed', async ({ page, request }) => {
  const { id } = await createReview(request, { title: 'Saved edit', content: PLAIN_CODE })
  await openReview(page, id)

  await viewLines(page).click()
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.insertText('// edited')
  await expect(runButton(page)).toBeEnabled()
  await saveButton(page).click()
  await expect(page.getByText(REVIEW_TEXT.saved)).toBeVisible()

  await page.reload()
  await expect(viewLines(page)).toContainText('// edited')
  await expect(runButton(page)).toBeEnabled()
})
