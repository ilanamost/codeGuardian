import type { Locator, Page, Request, Route } from '@playwright/test'
import { API_PATH } from '../../src/lib/api.constants'
import { fileListStorageKey } from '../../src/lib/fileListOpen'
import { FILE_DRAFT_TEXT, REVIEW_TEXT } from '../../src/lib/review.constants'
import { FAKE_GITHUB_REPO } from './e2e.constants'
import { apiRoute, connectFakeGithub, csrfRequest, expect, fulfillJson, MONACO_LOAD, setSettings, test } from './fixture'

// QA plan 038, adversarial, plain run only (it answers the wizard's file list and file bodies).
// Real measurements: focus ring, cursor, hover, `hidden` vs `md:flex`, no refetch on toggle,
// Monaco's own layout after the width change, 768 and 320 px, 20 files and a very long name,
// hostile storage, sign-out to another account, Save review with the list closed, CLS.

type QaFile = { id: string; path: string; language: string; content: string }

const LONG_LINE = `export const longLine = '${'x'.repeat(400)}'\n`

function qaFile(path: string, content = `export const v = ${JSON.stringify(path)}\n${LONG_LINE}`): QaFile {
  return { id: Buffer.from(path).toString('base64url'), path, language: 'TypeScript', content }
}

const threeFiles = () => [qaFile('src/qa/alpha.ts'), qaFile('src/qa/beta.ts'), qaFile('src/qa/gamma.ts')]

async function routeFiles(page: Page, fileList: QaFile[]) {
  await page.route(apiRoute(API_PATH.githubFileList(FAKE_GITHUB_REPO)), async (route: Route) => {
    if (route.request().method() !== 'GET') return route.continue()
    return fulfillJson(route, 200, { items: fileList.map(({ id, path, language }) => ({ id, path, language })), truncated: false })
  })
  await page.route(new RegExp(`/api/github/repo/${FAKE_GITHUB_REPO}/file/[^/?]+$`), async (route: Route) => {
    if (route.request().method() === 'OPTIONS') return fulfillJson(route, 204, {})
    const id = decodeURIComponent(new URL(route.request().url()).pathname.split('/').at(-1)!)
    const file = fileList.find((item) => item.id === id)
    return file ? fulfillJson(route, 200, file) : fulfillJson(route, 404, { error: { code: 'not_found', message: 'x' } })
  })
}

async function importFiles(page: Page, fileList: QaFile[] = threeFiles(), waitToast = true) {
  await routeFiles(page, fileList)
  await page.goto('/github')
  const userName = page.getByRole('textbox', { name: 'GitHub user name' })
  const repo = page.getByRole('radio', { name: FAKE_GITHUB_REPO })
  await expect(userName.or(repo).first()).toBeVisible()
  if (await userName.isVisible()) await connectFakeGithub(page)
  await repo.click()
  await page.getByRole('button', { name: 'Next' }).click()
  for (const file of fileList) await page.getByRole('checkbox', { name: file.path }).check()
  await page.getByRole('button', { name: 'Approve' }).click()
  await expect(panel(page)).toBeVisible()
  await expect(editor(page)).toContainText('export const v', MONACO_LOAD)
  // The import's success toast can sit over the toggle (see the overlap test): let it go first.
  if (waitToast) await expect(page.locator('[data-sonner-toast]')).toHaveCount(0, { timeout: 15_000 })
}

const list = (page: Page) => page.getByRole('navigation', { name: FILE_DRAFT_TEXT.listLabel })
const panel = (page: Page) => page.getByTestId('file-draft-panel')
const summary = (page: Page) => page.getByTestId('file-draft-summary')
const hideButton = (page: Page) => page.getByRole('button', { name: FILE_DRAFT_TEXT.hideList })
const showButton = (page: Page) => page.getByRole('button', { name: FILE_DRAFT_TEXT.showList })
const editor = (page: Page) => page.locator('.monaco-editor').first()

async function boxOf(locator: Locator) {
  const box = await locator.boundingBox()
  if (!box) throw new Error('no bounding box')
  return box
}

