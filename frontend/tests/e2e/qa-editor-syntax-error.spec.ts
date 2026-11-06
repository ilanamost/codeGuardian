import type { Page, Request, Route } from '@playwright/test'
import { EDITOR_TEXT, FINDING_MARKER_OWNER, REVIEW_TEXT, SYNTAX_CHECK_DELAY_MS, SYNTAX_LIMIT, SYNTAX_MARKER_OWNER, SYNTAX_TEXT } from '../../src/lib/review.constants'
import { ERROR_MESSAGE } from '../../src/utils/error-messages'
import { createReview, expect, MONACO_LOAD, test } from './fixture'
import { BACKEND_URL, FRONTEND_URL } from './e2e.constants'

// QA adversarial pass for plan 032 (editor syntax errors). Tries to break the debounce, the
// stale-result drop, the language switch, the coexistence with findings (also after Run review),
// drop and upload, the read-only Generated tests editor, lazy loading and the failure path.

type Marker = { owner: string; message: string; startLineNumber: number; startColumn: number; resource: { toString: () => string } }
type Model = { uri: { toString: () => string } }
type Ed = {
  focus: () => void
  setValue: (value: string) => void
  getModel: () => Model | null
  setPosition: (p: { lineNumber: number; column: number }) => void
  getRawOptions: () => { readOnly?: boolean }
}
type W = { monaco: { editor: { getEditors: () => Ed[]; getModelMarkers: (filter: { owner?: string; resource?: unknown }) => Marker[] } } }

const viewLines = (page: Page) => page.locator('.monaco-editor .view-lines').first()
const languageSelect = (page: Page) => page.getByRole('combobox', { name: 'Language' })
const runButton = (page: Page) => page.getByRole('button', { name: REVIEW_TEXT.runButton })
const CHECK_WAIT = { timeout: 20_000 }

// Syntax markers of the editable editor's model only (the Review page can hold two editors).
const syntaxList = (page: Page, owner = SYNTAX_MARKER_OWNER) =>
  page.evaluate((filterOwner) => {
    const { editor } = (window as unknown as W).monaco
    const main = editor.getEditors().find((item) => !item.getRawOptions().readOnly)
    const uri = main?.getModel()?.uri.toString()
    return editor
      .getModelMarkers({ owner: filterOwner })
      .filter((marker) => marker.resource.toString() === uri)
      .map(({ message, startLineNumber, startColumn }) => ({ message, startLineNumber, startColumn }))
  }, owner)

const setCode = (page: Page, code: string) =>
  page.evaluate((value) => {
    const main = (window as unknown as W).monaco.editor.getEditors().find((item) => !item.getRawOptions().readOnly)
    main?.setValue(value)
  }, code)

async function openNew(page: Page) {
  await page.goto('/review/new')
  await expect(viewLines(page)).toBeVisible(MONACO_LOAD)
}

// Plan 032 F1: the check runs in a worker, where Emscripten falls back to a synchronous XHR when a
// fetch of the runtime fails, so a blocked download covers both request types.
const isWasm = (request: Request) => new URL(request.url()).pathname.endsWith('.wasm') && ['fetch', 'xhr'].includes(request.resourceType())
const grammarName = (url: string) => /(tree-sitter-(python|go|java)|web-tree-sitter)/.exec(new URL(url).pathname)?.[1] ?? ''

// Holds every download of a grammar until release() (to put a check in flight).
async function holdGrammar(page: Page, pattern: RegExp) {
  let release: () => void = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route(pattern, async (route: Route) => {
    if (!isWasm(route.request())) return route.continue()
    await gate
    return route.continue()
  })
  return release
}

test('a result for an older version is dropped even when its check was in flight', async ({ page }) => {
  const release = await holdGrammar(page, /tree-sitter-python[^/]*\.wasm/)
  await openNew(page)
  await languageSelect(page).selectOption('Python')
  await setCode(page, 'x = )\n')
  // The debounce ends and the check waits on the held grammar.
  await page.waitForTimeout(SYNTAX_CHECK_DELAY_MS + 600)
  await setCode(page, 'x = 1\n')
  release()
  await page.waitForTimeout(SYNTAX_CHECK_DELAY_MS + 2500)
  expect(await syntaxList(page)).toEqual([])
  // And the other way round: the newest (invalid) code wins.
  await setCode(page, 'x = 1\n')
  await page.waitForTimeout(100)
  await setCode(page, 'y = (\n')
  await expect.poll(() => syntaxList(page), CHECK_WAIT).toEqual([{ message: SYNTAX_TEXT.unclosed('(', ')'), startLineNumber: 1, startColumn: 5 }])
})

