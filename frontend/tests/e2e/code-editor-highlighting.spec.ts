import type { Page } from '@playwright/test'
import { EDITOR_TEXT } from '../../src/lib/review.constants'
import { createReview, expect, test } from './fixture'

// Plan 027: Shiki colors the CDN-loaded Monaco with VS Code's grammars and one dark theme.
// The first page of a run can wait for the dev server's first transform and Monaco's CDN load.
const FIRST_LOAD_MS = 20000
const viewLines = (page: Page) => page.locator('.monaco-editor .view-lines').first()
const languageSelect = (page: Page) => page.getByRole('combobox', { name: 'Language' })

async function uploadFile(page: Page, name: string, content: string) {
  await page.getByLabel(EDITOR_TEXT.fileInput).setInputFiles({ name, mimeType: 'text/plain', buffer: Buffer.from(content) })
}

// The computed color of the first token span of the first editor whose text, trimmed, is `text`
// (null while there is none). Monaco renders spaces as non-breaking spaces.
function colorOf(page: Page, text: string): Promise<string | null> {
  return viewLines(page)
    .locator('span > span')
    .evaluateAll((list, wanted) => {
      const span = list.find((element) => element.textContent?.replace(/ /g, ' ').trim() === wanted)
      return span ? getComputedStyle(span).color : null
    }, text)
}

type Token = { keyword: string; type: string; functionName: string; string: string; comment: string; number: string; identifier: string }

type Sample = { language: string; fileName: string; content: string; token: Token }

const shared = { functionName: 'greet', type: 'User', string: '"hi"', number: '42', identifier: 'label' }

const sampleList: Sample[] = [
  {
    language: 'TypeScript',
    fileName: 'greet.ts',
    content: '// note\ninterface User { name: string }\nexport function greet(user: User): number {\n  const label = "hi"\n  return 42\n}\n',
    token: { ...shared, keyword: 'function', comment: '// note' }
  },
  {
    language: 'JavaScript',
    fileName: 'greet.js',
    content: '// note\nclass User {}\nexport function greet(user) {\n  let label = "hi"\n  return 42\n}\n',
    token: { ...shared, keyword: 'function', comment: '// note' }
  },
  {
    language: 'Python',
    fileName: 'greet.py',
    content: '# note\nclass User:\n    pass\n\ndef greet(user: User) -> int:\n    label = "hi"\n    return 42\n',
    token: { ...shared, keyword: 'def', comment: '# note' }
  },
  {
    language: 'Go',
    fileName: 'greet.go',
    content: '// note\ntype User struct{ Name string }\n\nfunc greet(user User) int {\n\tlabel := "hi"\n\treturn 42\n}\n',
    token: { ...shared, keyword: 'func', comment: '// note' }
  },
  {
    language: 'Java',
    fileName: 'Greet.java',
    content: '// note\npublic class User {\n  int greet(String name) {\n    String label = "hi";\n    return 42;\n  }\n}\n',
    token: { ...shared, keyword: 'public', comment: '// note' }
  }
]

async function colorByRole(page: Page, token: Token): Promise<Record<keyof Token, string>> {
  const color = {} as Record<keyof Token, string>
  for (const role of Object.keys(token) as (keyof Token)[]) {
    await expect.poll(() => colorOf(page, token[role]), { message: `${role} "${token[role]}" is shown` }).not.toBeNull()
    color[role] = (await colorOf(page, token[role])) as string
  }
  return color
}

test.describe('per-language highlighting', () => {
  for (const sample of sampleList) {
    test(`${sample.language}: keywords, strings, comments, numbers, function names and types each get their own color`, async ({
      page
    }) => {
      await page.goto('/review/new')
      await expect(viewLines(page)).toBeVisible({ timeout: FIRST_LOAD_MS })
      await uploadFile(page, sample.fileName, sample.content)
      await expect(languageSelect(page)).toHaveValue(sample.language)

      const color = await colorByRole(page, sample.token)
      const { identifier, ...distinct } = color
      // Six roles, six different colors.
      expect(new Set(Object.values(distinct)).size, JSON.stringify(color)).toBe(Object.keys(distinct).length)
      expect(color.functionName).not.toBe(identifier)
      expect(color.type).not.toBe(identifier)
    })
  }
})

