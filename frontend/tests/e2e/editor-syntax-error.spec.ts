import type { Page, Request } from '@playwright/test'
import { EDITOR_TEXT, FINDING_MARKER_OWNER, REVIEW_TEXT, SYNTAX_CHECK_DELAY_MS, SYNTAX_MARKER_OWNER, SYNTAX_TEXT } from '../../src/lib/review.constants'
import { ERROR_MESSAGE } from '../../src/utils/error-messages'
import { createReview, expect, MONACO_LOAD, test } from './fixture'
import { FRONTEND_URL } from './e2e.constants'

// Plan 032: syntax errors in the editor. Python, Go and Java are checked in the browser with
// tree-sitter (marker owner `syntax`); TypeScript and JavaScript keep Monaco's own syntax
// validation, with its semantic validation off. The grammar files come from the app itself.

type Marker = { owner: string; message: string; startLineNumber: number; startColumn: number; source?: string }
type Ed = {
  focus: () => void
  setValue: (value: string) => void
  setPosition: (p: { lineNumber: number; column: number }) => void
  trigger: (source: string, id: string) => void
}
type W = { monaco: { editor: { getEditors: () => Ed[]; getModelMarkers: (filter: { owner?: string }) => Marker[] } } }

const viewLines = (page: Page) => page.locator('.monaco-editor .view-lines').first()
const languageSelect = (page: Page) => page.getByRole('combobox', { name: 'Language' })
const squiggle = (page: Page) => page.locator('.monaco-editor .squiggly-error')
const toastList = (page: Page) => page.locator('[data-sonner-toast]')
// Long enough for the first grammar load in the dev server; later checks take milliseconds.
const CHECK_WAIT = { timeout: 20_000 }

const markerList = (page: Page, owner?: string) =>
  page.evaluate((filter) => (window as unknown as W).monaco.editor.getModelMarkers(filter), owner ? { owner } : {})

// Sets the whole text as one edit, so auto-closing brackets do not change the invalid code.
const setCode = (page: Page, code: string) => page.evaluate((value) => (window as unknown as W).monaco.editor.getEditors()[0].setValue(value), code)

async function openNew(page: Page) {
  await page.goto('/review/new')
  await expect(viewLines(page)).toBeVisible(MONACO_LOAD)
}

async function showHoverAt(page: Page, lineNumber: number, column: number) {
  await page.evaluate(
    ({ lineNumber, column }) => {
      const editor = (window as unknown as W).monaco.editor.getEditors()[0]
      editor.focus()
      editor.setPosition({ lineNumber, column })
      editor.trigger('e2e', 'editor.action.showHover')
    },
    { lineNumber, column }
  )
  return page.locator('.monaco-hover:visible').first()
}

async function uploadFile(page: Page, name: string, content: string) {
  await page.getByLabel(EDITOR_TEXT.fileInput).setInputFiles({ name, mimeType: 'text/plain', buffer: Buffer.from(content) })
}

// A download of a WebAssembly file itself (the dev server also serves `.wasm?import&url` modules
// that only hold its URL; they load lazily too). In the worker, Emscripten falls back to a
// synchronous XHR when a fetch of the runtime fails, so both request types count.
const isWasm = (request: Request) => ['fetch', 'xhr'].includes(request.resourceType()) && new URL(request.url()).pathname.endsWith('.wasm')

// One invalid snippet per checked language, with its first error.
const invalidCase = [
  { language: 'Python', code: 'def area(r)\n    return 3.14 * r * r\n', line: 1, column: 11, message: SYNTAX_TEXT.missing(':') },
  { language: 'Go', code: 'package main\n\nfunc main() {\n\tx := 1\n', line: 4, column: 7, message: SYNTAX_TEXT.missing('}') },
  { language: 'Java', code: 'class A {\n  void f() {\n    int x = 1\n  }\n}\n', line: 3, column: 13, message: SYNTAX_TEXT.missing(';') }
]

