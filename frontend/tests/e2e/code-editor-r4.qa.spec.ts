import type { Page, Route } from '@playwright/test'
import { EDITOR_TEXT, FINDING_MARKER_OWNER, SYNTAX_MARKER_OWNER } from '../../src/lib/review.constants'
import { createReview, expect, MONACO_LOAD, test } from './fixture'

// QA round 4 for plan 027 Revision 4: Shiki never gates the editor (R3-1) and stale TS/JS markers
// are cleared on a language change (P1). Tries to break both.
const viewLines = (page: Page) => page.locator('.monaco-editor .view-lines').first()
const languageSelect = (page: Page) => page.getByRole('combobox', { name: 'Language' })
const SHIKI = /shikiHighlight|@shikijs|\/shiki/
const CODE_BG = 'rgb(10, 18, 36)'
const VS_DARK_BG = 'rgb(30, 30, 30)'

type Sel = { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number }
type Mo = { getValue: () => string; getLanguageId: () => string; uri: unknown }
type Ed = {
  focus: () => void
  setPosition: (p: { lineNumber: number; column: number }) => void
  getPosition: () => { lineNumber: number; column: number }
  setSelection: (s: Sel) => void
  getSelection: () => Sel
  trigger: (s: string, id: string, a?: unknown) => void
}
type W = { monaco: { editor: { getEditors: () => Ed[]; getModels: () => Mo[]; getModelMarkers: (f: object) => { owner: string }[] } } }

const modelValue = (page: Page) => page.evaluate(() => (window as unknown as W).monaco.editor.getModels()[0]?.getValue())
const modelLanguage = (page: Page) => page.evaluate(() => (window as unknown as W).monaco.editor.getModels()[0]?.getLanguageId())
const ownerList = (page: Page) => page.evaluate(() => (window as unknown as W).monaco.editor.getModelMarkers({}).map((m) => m.owner))
const editorBg = (page: Page) => page.locator('.monaco-editor-background').first().evaluate((el) => getComputedStyle(el).backgroundColor)

async function uploadFile(page: Page, name: string, content: string) {
  await page.getByLabel(EDITOR_TEXT.fileInput).setInputFiles({ name, mimeType: 'text/plain', buffer: Buffer.from(content) })
}

// Holds every Shiki request until release() is called.
async function holdShiki(page: Page) {
  const held: Route[] = []
  let released = false
  await page.route(SHIKI, (route) => {
    if (released) return route.continue()
    held.push(route)
  })
  return {
    release: async () => {
      released = true
      for (const route of held.splice(0)) await route.continue()
    }
  }
}

// Visible color runs per line (adjacent same-color spans merged).
function fingerprint(page: Page): Promise<string> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('.monaco-editor .view-lines .view-line'))
      .sort((a, b) => parseFloat((a as HTMLElement).style.top) - parseFloat((b as HTMLElement).style.top))
      .map((line) => {
        const runList: [string, string][] = []
        for (const span of Array.from(line.querySelectorAll('span > span'))) {
          const color = getComputedStyle(span).color
          const text = span.textContent?.replace(/ /g, ' ') ?? ''
          const last = runList[runList.length - 1]
          if (last && last[1] === color) last[0] += text
          else runList.push([text, color])
        }
        return runList.map(([text, color]) => `${text}|${color}`).join('·')
      })
      .join('\n')
  )
}

async function stableFingerprint(page: Page) {
  await page.waitForTimeout(800)
  let last = ''
  await expect
    .poll(
      async () => {
        const now = await fingerprint(page)
        const stable = now === last && now !== ''
        last = now
        return stable
      },
      { timeout: 20000, intervals: [700] }
    )
    .toBe(true)
  return last
}

// The colors a normal load (Shiki ready before the editor) gives the same code and language.
async function referenceFingerprint(page: Page, fileName: string, code: string, language: string) {
  const ref = await page.context().newPage()
  await ref.goto('/review/new')
  await expect(viewLines(ref)).toBeVisible({ timeout: 20000 })
  await expect.poll(() => editorBg(ref), { timeout: 20000 }).toBe(CODE_BG)
  await uploadFile(ref, fileName, code)
  if ((await languageSelect(ref).inputValue()) !== language) await languageSelect(ref).selectOption(language)
  const print = await stableFingerprint(ref)
  await ref.close()
  return print
}