// Monaco's own measured layout: the overflow guard (sized by Monaco's layout()) against the
// editor's container, and the horizontal scrollbar's track.
async function monacoLayout(page: Page) {
  return editor(page).evaluate((element) => {
    const container = element.parentElement!.getBoundingClientRect()
    const guard = element.querySelector('.overflow-guard')!.getBoundingClientRect()
    const bar = element.querySelector('.scrollbar.horizontal')?.getBoundingClientRect()
    return { containerWidth: container.width, containerHeight: container.height, guardWidth: guard.width, guardHeight: guard.height, barWidth: bar?.width ?? 0 }
  })
}

async function settled(page: Page) {
  let last = ''
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const value = { editor: await boxOf(editor(page)), panel: await boxOf(panel(page)), monaco: await monacoLayout(page) }
    const key = JSON.stringify(value)
    if (key === last) return value
    last = key
    await page.waitForTimeout(100)
  }
  throw new Error('the layout did not settle')
}

const sideScroll = (page: Page) => page.evaluate(() => document.scrollingElement!.scrollWidth - window.innerWidth)

function apiCallsWhile(page: Page) {
  const callList: string[] = []
  const listener = (request: Request) => {
    if (request.url().includes('/api/') && request.method() !== 'OPTIONS') callList.push(`${request.method()} ${new URL(request.url()).pathname}`)
  }
  page.on('request', listener)
  return { callList, stop: () => page.off('request', listener) }
}

test('a11y in a real browser: focus ring, cursor, hover, Space, aria-controls target, hidden beats md:flex', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await importFiles(page)

  // Keyboard focus (focus-visible) draws a 2 px solid outline.
  await hideButton(page).focus()
  await page.keyboard.press('Shift+Tab')
  await page.keyboard.press('Tab')
  const ring = await hideButton(page).evaluate((element) => {
    const style = getComputedStyle(element)
    return { focused: document.activeElement === element, visible: element.matches(':focus-visible'), style: style.outlineStyle, width: style.outlineWidth, cursor: style.cursor }
  })
  expect(ring).toEqual({ focused: true, visible: true, style: 'solid', width: '2px', cursor: 'pointer' })

  // Hover changes the background.
  await page.mouse.move(0, 0)
  const before = await hideButton(page).evaluate((element) => getComputedStyle(element).backgroundColor)
  await hideButton(page).hover()
  await expect.poll(() => hideButton(page).evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe(before)

  // Space closes; the control target exists, is display:none (not overridden by md:flex) and
  // is out of the accessibility tree.
  await hideButton(page).focus()
  await page.keyboard.press('Space')
  await expect(showButton(page)).toHaveAttribute('aria-expanded', 'false')
  await expect(showButton(page)).toBeFocused()
  const target = await showButton(page).evaluate((element) => {
    const node = document.getElementById(element.getAttribute('aria-controls') ?? '')
    return node ? { display: getComputedStyle(node).display, hidden: node.hasAttribute('hidden'), buttons: node.querySelectorAll('button').length } : null
  })
  expect(target).toEqual({ display: 'none', hidden: true, buttons: 3 })
  await expect(list(page)).toHaveCount(0)
  const tree = await panel(page).ariaSnapshot()
  expect(tree).not.toContain('src/qa/beta.ts')
  expect(tree).toContain(FILE_DRAFT_TEXT.showList)

  // Space again opens.
  await page.keyboard.press('Space')
  await expect(hideButton(page)).toHaveAttribute('aria-expanded', 'true')
  await expect(list(page)).toBeVisible()
})