const validCode: Record<string, string> = {
  Python: 'def area(r):\n    return 3.14 * r * r\n',
  Go: 'package main\n\nfunc main() {\n\tx := 1\n\t_ = x\n}\n',
  Java: 'class A {\n  void f() {\n    int x = 1;\n  }\n}\n',
  TypeScript: 'const total: number = [1, 2].reduce((sum, item) => sum + item, 0)\n',
  JavaScript: 'const total = [1, 2].reduce((sum, item) => sum + item, 0)\n'
}

for (const item of invalidCase) {
  test(`${item.language}: invalid code shows a squiggle with the hover message`, async ({ page }) => {
    await openNew(page)
    await languageSelect(page).selectOption(item.language)
    await setCode(page, item.code)
    await expect.poll(() => markerList(page, SYNTAX_MARKER_OWNER), CHECK_WAIT).toHaveLength(1)
    const [marker] = await markerList(page, SYNTAX_MARKER_OWNER)
    expect(marker).toMatchObject({ message: item.message, startLineNumber: item.line, startColumn: item.column, source: 'Syntax' })
    await expect(squiggle(page).first()).toBeVisible()
    await expect(await showHoverAt(page, item.line, item.column)).toContainText(item.message)
  })
}

for (const [language, message] of [
  ['TypeScript', "')' expected"],
  ['JavaScript', "')' expected"]
]) {
  test(`${language}: Monaco marks a syntax error with a squiggle and its hover message`, async ({ page }) => {
    await openNew(page)
    await languageSelect(page).selectOption(language)
    await setCode(page, 'const total = (1 + 2\n')
    const owner = language.toLowerCase()
    await expect.poll(async () => (await markerList(page, owner)).length, CHECK_WAIT).toBeGreaterThan(0)
    await expect(squiggle(page).first()).toBeVisible()
    const [marker] = await markerList(page, owner)
    await expect(await showHoverAt(page, marker.startLineNumber, marker.startColumn)).toContainText(message)
  })

  test(`${language}: an undefined name shows no squiggle (semantic errors are off)`, async ({ page }) => {
    await openNew(page)
    await languageSelect(page).selectOption(language)
    await setCode(page, 'import { thing } from "./missing"\nconsole.log(undefinedName, thing.value)\n')
    await page.waitForTimeout(3000)
    expect(await markerList(page)).toEqual([])
    await expect(squiggle(page)).toHaveCount(0)
    // A syntax error in the same code is still marked.
    await setCode(page, 'import { thing } from "./missing"\nconsole.log(undefinedName, thing.value\n')
    await expect.poll(async () => (await markerList(page, language.toLowerCase())).length, CHECK_WAIT).toBeGreaterThan(0)
    await expect(squiggle(page).first()).toBeVisible()
  })
}

for (const [language, code] of Object.entries(validCode)) {
  test(`${language}: valid code shows no squiggle`, async ({ page }) => {
    await openNew(page)
    await languageSelect(page).selectOption(language)
    await setCode(page, code)
    await page.waitForTimeout(3000)
    expect(await markerList(page)).toEqual([])
    await expect(squiggle(page)).toHaveCount(0)
  })
}

test('switching the language checks the same code with the new grammar', async ({ page }) => {
  await openNew(page)
  await languageSelect(page).selectOption('Python')
  await setCode(page, validCode.Python)
  await page.waitForTimeout(SYNTAX_CHECK_DELAY_MS + 1500)
  expect(await markerList(page, SYNTAX_MARKER_OWNER)).toEqual([])
  await languageSelect(page).selectOption('Java')
  await expect.poll(async () => (await markerList(page, SYNTAX_MARKER_OWNER)).length, CHECK_WAIT).toBeGreaterThan(0)
  await expect(squiggle(page).first()).toBeVisible()
  await languageSelect(page).selectOption('Python')
  await expect.poll(() => markerList(page, SYNTAX_MARKER_OWNER), CHECK_WAIT).toEqual([])
  await expect(squiggle(page)).toHaveCount(0)
})

