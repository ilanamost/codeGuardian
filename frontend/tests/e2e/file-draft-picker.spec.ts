import type { Locator, Page, Route } from '@playwright/test'
import { API_PATH } from '../../src/lib/api.constants'
import { FILE_DRAFT_TEXT } from '../../src/lib/review.constants'
import { FAKE_GITHUB_REPO } from './e2e.constants'
import { apiRoute, connectFakeGithub, expect, fulfillJson, MONACO_LOAD, test } from './fixture'

// Plan 038, Revision 1 (Open Question 4A), on the real backend and its fake GitHub: below `md`
// the imported files are a one-row dropdown whose list opens under it and scrolls up and down,
// so every file is reachable at 320 and 390 px with 5 and with 20 files with long names. The
// wizard's file list and file bodies are answered here: plain run only.

type QaFile = { id: string; path: string; language: string; content: string }

function fileOf(path: string): QaFile {
  return { id: Buffer.from(path).toString('base64url'), path, language: 'TypeScript', content: `export const v = ${JSON.stringify(path)}\n` }
}

// Long names: a deep directory on every file, and the last one longer still.
function fileListOf(count: number): QaFile[] {
  return Array.from({ length: count }, (_, index) =>
    fileOf(
      index === count - 1
        ? `src/${'a-very-long-directory-name/'.repeat(4)}the-last-file-of-the-import.ts`
        : `src/components/feature-${String(index + 1).padStart(2, '0')}/some-long-component-name.tsx`
    )
  )
}

async function importFiles(page: Page, fileList: QaFile[]) {
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
  await page.goto('/github')
  await connectFakeGithub(page)
  await page.getByRole('radio', { name: FAKE_GITHUB_REPO }).click()
  await page.getByRole('button', { name: 'Next' }).click()
  for (const file of fileList) await page.getByRole('checkbox', { name: file.path }).check()
  await page.getByRole('button', { name: 'Approve' }).click()
  await expect(editor(page)).toContainText(fileList[0].path, MONACO_LOAD)
}

const nav = (page: Page) => page.getByRole('navigation', { name: FILE_DRAFT_TEXT.listLabel })
const panel = (page: Page) => page.getByTestId('file-draft-panel')
const row = (page: Page) => nav(page).getByRole('button', { expanded: false })
const menu = (page: Page) => page.getByRole('list', { name: FILE_DRAFT_TEXT.menuLabel })
const editor = (page: Page) => page.locator('.monaco-editor').first()
const runReview = (page: Page) => page.getByRole('button', { name: 'Run review' })
const sideScroll = (page: Page) => page.evaluate(() => document.scrollingElement!.scrollWidth - window.innerWidth)

async function boxOf(locator: Locator) {
  const box = await locator.boundingBox()
  if (!box) throw new Error('no bounding box')
  return box
}

// True when a tap at the centre of the element reaches it (nothing lies over it).
async function isTappable(locator: Locator) {
  return locator.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
    return hit !== null && element.contains(hit)
  })
}