test('toggling never refetches, and marks, selection and a running analysis survive close/open', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await importFiles(page)
  await list(page).getByRole('button', { name: /src\/qa\/beta\.ts/ }).click()

  const calls = apiCallsWhile(page)
  for (let cycle = 0; cycle < 6; cycle += 1) {
    await hideButton(page).click()
    await showButton(page).click()
  }
  await page.waitForTimeout(300)
  calls.stop()
  expect(calls.callList).toEqual([])
  await expect(list(page).getByRole('button', { name: /src\/qa\/beta\.ts/ })).toHaveAttribute('aria-current', 'true')
  await expect(list(page).getByTestId('file-draft-mark')).toHaveText(['Draft', 'Draft', 'Draft'])

  // Slow the review status so the analysis is still running while the list closes and opens.
  let release: () => void = () => undefined
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route(/\/api\/review\/[^/]+$/, async (route) => {
    if (route.request().method() === 'GET') await gate
    return route.continue()
  })
  await page.getByRole('button', { name: 'Run review' }).click()
  await expect(page).toHaveURL(/\/review\/(?!new)[^/]+$/)
  await hideButton(page).click()
  await expect(summary(page)).toContainText('src/qa/beta.ts')
  await showButton(page).click()
  await hideButton(page).click()
  release()
  await expect(summary(page)).toContainText('src/qa/beta.ts')
  await showButton(page).click()
  await expect(list(page).getByTestId('file-draft-mark').nth(1)).toHaveText('Reviewed', { timeout: 20_000 })
  await expect(list(page).getByTestId('file-draft-mark').nth(0)).toHaveText('Draft')
})

for (const theme of ['light', 'dark'] as const) {
  for (const [label, width, height] of [
    ['desktop 1280', 1280, 800],
    ['tablet 768', 768, 1024]
  ] as const) {
    test(`${theme} ${label}: Monaco re-lays out to the freed width (no blank strip), the scrollbar and cursor work, reopen restores`, async ({ page, request }) => {
      await setSettings(request, { theme })
      await page.setViewportSize({ width, height })
      await importFiles(page)
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      const open = await settled(page)
      expect(Math.abs(open.monaco.guardWidth - open.monaco.containerWidth)).toBeLessThanOrEqual(1)

      await hideButton(page).click()
      const closed = await settled(page)
      const freed = open.panel.width - closed.panel.width
      expect(closed.panel.width).toBeLessThanOrEqual(42)
      expect(freed).toBeGreaterThan(190)
      expect(Math.abs(closed.editor.width - open.editor.width - freed)).toBeLessThanOrEqual(2)
      // Monaco's own layout follows the container: no blank strip, nothing clipped.
      expect(Math.abs(closed.monaco.guardWidth - closed.monaco.containerWidth)).toBeLessThanOrEqual(1)
      expect(Math.abs(closed.monaco.guardWidth - open.monaco.guardWidth - freed)).toBeLessThanOrEqual(2)
      expect(closed.monaco.barWidth).toBeGreaterThan(open.monaco.barWidth + freed - 3)
      expect(await sideScroll(page)).toBeLessThanOrEqual(0)

      // The cursor still works: type at the start of the file.
      await editor(page).locator('.view-lines').click({ position: { x: 5, y: 5 } })
      await page.keyboard.press('Control+Home')
      await page.keyboard.type('// qa ')
      await expect(editor(page)).toContainText('// qa')
      // The horizontal scrollbar scrolls the long line.
      await page.keyboard.press('Control+End')
      await page.keyboard.press('ArrowUp')
      await page.keyboard.press('End')
      await expect.poll(() => editor(page).evaluate((element) => (element.querySelector('.lines-content') as HTMLElement).style.left)).not.toMatch(/^(0px)?$/)

      await showButton(page).click()
      const reopened = await settled(page)
      expect(Math.abs(reopened.editor.width - open.editor.width)).toBeLessThanOrEqual(2)
      expect(Math.abs(reopened.monaco.guardWidth - open.monaco.guardWidth)).toBeLessThanOrEqual(2)
    })
  }

  // Revision 1 (answer 4A): no open/close toggle on phones; the panel is always the one-row
  // dropdown. Still proves: one row, the editor takes all the rest (it starts right under the row
  // and Monaco fills it), opening the list overlays without moving the editor, no side-scroll.
  test(`${theme} phone 320: the dropdown is one row, the editor gets the height, no side-scroll`, async ({ page, request }) => {
    await setSettings(request, { theme })
    await page.setViewportSize({ width: 320, height: 640 })
    await importFiles(page)
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
    const closed = await settled(page)
    expect(await sideScroll(page)).toBeLessThanOrEqual(0)
    await expect(hideButton(page)).toHaveCount(0)
    await expect(showButton(page)).toHaveCount(0)
    // One row: at most 3 rem, and the editor starts right under it (no gap kept for a list).
    expect(closed.panel.height).toBeLessThanOrEqual(48)
    expect(closed.editor.y - (closed.panel.y + closed.panel.height)).toBeGreaterThanOrEqual(-0.5)
    expect(closed.editor.y - (closed.panel.y + closed.panel.height)).toBeLessThanOrEqual(80)
    expect(Math.abs(closed.monaco.guardHeight - closed.monaco.containerHeight)).toBeLessThanOrEqual(1)
    expect(Math.abs(closed.monaco.guardWidth - closed.monaco.containerWidth)).toBeLessThanOrEqual(1)
    const row = page.getByRole('button', { name: /1 of 3/ })
    const rowBox = await boxOf(row)
    expect(rowBox.x).toBeGreaterThanOrEqual(0)
    expect(rowBox.x + rowBox.width).toBeLessThanOrEqual(320)
    const text = await boxOf(summary(page))
    expect(text.x + text.width).toBeLessThanOrEqual(320)
    await expect(summary(page)).toContainText('src/qa/alpha.ts')

    // Opening the list overlays: the editor does not move or shrink, the list stays inside the
    // screen and scrolls vertically, still no side-scroll.
    await row.click()
    await expect(row).toHaveAttribute('aria-expanded', 'true')
    const menu = page.locator('#file-draft-menu')
    await expect(menu).toBeVisible()
    const opened = await settled(page)
    expect(Math.abs(opened.editor.y - closed.editor.y)).toBeLessThanOrEqual(1)
    expect(Math.abs(opened.editor.height - closed.editor.height)).toBeLessThanOrEqual(1)
    const menuBox = await boxOf(menu)
    expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(320.5)
    expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(640)
    expect(await menu.evaluate((element) => getComputedStyle(element).overflowY)).toBe('auto')
    expect(await sideScroll(page)).toBeLessThanOrEqual(0)
    await page.keyboard.press('Escape')
    await expect(menu).toBeHidden()
    await expect(row).toBeFocused()
  })
}

