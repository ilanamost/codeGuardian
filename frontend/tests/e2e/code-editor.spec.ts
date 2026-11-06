import type { Page } from '@playwright/test'
import { API_PATH } from '../../src/lib/api.constants'
import { EDITOR_TEXT } from '../../src/lib/review.constants'
import type { FindingDto } from '../../src/models/dto'
import { apiRoute, expect, FINDING_CODE, MONACO_LOAD, test } from './fixture'

// Plan 021: upload, paste, finding markers and the wide horizontal scrollbar of the code editor.
const viewLines = (page: Page) => page.locator('.monaco-editor .view-lines').first()
const runButton = (page: Page) => page.getByRole('button', { name: 'Run review' })
const languageSelect = (page: Page) => page.getByRole('combobox', { name: 'Language' })

async function uploadFile(page: Page, name: string, content: string) {
  await page.getByLabel(EDITOR_TEXT.fileInput).setInputFiles({ name, mimeType: 'text/plain', buffer: Buffer.from(content) })
}

async function openNewReview(page: Page) {
  await page.goto('/review/new')
  await expect(viewLines(page)).toBeVisible(MONACO_LOAD)
}

test('uploading a .ts file selects TypeScript, fills the editor and enables Run review', async ({ page }) => {
  await openNewReview(page)
  await languageSelect(page).selectOption('Python')
  await expect(runButton(page)).toBeDisabled()

  await uploadFile(page, 'user.service.ts', 'export const userName = "ada"\n')

  await expect(languageSelect(page)).toHaveValue('TypeScript')
  await expect(viewLines(page)).toContainText('export const userName')
  await expect(page.getByTestId('editor-title')).toHaveText('user.service.ts')
  await expect(page.getByText(EDITOR_TEXT.fileLoaded('user.service.ts'))).toBeVisible()
  await expect(runButton(page)).toBeEnabled()
})

test('an unsupported file is rejected with a toast and leaves the editor empty', async ({ page }) => {
  await openNewReview(page)

  await uploadFile(page, 'notes.pdf', '%PDF-1.4')

  await expect(page.getByText('Unsupported file type', { exact: false })).toBeVisible()
  await expect(runButton(page)).toBeDisabled()
  await expect(page.getByTestId('editor-title')).toHaveText(EDITOR_TEXT.title)
})

test('pasting code from the clipboard fills the editor and enables Run review', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await openNewReview(page)
  await page.evaluate(() => navigator.clipboard.writeText('const pasted = 42'))

  await viewLines(page).click()
  await page.keyboard.press('ControlOrMeta+V')

  await expect(viewLines(page)).toContainText('const pasted = 42')
  await expect(runButton(page)).toBeEnabled()
})

test('after Run review each finding line has a glyph and hovering it shows the finding', async ({ page, request }) => {
  await openNewReview(page)
  await uploadFile(page, 'service.ts', FINDING_CODE)
  await expect(viewLines(page)).toContainText('eval(input)')

  await runButton(page).click()
  await expect(page).toHaveURL(/\/review\/(?!new)[^/]+$/)
  await expect(page.getByText('Completed', { exact: true })).toBeVisible()

  const id = page.url().split('/').pop() ?? ''
  const review = (await (await request.get(apiRoute(API_PATH.reviewById(id)))).json()) as { finding: FindingDto[] }
  const lineCount = FINDING_CODE.split('\n').length
  const findingList = review.finding.filter((item) => item.line_start <= lineCount)
  expect(findingList.length).toBeGreaterThan(0)

  const glyph = page.locator('.monaco-editor .editor-finding-glyph')
  const lineSet = new Set(findingList.map((item) => item.line_start))
  await expect.poll(() => glyph.count()).toBeGreaterThanOrEqual(lineSet.size)
  expect(await glyph.count()).toBeLessThanOrEqual(findingList.length)

  const first = findingList[0]
  const lineText = FINDING_CODE.split('\n')[first.line_start - 1]
  await page.locator('.monaco-editor .view-line', { hasText: lineText }).locator('span span').first().hover()
  await expect(page.locator('.monaco-hover').filter({ hasText: first.message }).first()).toBeVisible(MONACO_LOAD)
})

const longLine = `const longLine = '${'x'.repeat(600)}'\nconst last = 1\n`

for (const { width, minSize } of [
  { width: 375, minSize: 16 },
  { width: 1280, minSize: 12 }
]) {
  test.describe(`Editor scrollbar at ${width}px`, () => {
    test.use({ viewport: { width, height: 800 } })

    test(`the horizontal scrollbar is at least ${minSize}px and dragging it scrolls the code`, async ({ page }) => {
      await openNewReview(page)
      await uploadFile(page, 'long.ts', longLine)
      await expect(viewLines(page)).toContainText('const last')

      const editor = page.locator('.monaco-editor').first()
      const bar = editor.locator('.monaco-scrollable-element > .scrollbar.horizontal').first()
      const slider = bar.locator('.slider')
      await expect(slider).toBeVisible()
      // Monaco measures the long line after it renders; the slider then gets narrower than the bar.
      await expect
        .poll(async () => ((await slider.boundingBox())?.width ?? 0) < ((await bar.boundingBox())?.width ?? 0))
        .toBe(true)
      // Below md the editor sits under the header: bring the scrollbar on screen before measuring.
      await bar.scrollIntoViewIfNeeded()
      const barBox = await bar.boundingBox()
      expect(barBox?.height ?? 0).toBeGreaterThanOrEqual(minSize)

      // The last line stays above the scrollbar.
      const lastBox = await page.locator('.monaco-editor .view-line', { hasText: 'const last' }).boundingBox()
      expect((lastBox?.y ?? 0) + (lastBox?.height ?? 0)).toBeLessThanOrEqual(barBox?.y ?? 0)

      // Where the long line starts on screen: it moves left as the code scrolls.
      const firstToken = page.locator('.monaco-editor .view-line', { hasText: 'const longLine' }).locator('span span').first()
      const lineX = async () => (await firstToken.boundingBox())?.x ?? 0
      const startX = await lineX()

      const sliderBox = await slider.boundingBox()
      const x = (sliderBox?.x ?? 0) + (sliderBox?.width ?? 0) / 2
      const y = (sliderBox?.y ?? 0) + (sliderBox?.height ?? 0) / 2
      await page.mouse.move(x, y)
      await page.mouse.down()
      await page.mouse.move(x + 120, y, { steps: 5 })
      await page.mouse.up()

      await expect.poll(lineX).toBeLessThan(startX)
      expect((await slider.boundingBox())?.x ?? 0).toBeGreaterThan(sliderBox?.x ?? 0)
    })
  })
}
