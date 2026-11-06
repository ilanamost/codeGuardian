import type { Page } from '@playwright/test'
import { EDITOR_TEXT, languageList, LANGUAGE_META, SYNTAX_MARKER_OWNER } from '../../src/lib/review.constants'
import { createReview, expect, MONACO_LOAD, test } from './fixture'

// Plan 027 Revision 3: switching the language on the same code recolors it for the new language,
// in either direction, right after load and after rapid switches; and the CDN editor keeps every
// Monaco feature it had before the plan (IntelliSense, diagnostics, command palette, go to line).
// The first page of a run can wait for the dev server's first transform and Monaco's CDN load.
const FIRST_LOAD_MS = 20000
const viewLines = (page: Page) => page.locator('.monaco-editor .view-lines').first()
const languageSelect = (page: Page) => page.getByRole('combobox', { name: 'Language' })

type W = {
  monaco: {
    editor: {
      getModels: () => { getLanguageId: () => string }[]
      getModelMarkers: (filter: object) => { owner: string }[]
    }
  }
}

async function uploadFile(page: Page, name: string, content: string) {
  await page.getByLabel(EDITOR_TEXT.fileInput).setInputFiles({ name, mimeType: 'text/plain', buffer: Buffer.from(content) })
}

const modelLanguage = (page: Page) => page.evaluate(() => (window as unknown as W).monaco.editor.getModels()[0]?.getLanguageId() ?? null)

// One code with a language-specific token per language: each language colors a different subset.
const SAMPLE = ['// note', '# note', 'interface User {}', 'let k = <div>hi</div>', 'def greet():', 'func main() {}', 'public class App {}', ''].join('\n')
const PROBE_LIST = ['// note', '# note', 'interface', 'div', 'def', 'func', 'public', 'class', 'User', 'greet', 'main', 'App']

type Fingerprint = Record<string, string | null>

// The color of each probe token in the first editor (null when no span has exactly that text).
function fingerprint(page: Page): Promise<Fingerprint> {
  return viewLines(page)
    .locator('span > span')
    .evaluateAll((list, probeList) => {
      const text = (element: Element) => element.textContent?.replace(/ /g, ' ').trim()
      return Object.fromEntries(
        probeList.map((probe) => {
          const span = list.find((element) => text(element) === probe)
          return [probe, span ? getComputedStyle(span).color : null]
        })
      )
    }, PROBE_LIST)
}

// Selects a language and waits until the model and the colors follow it. With `expected`, the
// colors must be exactly that language's fingerprint.
async function switchTo(page: Page, language: string, expected?: Fingerprint): Promise<Fingerprint> {
  await languageSelect(page).selectOption(language)
  await expect.poll(() => modelLanguage(page), { message: `model language for ${language}` }).toBe(LANGUAGE_META[language].monacoId)
  if (expected) await expect.poll(() => fingerprint(page), { message: `colors for ${language}` }).toEqual(expected)
  else await page.waitForTimeout(300)
  return fingerprint(page)
}

// Each language's fingerprint, read once by selecting it; also checks the meaning of the colors.
async function fingerprintByLanguage(page: Page): Promise<Record<string, Fingerprint>> {
  const byLanguage: Record<string, Fingerprint> = {}
  for (const language of languageList) byLanguage[language] = await switchTo(page, language)
  const keyword = byLanguage.TypeScript.interface
  const comment = byLanguage.TypeScript['// note']
  expect(keyword).not.toBeNull()
  expect(comment).not.toBeNull()
  expect(keyword).not.toBe(comment)
  // The declaration keyword of each language is in the keyword color there.
  expect(byLanguage.Go.func).toBe(keyword)
  expect(byLanguage.Python.def).toBe(keyword)
  expect(byLanguage.Java.public).toBe(keyword)
  // VS Code's JavaScript grammar reads `<div>` as JSX (a tag), TypeScript's as a type assertion.
  expect(byLanguage.TypeScript.div).toBe(byLanguage.TypeScript.User)
  expect(byLanguage.JavaScript.div).not.toBe(byLanguage.TypeScript.div)
  // `# note` is a comment in Python only, `// note` in every language but Python.
  expect(byLanguage.Python['# note']).toBe(comment)
  for (const language of ['TypeScript', 'JavaScript', 'Go', 'Java']) {
    expect(byLanguage[language]['# note'], language).not.toBe(comment)
    expect(byLanguage[language]['// note'], language).toBe(comment)
  }
  expect(byLanguage.Python['// note']).not.toBe(comment)
  // Every language colors this code differently.
  const distinct = new Set(Object.values(byLanguage).map((value) => JSON.stringify(value)))
  expect(distinct.size, JSON.stringify(byLanguage)).toBe(languageList.length)
  return byLanguage
}