const TS_CODE = [
  'export function greet(user: User): string {',
  '  const label = "hi"',
  '  return `${label} ${user.name}` // done',
  '}',
  'interface User { name: string }',
  ''
].join('\n')

// ---------- R3-1: late, slow, failed Shiki ----------

test('R4 late Shiki mid-typing: same editor, code and cursor kept, colors equal a normal load', async ({ page }) => {
  const shiki = await holdShiki(page)
  await page.goto('/review/new')
  await expect(viewLines(page)).toBeVisible({ timeout: 20000 })
  expect(await editorBg(page)).toBe(VS_DARK_BG)
  await uploadFile(page, 'greet.ts', TS_CODE)
  await expect(viewLines(page)).toContainText('export function greet')
  await page.locator('.monaco-editor').first().evaluate((el) => el.setAttribute('data-qa', 'same'))
  await viewLines(page).click()
  await page.keyboard.press('ControlOrMeta+End')
  // Type, release Shiki in the middle of the typing, keep typing.
  await page.keyboard.type('const a', { delay: 25 })
  const release = shiki.release()
  await page.keyboard.type(' = 1 // tail', { delay: 25 })
  await release
  const expected = `${TS_CODE}const a = 1 // tail`
  await expect.poll(() => modelValue(page)).toBe(expected)
  await expect.poll(() => editorBg(page), { timeout: 20000 }).toBe(CODE_BG)
  await expect(page.locator('.monaco-editor[data-qa=same]')).toHaveCount(1)
  const position = await page.evaluate(() => (window as unknown as W).monaco.editor.getEditors()[0].getPosition())
  expect(position).toEqual({ lineNumber: 6, column: 20 })
  // No wrong colors left: equal to a normal load of the same text.
  const print = await stableFingerprint(page)
  expect(print).toBe(await referenceFingerprint(page, 'greet.ts', expected, 'TypeScript'))
})

test('R4 late Shiki mid-selection: the selection is kept', async ({ page }) => {
  const shiki = await holdShiki(page)
  await page.goto('/review/new')
  await expect(viewLines(page)).toBeVisible({ timeout: 20000 })
  await uploadFile(page, 'greet.ts', TS_CODE)
  await expect(viewLines(page)).toContainText('export function greet')
  const selection = { startLineNumber: 2, startColumn: 3, endLineNumber: 4, endColumn: 2 }
  await page.evaluate((s) => {
    const editor = (window as unknown as W).monaco.editor.getEditors()[0]
    editor.focus()
    editor.setSelection(s)
  }, selection)
  await shiki.release()
  await expect.poll(() => editorBg(page), { timeout: 20000 }).toBe(CODE_BG)
  const now = await page.evaluate(() => (window as unknown as W).monaco.editor.getEditors()[0].getSelection())
  expect({ startLineNumber: now.startLineNumber, startColumn: now.startColumn, endLineNumber: now.endLineNumber, endColumn: now.endColumn }).toEqual(selection)
})

test('R4 late Shiki mid-upload and mid-language-switch: ends on the right language and colors', async ({ page }) => {
  const shiki = await holdShiki(page)
  await page.goto('/review/new')
  await expect(viewLines(page)).toBeVisible({ timeout: 20000 })
  const goCode = 'package main\n\n// note\nfunc main() {\n\tfmt.Println("hi", 42)\n}\n'
  // Release while the upload is being read and applied.
  const upload = uploadFile(page, 'main.go', goCode)
  const release = shiki.release()
  await Promise.all([upload, release])
  await expect(languageSelect(page)).toHaveValue('Go')
  // Rapid switches while the late highlighting is being applied.
  for (const l of ['Python', 'Java', 'TypeScript', 'Go', 'JavaScript', 'Python']) await languageSelect(page).selectOption(l)
  await expect.poll(() => modelLanguage(page)).toBe('python')
  await expect.poll(() => editorBg(page), { timeout: 20000 }).toBe(CODE_BG)
  expect(await modelValue(page)).toBe(goCode)
  // QA round 4 finding R4-1: when Shiki lands while a language's Monaco (Monarch) module is still
  // loading, that module registers after Shiki and replaces it for the rest of the session:
  // Monarch token types (`number.python`) under the Shiki theme leave numbers and operators plain.
  await page.waitForTimeout(1500)
  const tokenTypes = await page.evaluate(() =>
    (window as unknown as { monaco: { editor: { tokenize: (t: string, l: string) => { type: string }[][] } } }).monaco.editor
      .tokenize('x = 42', 'python')[0]
      .map((t) => t.type)
  )
  expect(tokenTypes.filter((t) => t.endsWith('.python')), 'Python is tokenized by Shiki, not Monarch').toEqual([])
  const print = await stableFingerprint(page)
  expect(print).toBe(await referenceFingerprint(page, 'main.go', goCode, 'Python'))
})