test('20 files with a very long name: rail and phone bar stay inside the panel and the viewport', async ({ page }) => {
  const longPath = `src/${'a-very-long-directory-name/'.repeat(8)}the-file.ts`
  const fileList = [qaFile(longPath), ...Array.from({ length: 19 }, (_, index) => qaFile(`src/qa/file-${String(index).padStart(2, '0')}.ts`))]
  await page.setViewportSize({ width: 1280, height: 800 })
  await importFiles(page, fileList)
  await hideButton(page).click()
  await settled(page)
  await expect(summary(page)).toContainText('20 files')
  const rail = await boxOf(panel(page))
  const text = await boxOf(summary(page))
  expect(text.y + text.height).toBeLessThanOrEqual(rail.y + rail.height + 0.5)
  expect(text.x + text.width).toBeLessThanOrEqual(rail.x + rail.width + 0.5)
  expect(await panel(page).evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(0)
  await expect(summary(page).getByText(longPath)).toHaveAttribute('title', longPath)
  expect(await sideScroll(page)).toBeLessThanOrEqual(0)

  await page.setViewportSize({ width: 390, height: 844 })
  await settled(page)
  const bar = await boxOf(panel(page))
  expect(bar.height).toBeLessThanOrEqual(44)
  const phoneText = await boxOf(summary(page))
  expect(phoneText.x + phoneText.width).toBeLessThanOrEqual(390)
  expect(await sideScroll(page)).toBeLessThanOrEqual(0)
})

test('reduced motion: the closed width applies at once (no animated frames)', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width: 1280, height: 800 })
  await importFiles(page)
  const widthList = await page.evaluate(async () => {
    const panelNode = document.querySelector('[data-testid="file-draft-panel"]') as HTMLElement
    const button = panelNode.querySelector('button') as HTMLButtonElement
    button.click()
    const seen: number[] = []
    for (let frame = 0; frame < 6; frame += 1) {
      await new Promise((resolve) => requestAnimationFrame(resolve))
      seen.push(Math.round(panelNode.getBoundingClientRect().width))
    }
    return seen
  })
  expect(new Set(widthList).size).toBe(1)
  expect(widthList[0]).toBeLessThanOrEqual(42)
})

