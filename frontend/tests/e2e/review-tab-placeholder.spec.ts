import type { Page } from '@playwright/test'
import { API_PATH } from '../../src/lib/api.constants'
import { REVIEW_PLACEHOLDER_TAB, REVIEW_PLACEHOLDER_TEXT, REVIEW_TEXT, reviewPlaceholderTestId, type ReviewPlaceholderText } from '../../src/lib/review.constants'
import { apiRoute, expect, test } from './fixture'

// Plan 020: an empty review tab shows a placeholder whose text follows the review's state.

// Breaks none of the stub analyzer's rules (no eval, secret, any, console call, TODO or long line).
const CLEAN_CODE = 'export function add(a: number, b: number): number {\n  return a + b\n}\n'

async function expectPlaceholder(page: Page, testId: string, text: ReviewPlaceholderText) {
  const placeholder = page.getByRole('tabpanel').getByTestId(testId)
  await expect(placeholder).toBeVisible()
  await expect(placeholder.getByText(text.title)).toBeVisible()
  await expect(placeholder.getByText(text.detail)).toBeVisible()
}

const findingId = reviewPlaceholderTestId(REVIEW_PLACEHOLDER_TAB.finding)
const suggestionId = reviewPlaceholderTestId(REVIEW_PLACEHOLDER_TAB.suggestion)
const generatedTestId = reviewPlaceholderTestId(REVIEW_PLACEHOLDER_TAB.generatedTest)

test.describe('Review tab placeholders', () => {
  test('a blank new review shows the "not run yet" placeholders in every tab', async ({ page }) => {
    await page.goto('/review/new')
    const text = REVIEW_PLACEHOLDER_TEXT.notRun

    // Summary: the Key issues block.
    await expectPlaceholder(page, findingId, text.finding)

    await page.getByRole('tab', { name: 'Findings (0)' }).click()
    await expectPlaceholder(page, findingId, text.finding)

    await page.getByRole('tab', { name: 'Suggested refactors (0)' }).click()
    await expectPlaceholder(page, suggestionId, text.suggestion)

    await page.getByRole('tab', { name: 'Generated tests (0)' }).click()
    await expectPlaceholder(page, generatedTestId, text.generated_test)
  })

  test('after Run review on clean code the tabs show the "completed, nothing found" placeholders', async ({ page }) => {
    await page.goto('/review/new')
    await page.locator('.monaco-editor .view-lines').first().click()
    // One input event: typed key by key, Monaco's suggest widget can swallow characters.
    await page.keyboard.insertText(CLEAN_CODE)

    const create = page.waitForResponse(
      (response) => response.request().method() === 'POST' && response.url() === apiRoute(API_PATH.review)
    )
    await page.getByRole('button', { name: 'Run review' }).click()
    const { id } = await (await create).json()
    await expect(page).toHaveURL(new RegExp(`/review/${id}$`))
    await expect(page.getByText('Completed', { exact: true })).toBeVisible()
    const text = REVIEW_PLACEHOLDER_TEXT.completed

    await expectPlaceholder(page, findingId, text.finding)
    // Nothing to open: the Summary offers no "View all findings" link.
    await expect(page.getByRole('button', { name: REVIEW_TEXT.viewAllFindings })).toHaveCount(0)

    await page.getByRole('tab', { name: 'Findings (0)' }).click()
    await expectPlaceholder(page, findingId, text.finding)

    await page.getByRole('tab', { name: 'Suggested refactors (0)' }).click()
    await expectPlaceholder(page, suggestionId, text.suggestion)

    // The stub analyzer always generates one test file, so this tab has content, not a placeholder.
    await page.getByRole('tab', { name: 'Generated tests (1)' }).click()
    await expect(page.getByTestId(generatedTestId)).toHaveCount(0)
  })
})