test('R4 slow Shiki (3 s): editor usable at once, then fully colored including the first line', async ({ page }) => {
  await page.route(SHIKI, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 3000))
    await route.continue()
  })
  const start = Date.now()
  await page.goto('/review/new')
  await expect(viewLines(page)).toBeVisible({ timeout: 20000 })
  const visibleMs = Date.now() - start
  await uploadFile(page, 'greet.ts', TS_CODE)
  await expect.poll(() => editorBg(page), { timeout: 30000 }).toBe(CODE_BG)
  const print = await stableFingerprint(page)
  console.log(`R4 slow Shiki: editor visible after ${visibleMs} ms`)
  // First line: export (control keyword), function (keyword), greet (function), User (type) each colored.
  const firstLine = print.split('\n')[0]
  expect(firstLine).toContain('export|rgb(197, 134, 192)')
  expect(firstLine).toContain('greet|rgb(220, 220, 170)')
  expect(firstLine).toContain('User|rgb(78, 201, 176)')
  expect(print).toBe(await referenceFingerprint(page, 'greet.ts', TS_CODE, 'TypeScript'))
})

test('R4 failed Shiki: editor works on vs-dark with Monaco colors, IntelliSense, no error toast or page error', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.route(SHIKI, (route) => route.abort('failed'))
  await page.goto('/review/new')
  await expect(viewLines(page)).toBeVisible({ timeout: 20000 })
  await uploadFile(page, 'greet.ts', TS_CODE)
  await page.waitForTimeout(1500)
  expect(await editorBg(page)).toBe(VS_DARK_BG)
  await expect(page.getByText('Something went wrong', { exact: false })).toHaveCount(0)
  await languageSelect(page).selectOption('Python')
  await expect.poll(() => modelLanguage(page)).toBe('python')
  expect(errors.filter((m) => m !== 'Canceled')).toEqual([])
})

// ---------- The theme-name mapping ----------