test('a language switch clears the old marks at once, before the new check', async ({ page }) => {
  await openNew(page)
  await languageSelect(page).selectOption('Python')
  // Invalid in Python and in Java.
  await setCode(page, 'x = )\n')
  await expect.poll(async () => (await syntaxList(page)).length, CHECK_WAIT).toBe(1)
  await languageSelect(page).selectOption('Java')
  // Well inside the 400 ms debounce: the Python marks must already be gone.
  expect(await syntaxList(page)).toEqual([])
  await expect.poll(async () => (await syntaxList(page)).length, CHECK_WAIT).toBeGreaterThan(0)
  await languageSelect(page).selectOption('TypeScript')
  expect(await syntaxList(page)).toEqual([])
  await page.waitForTimeout(SYNTAX_CHECK_DELAY_MS + 1500)
  expect(await syntaxList(page)).toEqual([])
})

test('rapid language switches check only the last language and load no grammar of the skipped ones', async ({ page }) => {
  const wasmList: string[] = []
  page.on('request', (request) => {
    if (isWasm(request)) wasmList.push(grammarName(request.url()))
  })
  await openNew(page)
  await setCode(page, 'x = )\n')
  for (const language of ['Python', 'Go', 'Java', 'Go', 'Python', 'Java']) {
    await languageSelect(page).selectOption(language)
    await page.waitForTimeout(80)
  }
  await expect.poll(async () => (await syntaxList(page)).length, CHECK_WAIT).toBeGreaterThan(0)
  await page.waitForTimeout(1000)
  expect(wasmList.sort()).toEqual(['tree-sitter-java', 'web-tree-sitter'])
})

test('rapid typing in bursts: a mark never lingers after the code was fixed', async ({ page }) => {
  await openNew(page)
  await languageSelect(page).selectOption('Python')
  await setCode(page, 'x = 1\n')
  await page.evaluate(() => {
    const main = (window as unknown as W).monaco.editor.getEditors()[0]
    main.focus()
    main.setPosition({ lineNumber: 2, column: 1 })
  })
  for (let round = 0; round < 5; round++) {
    await page.keyboard.type('y = (', { delay: 10 })
    await page.waitForTimeout(SYNTAX_CHECK_DELAY_MS + 300)
    await page.keyboard.type('1)', { delay: 10 })
    await page.keyboard.press('Enter')
  }
  await expect.poll(() => syntaxList(page), { timeout: 2000 }).toEqual([])
})

test('20 syntax marks at most in the editor', async ({ page }) => {
  await openNew(page)
  await languageSelect(page).selectOption('Java')
  const body = Array.from({ length: 40 }, (_, i) => `    int x${i} = ${i}`).join('\n')
  await setCode(page, `class A {\n  void f() {\n${body}\n  }\n}\n`)
  await expect.poll(async () => (await syntaxList(page)).length, CHECK_WAIT).toBe(SYNTAX_LIMIT.markMax)
})

test('a dropped invalid .py file shows the squiggle; a dropped valid one clears it', async ({ page }) => {
  await openNew(page)
  const drop = (name: string, content: string) =>
    page.evaluate(
      ({ name, content }) => {
        const transfer = new DataTransfer()
        transfer.items.add(new File([content], name, { type: 'text/plain' }))
        const target = document.querySelector('.monaco-editor') as Element
        target.dispatchEvent(new DragEvent('dragover', { dataTransfer: transfer, bubbles: true, cancelable: true }))
        target.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }))
      },
      { name, content }
    )
  await drop('area.py', 'def area(r)\n    return r\n')
  await expect(languageSelect(page)).toHaveValue('Python')
  await expect.poll(() => syntaxList(page), CHECK_WAIT).toEqual([{ message: SYNTAX_TEXT.missing(':'), startLineNumber: 1, startColumn: 11 }])
  await expect(page.locator('.monaco-editor .squiggly-error').first()).toBeVisible()
  await drop('area.py', 'def area(r):\n    return r\n')
  await expect.poll(() => syntaxList(page), CHECK_WAIT).toEqual([])
})

