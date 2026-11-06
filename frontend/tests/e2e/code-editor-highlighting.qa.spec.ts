import type { Page } from '@playwright/test'
import { EDITOR_TEXT, FINDING_MARKER_OWNER } from '../../src/lib/review.constants'
import { createReview, expect, MONACO_LOAD, test } from './fixture'

// QA for plan 027: tries to break the Shiki-highlighted editor. Revision 3: Monaco loads from the
// CDN again, so the bundled-build checks (no external request, failed lazy load) were removed.
const viewLines = (page: Page) => page.locator('.monaco-editor .view-lines').first()
const languageSelect = (page: Page) => page.getByRole('combobox', { name: 'Language' })

async function uploadFile(page: Page, name: string, content: string) {
  await page.getByLabel(EDITOR_TEXT.fileInput).setInputFiles({ name, mimeType: 'text/plain', buffer: Buffer.from(content) })
}

function colorOf(page: Page, text: string): Promise<string | null> {
  return viewLines(page)
    .locator('span > span')
    .evaluateAll((list, wanted) => {
      const span = list.find((element) => element.textContent?.replace(/ /g, ' ').trim() === wanted)
      return span ? getComputedStyle(span).color : null
    }, text)
}

// Lowest WCAG contrast ratio of any token color on the editor background.
function minTokenContrast(page: Page) {
  return page.evaluate(() => {
    const parse = (value: string) => (value.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map(Number)
    const lum = ([r, g, b]: number[]) => {
      const c = [r, g, b].map((v) => {
        const s = v / 255
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
      })
      return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
    }
    const bg = parse(getComputedStyle(document.querySelector('.monaco-editor-background') as Element).backgroundColor)
    const colorList = new Set(
      Array.from(document.querySelectorAll('.monaco-editor .view-lines span > span'))
        .filter((span) => span.textContent?.trim())
        .map((span) => getComputedStyle(span).color)
    )
    let min = Infinity
    let worst = ''
    for (const color of colorList) {
      const a = lum(parse(color))
      const b = lum(bg)
      const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
      if (ratio < min) {
        min = ratio
        worst = color
      }
    }
    return { min, worst, count: colorList.size }
  })
}

const SAMPLE = '// note\ninterface User { name: string }\nexport function greet(user: User): number {\n  const label = "hi"\n  return 42 // TODO\n}\n'

async function setTheme(page: Page, theme: 'Light' | 'Dark') {
  await page.goto('/settings')
  await page.getByRole('tab', { name: 'Appearance' }).click()
  await page.getByRole('radio', { name: theme }).check()
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme.toLowerCase())
}

for (const theme of ['Light', 'Dark'] as const) {
  test(`QA: every token color is readable (WCAG AA 4.5:1) on the code background in the ${theme} app theme`, async ({ page }) => {
    await setTheme(page, theme)
    await page.goto('/review/new')
    await expect(viewLines(page)).toBeVisible(MONACO_LOAD)
    await uploadFile(page, 'sample.ts', SAMPLE)
    await expect.poll(() => colorOf(page, 'greet')).not.toBeNull()
    const result = await minTokenContrast(page)
    expect(result.count, 'several token colors are shown').toBeGreaterThanOrEqual(5)
    expect(result.min, `worst token color ${result.worst}`).toBeGreaterThanOrEqual(4.5)
  })
}

test('QA: the editor colors are the same in the Light and Dark app themes', async ({ page }) => {
  const snapshot = async () => {
    await page.goto('/review/new')
    await expect(viewLines(page)).toBeVisible(MONACO_LOAD)
    await uploadFile(page, 'sample.ts', SAMPLE)
    await expect.poll(() => colorOf(page, 'greet')).not.toBeNull()
    const bg = await page.locator('.monaco-editor-background').first().evaluate((el) => getComputedStyle(el).backgroundColor)
    return { bg, fn: await colorOf(page, 'greet'), str: await colorOf(page, '"hi"'), type: await colorOf(page, 'User') }
  }
  await setTheme(page, 'Light')
  const light = await snapshot()
  await setTheme(page, 'Dark')
  const dark = await snapshot()
  expect(dark).toEqual(light)
})