test('fixing the error removes the squiggle within a second of the last key', async ({ page }) => {
  await openNew(page)
  await languageSelect(page).selectOption('Python')
  await setCode(page, 'x = (1, 2\n')
  await expect.poll(() => markerList(page, SYNTAX_MARKER_OWNER), CHECK_WAIT).toHaveLength(1)
  await page.evaluate(() => {
    const editor = (window as unknown as W).monaco.editor.getEditors()[0]
    editor.focus()
    editor.setPosition({ lineNumber: 1, column: 10 })
  })
  await page.keyboard.type(')')
  await expect(viewLines(page)).toContainText('x = (1, 2)')
  await expect.poll(() => markerList(page, SYNTAX_MARKER_OWNER), { timeout: 1000 }).toEqual([])
  await expect(squiggle(page)).toHaveCount(0)
})

test('no squiggle appears while typing faster than the debounce', async ({ page }) => {
  await openNew(page)
  await languageSelect(page).selectOption('Python')
  await setCode(page, 'x = 1\n')
  await page.waitForTimeout(SYNTAX_CHECK_DELAY_MS + 1500)
  await page.evaluate(() => {
    const editor = (window as unknown as W).monaco.editor.getEditors()[0]
    editor.focus()
    editor.setPosition({ lineNumber: 2, column: 1 })
  })
  // Each key comes 150 ms after the last, so the 400 ms wait never ends while typing.
  const countList: number[] = []
  for (const key of 'y = 1 + )') {
    await page.keyboard.type(key)
    countList.push((await markerList(page, SYNTAX_MARKER_OWNER)).length)
    await page.waitForTimeout(150)
  }
  expect(countList.every((count) => count === 0)).toBe(true)
  await expect.poll(async () => (await markerList(page, SYNTAX_MARKER_OWNER)).length, { timeout: 2000 }).toBeGreaterThan(0)
})

test('uploading a .py file with an error shows the squiggle, a valid one shows none', async ({ page }) => {
  await openNew(page)
  await uploadFile(page, 'area.py', invalidCase[0].code)
  await expect(languageSelect(page)).toHaveValue('Python')
  await expect.poll(() => markerList(page, SYNTAX_MARKER_OWNER), CHECK_WAIT).toHaveLength(1)
  await expect(squiggle(page).first()).toBeVisible()
  await uploadFile(page, 'area.py', validCode.Python)
  await expect.poll(() => markerList(page, SYNTAX_MARKER_OWNER), CHECK_WAIT).toEqual([])
  await expect(squiggle(page)).toHaveCount(0)
})

test('Run review stays enabled with a syntax error', async ({ page }) => {
  await openNew(page)
  await languageSelect(page).selectOption('Python')
  await setCode(page, invalidCase[0].code)
  await expect.poll(() => markerList(page, SYNTAX_MARKER_OWNER), CHECK_WAIT).toHaveLength(1)
  await expect(page.getByRole('button', { name: REVIEW_TEXT.runButton })).toBeEnabled()
})

test('finding markers and glyphs stay together with a syntax squiggle on another line', async ({ page, request }) => {
  const code = 'value = eval(user_input)\n# TODO remove the eval\nresult = (1, 2\n'
  const { id } = await createReview(request, { title: 'Syntax and findings', language: 'Python', content: code })
  await page.goto(`/review/${id}`)
  await expect(viewLines(page)).toBeVisible(MONACO_LOAD)
  await expect(languageSelect(page)).toHaveValue('Python')
  await expect.poll(async () => (await markerList(page, FINDING_MARKER_OWNER)).length, CHECK_WAIT).toBeGreaterThan(0)
  await expect.poll(() => markerList(page, SYNTAX_MARKER_OWNER), CHECK_WAIT).toHaveLength(1)
  const findingBefore = await markerList(page, FINDING_MARKER_OWNER)
  const glyphBefore = await page.locator('.editor-finding-glyph').count()
  expect(glyphBefore).toBeGreaterThan(0)
  const [syntax] = await markerList(page, SYNTAX_MARKER_OWNER)
  expect(syntax.startLineNumber).toBe(3)
  expect(findingBefore.every((marker) => marker.startLineNumber !== 3)).toBe(true)

  // A new syntax result leaves the findings alone.
  await page.waitForTimeout(SYNTAX_CHECK_DELAY_MS + 500)
  expect(await markerList(page, FINDING_MARKER_OWNER)).toEqual(findingBefore)
  expect(await page.locator('.editor-finding-glyph').count()).toBe(glyphBefore)

  // A language switch re-checks the code; the finding markers are the page's, not the check's.
  await languageSelect(page).selectOption('Go')
  await expect.poll(async () => (await markerList(page, SYNTAX_MARKER_OWNER)).length, CHECK_WAIT).toBeGreaterThan(0)
  expect(await markerList(page, FINDING_MARKER_OWNER)).toEqual(findingBefore)
  await languageSelect(page).selectOption('Python')
  await expect.poll(() => markerList(page, SYNTAX_MARKER_OWNER), CHECK_WAIT).toHaveLength(1)
  expect(await markerList(page, FINDING_MARKER_OWNER)).toEqual(findingBefore)
  await expect.poll(() => page.locator('.editor-finding-glyph').count()).toBe(glyphBefore)
})

