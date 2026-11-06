import type { Page } from '@playwright/test'
import { EDITOR_TEXT, FINDING_MARKER_OWNER } from '../../src/lib/review.constants'
import { createReview, expect, MONACO_LOAD, test } from './fixture'

// QA round 2 for plan 027 Revision 1: tries to break the F1, F2 and F3 fixes and the feature trim.
const viewLines = (page: Page) => page.locator('.monaco-editor .view-lines').first()
const languageSelect = (page: Page) => page.getByRole('combobox', { name: 'Language' })

type Ed = {
  getModel: () => Mo
  setPosition: (p: { lineNumber: number; column: number }) => void
  trigger: (s: string, id: string, a?: unknown) => void
  getSelections: () => unknown[]
  focus: () => void
  getAction: (id: string) => unknown
}
type Mo = { getValue: () => string; getEOL: () => string; getLineCount: () => number }
type W = { monaco: { editor: { getEditors: () => Ed[]; getModels: () => Mo[]; getModelMarkers: (f: object) => { owner: string; startLineNumber: number; startColumn: number; message: string }[] } } }

const modelValue = (page: Page) => page.evaluate(() => (window as unknown as W).monaco.editor.getModels()[0]?.getValue())

async function uploadFile(page: Page, name: string, content: string) {
  await page.getByLabel(EDITOR_TEXT.fileInput).setInputFiles({ name, mimeType: 'text/plain', buffer: Buffer.from(content) })
}

async function openNew(page: Page) {
  await page.goto('/review/new')
  await expect(viewLines(page)).toBeVisible(MONACO_LOAD)
}

async function setTheme(page: Page, theme: 'Light' | 'Dark') {
  await page.goto('/settings')
  await page.getByRole('tab', { name: 'Appearance' }).click()
  await page.getByRole('radio', { name: theme }).check()
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme.toLowerCase())
}

// ---------- F1 ----------
// Removed in Revision 3: Monaco loads from the CDN again, so there is no bundled lazy load and
// no load-failure screen to test.

// ---------- F2 ----------

for (const theme of ['Light', 'Dark'] as const) {
  test(`R2 F2: every severity class paints its token color in the ${theme} theme, and real findings show dots`, async ({ page, request }) => {
    await setTheme(page, theme)
    const { id } = await createReview(request, { title: `R2 glyph ${theme}` })
    await page.goto(`/review/${id}`)
    const glyph = page.locator('.monaco-editor .editor-finding-glyph')
    await expect.poll(() => glyph.count()).toBeGreaterThan(0)

    const result = await page.evaluate(() => {
      const tokenColor = (name: string) => {
        const probe = document.createElement('div')
        probe.style.backgroundColor = `var(${name})`
        document.body.append(probe)
        const color = getComputedStyle(probe).backgroundColor
        probe.remove()
        return color
      }
      const margin = document.querySelector('.monaco-editor .glyph-margin-widgets') ?? document.querySelector('.monaco-editor') as Element
      const dot = (severity: string) => {
        const el = document.createElement('div')
        el.className = `cgmr codicon editor-finding-glyph editor-finding-glyph-${severity}`
        el.setAttribute('style', 'position:absolute;width:18px;height:18px')
        margin.append(el)
        const before = getComputedStyle(el, '::before')
        const out = { color: before.backgroundColor, width: before.width, height: before.height, content: before.content }
        el.remove()
        return out
      }
      const real = Array.from(document.querySelectorAll('.monaco-editor .editor-finding-glyph')).map((el) => ({
        className: el.className,
        color: getComputedStyle(el, '::before').backgroundColor,
        width: getComputedStyle(el, '::before').width
      }))
      return {
        token: { critical: tokenColor('--color-critical'), medium: tokenColor('--color-medium'), low: tokenColor('--color-low') },
        dot: { critical: dot('critical'), high: dot('high'), medium: dot('medium'), low: dot('low'), info: dot('info') },
        real,
        codeBg: getComputedStyle(document.querySelector('.monaco-editor-background') as Element).backgroundColor
      }
    })
    expect(result.dot.critical.color).toBe(result.token.critical)
    expect(result.dot.high.color).toBe(result.token.critical)
    expect(result.dot.medium.color).toBe(result.token.medium)
    expect(result.dot.low.color).toBe(result.token.low)
    expect(result.dot.info.color).toBe(result.token.low)
    for (const severity of Object.values(result.dot)) {
      expect(severity.width).toBe('8px')
      expect(severity.height).toBe('8px')
    }
    expect(new Set([result.token.critical, result.token.medium, result.token.low]).size).toBe(3)
    for (const real of result.real) {
      expect(real.color, real.className).not.toBe('rgba(0, 0, 0, 0)')
      expect(real.color).not.toBe(result.codeBg)
      expect(real.width).toBe('8px')
    }
  })
}