test('QA: rapid language switching ends on the last chosen language and its colors', async ({ page }) => {
  await page.goto('/review/new')
  await expect(viewLines(page)).toBeVisible(MONACO_LOAD)
  await uploadFile(page, 'main.go', 'func greet() int {\n\treturn 42\n}\n# note\ndef run():\n    pass\n')
  await expect(languageSelect(page)).toHaveValue('Go')
  await expect.poll(() => colorOf(page, 'func')).not.toBeNull()
  const goFunc = await colorOf(page, 'func')
  await languageSelect(page).selectOption('Python')
  await expect.poll(() => colorOf(page, 'func')).not.toBe(goFunc)
  const pythonDef = await colorOf(page, 'def')

  const order = ['Java', 'Go', 'TypeScript', 'Python', 'JavaScript', 'Go', 'Java', 'Python', 'Go', 'Python']
  for (const language of order) await languageSelect(page).selectOption(language)

  await expect(languageSelect(page)).toHaveValue('Python')
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { monaco: { editor: { getModels: () => { getLanguageId: () => string }[] } } }).monaco.editor.getModels()[0]?.getLanguageId()))
    .toBe('python')
  await expect.poll(() => colorOf(page, 'def')).toBe(pythonDef)
  expect(await colorOf(page, 'func')).not.toBe(goFunc)
})

// Revision 3: Monaco's own TypeScript diagnostics are back (CDN build, as before plan 027); the
// review's findings are marked next to them.
test('QA: Monaco diagnostics mark a type error, and review findings keep their markers, glyphs and squiggles', async ({ page, request }) => {
  await page.goto('/review/new')
  await expect(viewLines(page)).toBeVisible(MONACO_LOAD)
  await uploadFile(page, 'broken.ts', 'const count: number = "text"\nfunction (\nlet x = \n')
  await expect(viewLines(page)).toContainText('const count')
  const ownerList = () =>
    page.evaluate(() =>
      (window as unknown as { monaco: { editor: { getModelMarkers: (filter: object) => { owner: string }[] } } }).monaco.editor
        .getModelMarkers({})
        .map(({ owner }) => owner)
    )
  await expect.poll(ownerList, { timeout: 15000 }).toContain('typescript')
  await expect(page.locator('.monaco-editor .squiggly-error').first()).toBeVisible(MONACO_LOAD)

  const { id } = await createReview(request, { title: 'QA findings' })
  await page.goto(`/review/${id}`)
  const glyph = page.locator('.editor-finding-glyph')
  await expect.poll(() => glyph.count()).toBeGreaterThan(0)
  await expect.poll(ownerList).toContain(FINDING_MARKER_OWNER)

  // Finding squiggles are drawn (Monaco paints them as a background image).
  const squiggle = page.locator('.monaco-editor [class*="squiggly-"]')
  await expect.poll(() => squiggle.count()).toBeGreaterThan(0)
  const squiggleBg = await squiggle.first().evaluate((el) => getComputedStyle(el).backgroundImage)
  expect(squiggleBg).toContain('url(')
})

// QA finding: Monaco's cleanClassName (textModel.js) replaces every character outside
// [a-z0-9-_] with a space, so the Tailwind variant classes of FINDING_GLYPH_CLASS
// (`before:block`, `before:bg-critical`, ...) reach the DOM as `before block`, `before bg-critical`
// and the dot is never painted. The glyph element exists (existing specs count it) but is empty.
test('QA: the finding glyph dot is painted in the glyph margin', async ({ page, request }) => {
  const { id } = await createReview(request, { title: 'QA glyph dot' })
  await page.goto(`/review/${id}`)
  const glyph = page.locator('.editor-finding-glyph')
  await expect.poll(() => glyph.count()).toBeGreaterThan(0)
  const editorBg = await page.locator('.monaco-editor-background').first().evaluate((el) => getComputedStyle(el).backgroundColor)
  const dotColor = await glyph.first().evaluate((el) => getComputedStyle(el, '::before').backgroundColor)
  expect(dotColor).not.toBe('rgba(0, 0, 0, 0)')
  expect(dotColor).not.toBe(editorBg)
})

