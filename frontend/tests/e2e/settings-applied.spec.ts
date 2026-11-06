import type { Page } from '@playwright/test'
import { API_PATH } from '../../src/lib/api.constants'
import { EDITOR_TEXT, REVIEW_TEXT } from '../../src/lib/review.constants'
import type { FindingDto, GeneratedTestFileDto } from '../../src/models/dto'
import { apiRoute, createReview, expect, FINDING_CODE, setNotification, setSettings, test } from './fixture'

// Plan 028, Scopes 18 and 19: Notifications and AI Preferences visibly change what the app does,
// with the settings saved on the backend for the signed-in account.

const PLAIN_CODE = 'export const sum = (a: number, b: number) => a + b\n'

// /review/new: upload a file, Run review, and wait until the page saw the review complete (the
// page polls it, which is when the completion notices fire).
async function runNewReview(page: Page, code: string) {
  await page.goto('/review/new')
  await page.getByLabel(EDITOR_TEXT.fileInput).setInputFiles({ name: 'svc.ts', mimeType: 'text/plain', buffer: Buffer.from(code) })
  await expect(page.locator('.monaco-editor .view-lines').first()).toContainText(code.split('\n')[0].slice(0, 20))
  await page.getByRole('button', { name: REVIEW_TEXT.runButton }).click()
  await expect(page).toHaveURL(/\/review\/[0-9a-f-]{36}$/)
  await expect(page.getByText('Completed', { exact: true })).toBeVisible()
}

test('with "Review completed" off, no completion toast', async ({ page, request }) => {
  await setNotification(request, { reviewCompleted: false, criticalFinding: false })

  await runNewReview(page, PLAIN_CODE)

  await page.waitForTimeout(1000)
  expect(await page.getByText(REVIEW_TEXT.completed, { exact: true }).count()).toBe(0)
})

test('with "Critical security findings" on and code containing eval, the critical notice shows', async ({ page, request }) => {
  await setNotification(request, { criticalFinding: true })

  await runNewReview(page, FINDING_CODE)

  await expect(page.getByText(REVIEW_TEXT.criticalFinding)).toBeVisible()
})

test('with "Critical security findings" off, no critical notice for the same code', async ({ page, request }) => {
  await setNotification(request, { criticalFinding: false })

  await runNewReview(page, FINDING_CODE)

  await expect(page.getByText(REVIEW_TEXT.completed, { exact: true })).toBeVisible()
  expect(await page.getByText(REVIEW_TEXT.criticalFinding).count()).toBe(0)
})

test('with review focus set to Security, the created review has only security findings', async ({ page, request }) => {
  await setSettings(request, { reviewFocus: 'security' })

  const { id } = await createReview(request, { title: 'Security focus', content: FINDING_CODE })
  const detail = (await (await request.get(apiRoute(API_PATH.reviewById(id)))).json()) as { finding: FindingDto[] }

  expect(detail.finding.length).toBeGreaterThan(0)
  expect(detail.finding.every((item) => item.category === 'security')).toBe(true)
  await page.goto(`/review/${id}`)
  await page.getByRole('tab', { name: /Findings/ }).click()
  await expect(page.getByText('Use of eval').first()).toBeVisible()
  expect(await page.getByText(/TODO/).count()).toBe(0)
})

test('with generated tests off, there is no Generated tests tab and no tests are produced', async ({ page, request }) => {
  await setSettings(request, { generatedTest: false })

  const { id } = await createReview(request, { title: 'No tests', content: FINDING_CODE })
  const detail = (await (await request.get(apiRoute(API_PATH.reviewById(id)))).json()) as { generatedTest: GeneratedTestFileDto[] }

  expect(detail.generatedTest).toEqual([])
  await page.goto(`/review/${id}`)
  await expect(page.getByRole('heading', { name: 'Review Results' })).toBeVisible()
  await expect(page.getByRole('tab', { name: /Generated tests/ })).toHaveCount(0)
})

test('the Email toggle is saved and shows that no email is sent yet', async ({ page, request }) => {
  await page.goto('/settings?section=notifications')

  await expect(page.getByText(/Email delivery is not available yet/)).toBeVisible()
  const toggle = page.getByRole('switch', { name: 'Email notifications' })
  const before = await toggle.isChecked()
  const saved = page.waitForResponse((response) => response.url() === apiRoute(API_PATH.settings) && response.request().method() === 'PUT')
  await toggle.click()
  expect((await saved).status()).toBe(204)
  const settings = (await (await request.get(apiRoute(API_PATH.settings))).json()) as { notification: { email: boolean } }
  expect(settings.notification.email).toBe(!before)
})