test('every switch between two languages recolors the same code for the new language, in both directions', async ({ page }) => {
  test.setTimeout(120000)
  await page.goto('/review/new')
  await expect(viewLines(page)).toBeVisible({ timeout: FIRST_LOAD_MS })
  await uploadFile(page, 'sample.ts', SAMPLE)
  await expect(viewLines(page)).toContainText('public class App')
  const byLanguage = await fingerprintByLanguage(page)

  for (const from of languageList) {
    for (const to of languageList) {
      if (from === to) continue
      await switchTo(page, from, byLanguage[from])
      await switchTo(page, to, byLanguage[to])
    }
  }
  // The code itself never changes.
  await expect(viewLines(page)).toContainText('interface User {}')
})

test('the first switch right after load and the end of rapid switches show the chosen language, on an existing review', async ({
  page,
  request
}) => {
  test.setTimeout(120000)
  const { id } = await createReview(request, { title: 'Language switch', content: SAMPLE })
  await page.goto(`/review/${id}`)
  await expect(viewLines(page)).toContainText('public class App')
  // Right after load, the very first switch already recolors.
  await expect.poll(() => modelLanguage(page)).toBe('typescript')
  await languageSelect(page).selectOption('Python')
  await expect.poll(() => modelLanguage(page)).toBe('python')
  await expect.poll(async () => (await fingerprint(page)).def).not.toBeNull()

  const byLanguage = await fingerprintByLanguage(page)
  for (const final of languageList) {
    const order = languageList.filter((language) => language !== final)
    for (const language of [...order, ...order.slice().reverse(), final]) await languageSelect(page).selectOption(language)
    await expect(languageSelect(page)).toHaveValue(final)
    await expect.poll(() => modelLanguage(page)).toBe(LANGUAGE_META[final].monacoId)
    await expect.poll(() => fingerprint(page), { message: `colors after rapid switches ending on ${final}` }).toEqual(byLanguage[final])
  }
})

test('TypeScript IntelliSense suggests members while typing', async ({ page }) => {
  await page.goto('/review/new')
  await expect(viewLines(page)).toBeVisible({ timeout: FIRST_LOAD_MS })
  await viewLines(page).click()
  await page.keyboard.type('const list = [1, 2]\nlist.')
  const suggest = page.locator('.monaco-editor .suggest-widget.visible')
  await expect(suggest).toBeVisible({ timeout: 15000 })
  // Array members come from the TypeScript language service, not from words in the code.
  const row = (name: string) => suggest.locator('.monaco-list-row').filter({ hasText: new RegExp(`^${name}`) })
  await expect(row('filter')).toBeVisible()
  await page.keyboard.type('ma')
  await expect(row('map')).toBeVisible()
})

// Plan 032 (answer 2A): Monaco's TypeScript validation shows syntax errors only, so the probe is a
// syntax error (a type error such as `const count: number = "text"` is no longer marked).
test('Monaco\'s TypeScript diagnostics mark a syntax error with an error squiggle', async ({ page }) => {
  await page.goto('/review/new')
  await expect(viewLines(page)).toBeVisible({ timeout: FIRST_LOAD_MS })
  await uploadFile(page, 'broken.ts', 'const count: number = 1 +* 2\n')
  await expect(viewLines(page)).toContainText('const count')
  await expect
    .poll(() => page.evaluate(() => (window as unknown as W).monaco.editor.getModelMarkers({}).map(({ owner }) => owner)), { timeout: 15000 })
    .toContain('typescript')
  await expect(page.locator('.monaco-editor .squiggly-error').first()).toBeVisible(MONACO_LOAD)
})

