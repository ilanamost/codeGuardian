import type { Page } from '@playwright/test'
import { API_PATH } from '../../src/lib/api.constants'
import { REVIEW_TEXT } from '../../src/lib/review.constants'
import { ROUTE_PATH } from '../../src/lib/route.constants'
import { apiRoute, createReview, expect, MONACO_LOAD, test } from './fixture'

const PLAIN_CODE = 'export const sum = (a: number, b: number) => a + b\n'

const rowOf = (page: Page, title: string) => page.getByTestId('review-row').filter({ hasText: title })

test('history -> open review -> editor visible', async ({ page, request }) => {
  const { id } = await createReview(request, { title: 'Authentication Service' })
  await page.goto('/history')
  await page.getByTestId('review-row').getByRole('link', { name: /Authentication Service/ }).click()

  await expect(page).toHaveURL(new RegExp(`/review/${id}$`))
  await expect(page.getByRole('heading', { name: 'Review Results' })).toBeVisible()
  await expect(page.locator('.monaco-editor').first()).toBeVisible(MONACO_LOAD)
})

// Plan 024: a row shows when the review was created; running it again changes neither that text
// nor the row's position.
test('after a re-run the History row still says Created and keeps its position', async ({ page, request }) => {
  const { id } = await createReview(request, { title: 'History older', content: PLAIN_CODE })
  await createReview(request, { title: 'History newer', content: PLAIN_CODE })

  await page.goto(ROUTE_PATH.history)
  await expect(rowOf(page, 'History older')).toContainText(/TypeScript - Created /)
  const titleList = () => page.getByTestId('review-row').locator('p.truncate').allTextContents()
  const orderBefore = await titleList()
  expect(orderBefore.indexOf('History newer')).toBeLessThan(orderBefore.indexOf('History older'))
  const createdBefore = ((await (await request.get(apiRoute(API_PATH.review))).json()) as { id: string; timeAgo: string }[]).find(
    (item) => item.id === id
  )?.timeAgo

  await page.goto(ROUTE_PATH.review(id))
  await expect(page.getByText('Completed', { exact: true })).toBeVisible()
  await page.getByRole('combobox', { name: 'Language' }).selectOption('JavaScript')
  const started = page.waitForResponse((response) => response.url().endsWith('/run') && response.request().method() === 'POST')
  await page.getByRole('button', { name: REVIEW_TEXT.runButton }).click()
  expect((await started).status()).toBe(202)
  await expect(page.getByText('Completed', { exact: true })).toBeVisible()
  await expect(page.getByText('just now')).toBeVisible()

  await page.goto(ROUTE_PATH.history)
  await expect(rowOf(page, 'History older')).toContainText(`JavaScript - Created ${createdBefore}`)
  expect(await titleList()).toEqual(orderBefore)
})