test('storage: a garbage stored value opens the list; it is then overwritten with a valid one', async ({ page }) => {
  await page.addInitScript((key) => {
    if (!sessionStorage.getItem('qa-seeded')) {
      localStorage.setItem(key, '"sideways"')
      sessionStorage.setItem('qa-seeded', '1')
    }
  }, fileListStorageKey)
  await page.setViewportSize({ width: 1280, height: 800 })
  await importFiles(page)
  await expect(hideButton(page)).toHaveAttribute('aria-expanded', 'true')
  await hideButton(page).click()
  expect(await page.evaluate((key) => localStorage.getItem(key), fileListStorageKey)).toBe('"closed"')
})

test('storage blocked (every get and set throws): opens, toggles, stays closed from /review/new to /review/:id, no error', async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => {
      throw new DOMException('blocked', 'SecurityError')
    }
    Storage.prototype.setItem = () => {
      throw new DOMException('blocked', 'QuotaExceededError')
    }
  })
  const pageErrorList: string[] = []
  page.on('pageerror', (error) => pageErrorList.push(error.message))
  await page.setViewportSize({ width: 1280, height: 800 })
  await importFiles(page)
  await expect(hideButton(page)).toHaveAttribute('aria-expanded', 'true')
  await hideButton(page).click()
  await expect(showButton(page)).toHaveAttribute('aria-expanded', 'false')
  await page.getByRole('button', { name: 'Run review' }).click()
  await expect(page).toHaveURL(/\/review\/(?!new)[^/]+$/)
  await expect(showButton(page)).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByRole('alert').filter({ hasText: /storage/i })).toHaveCount(0)
  expect(pageErrorList).toEqual([])
})

test('Save review with the list closed stores the edit and keeps the list closed', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await importFiles(page)
  await page.getByRole('button', { name: 'Run review' }).click()
  await expect(page).toHaveURL(/\/review\/(?!new)[^/]+$/)
  await hideButton(page).click()
  await expect(page.locator('#file-draft-list [data-testid="file-draft-mark"]').first()).toHaveText('Reviewed', { timeout: 15_000 })
  await editor(page).locator('.view-lines').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('Control+Home')
  await page.keyboard.type('// saved by qa\n')
  const put = page.waitForResponse((response) => response.request().method() === 'PUT' && /\/api\/review\/[^/]+$/.test(new URL(response.url()).pathname))
  await page.getByRole('button', { name: REVIEW_TEXT.saveButton }).click()
  expect((await put).status()).toBeLessThan(300)
  await expect(page.getByText(REVIEW_TEXT.saved).first()).toBeVisible()
  await expect(showButton(page)).toHaveAttribute('aria-expanded', 'false')
  await expect(summary(page)).toContainText('src/qa/alpha.ts')
})

test('sign out, sign in as another account: the closed choice stays (browser display preference, no account data)', async ({ page, browser }) => {
  const other = await browser.newContext()
  const created = await csrfRequest(other.request).post(apiRoute(API_PATH.account), {
    data: { username: 'qa.other', email: 'qa.other@example.com', password: 'qa-other-Secret-42' }
  })
  expect(created.status()).toBe(201)
  await other.close()

  await page.setViewportSize({ width: 1280, height: 800 })
  await importFiles(page)
  await hideButton(page).click()
  page.on('dialog', (dialog) => dialog.accept())
  await page.goto('/settings')
  const leave = page.getByRole('dialog', { name: FILE_DRAFT_TEXT.leaveTitle })
  if (await leave.isVisible().catch(() => false)) await leave.getByRole('button', { name: FILE_DRAFT_TEXT.leaveConfirm }).click()
  await page.getByRole('tab', { name: 'Security' }).click()
  await page.getByRole('button', { name: 'Sign Out' }).click()
  await page.getByRole('dialog', { name: 'Sign out?' }).getByRole('button', { name: 'Sign out' }).click()
  await expect(page).toHaveURL(/\/login$/)
  const keyList = await page.evaluate(() => Object.keys(localStorage))
  expect(keyList.filter((key) => key.startsWith('cr.'))).toEqual([])
  expect(await page.evaluate((key) => localStorage.getItem(key), fileListStorageKey)).toBe('"closed"')

  await page.getByLabel('User name').fill('qa.other')
  await page.getByLabel('Password', { exact: true }).click()
  await page.getByLabel('Password', { exact: true }).fill('qa-other-Secret-42')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible()
  await importFiles(page)
  await expect(showButton(page)).toHaveAttribute('aria-expanded', 'false')
})