test('F1 opens the command palette and Ctrl+G opens go to line', async ({ page }) => {
  await page.goto('/review/new')
  await expect(viewLines(page)).toBeVisible({ timeout: FIRST_LOAD_MS })
  await uploadFile(page, 'lines.ts', 'const a = 1\nconst b = 2\nconst c = 3\n')
  await expect(viewLines(page)).toContainText('const c = 3')
  await viewLines(page).click()

  const quickInput = page.locator('.quick-input-widget')
  await page.keyboard.press('F1')
  await expect(quickInput).toBeVisible()
  await expect(quickInput.locator('input')).toHaveValue('>')
  await page.keyboard.press('Escape')
  await expect(quickInput).toBeHidden()

  await page.keyboard.press('Control+G')
  await expect(quickInput).toBeVisible()
  await expect(quickInput.locator('input')).toHaveValue(':')
  await page.keyboard.press('Escape')
})

// QA round 3, P1: Monaco's TypeScript diagnostics belong to TypeScript code only. They go when the
// language switches away, and come back when it switches back to TypeScript.
test('TypeScript error markers leave with a switch to Python and come back with TypeScript', async ({ page }) => {
  const tsOwnerCount = () =>
    page.evaluate(() => (window as unknown as W).monaco.editor.getModelMarkers({}).filter(({ owner }) => owner === 'typescript').length)
  await page.goto('/review/new')
  await expect(viewLines(page)).toBeVisible({ timeout: FIRST_LOAD_MS })
  await uploadFile(page, 'broken.ts', 'const count: number = 1 +* 2\n')
  await expect.poll(tsOwnerCount, { timeout: 15000 }).toBeGreaterThan(0)

  await languageSelect(page).selectOption('Python')
  await expect.poll(tsOwnerCount).toBe(0)
  // A late check of the TypeScript service does not bring them back on Python code.
  await page.waitForTimeout(2000)
  expect(await tsOwnerCount()).toBe(0)
  // Plan 032: this code is not Python either, so only the editor's own syntax check marks it.
  const otherOwnerList = await page.evaluate(() =>
    (window as unknown as W).monaco.editor.getModelMarkers({}).map(({ owner }) => owner)
  )
  expect(otherOwnerList.filter((owner) => owner !== SYNTAX_MARKER_OWNER)).toEqual([])

  await languageSelect(page).selectOption('TypeScript')
  await expect.poll(tsOwnerCount, { timeout: 15000 }).toBeGreaterThan(0)
  await expect(page.locator('.monaco-editor .squiggly-error').first()).toBeVisible(MONACO_LOAD)
})

// QA round 4, R4-1: Shiki can land while the CDN Monaco is still loading a language's own
// (Monarch) tokenizer, which used to replace Shiki for that language for the rest of the session.
// After a slow first load with switches right as Shiki arrives, every language must color the code
// exactly as after a normal load, and still after it is selected again.
test('after a slow first load, switching right away colors every language with Shiki, also when re-selected', async ({ browser, context }) => {
  test.setTimeout(150000)
  // Plan 028: new pages get the fixture's signed-in session cookie.
  const storageState = await context.storageState()
  const normal = await browser.newPage({ storageState })
  await normal.goto('/review/new')
  await expect(viewLines(normal)).toBeVisible({ timeout: FIRST_LOAD_MS })
  await uploadFile(normal, 'sample.ts', SAMPLE)
  await expect(viewLines(normal)).toContainText('public class App')
  const byLanguage = await fingerprintByLanguage(normal)
  await normal.close()

  const page = await browser.newPage({ storageState })
  let release = () => {}
  const released = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route(/shikiHighlight|@shikijs|\/shiki/, async (route) => {
    await released
    await route.continue()
  })
  await page.goto('/review/new')
  await expect(viewLines(page)).toBeVisible({ timeout: FIRST_LOAD_MS })
  await uploadFile(page, 'sample.go', SAMPLE)
  await expect(viewLines(page)).toContainText('public class App')
  // Shiki lands while the user goes through every language at once.
  release()
  for (const language of [...languageList].reverse()) await languageSelect(page).selectOption(language)
  for (const round of [1, 2]) {
    for (const language of languageList) {
      await switchTo(page, language)
      await expect.poll(() => fingerprint(page), { message: `${language}, round ${round}`, timeout: 15000 }).toEqual(byLanguage[language])
    }
  }
  await page.close()
})