test('an uploaded invalid .java and .go file are marked right after loading', async ({ page }) => {
  await openNew(page)
  const upload = (name: string, content: string) =>
    page.getByLabel(EDITOR_TEXT.fileInput).setInputFiles({ name, mimeType: 'text/plain', buffer: Buffer.from(content) })
  await upload('A.java', 'class A {\n  int x = 1\n}\n')
  await expect(languageSelect(page)).toHaveValue('Java')
  await expect.poll(() => syntaxList(page), CHECK_WAIT).toEqual([{ message: SYNTAX_TEXT.missing(';'), startLineNumber: 2, startColumn: 11 }])
  await upload('main.go', 'package main\n}\n')
  await expect(languageSelect(page)).toHaveValue('Go')
  await expect.poll(() => syntaxList(page), CHECK_WAIT).toEqual([{ message: SYNTAX_TEXT.unexpected('}'), startLineNumber: 2, startColumn: 1 }])
})

test('the read-only Generated tests editor never gets syntax marks (its Python test file is not valid Python)', async ({ page, request }) => {
  const { id } = await createReview(request, { title: 'QA read-only', language: 'Python', content: 'x = 1\n' })
  await page.goto(`/review/${id}`)
  await expect(viewLines(page)).toBeVisible(MONACO_LOAD)
  await page.getByRole('tab', { name: /Generated tests/ }).click()
  await expect(page.locator('.monaco-editor .view-lines').filter({ hasText: 'Stub generated test' }).first()).toBeVisible(MONACO_LOAD)
  await page.waitForTimeout(SYNTAX_CHECK_DELAY_MS + 3000)
  const readOnlyMarker = await page.evaluate((owner) => {
    const { editor } = (window as unknown as W).monaco
    const readOnlyUri = editor
      .getEditors()
      .filter((item) => item.getRawOptions().readOnly)
      .map((item) => item.getModel()?.uri.toString())
    return editor.getModelMarkers({ owner }).filter((marker) => readOnlyUri.includes(marker.resource.toString())).length
  }, SYNTAX_MARKER_OWNER)
  expect(readOnlyMarker).toBe(0)
  await expect(page.locator('.monaco-editor .squiggly-error')).toHaveCount(0)
})

test('after Run review, finding markers and the syntax squiggle are both still there', async ({ page, request }) => {
  const code = 'value = eval(user_input)\n# TODO remove the eval\nresult = (1, 2\n'
  const { id } = await createReview(request, { title: 'QA run with syntax', language: 'Python', content: code })
  await page.goto(`/review/${id}`)
  await expect(viewLines(page)).toBeVisible(MONACO_LOAD)
  await expect.poll(async () => (await syntaxList(page, FINDING_MARKER_OWNER)).length, CHECK_WAIT).toBeGreaterThan(0)
  await expect.poll(async () => (await syntaxList(page)).length, CHECK_WAIT).toBe(1)
  // An edit makes Run review available; the syntax error stays.
  await viewLines(page).click()
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.insertText('z = 1\n')
  await expect(runButton(page)).toBeEnabled()
  await runButton(page).click()
  await expect(page.getByText('Completed', { exact: true })).toBeVisible(CHECK_WAIT)
  await expect.poll(async () => (await syntaxList(page, FINDING_MARKER_OWNER)).length, CHECK_WAIT).toBeGreaterThan(0)
  await expect.poll(() => syntaxList(page), CHECK_WAIT).toEqual([{ message: SYNTAX_TEXT.unclosed('(', ')'), startLineNumber: 3, startColumn: 10 }])
  await expect.poll(() => page.locator('.editor-finding-glyph').count()).toBeGreaterThan(0)
})

test('TypeScript: a type error and a missing module show no squiggle; a syntax error does', async ({ page }) => {
  await openNew(page)
  await languageSelect(page).selectOption('TypeScript')
  await setCode(page, 'import { x } from "nowhere"\nconst count: number = "text"\nconst y: Foo = x.bar()\n')
  await page.waitForTimeout(3500)
  expect(await syntaxList(page, 'typescript')).toEqual([])
  await expect(page.locator('.monaco-editor .squiggly-error')).toHaveCount(0)
  await setCode(page, 'const count: number = "text"\nfunction f( {\n')
  await expect.poll(async () => (await syntaxList(page, 'typescript')).length, CHECK_WAIT).toBeGreaterThan(0)
})