test('switching the language on the same code recolors the language-specific tokens', async ({ page }) => {
  await page.goto('/review/new')
  await expect(viewLines(page)).toBeVisible({ timeout: FIRST_LOAD_MS })
  await uploadFile(page, 'main.go', 'func greet() int {\n\treturn 42\n}\n# note\n')
  await expect(languageSelect(page)).toHaveValue('Go')
  await expect.poll(() => colorOf(page, 'func')).not.toBeNull()
  const goFunc = await colorOf(page, 'func')

  await languageSelect(page).selectOption('Python')

  // `func` is a keyword in Go only; `# note` is a comment in Python only.
  await expect.poll(() => colorOf(page, 'func')).not.toBe(goFunc)
  await expect.poll(() => colorOf(page, '# note')).not.toBeNull()
  const pythonComment = await colorOf(page, '# note')
  await expect(viewLines(page)).toContainText('func greet() int {')

  await languageSelect(page).selectOption('Go')
  await expect.poll(() => colorOf(page, 'func')).toBe(goFunc)
  await expect.poll(() => colorOf(page, '# note')).not.toBe(pythonComment)
})

// Revision 3: Monaco loads from the CDN again, exactly as before plan 027.
test('the editor sits on the app code background, and Monaco loads from the CDN as before', async ({ page }) => {
  const cdnList: string[] = []
  page.on('request', (request) => {
    if (new URL(request.url()).hostname === 'cdn.jsdelivr.net') cdnList.push(request.url())
  })
  await page.goto('/review/new')
  await expect(viewLines(page)).toBeVisible({ timeout: FIRST_LOAD_MS })
  await uploadFile(page, 'a.ts', 'const a = 1\n')
  await expect(viewLines(page)).toContainText('const a = 1')

  const codeBg = await page.evaluate(() => {
    const probe = document.createElement('div')
    probe.className = 'bg-code-bg'
    document.body.append(probe)
    const color = getComputedStyle(probe).backgroundColor
    probe.remove()
    return color
  })
  const editorBg = await page.locator('.monaco-editor-background').first().evaluate((element) => getComputedStyle(element).backgroundColor)
  expect(editorBg).toBe(codeBg)
  expect(cdnList.some((url) => url.includes('/monaco-editor@'))).toBe(true)
})

// QA round 1, F2: the dots are drawn by plain classes (styles/basics/base.css), as Monaco breaks
// Tailwind variant classes apart. Each one is painted in its severity token color.
test('each finding glyph dot is painted in its severity color', async ({ page, request }) => {
  // The stub analyzer: `any` is medium, eval critical, TODO low, a hardcoded password high.
  const { id } = await createReview(request, {
    title: 'Glyph colors',
    content: 'const value: any = 1\neval(input)\n// TODO remove\nconst password = "hunter2"\n'
  })
  await page.goto(`/review/${id}`)
  const glyph = page.locator('.monaco-editor .editor-finding-glyph')
  await expect.poll(() => glyph.count()).toBe(4)

  const tokenColor = await page.evaluate(() =>
    Object.fromEntries(
      ['critical', 'medium', 'low'].map((token) => {
        const probe = document.createElement('div')
        probe.className = `bg-${token}`
        document.body.append(probe)
        const color = getComputedStyle(probe).backgroundColor
        probe.remove()
        return [token, color]
      })
    )
  )
  const dotColor = (severity: string) =>
    page.locator(`.monaco-editor .editor-finding-glyph-${severity}`).evaluate((element) => getComputedStyle(element, '::before').backgroundColor)

  expect(await dotColor('critical')).toBe(tokenColor.critical)
  expect(await dotColor('high')).toBe(tokenColor.critical)
  expect(await dotColor('medium')).toBe(tokenColor.medium)
  expect(await dotColor('low')).toBe(tokenColor.low)
  expect(new Set(Object.values(tokenColor)).size).toBe(3)
  const box = await glyph.first().evaluate((element) => {
    const style = getComputedStyle(element, '::before')
    return { width: style.width, height: style.height }
  })
  expect(box).toEqual({ width: '8px', height: '8px' })
})

