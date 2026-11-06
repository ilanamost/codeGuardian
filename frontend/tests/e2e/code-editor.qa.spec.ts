import type { Page } from '@playwright/test'
import { EDITOR_TEXT, REVIEW_LIMIT } from '../../src/lib/review.constants'
import { FORM_ERROR_MESSAGE } from '../../src/utils/error-messages'
import { createReview, expect, MONACO_LOAD, test } from './fixture'

// QA (AI-39): adversarial e2e checks for plan 021, the code editor. The known defects found in
// QA round 1 are fixed; their tests are named "D<n> fixed".
const runButton = (page: Page) => page.getByRole('button', { name: 'Run review' })
const languageSelect = (page: Page) => page.getByRole('combobox', { name: 'Language' })
const glyph = (page: Page) => page.locator('.monaco-editor .editor-finding-glyph')

async function uploadFile(page: Page, name: string, content: string) {
  await page.getByLabel(EDITOR_TEXT.fileInput).setInputFiles({ name, mimeType: 'text/plain', buffer: Buffer.from(content) })
}

async function openNewReview(page: Page) {
  await page.goto('/review/new')
  await expect(page.locator('.monaco-editor .view-lines').first()).toBeVisible(MONACO_LOAD)
}

// The language id of the first editor model, read from the Monaco global the loader installs.
async function modelLanguage(page: Page) {
  return page.evaluate(() => {
    const monaco = (window as unknown as { monaco?: { editor: { getModels: () => { getLanguageId: () => string }[] } } }).monaco
    return monaco?.editor.getModels()[0]?.getLanguageId() ?? null
  })
}

test('QA: uploading then changing the language switches Monaco to the chosen language', async ({ page }) => {
  await openNewReview(page)
  await uploadFile(page, 'main.py', 'def f():\n    return 1\n')
  await expect(languageSelect(page)).toHaveValue('Python')
  await expect.poll(() => modelLanguage(page)).toBe('python')

  await languageSelect(page).selectOption('Go')

  await expect.poll(() => modelLanguage(page)).toBe('go')
  await expect(page.locator('.monaco-editor .view-lines').first()).toContainText('def f()')
})

test('QA: an uppercase double extension (App.Test.TSX) is TypeScript', async ({ page }) => {
  await openNewReview(page)
  await languageSelect(page).selectOption('Java')
  await uploadFile(page, 'App.Test.TSX', 'export const App = () => null\n')
  await expect(languageSelect(page)).toHaveValue('TypeScript')
  await expect(page.getByTestId('editor-title')).toHaveText('App.Test.TSX')
})

test('QA: multibyte content at exactly the limit is accepted, one more character is rejected', async ({ page }) => {
  await openNewReview(page)
  await uploadFile(page, 'accents.py', 'é'.repeat(REVIEW_LIMIT.contentMax))
  await expect(languageSelect(page)).toHaveValue('Python')
  await expect(runButton(page)).toBeEnabled()
  await expect(page.getByText(FORM_ERROR_MESSAGE.codeTooLong(REVIEW_LIMIT.contentMax, REVIEW_LIMIT.contentMax))).toHaveCount(0)

  await uploadFile(page, 'over.ts', 'é'.repeat(REVIEW_LIMIT.contentMax + 1))
  await expect(page.getByText('File size exceeds limit', { exact: false })).toBeVisible()
  await expect(languageSelect(page)).toHaveValue('Python')
  await expect(page.getByTestId('editor-title')).toHaveText('accents.py')
})