for (const width of [320, 390]) {
  for (const count of [5, 20]) {
    test(`phone ${width} px, ${count} files: every file is reachable and opens, no side-scroll, the list scrolls inside half the screen`, async ({ page }) => {
      const height = 700
      await page.setViewportSize({ width, height })
      const fileList = fileListOf(count)
      await importFiles(page, fileList)

      // Closed: one row, at most 3 rem, inside the screen; the page does not scroll sideways.
      const panelBox = await boxOf(panel(page))
      expect(panelBox.height).toBeLessThanOrEqual(48)
      expect(panelBox.x + panelBox.width).toBeLessThanOrEqual(width + 0.5)
      await expect(row(page)).toContainText(`1 of ${count}`)
      expect(await sideScroll(page)).toBeLessThanOrEqual(0)

      // Open: a vertical list under the row, at most half the screen high, scrolling up and down.
      await row(page).click()
      await expect(menu(page)).toBeVisible()
      const menuBox = await boxOf(menu(page))
      expect(menuBox.y).toBeGreaterThanOrEqual(panelBox.y + panelBox.height - 1)
      expect(menuBox.height).toBeLessThanOrEqual(height / 2 + 1)
      expect(menuBox.x).toBeGreaterThanOrEqual(0)
      expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(width + 0.5)
      const scroll = await menu(page).evaluate((element) => ({
        overflowY: getComputedStyle(element).overflowY,
        overflowX: element.scrollWidth - element.clientWidth,
        scrollable: element.scrollHeight > element.clientHeight
      }))
      expect(scroll.overflowY).toBe('auto')
      expect(scroll.overflowX).toBeLessThanOrEqual(0)
      if (count === 20) expect(scroll.scrollable).toBe(true)
      await expect(menu(page).getByRole('button')).toHaveCount(count)
      expect(await sideScroll(page)).toBeLessThanOrEqual(0)

      // Every row is a full-width row: name, language and mark.
      const firstRow = menu(page).getByRole('button').first()
      await expect(firstRow).toContainText(fileList[0].path)
      await expect(firstRow).toContainText('TypeScript')
      await expect(firstRow.getByTestId('file-draft-mark')).toHaveText('Draft')
      expect((await boxOf(firstRow)).width).toBeGreaterThan(menuBox.width - 24)

      // The last file is reached by scrolling the list and opens.
      const last = fileList[count - 1]
      const lastRow = menu(page).getByRole('button', { name: new RegExp(last.path.replaceAll('.', '\\.')) })
      await lastRow.scrollIntoViewIfNeeded()
      await lastRow.click()
      await expect(menu(page)).toBeHidden()
      await expect(editor(page)).toContainText(last.path)
      await expect(row(page)).toContainText(`${count} of ${count}`)
      await expect(page.getByTestId('file-draft-summary')).toContainText('the-last-file-of-the-import.ts')

      // A file in the middle too.
      const middle = fileList[Math.floor(count / 2)]
      await row(page).click()
      await menu(page).getByRole('button', { name: new RegExp(middle.path.replaceAll('.', '\\.')) }).click()
      await expect(editor(page)).toContainText(middle.path)

      // With the list closed, Run review is not covered.
      await runReview(page).scrollIntoViewIfNeeded()
      expect(await isTappable(runReview(page))).toBe(true)
      expect(await sideScroll(page)).toBeLessThanOrEqual(0)
    })
  }
}

test('phone keyboard and outside tap: Enter, arrows, Escape and a tap outside close the list and return the focus to the row', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const fileList = fileListOf(5)
  await importFiles(page, fileList)

  await row(page).focus()
  await page.keyboard.press('Enter')
  await expect(menu(page)).toBeVisible()
  await expect(nav(page).getByRole('button', { expanded: true })).toHaveAttribute('aria-controls', await menu(page).getAttribute('id') ?? '')
  await expect(menu(page).getByRole('button').first()).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(menu(page).getByRole('button').nth(1)).toBeFocused()
  await page.keyboard.press('End')
  await expect(menu(page).getByRole('button').last()).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(menu(page)).toBeHidden()
  await expect(row(page)).toBeFocused()

  await page.keyboard.press('Space')
  await expect(menu(page)).toBeVisible()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect(menu(page)).toBeHidden()
  await expect(editor(page)).toContainText(fileList[1].path)
  await expect(row(page)).toBeFocused()

  // A tap outside (in the page's side gutter, under the open list) closes the list and the focus
  // returns to the row.
  await row(page).click()
  await expect(menu(page)).toBeVisible()
  const menuBox = await boxOf(menu(page))
  await page.mouse.click(4, menuBox.y + menuBox.height + 12)
  await expect(menu(page)).toBeHidden()
  await expect(row(page)).toBeFocused()
})

test('phone: after Run review the row and the list show the new mark; the next file is chosen from the list', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const fileList = fileListOf(5)
  await importFiles(page, fileList)
  await runReview(page).click()
  await expect(page).toHaveURL(/\/review\/(?!new)[^/]+$/)
  await expect(row(page).getByTestId('file-draft-mark')).toHaveText(/Analyzing|Reviewed/)
  await expect(row(page).getByTestId('file-draft-mark')).toHaveText('Reviewed', { timeout: 20_000 })
  await row(page).click()
  await expect(menu(page).getByTestId('file-draft-mark')).toHaveText(['Reviewed', 'Draft', 'Draft', 'Draft', 'Draft'])
  await menu(page).getByRole('button').nth(2).click()
  await expect(page).toHaveURL(/\/review\/new$/)
  await expect(editor(page)).toContainText(fileList[2].path)
  await expect(row(page)).toContainText('3 of 5')
})

test('phone reduced motion: the dropdown arrow does not animate', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width: 390, height: 844 })
  await importFiles(page, fileListOf(5))
  const arrow = row(page).locator('svg').last()
  expect(await arrow.evaluate((element) => getComputedStyle(element).transitionDuration)).toMatch(/^0s/)
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await expect.poll(() => arrow.evaluate((element) => getComputedStyle(element).transitionProperty)).toMatch(/transform|rotate|all/)
})
