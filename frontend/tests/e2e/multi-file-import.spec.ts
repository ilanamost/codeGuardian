import type { Page, Route } from '@playwright/test'
import { API_PATH } from '../../src/lib/api.constants'
import { FILE_DRAFT_TEXT } from '../../src/lib/review.constants'
import { ERROR_MESSAGE } from '../../src/utils/error-messages'
import { FAKE_GITHUB_REPO } from './e2e.constants'
import { apiRoute, connectFakeGithub, expect, fulfillJson, MONACO_LOAD, test } from './fixture'

// Plan 034, Workstream B, on the real backend and its fake GitHub (GITHUB_FAKE=true). The fake
// repository `demo` lists two importable files (src/greet.ts, src/util.py); a third one,
// src/extra.ts, is added to the wizard's file list here (and answered or failed), so three files
// can be imported.

const EXTRA_PATH = 'src/extra.ts'
const EXTRA_ID = Buffer.from(EXTRA_PATH).toString('base64url')
const EXTRA_CODE = 'export const extra = (value: number) => value * 2\n'

async function addThirdFile(page: Page, answer: 'ok' | 'fail') {
  await page.route(apiRoute(API_PATH.githubFileList(FAKE_GITHUB_REPO)), async (route: Route) => {
    if (route.request().method() !== 'GET') return route.continue()
    const response = await route.fetch()
    const body = (await response.json()) as { items: unknown[]; truncated: boolean }
    return route.fulfill({ response, json: { ...body, items: [...body.items, { id: EXTRA_ID, path: EXTRA_PATH, language: 'TypeScript' }] } })
  })
  await page.route(apiRoute(API_PATH.githubFile(FAKE_GITHUB_REPO, EXTRA_ID)), (route: Route) =>
    answer === 'ok'
      ? fulfillJson(route, 200, { id: EXTRA_ID, path: EXTRA_PATH, language: 'TypeScript', content: EXTRA_CODE })
      : fulfillJson(route, 500, { error: { code: 'internal_error', message: 'Forced by the e2e test.' } })
  )
}

async function importThreeFiles(page: Page) {
  await page.goto('/github')
  await connectFakeGithub(page)
  await page.getByRole('radio', { name: FAKE_GITHUB_REPO }).click()
  await page.getByRole('button', { name: 'Next' }).click()
  for (const path of ['src/greet.ts', 'src/util.py', EXTRA_PATH]) await page.getByRole('checkbox', { name: path }).check()
  await page.getByRole('button', { name: 'Approve' }).click()
  const list = page.getByRole('navigation', { name: FILE_DRAFT_TEXT.listLabel })
  await expect(list).toBeVisible()
  return list
}

const editor = (page: Page) => page.locator('.monaco-editor').first()
const fileButton = (list: ReturnType<Page['getByRole']>, path: string) => list.getByRole('button', { name: new RegExp(path.replace('.', '\\.')) })