// ---------- F3 ----------

test('R2 F3: typing 60 keys with no delay right after a large LF upload loses nothing and keeps the cursor', async ({ page }) => {
  await openNew(page)
  const many = Array.from({ length: 900 }, (_, i) => `function f${i}(a: number): string { return "v${i}" } // c${i}`).join('\n')
  for (const eol of ['\n', '\r\n']) {
    const content = `${many}\n`.replace(/\n/g, eol)
    await uploadFile(page, `big${eol.length}.ts`, content)
    await expect(viewLines(page)).toContainText('function f0')
    await viewLines(page).click()
    await page.keyboard.press('ControlOrMeta+Home')
    const typed = 'const typedQuicklyAfterUpload = 123456789 + 987654321 / 2;'
    const start = Date.now()
    await page.keyboard.type(typed)
    await expect.poll(() => modelValue(page), { timeout: 15000 }).toBe(`${typed}${many}\n`)
    const ms = Date.now() - start
    console.log(`R2 large typing eol=${JSON.stringify(eol)}: ${typed.length} keys settled in ${ms} ms`)
    expect(ms).toBeLessThan(6000)
  }
})

test('R2 F3: IME composition input is committed once and in place', async ({ page }) => {
  await openNew(page)
  await uploadFile(page, 'ime.ts', 'const a = 1\n')
  await expect(viewLines(page)).toContainText('const a = 1')
  await viewLines(page).click()
  await page.keyboard.press('ControlOrMeta+Home')
  const cdp = await page.context().newCDPSession(page)
  for (const step of ['n', 'ni', 'nih', 'niho', 'nihon']) {
    await cdp.send('Input.imeSetComposition', { text: step, selectionStart: step.length, selectionEnd: step.length })
  }
  await cdp.send('Input.insertText', { text: '日本' })
  await page.keyboard.type('X')
  await expect.poll(() => modelValue(page)).toBe('日本Xconst a = 1\n')
  // A re-render (language switch) keeps the committed text: page state matches the model.
  await languageSelect(page).selectOption('Python')
  await expect.poll(() => modelValue(page)).toBe('日本Xconst a = 1\n')
})

test('R2 F3: pasting a big block, then typing at once, keeps every character', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await openNew(page)
  const block = Array.from({ length: 1200 }, (_, i) => `let v${i} = ${i} // pasted`).join('\r\n')
  await page.evaluate((text) => navigator.clipboard.writeText(text), block)
  // QA round 4: in one full run the paste inserted nothing (only "END" arrived) while it passes
  // alone; the clipboard is shared state, so make sure it holds the block before pasting.
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText()), { message: 'clipboard holds the block' }).toBe(block)
  await viewLines(page).click()
  await page.keyboard.press('ControlOrMeta+V')
  await page.keyboard.type('END')
  const expected = `${block.replace(/\r\n/g, '\n')}END`
  await expect.poll(() => modelValue(page), { timeout: 15000 }).toBe(expected)
  await languageSelect(page).selectOption('Go')
  await expect.poll(() => modelValue(page)).toBe(expected)
})

test('R2 F3: undo and redo work and survive a re-render (page state stays in sync)', async ({ page }) => {
  await openNew(page)
  await uploadFile(page, 'undo.ts', 'const a = 1\n')
  await expect(viewLines(page)).toContainText('const a = 1')
  await viewLines(page).click()
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.type('abc')
  await expect.poll(() => modelValue(page)).toBe('const a = 1\nabc')
  await page.keyboard.press('ControlOrMeta+Z')
  await expect.poll(() => modelValue(page)).toBe('const a = 1\n')
  // Re-render: the wrapper must not push the old page value back.
  await languageSelect(page).selectOption('Java')
  await expect.poll(() => modelValue(page)).toBe('const a = 1\n')
  await page.locator('.monaco-editor textarea, .monaco-editor .native-edit-context').first().focus()
  await page.keyboard.press('ControlOrMeta+Y')
  await expect.poll(() => modelValue(page)).toBe('const a = 1\nabc')
  await languageSelect(page).selectOption('TypeScript')
  await expect.poll(() => modelValue(page)).toBe('const a = 1\nabc')
})