test('the grammars load lazily from the app itself, only the one needed, once', async ({ page }) => {
  const wasmList: string[] = []
  page.on('request', (request) => {
    if (isWasm(request)) wasmList.push(request.url())
  })
  const urlModuleList: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('.wasm?')) urlModuleList.push(request.url())
  })
  await openNew(page)
  await page.waitForTimeout(2000)
  expect(wasmList, 'first page load').toEqual([])
  expect(urlModuleList, 'first page load').toEqual([])

  await languageSelect(page).selectOption('Python')
  await setCode(page, 'x = )\n')
  await expect.poll(() => markerList(page, SYNTAX_MARKER_OWNER), CHECK_WAIT).toHaveLength(1)
  await languageSelect(page).selectOption('TypeScript')
  await languageSelect(page).selectOption('Python')
  await setCode(page, 'y = )\n')
  await expect.poll(async () => (await markerList(page, SYNTAX_MARKER_OWNER))[0]?.startColumn, CHECK_WAIT).toBe(5)

  const grammarList = wasmList.map((url) => new URL(url).pathname.split('/').pop() ?? '')
  expect(grammarList.filter((name) => name.includes('tree-sitter-python'))).toHaveLength(1)
  expect(grammarList.filter((name) => /tree-sitter-(go|java)/.test(name))).toEqual([])
  expect(grammarList.filter((name) => name.startsWith('web-tree-sitter'))).toHaveLength(1)
  expect(wasmList.every((url) => url.startsWith(FRONTEND_URL))).toBe(true)
})

test('a grammar that cannot load leaves the editor working, with no squiggle and one toast', async ({ page }) => {
  // Counts every toast with the message that is ever shown (a toast closes by itself after a while).
  await page.addInitScript((message) => {
    const counter = window as unknown as { syntaxToastCount: number }
    counter.syntaxToastCount = 0
    const seen = new WeakSet<Element>()
    new MutationObserver(() => {
      for (const toast of document.querySelectorAll('[data-sonner-toast]')) {
        if (seen.has(toast) || !toast.textContent?.includes(message)) continue
        seen.add(toast)
        counter.syntaxToastCount += 1
      }
    }).observe(document, { childList: true, subtree: true, characterData: true })
  }, ERROR_MESSAGE.syntaxCheck)
  const toastCount = () => page.evaluate(() => (window as unknown as { syntaxToastCount: number }).syntaxToastCount)
  await page.route(/tree-sitter-python[^/]*\.wasm/, (route) => (isWasm(route.request()) ? route.abort('blockedbyclient') : route.continue()))
  await openNew(page)
  await languageSelect(page).selectOption('Python')
  await setCode(page, 'x = )\n')
  await expect(toastList(page).filter({ hasText: ERROR_MESSAGE.syntaxCheck })).toHaveCount(1, CHECK_WAIT)
  expect(await markerList(page, SYNTAX_MARKER_OWNER)).toEqual([])
  await expect(squiggle(page)).toHaveCount(0)

  // Later checks (past the toast de-duplication) show no second toast, and typing still works.
  await page.waitForTimeout(2500)
  await page.evaluate(() => {
    const editor = (window as unknown as W).monaco.editor.getEditors()[0]
    editor.focus()
    editor.setPosition({ lineNumber: 2, column: 1 })
  })
  await page.keyboard.type('y = 2')
  await expect(viewLines(page)).toContainText('y = 2')
  await page.waitForTimeout(SYNTAX_CHECK_DELAY_MS + 1000)
  expect(await toastCount()).toBe(1)
  await expect(squiggle(page)).toHaveCount(0)
  // Another language still gets checked.
  await languageSelect(page).selectOption('Java')
  await expect.poll(async () => (await markerList(page, SYNTAX_MARKER_OWNER)).length, CHECK_WAIT).toBeGreaterThan(0)
  expect(await toastCount()).toBe(1)
})