test('the read-only Generated tests editor uses the same highlighting', async ({ page, request }) => {
  const { id } = await createReview(request, {
    title: 'Auth Service',
    content: 'export function load(input: string) {\n  return eval(input)\n}\n'
  })
  await page.goto(`/review/${id}`)
  await expect(viewLines(page)).toBeVisible({ timeout: FIRST_LOAD_MS })
  await expect.poll(() => colorOf(page, 'function')).not.toBeNull()
  const summaryKeyword = await colorOf(page, 'function')

  await page.getByRole('tab', { name: /Generated tests/ }).click()
  await expect(viewLines(page)).toContainText("describe('auth-service'")
  await expect.poll(() => colorOf(page, 'describe')).not.toBeNull()
  const functionName = await colorOf(page, 'describe')
  const string = await colorOf(page, "'auth-service'")
  expect(string).not.toBeNull()
  expect(new Set([summaryKeyword, functionName, string]).size).toBe(3)
})

// QA round 3, R3-1: the editor never waits for Shiki. With its request stalled, the editor works
// with Monaco's own vs-dark; when Shiki arrives, the same editor switches to the Shiki colors in
// place, keeping the code and the cursor, with the first line fully colored.
test('a stalled Shiki load never holds the editor back, and its late arrival recolors the same editor in place', async ({ page }) => {
  type Ed = { getPosition: () => { lineNumber: number; column: number } | null }
  type Mo = { getValue: () => string }
  type W = { monaco: { editor: { getEditors: () => Ed[]; getModels: () => Mo[] } } }
  let release = () => {}
  const released = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route(/shikiHighlight|@shikijs|\/shiki/, async (route) => {
    await released
    await route.continue()
  })
  await page.goto('/review/new')
  await expect(viewLines(page)).toBeVisible({ timeout: 20000 })
  const code = 'export function greet(user: User): number {\n  return 42 // done\n}\n'
  await uploadFile(page, 'greet.ts', code)
  await expect(viewLines(page)).toContainText('export function greet')

  // Monaco's own theme meanwhile: vs-dark background, and the function name is not colored.
  const editorBg = () => page.locator('.monaco-editor-background').first().evaluate((element) => getComputedStyle(element).backgroundColor)
  expect(await editorBg()).toBe('rgb(30, 30, 30)')
  const plainGreet = await colorOf(page, 'greet')

  // The user is editing when Shiki arrives: the cursor sits after a typed character.
  await viewLines(page).click()
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.type('x')
  const position = await page.evaluate(() => (window as unknown as W).monaco.editor.getEditors()[0].getPosition())
  await page.locator('.monaco-editor').first().evaluate((element) => element.setAttribute('data-qa-mounted', 'first'))

  release()
  await expect.poll(editorBg, { timeout: 15000 }).toBe('rgb(10, 18, 36)')
  // The first line is fully colored: keyword, declaration keyword, function name and type.
  await expect.poll(() => colorOf(page, 'greet')).toBe('rgb(220, 220, 170)')
  expect(plainGreet).not.toBe('rgb(220, 220, 170)')
  expect(await colorOf(page, 'export')).toBe('rgb(197, 134, 192)')
  expect(await colorOf(page, 'function')).toBe('rgb(86, 156, 214)')
  expect(await colorOf(page, 'User')).toBe('rgb(78, 201, 176)')

  // Same editor (not remounted), same code and cursor; typing goes on where it was.
  await expect(page.locator('.monaco-editor[data-qa-mounted="first"]')).toHaveCount(1)
  expect(await page.evaluate(() => (window as unknown as W).monaco.editor.getEditors()[0].getPosition())).toEqual(position)
  await page.keyboard.type('y')
  await expect.poll(() => page.evaluate(() => (window as unknown as W).monaco.editor.getModels()[0].getValue())).toBe(`${code}xy`)
})