test('R2 F3: no React flushSync warning or error in the console while editing, uploading and switching reviews', async ({ page, request }) => {
  const problemList: string[] = []
  page.on('console', (message) => {
    if (['error', 'warning'].includes(message.type())) problemList.push(message.text().slice(0, 200))
  })
  page.on('pageerror', (error) => problemList.push(`pageerror ${error.message}`))
  const { id } = await createReview(request, { title: 'R2 console', content: 'const value: any = eval(input)\r\n// TODO remove\r\n' })
  await openNew(page)
  await uploadFile(page, 'c.ts', 'const a = 1\r\nconst b = 2\r\n')
  await viewLines(page).click()
  await page.keyboard.type('xyz')
  await page.goto(`/review/${id}`)
  await expect(viewLines(page)).toBeVisible(MONACO_LOAD)
  await viewLines(page).click()
  await page.keyboard.type('q')
  await page.getByRole('tab', { name: /Generated tests/ }).click()
  await expect(viewLines(page)).toBeVisible(MONACO_LOAD)
  await page.waitForTimeout(500)
  // Revision 3: the CDN Monaco (0.55.1, as before plan 027) rejects its own pending work with a
  // plain "Canceled" when an editor is disposed (tab switch). It happens with Shiki off as well,
  // never reaches window's unhandledrejection (so lib/ignoreMonacoCancel.ts cannot hide it) and
  // is harmless. Only that exact page error is allowed; every other one still fails.
  const monacoCancel = 'pageerror Canceled'
  expect(
    problemList.filter((text) => /flushSync|lifecycle|Maximum update|act\(|Warning:/i.test(text) || (text.startsWith('pageerror') && text !== monacoCancel))
  ).toEqual([])
})

// QA round 2 finding R2-1: CodeEditor calls flushSync in every Monaco onChange. When the wrapper
// itself changes the model inside its `[value]` effect (the read-only Generated tests editor gets
// new code from Regenerate; @monaco-editor/react uses setValue there), onChange fires during
// React's commit, and React logs "flushSync was called from inside a lifecycle method".
test('R2: Regenerate on the read-only Generated tests editor logs no React flushSync error', async ({ page, request }) => {
  const problemList: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error' && /flushSync/.test(message.text())) problemList.push(message.text().slice(0, 160))
  })
  const { id } = await createReview(request, { title: 'Auth Service' })
  await page.goto(`/review/${id}`)
  await page.getByRole('tab', { name: /Generated tests/ }).click()
  await expect(viewLines(page)).toContainText("describe('auth-service'")
  await page.getByRole('button', { name: 'Regenerate' }).click()
  await expect(viewLines(page)).toContainText('(regenerated)')
  await page.waitForTimeout(300)
  expect(problemList).toEqual([])
})

// QA round 2 finding R2-2: @shikijs/monaco stops a line after tokenizeTimeLimit (500 ms default)
// and logs "Time limit reached when tokenizing line". The JavaScript regex engine compiles a
// grammar's patterns on first use, so the FIRST line tokenized after load can pass the limit:
// the rest of that line keeps a wrong color (seen: `any = eval` and `input` all in the type color,
// or the whole line gray) until it is edited. It reproduced without throttling during the full
// suite; 4x CPU throttling (a mid-range laptop) makes it deterministic.
test('R2: the first line of a review is fully colored on a slower CPU', async ({ page, request }) => {
  test.setTimeout(90000)
  const warnList: string[] = []
  page.on('console', (message) => {
    if (/Time limit reached when tokenizing/.test(message.text())) warnList.push(message.text().slice(0, 100))
  })
  const { id } = await createReview(request, { title: 'R2 first line' })
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
  await page.goto(`/review/${id}`)
  await expect(viewLines(page)).toBeVisible({ timeout: 60000 })
  const tokenColor = (text: string) =>
    page
      .locator('.monaco-editor .view-line')
      .first()
      .locator('span > span')
      .evaluateAll((list, wanted) => {
        const span = list.find((element) => element.textContent?.replace(/ /g, ' ').trim() === wanted)
        return span ? getComputedStyle(span).color : null
      }, text)
  // `const` keyword, `eval` function name and `input` each get their own span and color.
  await expect.poll(() => tokenColor('eval'), { timeout: 10000 }).not.toBeNull()
  const colorList = [await tokenColor('const'), await tokenColor('eval'), await tokenColor('input')]
  expect(new Set(colorList).size, JSON.stringify(colorList)).toBe(3)
  expect(warnList).toEqual([])
})

// ---------- Editor features (the feature trim was reverted in Revision 3) ----------

