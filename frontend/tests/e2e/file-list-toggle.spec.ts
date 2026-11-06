import type { Locator, Page, Route } from '@playwright/test'
import { API_PATH } from '../../src/lib/api.constants'
import { FILE_DRAFT_TEXT } from '../../src/lib/review.constants'
import { FAKE_GITHUB_REPO } from './e2e.constants'
import { apiRoute, connectFakeGithub, expect, fulfillJson, MONACO_LOAD, setSettings, test } from './fixture'

// Plan 038, on the real backend and its fake GitHub (GITHUB_FAKE=true): the imported files list
// closes to a slim rail (a one-row bar on phones) and opens again; the editor takes the freed
// space; the choice is remembered in this browser. A third file is added to the wizard's list
// (as in multi-file-import.spec.ts), which rewrites the page's own API body: plain run only.

const EXTRA_PATH = 'src/extra.ts'
const EXTRA_ID = Buffer.from(EXTRA_PATH).toString('base64url')
const EXTRA_CODE = 'export const extra = (value: number) => value * 2\n'

async function addThirdFile(page: Page) {
  await page.route(apiRoute(API_PATH.githubFileList(FAKE_GITHUB_REPO)), async (route: Route) => {
    if (route.request().method() !== 'GET') return route.continue()
    const response = await route.fetch()
    const body = (await response.json()) as { items: unknown[]; truncated: boolean }
    return route.fulfill({ response, json: { ...body, items: [...body.items, { id: EXTRA_ID, path: EXTRA_PATH, language: 'TypeScript' }] } })
  })
  await page.route(apiRoute(API_PATH.githubFile(FAKE_GITHUB_REPO, EXTRA_ID)), (route: Route) =>
    fulfillJson(route, 200, { id: EXTRA_ID, path: EXTRA_PATH, language: 'TypeScript', content: EXTRA_CODE })
  )
}

// The wizard: connect the fake GitHub (unless still connected), tick the three files, approve.
async function runWizard(page: Page) {
  await page.goto('/github')
  const userName = page.getByRole('textbox', { name: 'GitHub user name' })
  const repo = page.getByRole('radio', { name: FAKE_GITHUB_REPO })
  await expect(userName.or(repo).first()).toBeVisible()
  if (await userName.isVisible()) await connectFakeGithub(page)
  await repo.click()
  await page.getByRole('button', { name: 'Next' }).click()
  for (const path of ['src/greet.ts', 'src/util.py', EXTRA_PATH]) await page.getByRole('checkbox', { name: path }).check()
  await page.getByRole('button', { name: 'Approve' }).click()
  await expect(panel(page)).toBeVisible()
  await expect(editor(page)).toContainText('export function greet', MONACO_LOAD)
}

async function importThreeFiles(page: Page) {
  await addThirdFile(page)
  await runWizard(page)
  await expect(list(page)).toBeVisible()
}

const list = (page: Page) => page.getByRole('navigation', { name: FILE_DRAFT_TEXT.listLabel })
const panel = (page: Page) => page.getByTestId('file-draft-panel')
const summary = (page: Page) => page.getByTestId('file-draft-summary')
const hideButton = (page: Page) => page.getByRole('button', { name: FILE_DRAFT_TEXT.hideList })
const showButton = (page: Page) => page.getByRole('button', { name: FILE_DRAFT_TEXT.showList })
const editor = (page: Page) => page.locator('.monaco-editor').first()
const fileButton = (page: Page, path: string) => list(page).getByRole('button', { name: new RegExp(path.replace('.', '\\.')) })

async function boxOf(locator: Locator) {
  const box = await locator.boundingBox()
  if (!box) throw new Error('no bounding box')
  return box
}

// Waits until the editor (and the panel) stop changing size after the width transition.
async function settledBox(page: Page) {
  let last = ''
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const box = { editor: await boxOf(editor(page)), panel: await boxOf(panel(page)) }
    const key = JSON.stringify(box)
    if (key === last) return box
    last = key
    await page.waitForTimeout(100)
  }
  throw new Error('the layout did not settle')
}