// Plan question: does JSX false-alarm? A snippet of a React component pasted with the language
// set to TypeScript or JavaScript (an uploaded .tsx/.jsx file maps to these languages too).
// QA finding F2 (pre-existing since plan 027, kept by plan 032), fixed: the editable model now has
// a .tsx path (EDITOR_MODEL_PATH), so TypeScript accepts JSX as JavaScript does.
for (const language of ['TypeScript', 'JavaScript']) {
  test(`${language}: JSX in a pasted component is not marked as a syntax error`, async ({ page }) => {
    await openNew(page)
    await languageSelect(page).selectOption(language)
    await setCode(page, 'export function App() {\n  return <div className="app">Hello {name}</div>\n}\n')
    await page.waitForTimeout(3500)
    expect(await syntaxList(page, language.toLowerCase())).toEqual([])
  })
}

test('every grammar and runtime request goes to the app origin; no third-party host other than the Monaco CDN', async ({ page }) => {
  const hostList = new Set<string>()
  const wasmUrlList: string[] = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.protocol.startsWith('http')) hostList.add(url.origin)
    if (/tree-sitter/.test(url.pathname)) wasmUrlList.push(request.url())
  })
  await openNew(page)
  for (const [language, code] of [
    ['Python', 'x = )\n'],
    ['Go', 'package main\n}\n'],
    ['Java', 'class A {\n}\n}\n']
  ]) {
    await languageSelect(page).selectOption(language)
    await setCode(page, code)
    await expect.poll(async () => (await syntaxList(page)).length, CHECK_WAIT).toBeGreaterThan(0)
  }
  expect(wasmUrlList.length).toBeGreaterThan(0)
  expect(wasmUrlList.every((url) => url.startsWith(`${FRONTEND_URL}/`))).toBe(true)
  // The dev server also serves `.wasm?import&url` modules (the URL only); count the downloads.
  const grammarDownload = wasmUrlList.filter((url) => new URL(url).pathname.endsWith('.wasm') && !new URL(url).search)
  expect(grammarDownload.map(grammarName).sort()).toEqual(['tree-sitter-go', 'tree-sitter-java', 'tree-sitter-python', 'web-tree-sitter'])
  const thirdParty = [...hostList].filter((origin) => origin !== FRONTEND_URL && origin !== BACKEND_URL)
  expect(thirdParty.every((origin) => origin === 'https://cdn.jsdelivr.net')).toBe(true)
})

test('a blocked runtime: no marks in any language, exactly one toast, the editor still edits', async ({ page }) => {
  await page.addInitScript((message) => {
    const counter = window as unknown as { qaToast: number }
    counter.qaToast = 0
    const seen = new WeakSet<Element>()
    new MutationObserver(() => {
      for (const toast of document.querySelectorAll('[data-sonner-toast]')) {
        if (seen.has(toast) || !toast.textContent?.includes(message)) continue
        seen.add(toast)
        counter.qaToast += 1
      }
    }).observe(document, { childList: true, subtree: true, characterData: true })
  }, ERROR_MESSAGE.syntaxCheck)
  await page.route(/web-tree-sitter[^/]*\.wasm/, (route) => (isWasm(route.request()) ? route.abort('blockedbyclient') : route.continue()))
  await openNew(page)
  for (const language of ['Python', 'Go', 'Java']) {
    await languageSelect(page).selectOption(language)
    await setCode(page, 'x = )\n}\n')
    await page.waitForTimeout(SYNTAX_CHECK_DELAY_MS + 1500)
    expect(await syntaxList(page)).toEqual([])
  }
  expect(await page.evaluate(() => (window as unknown as { qaToast: number }).qaToast)).toBe(1)
  await expect(page.locator('.monaco-editor .squiggly-error')).toHaveCount(0)
  await viewLines(page).click()
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.type('still typing')
  await expect(viewLines(page)).toContainText('still typing')
  await expect(runButton(page)).toBeVisible()
})