test('R4 theme: Monaco High Contrast toggle, app theme switches and the Generated tests editor never throw or leave the Shiki theme', async ({ page, request }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console ${m.text().slice(0, 160)}`)
  })
  const { id } = await createReview(request, { title: 'R4 theme' })
  await page.goto(`/review/${id}`)
  await expect(viewLines(page)).toBeVisible({ timeout: 20000 })
  await expect.poll(() => editorBg(page), { timeout: 20000 }).toBe(CODE_BG)
  // Monaco's own command (F1 > Toggle High Contrast Theme) asks for hc-black.
  await page.evaluate(() => (window as unknown as W).monaco.editor.getEditors()[0].trigger('qa', 'editor.action.toggleHighContrast'))
  await page.waitForTimeout(500)
  const afterToggle = await editorBg(page)
  console.log(`R4 theme: background after High Contrast toggle = ${afterToggle}`)
  await page.evaluate(() => (window as unknown as W).monaco.editor.getEditors()[0].trigger('qa', 'editor.action.toggleHighContrast'))
  await page.waitForTimeout(300)
  await expect.poll(() => editorBg(page)).toBe(CODE_BG)
  // App theme switches, then back to the review and the Generated tests tab.
  for (const theme of ['Dark', 'Light']) {
    await page.goto('/settings')
    await page.getByRole('tab', { name: 'Appearance' }).click()
    await page.getByRole('radio', { name: theme }).check()
    await page.goto(`/review/${id}`)
    await expect(viewLines(page)).toBeVisible({ timeout: 20000 })
    await expect.poll(() => editorBg(page), { timeout: 20000 }).toBe(CODE_BG)
    await page.getByRole('tab', { name: /Generated tests/ }).click()
    await expect(viewLines(page)).toBeVisible(MONACO_LOAD)
    await expect.poll(() => editorBg(page)).toBe(CODE_BG)
  }
  expect(errors.filter((m) => m !== 'Canceled')).toEqual([])
})

// ---------- P1: stale markers ----------

// Plan 032 (answer 2A): syntax errors, as Monaco's semantic validation is off.
const TS_ERROR = 'const count: number = 1 +* 2\nconst other: string = 4 +* 2\n'

test('R4 markers: TS -> Python -> Go -> Java -> TS three times; TS errors only while TypeScript', async ({ page }) => {
  await page.goto('/review/new')
  await expect(viewLines(page)).toBeVisible({ timeout: 20000 })
  await uploadFile(page, 'err.ts', TS_ERROR)
  await expect.poll(() => ownerList(page), { timeout: 20000 }).toContain('typescript')
  for (let round = 0; round < 3; round++) {
    for (const l of ['Python', 'Go', 'Java']) {
      await languageSelect(page).selectOption(l)
      await page.waitForTimeout(400)
      expect(await ownerList(page), `${l} round ${round}`).not.toContain('typescript')
    }
    await languageSelect(page).selectOption('TypeScript')
    await expect.poll(() => ownerList(page), { timeout: 20000 }).toContain('typescript')
  }
  // A late check after leaving TypeScript does not bring them back.
  await languageSelect(page).selectOption('Go')
  await page.waitForTimeout(2500)
  expect(await ownerList(page)).not.toContain('typescript')
  // Plan 032: the code is not Go either, so only the editor's own syntax check marks it.
  expect((await ownerList(page)).filter((owner) => owner !== SYNTAX_MARKER_OWNER)).toEqual([])
})

test('R4 markers: uploads of .py/.go/.java while the TS checker is still busy leave no TS markers', async ({ page }) => {
  await page.goto('/review/new')
  await expect(viewLines(page)).toBeVisible({ timeout: 20000 })
  const big = Array.from({ length: 300 }, (_, i) => `const v${i}: number = 1 +* ${i}`).join('\n')
  for (const [name, code] of [
    ['a.py', 'def run():\n    return 1\n'],
    ['b.go', 'package main\nfunc main() {}\n'],
    ['C.java', 'public class C {}\n']
  ]) {
    await uploadFile(page, 'busy.ts', big)
    // No wait: the TS checker is still working on 300 errors.
    await uploadFile(page, name, code)
    await expect.poll(() => modelValue(page)).toBe(code)
    await page.waitForTimeout(2500)
    expect(await ownerList(page), name).not.toContain('typescript')
  }
})

test('R4 markers: real errors still show for TypeScript and JavaScript code', async ({ page }) => {
  await page.goto('/review/new')
  await expect(viewLines(page)).toBeVisible({ timeout: 20000 })
  await uploadFile(page, 'err.ts', TS_ERROR)
  await expect.poll(() => ownerList(page), { timeout: 20000 }).toContain('typescript')
  await uploadFile(page, 'err.js', 'let x = ;\nfunction (\n')
  await expect(languageSelect(page)).toHaveValue('JavaScript')
  await expect.poll(() => ownerList(page), { timeout: 20000 }).toContain('javascript')
  expect(await ownerList(page)).not.toContain('typescript')
  await expect(page.locator('.monaco-editor .squiggly-error').first()).toBeVisible(MONACO_LOAD)
})

test('R4 markers: the cleanup never removes review finding markers or glyphs', async ({ page, request }) => {
  const { id } = await createReview(request, { title: 'R4 findings' })
  await page.goto(`/review/${id}`)
  await expect(viewLines(page)).toBeVisible({ timeout: 20000 })
  const findingCount = () => page.evaluate((owner) => (window as unknown as W).monaco.editor.getModelMarkers({ owner }).length, FINDING_MARKER_OWNER)
  await expect.poll(findingCount).toBeGreaterThan(0)
  const before = await findingCount()
  const glyphs = await page.locator('.editor-finding-glyph').count()
  // Let the TS checker run and the cleanup react to its markers.
  await page.waitForTimeout(3000)
  expect(await findingCount()).toBe(before)
  expect(await page.locator('.editor-finding-glyph').count()).toBe(glyphs)
  // A language switch away and back: whatever the page decides for findings, the TS cleanup must
  // not be the one removing them; compare with the review-finding count the page shows after.
  await languageSelect(page).selectOption('Python')
  await page.waitForTimeout(1500)
  const onPython = await findingCount()
  const glyphsOnPython = await page.locator('.editor-finding-glyph').count()
  console.log(`R4 findings: TypeScript ${before} markers/${glyphs} glyphs; Python ${onPython} markers/${glyphsOnPython} glyphs`)
  expect(onPython).toBe(glyphsOnPython > 0 ? onPython : 0)
  await languageSelect(page).selectOption('TypeScript')
  await expect.poll(findingCount).toBe(before)
  await expect.poll(() => page.locator('.editor-finding-glyph').count()).toBe(glyphs)
})

// ---------- QA round 5: the R4-1 wrapper ----------

type Langs = {
  setMonarchTokensProvider: (id: string, def: object) => unknown
  setTokensProvider: (id: string, p: object) => unknown
  registerTokensProviderFactory: (id: string, f: object) => unknown
  register: (l: { id: string }) => void
}
const tokenTypes = (page: Page, code: string, lang: string) =>
  page.evaluate(
    ({ code, lang }) =>
      (window as unknown as { monaco: { editor: { tokenize: (t: string, l: string) => { type: string }[][] } } }).monaco.editor
        .tokenize(code, lang)[0]
        .map((t) => t.type),
    { code, lang }
  )
const FIVE = ['typescript', 'javascript', 'python', 'go', 'java']

test('R5 wrapper: Monaco registrations for the five languages after Shiki are ignored; colors stay Shiki', async ({ page }) => {
  await page.goto('/review/new')
  await expect(viewLines(page)).toBeVisible({ timeout: 20000 })
  await expect.poll(() => editorBg(page), { timeout: 20000 }).toBe(CODE_BG)
  await uploadFile(page, 'greet.ts', TS_CODE)
  const before = await stableFingerprint(page)
  // Monarch, a plain provider and a factory, for all five languages, after Shiki is on.
  await page.evaluate((ids) => {
    const languages = (window as unknown as { monaco: { languages: Langs } }).monaco.languages
    const monarch = { tokenizer: { root: [[/.*/, 'keyword']] } }
    const plain = {
      getInitialState: () => ({ clone: () => null, equals: () => true }),
      tokenize: () => ({ tokens: [{ startIndex: 0, scopes: 'keyword' }], endState: null })
    }
    for (const id of ids) {
      languages.setMonarchTokensProvider(id, monarch)
      languages.setTokensProvider(id, plain)
      languages.registerTokensProviderFactory(id, { create: () => monarch })
    }
  }, FIVE)
  await languageSelect(page).selectOption('Python')
  await languageSelect(page).selectOption('TypeScript')
  expect(await stableFingerprint(page)).toBe(before)
  for (const id of FIVE) {
    const types = await tokenTypes(page, 'x = 42', id)
    expect(types.filter((t) => t.endsWith(`.${id}`) || t === 'keyword'), id).toEqual([])
  }
})

test('R5 wrapper: a non-Shiki language still registers a Monarch tokenizer normally', async ({ page }) => {
  await page.goto('/review/new')
  await expect(viewLines(page)).toBeVisible({ timeout: 20000 })
  await expect.poll(() => editorBg(page), { timeout: 20000 }).toBe(CODE_BG)
  const types = await page.evaluate(() => {
    const m = (window as unknown as { monaco: { languages: Langs; editor: { tokenize: (t: string, l: string) => { type: string }[][] } } }).monaco
    m.languages.register({ id: 'qa-lang' })
    m.languages.setMonarchTokensProvider('qa-lang', { tokenizer: { root: [[/qa/, 'keyword'], [/\d+/, 'number']] } })
    return m.editor.tokenize('qa 42', 'qa-lang')[0].map((t) => t.type)
  })
  expect(types).toContain('keyword.qa-lang')
  expect(types).toContain('number.qa-lang')
})

test('R5 wrapper: after a slow first load and rapid switches, TypeScript IntelliSense, hover and diagnostics still work', async ({ page }) => {
  const shiki = await holdShiki(page)
  await page.goto('/review/new')
  await expect(viewLines(page)).toBeVisible({ timeout: 20000 })
  await uploadFile(page, 'err.ts', 'const list = [1, 2, 3]\nconst count: number = 1 +* 2\n')
  const release = shiki.release()
  for (const l of ['Python', 'Go', 'Java', 'JavaScript', 'TypeScript', 'Python', 'Go', 'Java', 'JavaScript', 'TypeScript']) await languageSelect(page).selectOption(l)
  await release
  await expect.poll(() => editorBg(page), { timeout: 20000 }).toBe(CODE_BG)
  await expect.poll(() => modelLanguage(page)).toBe('typescript')
  expect((await tokenTypes(page, 'const x = 42', 'typescript')).filter((t) => t.endsWith('.ts'))).toEqual([])
  await expect.poll(() => ownerList(page), { timeout: 20000 }).toContain('typescript')
  await viewLines(page).click()
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.insertText('\nlist.ma')
  await page.evaluate(() => (window as unknown as W).monaco.editor.getEditors()[0].trigger('qa', 'editor.action.triggerSuggest'))
  await expect(page.locator('.suggest-widget.visible')).toContainText('map', { timeout: 15000 })
  await page.keyboard.press('Escape')
  await page.evaluate(() => {
    const editor = (window as unknown as W).monaco.editor.getEditors()[0]
    editor.focus()
    editor.setPosition({ lineNumber: 1, column: 8 })
    editor.trigger('qa', 'editor.action.showHover')
  })
  await expect(page.locator('.monaco-hover:visible').first()).toContainText('number[]', { timeout: 15000 })
})

test('R5 wrapper: two editors on one page (Summary + Generated tests) with a late Shiki are both Shiki-colored', async ({ page, request }) => {
  const { id } = await createReview(request, { title: 'R5 two editors' })
  const shiki = await holdShiki(page)
  await page.goto(`/review/${id}`)
  await expect(viewLines(page)).toBeVisible({ timeout: 20000 })
  expect(await editorBg(page)).toBe(VS_DARK_BG)
  await page.getByRole('tab', { name: /Generated tests/ }).click()
  await expect(viewLines(page)).toBeVisible(MONACO_LOAD)
  const release = shiki.release()
  await page.getByRole('tab', { name: 'Summary' }).click()
  await release
  await expect(viewLines(page)).toBeVisible(MONACO_LOAD)
  await expect.poll(() => editorBg(page), { timeout: 20000 }).toBe(CODE_BG)
  const summary = await stableFingerprint(page)
  await page.getByRole('tab', { name: /Generated tests/ }).click()
  await expect(viewLines(page)).toBeVisible(MONACO_LOAD)
  await expect.poll(() => editorBg(page)).toBe(CODE_BG)
  const generated = await stableFingerprint(page)
  // Dark+ keyword blue on the Summary code, Dark+ function yellow on the generated tests.
  expect(summary).toMatch(/rgb\(86, 156, 214\)/)
  expect(generated).toMatch(/rgb\(220, 220, 170\)/)
  expect((await tokenTypes(page, 'const x = 42', 'typescript')).filter((t) => t.endsWith('.ts'))).toEqual([])
})

test('R5 wrapper: on a Shiki-failed page Monarch tokenizers work normally on vs-dark', async ({ page }) => {
  await page.route(SHIKI, (route) => route.abort('failed'))
  await page.goto('/review/new')
  await expect(viewLines(page)).toBeVisible({ timeout: 20000 })
  await uploadFile(page, 'main.go', 'package main\n\nfunc main() {\n\tprintln(42)\n}\n')
  await expect(languageSelect(page)).toHaveValue('Go')
  for (const l of ['Python', 'Java', 'TypeScript', 'Go']) await languageSelect(page).selectOption(l)
  await page.waitForTimeout(1500)
  expect(await editorBg(page)).toBe(VS_DARK_BG)
  for (const [lang, suffix] of [['go', '.go'], ['python', '.python'], ['java', '.java'], ['typescript', '.ts']]) {
    const types = await tokenTypes(page, 'x = 42', lang)
    expect(types.some((t) => t.endsWith(suffix)), `${lang} ${JSON.stringify(types)}`).toBe(true)
  }
  const colors = await page.evaluate(() => new Set(Array.from(document.querySelectorAll('.monaco-editor .view-lines span > span')).map((s) => getComputedStyle(s).color)).size)
  expect(colors).toBeGreaterThanOrEqual(3)
})