test('R2 editor features: find, hover, folding, markers, copy/paste, multi-cursor, bracket matching and comment toggle still work', async ({ page, request, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  const { id } = await createReview(request, { title: 'R2 features' })
  await page.goto(`/review/${id}`)
  await expect(viewLines(page)).toBeVisible(MONACO_LOAD)
  await expect.poll(() => page.locator('.editor-finding-glyph').count()).toBeGreaterThan(0)

  // Markers: the finding markers (Revision 3: Monaco's own TypeScript diagnostics may sit next to
  // them, as before plan 027).
  const markerList = await page.evaluate((owner) => (window as unknown as W).monaco.editor.getModelMarkers({ owner }), FINDING_MARKER_OWNER)
  expect(markerList.length).toBeGreaterThan(0)
  expect(new Set(markerList.map((m) => m.owner))).toEqual(new Set([FINDING_MARKER_OWNER]))

  // Hover on a marker shows its message.
  await page.evaluate(({ line, column }) => {
    const editor = (window as unknown as W).monaco.editor.getEditors()[0]
    editor.focus()
    editor.setPosition({ lineNumber: line, column: column + 1 })
    editor.trigger('qa', 'editor.action.showHover')
  }, { line: markerList[0].startLineNumber, column: markerList[0].startColumn })
  await expect(page.locator('.monaco-hover').filter({ hasText: markerList[0].message.split('\n')[0] }).first()).toBeVisible(MONACO_LOAD)
  await page.keyboard.press('Escape')

  // Glyph hover shows the finding message too.
  await page.locator('.editor-finding-glyph').first().hover()
  await expect(page.locator('.monaco-hover:visible').first()).toBeVisible(MONACO_LOAD)
  await page.mouse.move(0, 0)

  // Fresh code for the editing features.
  await page.goto('/review/new')
  await expect(viewLines(page)).toBeVisible(MONACO_LOAD)
  await uploadFile(page, 'feat.ts', 'function a() {\n  return 1\n}\nfunction b() {\n  return 2\n}\n')
  await expect(viewLines(page)).toContainText('function b')
  await viewLines(page).click()

  // Find widget.
  await page.keyboard.press('ControlOrMeta+F')
  await expect(page.locator('.monaco-editor .find-widget.visible')).toBeVisible(MONACO_LOAD)
  await page.keyboard.press('Escape')

  // Folding.
  await page.evaluate(() => (window as unknown as W).monaco.editor.getEditors()[0].trigger('qa', 'editor.foldAll'))
  await expect.poll(() => page.locator('.monaco-editor .view-line').count()).toBeLessThan(6)
  await page.evaluate(() => (window as unknown as W).monaco.editor.getEditors()[0].trigger('qa', 'editor.unfoldAll'))
  await expect.poll(() => page.locator('.monaco-editor .view-line').count()).toBeGreaterThanOrEqual(6)

  // Bracket matching: cursor after `{` on line 1.
  await page.evaluate(() => {
    const editor = (window as unknown as W).monaco.editor.getEditors()[0]
    editor.focus()
    editor.setPosition({ lineNumber: 1, column: 15 })
  })
  await expect.poll(() => page.locator('.monaco-editor .bracket-match').count()).toBeGreaterThan(0)

  // Comment toggle on line 1.
  await page.evaluate(() => (window as unknown as W).monaco.editor.getEditors()[0].trigger('qa', 'editor.action.commentLine'))
  await expect.poll(() => modelValue(page)).toMatch(/^\/\/ function a\(\) \{/)
  await page.keyboard.press('ControlOrMeta+Z')
  await expect.poll(() => modelValue(page)).toMatch(/^function a\(\) \{/)

  // Multi-cursor: add a cursor below, type once, both lines change.
  await page.evaluate(() => {
    const editor = (window as unknown as W).monaco.editor.getEditors()[0]
    editor.setPosition({ lineNumber: 2, column: 1 })
    editor.trigger('qa', 'editor.action.insertCursorBelow')
  })
  expect(await page.evaluate(() => (window as unknown as W).monaco.editor.getEditors()[0].getSelections().length)).toBe(2)
  await page.keyboard.type('#')
  await expect.poll(() => modelValue(page)).toContain('#  return 1\n#}')
  await page.keyboard.press('Escape')

  // Copy / paste with the keyboard: select line 1, copy, paste at the end.
  await page.evaluate(() => {
    const editor = (window as unknown as W).monaco.editor.getEditors()[0]
    editor.setPosition({ lineNumber: 1, column: 1 })
  })
  await page.keyboard.press('Shift+End')
  await page.keyboard.press('ControlOrMeta+C')
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.press('ControlOrMeta+V')
  await expect.poll(() => modelValue(page)).toMatch(/\}\nfunction a\(\) \{$/)

  // Context menu opens (copy/paste entries come from it).
  await viewLines(page).click({ button: 'right' })
  await expect(page.locator('.context-view .monaco-menu, .monaco-menu-container').first()).toBeVisible(MONACO_LOAD)
  await page.keyboard.press('Escape')
})