test('import 3 files, switch between them, run two reviews separately', async ({ page, request }) => {
  await addThirdFile(page, 'ok')
  const list = await importThreeFiles(page)

  await expect(page.getByText(`Imported 3 files from ${FAKE_GITHUB_REPO}`)).toBeVisible()
  await expect(page).toHaveURL(/\/review\/new$/)
  await expect(list.getByRole('button')).toHaveCount(3)
  await expect(list.getByTestId('file-draft-mark')).toHaveText(['Draft', 'Draft', 'Draft'])
  await expect(fileButton(list, 'src/greet.ts')).toHaveAttribute('aria-current', 'true')
  await expect(editor(page)).toContainText('export function greet', MONACO_LOAD)

  // Switching shows each file's own code and language.
  await fileButton(list, 'src/util.py').click()
  await expect(page.getByTestId('review-name')).toHaveText('src/util.py')
  await expect(editor(page)).toContainText('def total')
  await expect(page.getByRole('combobox', { name: /language/i }).first()).toHaveValue('Python')
  await fileButton(list, EXTRA_PATH).click()
  await expect(editor(page)).toContainText('export const extra')

  // Run review for the selected file only: its own review, the others stay drafts.
  await page.getByRole('button', { name: 'Run review' }).click()
  await expect(page).toHaveURL(/\/review\/(?!new)[^/]+$/)
  const firstId = new URL(page.url()).pathname.split('/').at(-1)
  await expect(list).toBeVisible()
  await expect(fileButton(list, EXTRA_PATH).getByTestId('file-draft-mark')).toHaveText(/Analyzing|Reviewed/)
  await expect(fileButton(list, 'src/greet.ts').getByTestId('file-draft-mark')).toHaveText('Draft')

  await fileButton(list, 'src/greet.ts').click()
  await expect(page).toHaveURL(/\/review\/new$/)
  await expect(editor(page)).toContainText('export function greet')
  await page.getByRole('button', { name: 'Run review' }).click()
  await expect(page).toHaveURL(/\/review\/(?!new)[^/]+$/)
  const secondId = new URL(page.url()).pathname.split('/').at(-1)
  expect(secondId).not.toBe(firstId)
  await expect(fileButton(list, 'src/util.py').getByTestId('file-draft-mark')).toHaveText('Draft')

  // Two reviews exist, one per file, each with its own code.
  const reviewList = (await (await request.get(apiRoute(API_PATH.review))).json()) as { id: string; title: string }[]
  expect(reviewList.map((item) => item.title).sort()).toEqual(['src/extra.ts', 'src/greet.ts'])
  const first = (await (await request.get(apiRoute(API_PATH.reviewById(firstId ?? '')))).json()) as { content: string }
  expect(first.content).toBe(EXTRA_CODE)

  // Opening a reviewed file goes to its review.
  await fileButton(list, EXTRA_PATH).click()
  await expect(page).toHaveURL(new RegExp(`/review/${firstId}$`))

  // Leaving with a file still unreviewed asks first.
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Review History' }).click()
  const dialog = page.getByRole('dialog', { name: FILE_DRAFT_TEXT.leaveTitle })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: FILE_DRAFT_TEXT.stay }).click()
  await expect(list).toBeVisible()
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Review History' }).click()
  await dialog.getByRole('button', { name: FILE_DRAFT_TEXT.leaveConfirm }).click()
  await expect(page).toHaveURL(/\/history$/)
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'New Review' }).click()
  await expect(page.getByRole('navigation', { name: FILE_DRAFT_TEXT.listLabel })).toHaveCount(0)
})

test('a failed file download is listed with its error and the other files are kept', async ({ page }) => {
  await addThirdFile(page, 'fail')
  const list = await importThreeFiles(page)

  await expect(page.getByText(`Imported 2 of 3 files from ${FAKE_GITHUB_REPO}`)).toBeVisible()
  await expect(page.getByText(new RegExp(`^${ERROR_MESSAGE.githubFileImport.replace('.', '\\.')}`)).first()).toBeVisible()
  await expect(list.getByTestId('file-draft-mark')).toHaveText(['Draft', 'Draft', 'Not imported'])
  await expect(fileButton(list, EXTRA_PATH)).toBeDisabled()
  await expect(editor(page)).toContainText('export function greet', MONACO_LOAD)
  await fileButton(list, 'src/util.py').click()
  await expect(editor(page)).toContainText('def total')
})

for (const [label, width, height] of [
  ['phone 320', 320, 640],
  ['tablet 768', 768, 1024],
  ['desktop 1280', 1280, 800]
] as const) {
  test(`file list layout at ${label}: the editor stays visible, no page side-scroll`, async ({ page }) => {
    await page.setViewportSize({ width, height })
    await addThirdFile(page, 'ok')
    const list = await importThreeFiles(page)
    await expect(editor(page)).toBeVisible(MONACO_LOAD)

    const listBox = await list.boundingBox()
    const editorBox = await editor(page).boundingBox()
    expect(listBox && editorBox).toBeTruthy()
    if (width < 768) {
      // Plan 038, Revision 1: a one-row dropdown above the editor (it replaced the horizontal
      // strip); its list opens under it and scrolls up and down.
      expect(listBox!.y + listBox!.height).toBeLessThanOrEqual(editorBox!.y + 1)
      expect(listBox!.height).toBeLessThanOrEqual(48)
      const row = list.getByRole('button', { expanded: false })
      await expect(row).toContainText('1 of 3')
      await row.click()
      const menu = list.getByRole('list', { name: FILE_DRAFT_TEXT.menuLabel })
      await expect(menu).toBeVisible()
      expect(await menu.evaluate((element) => getComputedStyle(element).overflowY)).toBe('auto')
      await expect(menu.getByRole('button')).toHaveCount(3)
      await page.keyboard.press('Escape')
      await expect(menu).toBeHidden()
    } else {
      // A vertical list beside the page.
      expect(listBox!.x + listBox!.width).toBeLessThanOrEqual(editorBox!.x + 1)
    }
    expect(editorBox!.y).toBeLessThan(height)
    const sideScroll = await page.evaluate(() => document.scrollingElement!.scrollWidth - window.innerWidth)
    expect(sideScroll).toBeLessThanOrEqual(0)
  })
}