test('QA: font size from Settings and the wide horizontal scrollbar (16px below md, 12px from md)', async ({ page }) => {
  await page.goto('/settings')
  await page.getByRole('tab', { name: 'Appearance' }).click()
  await page.getByRole('radio', { name: 'Large (16px)' }).check()

  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/review/new')
  await expect(viewLines(page)).toBeVisible(MONACO_LOAD)
  await uploadFile(page, 'wide.ts', `const wide = "${'x'.repeat(400)}"\n`)
  await expect(viewLines(page)).toContainText('const wide')
  await expect.poll(() => viewLines(page).evaluate((el) => getComputedStyle(el).fontSize)).toBe('16px')
  const bar = page.locator('.monaco-editor .monaco-scrollable-element > .scrollbar.horizontal').first()
  await expect.poll(async () => Math.round((await bar.boundingBox())?.height ?? 0)).toBe(12)

  await page.setViewportSize({ width: 390, height: 844 })
  await expect.poll(() => viewLines(page).evaluate((el) => getComputedStyle(el).fontSize)).toBe('18px')
  await expect.poll(async () => Math.round((await bar.boundingBox())?.height ?? 0)).toBe(16)
})

test('QA: a very long line and a large file keep the editor responsive and colored', async ({ page }) => {
  await page.goto('/review/new')
  await expect(viewLines(page)).toBeVisible(MONACO_LOAD)
  const long = `const big = [${Array.from({ length: 4000 }, (_, i) => i).join(', ')}]\n`
  const many = Array.from({ length: 900 }, (_, i) => `function f${i}(a: number): string { return "v${i}" } // c${i}`).join('\n')
  // CRLF line breaks so the LF cursor-jump finding below does not interfere.
  await uploadFile(page, 'big.ts', `${long}${many}\nfunction tail() {}\n`.replace(/\n/g, '\r\n'))
  await expect(viewLines(page)).toContainText('const big')
  await expect.poll(() => colorOf(page, 'function')).not.toBeNull()
  // Typing on the 22k-character first line stays responsive (the post-upload cursor race, F3, is
  // covered by the typing tests below).
  await page.waitForTimeout(1500)
  await viewLines(page).click()
  await page.keyboard.press('ControlOrMeta+Home')
  const before = (await modelValue(page))?.length ?? 0
  const start = Date.now()
  await page.keyboard.type('let typed = 1;', { delay: 30 })
  // Only the count of characters is checked here; where they land is checked below.
  await expect.poll(async () => ((await modelValue(page))?.length ?? 0) - before).toBe(14)
  expect(Date.now() - start).toBeLessThan(3000)
})

const modelValue = (page: Page) =>
  page.evaluate(() => (window as unknown as { monaco: { editor: { getModels: () => { getValue: () => string }[] } } }).monaco.editor.getModels()[0]?.getValue())

// QA finding F3 (fixed in Revision 1): typing within about a second of an upload sometimes moved
// the cursor to the end of the file mid-word ("let typconst a = 1\r\ned = 1;"). Cause: the
// value sync of @monaco-editor/react (`value !== editor.getValue()`, in an effect after paint)
// replaced the whole content when it saw an older value than the model (a CRLF/LF mismatch, or a
// key typed before the effect ran). The model is now kept on LF, gets the value with LF, and
// CodeEditor commits each change with flushSync. Checked for an LF and a CRLF upload,
// typing at once and with no key delay, several rounds each; the model must also stay on LF.
const modelEol = (page: Page) =>
  page.evaluate(() => (window as unknown as { monaco: { editor: { getModels: () => { getEOL: () => string }[] } } }).monaco.editor.getModels()[0]?.getEOL())

for (const { label, content } of [
  { label: 'an LF file', content: 'const a = 1\nconst b = 2\n' },
  { label: 'a CRLF file', content: 'const a = 1\r\nconst b = 2\r\n' }
]) {
  test(`QA: typing at the top right after uploading ${label} keeps the cursor and every key`, async ({ page }) => {
    await page.goto('/review/new')
    await expect(viewLines(page)).toBeVisible(MONACO_LOAD)
    for (let round = 0; round < 3; round++) {
      await uploadFile(page, `lf${round}.ts`, content)
      await expect(viewLines(page)).toContainText('const b = 2')
      await viewLines(page).click()
      await page.keyboard.press('ControlOrMeta+Home')
      await page.keyboard.type('let typed = 1;')
      await expect.poll(() => modelValue(page)).toBe('let typed = 1;const a = 1\nconst b = 2\n')
      expect(await modelEol(page)).toBe('\n')
    }
  })
}
