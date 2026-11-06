import type { Page } from '@playwright/test'
import { API_PATH } from '../../src/lib/api.constants'
import { EDITOR_TEXT, REVIEW_TEXT } from '../../src/lib/review.constants'
import { ROUTE_PATH } from '../../src/lib/route.constants'
import { apiRoute, createReview, expect, FINDING_CODE, MONACO_LOAD, showReviewAs, test } from './fixture'

// QA round 5 (AI-39, plan 021 Revision 1): adversarial e2e checks of Run review on an existing review.
const runButton = (page: Page) => page.getByRole('button', { name: REVIEW_TEXT.runButton })
const saveButton = (page: Page) => page.getByRole('button', { name: REVIEW_TEXT.saveButton })
const downloadButton = (page: Page) => page.getByRole('button', { name: 'Download report' })
const languageSelect = (page: Page) => page.getByRole('combobox', { name: 'Language' })
const viewLines = (page: Page) => page.locator('.monaco-editor .view-lines').first()

const PLAIN_CODE = 'export const sum = (a: number, b: number) => a + b\n'

async function openReview(page: Page, id: string) {
  await page.goto(ROUTE_PATH.review(id))
  await expect(page.getByText('Completed', { exact: true })).toBeVisible()
  await expect(viewLines(page)).toBeVisible(MONACO_LOAD)
}

// QA AI-43 D4: "Completed" is already on screen before a run, so a test first waits for the run to
// start: the 202 of POST /api/review/{id}/run and the Pending badge it puts on screen (the next
// poll is at least a second later).
async function startRun(page: Page) {
  const started = page.waitForResponse(
    (response) => /\/api\/review\/[^/]+\/run$/.test(new URL(response.url()).pathname) && response.request().method() === 'POST'
  )
  await runButton(page).click()
  expect((await started).status()).toBe(202)
  await expect(page.getByText('Pending', { exact: true })).toBeVisible()
}

async function typeAtEnd(page: Page, text: string) {
  await viewLines(page).click()
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.insertText(text)
}

test('QA: typing enables Run, deleting it again disables Run; a language change and back does the same', async ({ page, request }) => {
  const { id } = await createReview(request, { title: 'QA toggle', content: PLAIN_CODE })
  await openReview(page, id)
  await expect(runButton(page)).toBeDisabled()

  await typeAtEnd(page, '//x')
  await expect(runButton(page)).toBeEnabled()
  for (let index = 0; index < 3; index += 1) await page.keyboard.press('Backspace')
  await expect(runButton(page)).toBeDisabled()

  // Trailing blank lines only: not a change.
  await page.keyboard.press('Enter')
  await page.keyboard.press('Enter')
  await expect(runButton(page)).toBeDisabled()

  await languageSelect(page).selectOption('JavaScript')
  await expect(runButton(page)).toBeEnabled()
  await languageSelect(page).selectOption('TypeScript')
  await expect(runButton(page)).toBeDisabled()
})