async function sideScroll(page: Page) {
  return page.evaluate(() => document.scrollingElement!.scrollWidth - window.innerWidth)
}

test('desktop: closing the list widens the editor, files switch through the rail, the choice survives a reload', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await importThreeFiles(page)
  const open = await settledBox(page)

  await hideButton(page).click()
  await expect(showButton(page)).toHaveAttribute('aria-expanded', 'false')
  await expect(list(page)).toBeHidden()
  const closed = await settledBox(page)
  // The editor gains what the list gave up: the open list's width minus the slim rail.
  const freed = open.panel.width - closed.panel.width
  expect(closed.panel.width).toBeLessThanOrEqual(42)
  expect(freed).toBeGreaterThan(190)
  expect(Math.abs(closed.editor.width - open.editor.width - freed)).toBeLessThanOrEqual(2)
  expect(closed.editor.x).toBeLessThan(open.editor.x)
  await expect(summary(page)).toContainText('3 files')
  await expect(summary(page)).toContainText('src/greet.ts')

  // Switching files from the rail: open, pick, close again; the rail names the new file.
  await showButton(page).click()
  await fileButton(page, 'src/util.py').click()
  await expect(editor(page)).toContainText('def total')
  await hideButton(page).click()
  await expect(summary(page)).toContainText('src/util.py')
  await expect(editor(page)).toContainText('def total')

  // Reloading keeps the choice (the import session itself lives in memory, so import again).
  // The reload drops the unsaved drafts: accept the browser's leave question if it asks.
  page.on('dialog', (dialog) => dialog.accept())
  await page.reload()
  await runWizard(page)
  await expect(showButton(page)).toBeVisible()
  await expect(showButton(page)).toHaveAttribute('aria-expanded', 'false')
  await expect(editor(page)).toContainText('export function greet', MONACO_LOAD)

  // Reopening restores the original size.
  await showButton(page).click()
  await expect(list(page)).toBeVisible()
  const reopened = await settledBox(page)
  expect(Math.abs(reopened.editor.width - open.editor.width)).toBeLessThanOrEqual(2)
  expect(Math.abs(reopened.panel.width - open.panel.width)).toBeLessThanOrEqual(2)
})

test('desktop: while closed the file buttons are skipped by Tab', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await importThreeFiles(page)
  await hideButton(page).click()
  await showButton(page).focus()
  for (let step = 0; step < 6; step += 1) {
    await page.keyboard.press('Tab')
    const inList = await page.evaluate(() => document.activeElement?.closest('#file-draft-list') !== null)
    expect(inList).toBe(false)
  }
  // Keyboard: Enter on the toggle opens the list again.
  await showButton(page).focus()
  await page.keyboard.press('Enter')
  await expect(list(page)).toBeVisible()
})

// Plan 038, Revision 1: on phones the open/close toggle is gone; the files are a one-row
// dropdown (as small as the former closed bar), whose list opens over the page under it.
test('phone: a one-row dropdown without a toggle; opening it does not move the editor, choosing closes it', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await importThreeFiles(page)
  const before = await settledBox(page)
  expect(before.panel.height).toBeLessThanOrEqual(44)
  expect(before.panel.y + before.panel.height).toBeLessThanOrEqual(before.editor.y + 1)
  await expect(hideButton(page)).toHaveCount(0)
  await expect(showButton(page)).toHaveCount(0)
  await expect(summary(page)).toContainText('src/greet.ts')

  const row = list(page).getByRole('button', { expanded: false })
  await expect(row).toContainText('1 of 3')
  await row.click()
  const menu = page.getByRole('list', { name: FILE_DRAFT_TEXT.menuLabel })
  await expect(menu).toBeVisible()
  const during = await settledBox(page)
  expect(Math.abs(during.editor.y - before.editor.y)).toBeLessThanOrEqual(1)
  await menu.getByRole('button', { name: /src\/util\.py/ }).click()
  await expect(menu).toBeHidden()
  await expect(editor(page)).toContainText('def total')
  await expect(summary(page)).toContainText('src/util.py')
  const after = await settledBox(page)
  expect(Math.abs(after.editor.y - before.editor.y)).toBeLessThanOrEqual(1)
})

