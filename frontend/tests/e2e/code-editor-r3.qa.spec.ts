import type { Page } from '@playwright/test'
import { EDITOR_TEXT } from '../../src/lib/review.constants'
import { createReview, expect, MONACO_LOAD, test } from './fixture'

// QA round 3 for plan 027 Revision 3 (CDN Monaco + Shiki in beforeMount, "add, never remove").
// Written so it also runs unchanged on a HEAD worktree: the parity tests must pass on both.
const viewLines = (page: Page) => page.locator('.monaco-editor .view-lines').first()
const languageSelect = (page: Page) => page.getByRole('combobox', { name: 'Language' })
const label = () => (test.info().config.rootDir.replace(/\\/g, '/').includes('qa-head') ? 'head' : 'branch')

type Mo = { getValue: () => string; getLanguageId: () => string }
type Ed = { focus: () => void; setPosition: (p: { lineNumber: number; column: number }) => void; trigger: (s: string, id: string, a?: unknown) => void }
type W = { monaco: { editor: { getEditors: () => Ed[]; getModels: () => Mo[]; getModelMarkers: (f: object) => { owner: string }[] } } }

const modelValue = (page: Page) => page.evaluate(() => (window as unknown as W).monaco.editor.getModels()[0]?.getValue())
const modelLanguage = (page: Page) => page.evaluate(() => (window as unknown as W).monaco.editor.getModels()[0]?.getLanguageId())

async function uploadFile(page: Page, name: string, content: string) {
  await page.getByLabel(EDITOR_TEXT.fileInput).setInputFiles({ name, mimeType: 'text/plain', buffer: Buffer.from(content) })
}

async function openNew(page: Page) {
  await page.goto('/review/new')
  await expect(viewLines(page)).toBeVisible({ timeout: 30000 })
}

// Realistic multi-line code of the kind a user pastes, one per language.
const REAL: Record<string, { file: string; code: string }> = {
  TypeScript: {
    file: 'user.service.ts',
    code: [
      "import { Injectable } from './di'",
      '',
      '// Loads users and caches them by id.',
      'export interface User {',
      '  id: number',
      '  name: string',
      '}',
      '',
      'export class UserService {',
      '  private cache = new Map<number, User>()',
      '',
      '  async load(id: number): Promise<User | undefined> {',
      '    if (this.cache.has(id)) return this.cache.get(id)',
      '    const response = await fetch(`/api/user/${id}`)',
      '    const user = (await response.json()) as User',
      '    this.cache.set(id, user)',
      '    return user',
      '  }',
      '}',
      ''
    ].join('\n')
  },
  JavaScript: {
    file: 'cart.js',
    code: [
      'const TAX = 0.17',
      '',
      '// Sums the cart with tax.',
      'export function total(items) {',
      '  let sum = 0',
      '  for (const item of items) {',
      '    sum += item.price * item.quantity',
      '  }',
      '  return Math.round(sum * (1 + TAX) * 100) / 100',
      '}',
      '',
      "console.log(total([{ price: 10, quantity: 2 }]), 'done')",
      ''
    ].join('\n')
  },
  Python: {
    file: 'report.py',
    code: [
      'import json',
      'from dataclasses import dataclass',
      '',
      '# Builds a summary report.',
      '@dataclass',
      'class Report:',
      '    title: str',
      '    count: int = 0',
      '',
      'def summarize(rows: list[dict]) -> Report:',
      '    report = Report(title="Summary")',
      '    for row in rows:',
      '        if row.get("ok"):',
      '            report.count += 1',
      '    return report',
      '',
      'print(json.dumps({"count": summarize([]).count}))',
      ''
    ].join('\n')
  },
  Go: {
    file: 'server.go',
    code: [
      'package main',
      '',
      'import (',
      '\t"fmt"',
      '\t"net/http"',
      ')',
      '',
      '// Handler answers with a greeting.',
      'type Handler struct {',
      '\tName string',
      '}',
      '',
      'func (h Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {',
      '\tfmt.Fprintf(w, "hello %s %d", h.Name, 42)',
      '}',
      '',
      'func main() {',
      '\thttp.ListenAndServe(":8080", Handler{Name: "go"})',
      '}',
      ''
    ].join('\n')
  },
  Java: {
    file: 'Account.java',
    code: [
      'package bank;',
      '',
      'import java.util.ArrayList;',
      'import java.util.List;',
      '',
      '// A bank account with a history.',
      'public class Account {',
      '    private final List<Integer> history = new ArrayList<>();',
      '    private int balance = 0;',
      '',
      '    public void deposit(int amount) {',
      '        if (amount <= 0) throw new IllegalArgumentException("amount");',
      '        balance += amount;',
      '        history.add(amount);',
      '    }',
      '',
      '    public int getBalance() { return balance; }',
      '}',
      ''
    ].join('\n')
  }
}
const LANGUAGES = Object.keys(REAL)
const MONACO_ID: Record<string, string> = { TypeScript: 'typescript', JavaScript: 'javascript', Python: 'python', Go: 'go', Java: 'java' }