test('QA: a saved review shows glyphs; the Generated tests editor is read-only, without upload or glyphs, and has the wide scrollbar', async ({
  page,
  request
}) => {
  const { id } = await createReview(request, { title: 'QA markers' })
  await page.goto(`/review/${id}`)
  await expect.poll(() => glyph(page).count()).toBeGreaterThan(0)

  await page.getByRole('tab', { name: /Generated tests/ }).click()
  await expect(page.getByRole('button', { name: EDITOR_TEXT.upload })).toHaveCount(0)
  const editor = page.locator('.monaco-editor').first()
  await expect(editor).toBeVisible()
  await expect(glyph(page)).toHaveCount(0)

  // Read-only: typing does not change the code.
  await expect(editor.locator('.view-lines')).toContainText('Stub generated test')
  await editor.locator('.view-lines').click()
  await page.keyboard.press('ControlOrMeta+Home')
  await page.keyboard.type('QA_TYPED')
  await page.keyboard.press('Enter')
  await expect(editor.locator('.view-lines')).not.toContainText('QA_TYPED')
  await expect(editor.locator('.view-line').first()).toContainText('Stub generated test')

  const bar = editor.locator('.monaco-scrollable-element > .scrollbar.horizontal').first()
  expect((await bar.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(12)
})

test('QA D2 fixed: a marker follows its line after an edit inserts a line above it', async ({ page, request }) => {
  const { id } = await createReview(request, { title: 'QA drift' })
  await page.goto(`/review/${id}`)
  await expect.poll(() => glyph(page).count()).toBeGreaterThan(0)
  const firstTop = async () => Math.min(...(await glyph(page).evaluateAll((list) => list.map((el) => el.getBoundingClientRect().top))))
  const before = await firstTop()

  await page.locator('.monaco-editor .view-lines').first().click()
  await page.keyboard.press('ControlOrMeta+Home')
  await page.keyboard.press('Enter')

  await expect.poll(firstTop).toBeGreaterThan(before)
})

test('QA D1 fixed: uploading a new file over a reviewed one does not keep the old findings on unrelated lines', async ({ page, request }) => {
  const { id } = await createReview(request, { title: 'QA stale markers' })
  await page.goto(`/review/${id}`)
  await expect.poll(() => glyph(page).count()).toBeGreaterThan(0)

  await uploadFile(page, 'clean.py', 'x = 1\ny = 2\nz = 3\n')
  await expect(page.getByTestId('editor-title')).toHaveText('clean.py')
  await expect(page.locator('.monaco-editor .view-lines').first()).toContainText('x = 1')

  // The findings belong to the reviewed code, not to clean.py.
  await expect(glyph(page)).toHaveCount(0)
})

test('QA D4 fixed: the old findings stay cleared after switching tabs away and back', async ({ page, request }) => {
  const { id } = await createReview(request, { title: 'QA stale markers tab' })
  await page.goto(`/review/${id}`)
  await expect.poll(() => glyph(page).count()).toBeGreaterThan(0)
  await uploadFile(page, 'clean.py', 'x = 1\ny = 2\nz = 3\n')
  await expect(page.getByTestId('editor-title')).toHaveText('clean.py')
  await expect(glyph(page)).toHaveCount(0)

  await page.getByRole('tab', { name: /Findings/ }).click()
  await page.getByRole('tab', { name: /Summary/ }).click()
  await expect(page.locator('.monaco-editor .view-lines').first()).toContainText('x = 1')

  const markerCount = () =>
    page.evaluate(() => {
      const monaco = (window as unknown as { monaco?: { editor: { getModelMarkers: (filter: { owner: string }) => unknown[] } } }).monaco
      return monaco?.editor.getModelMarkers({ owner: 'review-finding' }).length ?? -1
    })
  // Give the remounted editor time to apply markers, then check that none came back.
  await page.waitForTimeout(1000)
  expect(await markerCount()).toBe(0)
  await expect(glyph(page)).toHaveCount(0)
})

test('QA D5 fixed: the old findings stay cleared after Regenerate tests on an uploaded file', async ({ page, request }) => {
  const { id } = await createReview(request, { title: 'QA stale markers regenerate' })
  await page.goto(`/review/${id}`)
  await expect.poll(() => glyph(page).count()).toBeGreaterThan(0)
  await uploadFile(page, 'clean.py', 'x = 1\ny = 2\nz = 3\n')
  await expect(page.getByTestId('editor-title')).toHaveText('clean.py')
  await expect(glyph(page)).toHaveCount(0)

  await page.getByRole('tab', { name: /Generated tests/ }).click()
  const regenerated = page.waitForResponse((response) => response.url().includes('generated-test') && response.request().method() === 'POST')
  await page.getByRole('button', { name: /Regenerate/ }).first().click()
  expect((await regenerated).ok()).toBe(true)
  await page.getByRole('tab', { name: /Summary/ }).click()
  await expect(page.locator('.monaco-editor .view-lines').first()).toContainText('x = 1')

  // Regenerate changes only the generated tests: the findings still describe the replaced code.
  await page.waitForTimeout(1000)
  const markerCount = await page.evaluate(() => {
    const monaco = (window as unknown as { monaco?: { editor: { getModelMarkers: (filter: { owner: string }) => unknown[] } } }).monaco
    return monaco?.editor.getModelMarkers({ owner: 'review-finding' }).length ?? -1
  })
  expect(markerCount).toBe(0)
  await expect(glyph(page)).toHaveCount(0)
})

test('QA round 2: Run review on an uploaded file marks the uploaded code', async ({ page }) => {
  await page.goto('/review/new')
  await uploadFile(page, 'svc.ts', 'const value: any = eval(input)\n// TODO remove the eval\n')
  await expect(page.getByTestId('editor-title')).toHaveText('svc.ts')
  await runButton(page).click()
  await expect(page).toHaveURL(/\/review\/(?!new)[^/]+$/)
  await expect(page.getByText('Completed', { exact: true })).toBeVisible()
  await expect.poll(() => glyph(page).count()).toBeGreaterThan(0)
})

test.describe('QA: mobile 375px', () => {
  test.use({ viewport: { width: 375, height: 740 }, hasTouch: true })

  test('Upload button is reachable, a long file name is truncated and the page does not scroll sideways', async ({ page }) => {
    await openNewReview(page)
    const upload = page.getByRole('button', { name: EDITOR_TEXT.upload })
    await upload.scrollIntoViewIfNeeded()
    const box = await upload.boundingBox()
    expect(box).not.toBeNull()
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(375)

    const longName = `${'very_long_module_name_'.repeat(6)}service.ts`
    await uploadFile(page, longName, `const line = '${'y'.repeat(400)}'\n`)
    await expect(page.getByTestId('editor-title')).toHaveText(longName)
    const titleBox = await page.getByTestId('editor-title').boundingBox()
    expect((titleBox?.x ?? 0) + (titleBox?.width ?? 0)).toBeLessThanOrEqual(375)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375)
    await expect(runButton(page)).toBeEnabled()
  })
})