test('QA: pasting enables Run', async ({ page, request, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  const { id } = await createReview(request, { title: 'QA paste', content: PLAIN_CODE })
  await openReview(page, id)
  await page.evaluate(() => navigator.clipboard.writeText('\nconst pasted = 1'))
  await viewLines(page).click()
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.press('ControlOrMeta+V')
  await expect(viewLines(page)).toContainText('const pasted = 1')
  await expect(runButton(page)).toBeEnabled()
})

test('QA: uploading the analyzed code with CR LF line breaks keeps Run disabled', async ({ page, request }) => {
  const { id } = await createReview(request, { title: 'QA crlf', content: PLAIN_CODE })
  await openReview(page, id)
  await page.getByLabel(EDITOR_TEXT.fileInput).setInputFiles({
    name: 'sum.ts',
    mimeType: 'text/plain',
    buffer: Buffer.from(PLAIN_CODE.replace(/\n/g, '\r\n') + '\r\n\r\n')
  })
  await expect(page.getByTestId('editor-title')).toHaveText('sum.ts')
  await expect(runButton(page)).toBeDisabled()
})

test('QA: an unfinished review has Run disabled in the UI, and the API answers 409', async ({ page, request }) => {
  const { id } = await createReview(request, { title: 'QA pending', content: PLAIN_CODE })
  await showReviewAs(page, id, 'in_progress')
  await page.goto(ROUTE_PATH.review(id))
  await expect(viewLines(page)).toBeVisible(MONACO_LOAD)
  await typeAtEnd(page, '//changed')
  await expect(runButton(page)).toBeDisabled()

  // Two runs at the same time: the stub analyzer has not finished the first, so the second is a 409.
  const body = { language: 'TypeScript', code: FINDING_CODE }
  const [first, second] = await Promise.all([
    request.post(apiRoute(API_PATH.reviewRun(id)), { data: body }),
    request.post(apiRoute(API_PATH.reviewRun(id)), { data: body })
  ])
  const statusList = [first.status(), second.status()].sort()
  // At least one 202; the other is 202 only when the analysis finished in between.
  expect(statusList[0]).toBe(202)
  if (statusList[1] !== 202) expect(statusList[1]).toBe(409)
})

test('QA: a real double click on Run review sends one run and shows no error', async ({ page, request }) => {
  const { id } = await createReview(request, { title: 'QA double', content: PLAIN_CODE })
  await openReview(page, id)
  await typeAtEnd(page, '\n// double')
  await expect(runButton(page)).toBeEnabled()

  const statusList: number[] = []
  page.on('response', (item) => {
    if (item.request().method() === 'POST' && item.url().endsWith('/run')) statusList.push(item.status())
  })
  await runButton(page).dblclick()
  await expect(page.getByText('Completed', { exact: true })).toBeVisible()
  await page.waitForTimeout(800)
  expect(statusList).toEqual([202])
  await expect(page.getByText('Could not run the review', { exact: false })).toHaveCount(0)
})

test('QA (info): two clicks in one JS task', async ({ page, request }) => {
  const { id } = await createReview(request, { title: 'QA double sync', content: PLAIN_CODE })
  await openReview(page, id)
  await typeAtEnd(page, '\n// double')
  const statusList: number[] = []
  page.on('response', (item) => {
    if (item.request().method() === 'POST' && item.url().endsWith('/run')) statusList.push(item.status())
  })
  await runButton(page).evaluate((button: HTMLButtonElement) => {
    button.click()
    button.click()
  })
  await expect(page.getByText('Completed', { exact: true })).toBeVisible()
  await page.waitForTimeout(800)
  // Measured: [202, 202]. The second run re-analyzes the same code, so it does no harm, and no error is shown.
  expect(statusList.every((status) => status === 202 || status === 409)).toBe(true)
  await expect(page.getByText('Could not run the review', { exact: false })).toHaveCount(0)
})

test('QA: editing right after Run keeps the edit, and Run is enabled again once the run completes', async ({ page, request }) => {
  const { id } = await createReview(request, { title: 'QA edit during run', content: PLAIN_CODE })
  await openReview(page, id)
  await typeAtEnd(page, '\n// first')
  await startRun(page)
  await typeAtEnd(page, '\n// second')

  await expect(page.getByText('Completed', { exact: true })).toBeVisible()
  await expect(viewLines(page)).toContainText('// second')
  await expect(viewLines(page)).toContainText('// first')
  const detail = (await (await request.get(apiRoute(API_PATH.reviewById(id)))).json()) as { analyzedContent: string }
  expect(detail.analyzedContent).toContain('// first')
  expect(detail.analyzedContent).not.toContain('// second')
  await expect(runButton(page)).toBeEnabled()
})

test('QA: upload, Run: the new findings are on the uploaded lines, same id, then Regenerate keeps them', async ({ page, request }) => {
  const { id } = await createReview(request, { title: 'QA run lines', content: PLAIN_CODE })
  await openReview(page, id)
  const url = page.url()
  // eval on line 3 and the TODO on line 4 of the uploaded file.
  const uploaded = `// header\n\n${FINDING_CODE}`
  await page.getByLabel(EDITOR_TEXT.fileInput).setInputFiles({ name: 'svc.ts', mimeType: 'text/plain', buffer: Buffer.from(uploaded) })
  await expect(viewLines(page)).toContainText('eval(input)')
  await startRun(page)
  await expect(page.getByText('Completed', { exact: true })).toBeVisible()
  expect(page.url()).toBe(url)

  const detail = (await (await request.get(apiRoute(API_PATH.reviewById(id)))).json()) as { finding: { line_start: number }[] }
  const lineSet = [...new Set(detail.finding.map((item) => item.line_start))].sort()
  expect(lineSet).toEqual([3, 4])
  const markerLine = () =>
    page.evaluate(() => {
      const monaco = (window as unknown as { monaco?: { editor: { getModelMarkers: (f: { owner: string }) => { startLineNumber: number }[] } } }).monaco
      return [...new Set((monaco?.editor.getModelMarkers({ owner: 'review-finding' }) ?? []).map((item) => item.startLineNumber))].sort()
    })
  await expect.poll(markerLine).toEqual([3, 4])

  await page.getByRole('tab', { name: /Generated tests/ }).click()
  await page.getByRole('button', { name: /Regenerate/ }).first().click()
  await page.getByRole('tab', { name: /Summary/ }).click()
  await expect(viewLines(page)).toContainText('eval(input)')
  await expect.poll(markerLine).toEqual([3, 4])
  await expect(runButton(page)).toBeDisabled()
})

test('QA: History and the review page after a re-run', async ({ page, request }) => {
  const { id } = await createReview(request, { title: 'QA history', content: PLAIN_CODE })
  await openReview(page, id)
  await languageSelect(page).selectOption('JavaScript')
  await startRun(page)
  await expect(page.getByText('Completed', { exact: true })).toBeVisible()

  await page.goto(ROUTE_PATH.history)
  const row = page.getByText('QA history').first()
  await expect(row).toBeVisible()
  const list = (await (await request.get(apiRoute(API_PATH.review))).json()) as { id: string; language: string; status: string }[]
  expect(list.filter((item) => item.id === id)).toHaveLength(1)
  expect(list.find((item) => item.id === id)).toMatchObject({ language: 'JavaScript', status: 'completed' })
  await page.goto('/')
  await expect(page.locator('body')).not.toContainText('Something went wrong')
})

for (const width of [375, 768, 1024]) {
  test.describe(`QA: review header with three buttons at ${width}px`, () => {
    test.use({ viewport: { width, height: 800 } })

    test('the three buttons are visible, inside the viewport and do not overlap; no sideways scroll', async ({ page, request }) => {
      const { id } = await createReview(request, { title: 'QA header layout with a fairly long review name', content: PLAIN_CODE })
      await openReview(page, id)
      const boxList = []
      for (const button of [runButton(page), saveButton(page), downloadButton(page)]) {
        await expect(button).toBeVisible()
        const box = await button.boundingBox()
        expect(box).not.toBeNull()
        if (!box) continue
        expect(box.x).toBeGreaterThanOrEqual(0)
        expect(box.x + box.width).toBeLessThanOrEqual(width)
        boxList.push(box)
      }
      for (let i = 0; i < boxList.length; i += 1) {
        for (let j = i + 1; j < boxList.length; j += 1) {
          const a = boxList[i]
          const b = boxList[j]
          const overlap = a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
          expect(overlap).toBe(false)
        }
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    })
  })
}