// Color fingerprint of the visible code: token text and color, line by line.
function fingerprint(page: Page): Promise<string> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('.monaco-editor .view-lines .view-line'))
      .sort((a, b) => parseFloat((a as HTMLElement).style.top) - parseFloat((b as HTMLElement).style.top))
      .map((line) => {
        // What the user sees: runs of text in one color. Adjacent spans of the same color are
        // merged, as Monaco may split or join them differently without any visible change.
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

const colorCount = (page: Page) =>
  page.evaluate(
    () =>
      new Set(
        Array.from(document.querySelectorAll('.monaco-editor .view-lines span > span'))
          .filter((span) => span.textContent?.trim())
          .map((span) => getComputedStyle(span).color)
      ).size
  )

// Waits for the model language and for two equal fingerprints in a row (tokenization done).
async function settle(page: Page, monacoId: string) {
  await expect.poll(() => modelLanguage(page), { timeout: 15000 }).toBe(monacoId)
  // Monaco tokenizes in background slices: give it a moment before comparing snapshots.
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

async function shot(page: Page, name: string) {
  await page.locator('.monaco-editor').first().screenshot({ path: test.info().outputPath(`${label()}-${name}.png`) })
}

// ---------- Language switch: the reported problem ----------

for (const source of LANGUAGES) {
  test(`R3 switch: real ${source} code through all five languages and back`, async ({ page }) => {
    await openNew(page)
    await uploadFile(page, REAL[source].file, REAL[source].code)
    await expect(languageSelect(page)).toHaveValue(source)
    const print: Record<string, string> = {}
    const count: Record<string, number> = {}
    print[source] = await settle(page, MONACO_ID[source])
    count[source] = await colorCount(page)
    await shot(page, `${source}-as-${source}`)
    const others = LANGUAGES.filter((l) => l !== source)
    for (const target of [...others, ...others.slice(0, -1).reverse(), source]) {
      await languageSelect(page).selectOption(target)
      const now = await settle(page, MONACO_ID[target])
      if (print[target] === undefined) {
        print[target] = now
        count[target] = await colorCount(page)
        await shot(page, `${source}-as-${target}`)
      } else {
        expect(now, `${source} code back to ${target}`).toBe(print[target])
      }
    }
    // EOL-insensitive, so the same spec also runs on HEAD (whose model keeps CRLF on Windows).
    expect((await modelValue(page))?.replace(/\r\n/g, '\n')).toBe(REAL[source].code)
    console.log(`R3 ${label()} ${source} code: colors per language ${JSON.stringify(count)}; distinct fingerprints ${new Set(Object.values(print)).size}/5`)
    // VS Code's JavaScript grammar is generated from the TypeScript one: on code without JSX or
    // type syntax the two color identically. Every other pair must differ.
    for (const a of LANGUAGES) {
      for (const b of LANGUAGES) {
        if (a < b && !(a === 'JavaScript' && b === 'TypeScript')) expect(print[a], `${source} code: ${a} vs ${b}`).not.toBe(print[b])
      }
    }
    console.log(`R3 ${label()} ${source} code: TypeScript and JavaScript identical = ${print.TypeScript === print.JavaScript}`)
  })
}

test('R3 switch: on an existing review, right after load and after rapid switches', async ({ page, request }) => {
  const { id } = await createReview(request, { title: 'R3 switch', language: 'Python', content: REAL.Python.code })
  await page.goto(`/review/${id}`)
  await expect(viewLines(page)).toBeVisible({ timeout: 30000 })
  await expect(languageSelect(page)).toHaveValue('Python')
  const python = await settle(page, 'python')
  await languageSelect(page).selectOption('Go')
  const go = await settle(page, 'go')
  expect(go).not.toBe(python)
  for (const end of ['Java', 'Python', 'TypeScript', 'Go']) {
    for (const l of ['TypeScript', 'Go', 'Java', 'JavaScript', 'Python', 'Go', 'Java']) await languageSelect(page).selectOption(l)
    await languageSelect(page).selectOption(end)
    const now = await settle(page, MONACO_ID[end])
    if (end === 'Python') expect(now).toBe(python)
    if (end === 'Go') expect(now).toBe(go)
  }
})

// ---------- Nothing lost vs HEAD ----------

async function tsEditor(page: Page, code: string) {
  await openNew(page)
  await uploadFile(page, 'probe.ts', code)
  await expect(languageSelect(page)).toHaveValue('TypeScript')
  await expect(viewLines(page)).toContainText(code.split('\n')[0].slice(0, 10))
}

test('R3 parity: TS IntelliSense suggestions, signature help and hover type info', async ({ page }) => {
  await tsEditor(page, 'const list = [1, 2, 3]\n')
  await viewLines(page).click()
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.insertText('list.ma')
  await page.evaluate(() => (window as unknown as W).monaco.editor.getEditors()[0].trigger('qa', 'editor.action.triggerSuggest'))
  await expect(page.locator('.suggest-widget.visible')).toBeVisible({ timeout: 15000 })
  await expect(page.locator('.suggest-widget.visible')).toContainText('map', { timeout: 15000 })
  await page.keyboard.press('Escape')
  await page.keyboard.insertText('\nMath.max(')
  await page.evaluate(() => (window as unknown as W).monaco.editor.getEditors()[0].trigger('qa', 'editor.action.triggerParameterHints'))
  await expect(page.locator('.parameter-hints-widget.visible')).toBeVisible({ timeout: 15000 })
  await page.keyboard.press('Escape')
  await page.evaluate(() => {
    const editor = (window as unknown as W).monaco.editor.getEditors()[0]
    editor.focus()
    editor.setPosition({ lineNumber: 1, column: 8 })
    editor.trigger('qa', 'editor.action.showHover')
  })
  await expect(page.locator('.monaco-hover:visible').first()).toContainText('number[]', { timeout: 15000 })
})

test('R3 parity: TS error squiggle, F1 palette, Ctrl+G, find/replace, format document', async ({ page }) => {
  // Plan 032 (answer 2A): a syntax error, as Monaco's semantic validation is off.
  await tsEditor(page, 'const count: number = 1 +* 2\nfunction   pad( a:string ){return a}\n')
  await expect
    .poll(() => page.evaluate(() => (window as unknown as W).monaco.editor.getModelMarkers({}).map((m) => m.owner)), { timeout: 20000 })
    .toContain('typescript')
  await expect(page.locator('.monaco-editor .squiggly-error').first()).toBeVisible(MONACO_LOAD)
  await viewLines(page).click()
  await page.keyboard.press('F1')
  await expect(page.locator('.quick-input-widget')).toBeVisible()
  await expect(page.locator('.quick-input-widget input')).toHaveValue('>')
  await page.keyboard.press('Escape')
  await page.keyboard.press('Control+G')
  await expect(page.locator('.quick-input-widget')).toBeVisible()
  await expect(page.locator('.quick-input-widget input')).toHaveValue(':')
  await page.keyboard.press('Escape')
  await page.keyboard.press('ControlOrMeta+H')
  await expect(page.locator('.find-widget.visible .replace-part')).toBeVisible()
  await page.keyboard.press('Escape')
  await page.evaluate(() => (window as unknown as W).monaco.editor.getEditors()[0].trigger('qa', 'editor.action.formatDocument'))
  await expect.poll(() => modelValue(page), { timeout: 15000 }).toContain('function pad(a: string) { return a }')
})

// Uploading non-TypeScript code into the fresh editor (which starts as TypeScript) must not leave
// TypeScript error squiggles on Python/Go/Java code. QA round 3 finding P1: PRE-EXISTING, the
// same 44/34/29 'typescript' markers appear on HEAD (CDN Monaco's TS worker validates the
// uploaded text while the model is still TypeScript, and the markers stay after the language
// changes). Fixed in Revision 4: CodeEditor clears the TypeScript/JavaScript markers from a model
// of another language, also when the service marks it after the change.
for (const source of ['Python', 'Go', 'Java']) {
  test(`R3 stale diagnostics: no TypeScript markers on uploaded ${source} code`, async ({ page }) => {
    await openNew(page)
    await uploadFile(page, REAL[source].file, REAL[source].code)
    await expect(languageSelect(page)).toHaveValue(source)
    await expect.poll(() => modelLanguage(page)).toBe(MONACO_ID[source])
    await page.waitForTimeout(3000)
    const owners = await page.evaluate(() => (window as unknown as W).monaco.editor.getModelMarkers({}).map((m) => m.owner))
    console.log(`R3 ${label()} ${source} upload markers: ${owners.length} ${JSON.stringify([...new Set(owners)])}`)
    await shot(page, `stale-${source}`)
    expect(owners.filter((o) => o === 'typescript' || o === 'javascript')).toEqual([])
  })
}

// ---------- Fallback and hang ----------

test('R3 fallback: Shiki chunk blocked, the editor still loads with Monaco colors and no error toast', async ({ page }) => {
  await page.route(/shikiHighlight|@shikijs|\/shiki/, (route) => route.abort('failed'))
  await openNew(page)
  await uploadFile(page, 'main.go', REAL.Go.code)
  await expect(languageSelect(page)).toHaveValue('Go')
  await settle(page, 'go')
  expect(await colorCount(page)).toBeGreaterThanOrEqual(2)
  await expect(page.getByText('Something went wrong', { exact: false })).toHaveCount(0)
  await languageSelect(page).selectOption('Python')
  await settle(page, 'python')
})

test('R3 hang: a stalled Shiki request must not keep "Loading editor..." forever', async ({ page }) => {
  // The request is never answered (stalled network or proxy).
  await page.route(/shikiHighlight|@shikijs|\/shiki/, () => new Promise(() => undefined))
  await page.goto('/review/new')
  await expect(viewLines(page)).toBeVisible({ timeout: 20000 })
})

// ---------- Network ----------

test('R3 network: the only external host is cdn.jsdelivr.net', async ({ page, request }) => {
  const hostList = new Set<string>()
  page.on('request', (r) => {
    const { hostname } = new URL(r.url())
    // blob: and data: URLs (Monaco's worker) have no hostname.
    if (hostname && !/^(localhost|127\.0\.0\.1)$/.test(hostname)) hostList.add(hostname)
  })
  const { id } = await createReview(request, { title: 'R3 net' })
  await openNew(page)
  await page.goto(`/review/${id}`)
  await expect(viewLines(page)).toBeVisible(MONACO_LOAD)
  await page.getByRole('tab', { name: /Generated tests/ }).click()
  await expect(viewLines(page)).toBeVisible(MONACO_LOAD)
  await page.waitForTimeout(500)
  expect([...hostList]).toEqual(['cdn.jsdelivr.net'])
})

// ---------- The "Canceled" allowance ----------

test('R3 cancel: page errors on Summary and Generated tests tab switches', async ({ page, request }) => {
  const errorList: string[] = []
  page.on('pageerror', (error) => errorList.push(error.message))
  const { id } = await createReview(request, { title: 'R3 cancel' })
  await page.goto(`/review/${id}`)
  await expect(viewLines(page)).toBeVisible(MONACO_LOAD)
  for (let i = 0; i < 3; i++) {
    await page.getByRole('tab', { name: /Generated tests/ }).click()
    await expect(viewLines(page)).toBeVisible(MONACO_LOAD)
    await page.getByRole('tab', { name: /Summary/ }).click()
    await expect(viewLines(page)).toBeVisible(MONACO_LOAD)
  }
  await page.waitForTimeout(800)
  console.log(`R3 ${label()} pageerrors: ${JSON.stringify(errorList)}`)
  expect(errorList.filter((m) => m !== 'Canceled')).toEqual([])
})