// QA F2: the editable model has a .tsx path, so JSX in TypeScript code is not a syntax error.
const JSX_CODE = 'export function App({ name }: { name: string }) {\n  return <div className="app">Hello {name}</div>\n}\n'

test('TypeScript: valid JSX shows no squiggle, a syntax error inside JSX still does', async ({ page }) => {
  await openNew(page)
  await languageSelect(page).selectOption('TypeScript')
  await setCode(page, JSX_CODE)
  await page.waitForTimeout(3000)
  expect(await markerList(page)).toEqual([])
  await expect(squiggle(page)).toHaveCount(0)
  await setCode(page, 'export function App({ name }: { name: string }) {\n  return <div className="app">Hello {name</div>\n}\n')
  await expect.poll(async () => (await markerList(page, 'typescript')).length, CHECK_WAIT).toBeGreaterThan(0)
  await expect(squiggle(page).first()).toBeVisible()
})

test('an uploaded .tsx component shows no squiggle', async ({ page }) => {
  await openNew(page)
  await languageSelect(page).selectOption('Python')
  await uploadFile(page, 'App.tsx', JSX_CODE)
  await expect(languageSelect(page)).toHaveValue('TypeScript')
  await page.waitForTimeout(3000)
  expect(await markerList(page)).toEqual([])
  await expect(squiggle(page)).toHaveCount(0)
})

// QA F1: the parse runs in a Web Worker from the app's origin, so a 5 000-line file with an early
// error (tree-sitter's slowest case, about 170 ms of parsing) makes no long task on the page.
test('a large broken file is parsed in a worker, with no long task over 100 ms on the page', async ({ page }) => {
  const workerList: string[] = []
  page.on('worker', (worker) => workerList.push(worker.url()))
  await openNew(page)
  expect(workerList.filter((url) => url.includes('syntax'))).toEqual([])
  await languageSelect(page).selectOption('Python')
  const code = await page.evaluate(() => {
    let text = 'x = (1,\n'
    for (let index = 0; text.split('\n').length < 5000; index += 1) {
      text += `def f${index}(a, b):\n    if a > b:\n        return [x * 2 for x in range(a)]\n    return {"k": (a, b)}\n\n`
    }
    return text.slice(0, 100_000)
  })
  await setCode(page, code)
  await expect.poll(async () => (await markerList(page, SYNTAX_MARKER_OWNER))[0]?.startColumn, CHECK_WAIT).toBe(5)
  const syntaxWorker = workerList.filter((url) => url.includes('syntax'))
  expect(syntaxWorker).toHaveLength(1)
  expect(syntaxWorker[0].startsWith(FRONTEND_URL)).toBe(true)
  // Let Monaco finish coloring the new text before measuring.
  await page.waitForTimeout(3000)
  await page.evaluate(() => {
    const store = window as unknown as { longTaskList: number[] }
    store.longTaskList = []
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) store.longTaskList.push(entry.duration)
    }).observe({ type: 'longtask' })
  })
  // One key at the start of line 1 moves the first error by one column: a new check of the whole file.
  await page.evaluate(() => {
    const editor = (window as unknown as W).monaco.editor.getEditors()[0]
    editor.focus()
    editor.setPosition({ lineNumber: 1, column: 1 })
  })
  await page.keyboard.type('y')
  await expect.poll(async () => (await markerList(page, SYNTAX_MARKER_OWNER))[0]?.startColumn, CHECK_WAIT).toBe(6)
  const longTaskList = await page.evaluate(() => (window as unknown as { longTaskList: number[] }).longTaskList)
  expect(longTaskList.filter((duration) => duration > 100)).toEqual([])
})