// Each layout shift without recent input, with the nodes that moved, so a failure names its cause.
type QaShift = { value: number; at: number; path: string; sourceList: string[] }

async function shiftList(page: Page): Promise<QaShift[]> {
  return page.evaluate(() => (window as unknown as { __qaShiftList: QaShift[] }).__qaShiftList)
}

const total = (list: QaShift[]) => list.reduce((sum, shift) => sum + shift.value, 0)

test('no layout shift on the Dashboard (loader) and on the review page while importing; no side-scroll', async ({ page }) => {
  await page.addInitScript(() => {
    const store = window as unknown as { __qaShiftList: unknown[] }
    store.__qaShiftList = []
    const describe = (node: Node | null) => {
      if (!(node instanceof Element)) return String(node?.nodeName ?? 'null')
      const id = node.id ? `#${node.id}` : ''
      const testId = node.getAttribute('data-testid') ? `[data-testid=${node.getAttribute('data-testid')}]` : ''
      return `${node.tagName.toLowerCase()}${id}${testId}.${String(node.className).split(' ').slice(0, 4).join('.')}`
    }
    new PerformanceObserver((entryList) => {
      for (const entry of entryList.getEntries() as unknown as { value: number; hadRecentInput: boolean; startTime: number; sources?: { node: Node | null }[] }[]) {
        if (entry.hadRecentInput) continue
        store.__qaShiftList.push({ value: entry.value, at: Math.round(entry.startTime), path: location.pathname, sourceList: (entry.sources ?? []).map((source) => describe(source.node)) })
      }
    }).observe({ type: 'layout-shift', buffered: true })
  })
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/dashboard')
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(500)
  const dashboard = await shiftList(page)
  expect(await sideScroll(page)).toBeLessThanOrEqual(0)
  expect(total(dashboard), `dashboard shifts: ${JSON.stringify(dashboard)}`).toBeLessThan(0.1)

  await importFiles(page)
  await hideButton(page).click()
  await settled(page)
  await showButton(page).click()
  await settled(page)
  await page.waitForTimeout(600)
  const all = await shiftList(page)
  const review = all.filter((shift) => shift.path !== '/dashboard')
  test.info().annotations.push({ type: 'qa-shift', description: JSON.stringify({ dashboard, review }) })
  expect(total(review), `review-page shifts (after leaving /dashboard): ${JSON.stringify(review)}`).toBeLessThan(0.1)
  expect(await sideScroll(page)).toBeLessThanOrEqual(0)
})

for (const [label, width, height] of [
  ['desktop 1280', 1280, 800],
  ['tablet 768', 768, 1024]
] as const) {
  test(`${label}: the import success toast does not cover the toggle right after the import`, async ({ page }) => {
    await page.setViewportSize({ width, height })
    await importFiles(page, threeFiles(), false)
    const toast = page.locator('[data-sonner-toast]').first()
    await expect(toast).toBeVisible()
    const toastBox = await boxOf(toast)
    const buttonBox = await boxOf(hideButton(page))
    const overlap =
      toastBox.x < buttonBox.x + buttonBox.width &&
      buttonBox.x < toastBox.x + toastBox.width &&
      toastBox.y < buttonBox.y + buttonBox.height &&
      buttonBox.y < toastBox.y + toastBox.height
    expect(overlap, `toast ${JSON.stringify(toastBox)} vs toggle ${JSON.stringify(buttonBox)}`).toBe(false)
  })
}