test('with the list closed, Run review reviews the open file and the leave guard still asks', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await importThreeFiles(page)
  await fileButton(page, 'src/util.py').click()
  await expect(editor(page)).toContainText('def total')
  await hideButton(page).click()

  await page.getByRole('button', { name: 'Run review' }).click()
  await expect(page).toHaveURL(/\/review\/(?!new)[^/]+$/)
  await expect(page.getByTestId('review-name')).toHaveText('src/util.py')
  // Still closed on the review page of that file, and it names the file.
  await expect(showButton(page)).toHaveAttribute('aria-expanded', 'false')
  await expect(summary(page)).toContainText('src/util.py')

  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Review History' }).click()
  const dialog = page.getByRole('dialog', { name: FILE_DRAFT_TEXT.leaveTitle })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: FILE_DRAFT_TEXT.stay }).click()
  await expect(showButton(page)).toBeVisible()
})

test('reduced motion: no width transition on the panel', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width: 1280, height: 800 })
  await importThreeFiles(page)
  expect(await panel(page).evaluate((element) => getComputedStyle(element).transitionDuration)).toMatch(/^0s/)
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await expect.poll(() => panel(page).evaluate((element) => getComputedStyle(element).transitionProperty)).toContain('width')
})

for (const theme of ['light', 'dark'] as const) {
  for (const [label, width, height] of [
    ['desktop 1280', 1280, 800],
    ['tablet 768', 768, 1024]
  ] as const) {
    test(`${theme} ${label}: the toggle is visible and not clipped, open or closed, with no side-scroll`, async ({ page, request }) => {
      await setSettings(request, { theme })
      await page.setViewportSize({ width, height })
      await importThreeFiles(page)
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)

      for (const button of [hideButton(page), showButton(page)]) {
        await expect(button).toBeVisible()
        const box = await boxOf(button)
        const outer = await boxOf(panel(page))
        expect(box.x).toBeGreaterThanOrEqual(outer.x - 0.5)
        expect(box.x + box.width).toBeLessThanOrEqual(outer.x + outer.width + 0.5)
        expect(box.y).toBeGreaterThanOrEqual(outer.y - 0.5)
        expect(box.y + box.height).toBeLessThanOrEqual(outer.y + outer.height + 0.5)
        expect(box.x + box.width).toBeLessThanOrEqual(width)
        expect(await sideScroll(page)).toBeLessThanOrEqual(0)
        await button.click()
        await settledBox(page)
      }
      await expect(editor(page)).toBeVisible()
    })
  }

  // Plan 038, Revision 1: the phone has the dropdown row instead of the toggle.
  test(`${theme} phone 390: the dropdown row and its list are visible and not clipped, with no side-scroll`, async ({ page, request }) => {
    await setSettings(request, { theme })
    await page.setViewportSize({ width: 390, height: 844 })
    await importThreeFiles(page)
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
    const row = list(page).getByRole('button', { expanded: false })
    const box = await boxOf(row)
    const outer = await boxOf(panel(page))
    expect(box.x).toBeGreaterThanOrEqual(outer.x - 0.5)
    expect(box.x + box.width).toBeLessThanOrEqual(390)
    expect(box.y + box.height).toBeLessThanOrEqual(outer.y + outer.height + 0.5)
    expect(await sideScroll(page)).toBeLessThanOrEqual(0)
    await row.click()
    const menu = page.getByRole('list', { name: FILE_DRAFT_TEXT.menuLabel })
    await expect(menu).toBeVisible()
    const menuBox = await boxOf(menu)
    expect(menuBox.x).toBeGreaterThanOrEqual(0)
    expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(390)
    expect(await sideScroll(page)).toBeLessThanOrEqual(0)
    await expect(editor(page)).toBeVisible()
  })
}
