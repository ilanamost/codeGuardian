import type { Page } from '@playwright/test'
import { GITHUB_LINK_TEXT } from '../../src/lib/github.constants'
import { FILE_DRAFT_TEXT } from '../../src/lib/review.constants'
import { ROUTE_PATH } from '../../src/lib/route.constants'
import { FORM_ERROR_MESSAGE, GITHUB_LINK_HINT } from '../../src/utils/error-messages'
import { expect, MONACO_LOAD, test } from './fixture'

// Plan 023: "Paste a GitHub link" on the GitHub Integration page, against the real backend on
// its fake GitHub (GITHUB_FAKE=true in playwright.config.ts), so no test calls the real GitHub.
const githubPage = '/github'
const base = 'https://github.com/example-org'
const prefix = 'Could not import the GitHub link.'

const toastList = (page: Page) => page.locator('[data-sonner-toast]')

async function importLink(page: Page, url: string) {
  await page.goto(githubPage)
  await page.getByRole('textbox', { name: GITHUB_LINK_TEXT.label }).fill(url)
  await page.getByRole('button', { name: GITHUB_LINK_TEXT.import }).click()
}

test('a file link opens in the editor as a new review, without connecting GitHub', async ({ page }) => {
  await importLink(page, `${base}/demo/blob/main/src/greet.ts`)

  await expect(page.getByText('Imported greet.ts (1 file)')).toBeVisible()
  await expect(page).toHaveURL(new RegExp(`${ROUTE_PATH.newReview}$`))
  await expect(page.getByTestId('review-name')).toHaveText('greet.ts')
  await expect(page.locator('.monaco-editor')).toContainText('export function greet(name: any) {', MONACO_LOAD)
  await expect(page.getByRole('button', { name: 'Run review' })).toBeEnabled()
})

test('a pull request imports its kept files and the toast lists the skipped ones', async ({ page }) => {
  await importLink(page, `${base}/demo/pull/1`)

  await expect(page.getByText('Imported example-org/demo#1 (2 files)')).toBeVisible()
  await expect(page.getByText('Skipped 2 files: assets/logo.png (unsupported type), src/old.js (removed).', { exact: false })).toBeVisible()
  // Plan 034 (Open Question 3): each kept file is its own draft in the file list, with its own
  // code (`fileContentList`, no header line); the skipped files are listed too.
  const list = page.getByRole('navigation', { name: FILE_DRAFT_TEXT.listLabel })
  await expect(list.getByRole('button')).toHaveCount(4)
  await expect(list.getByRole('button', { name: /src\/old\.js/ })).toBeDisabled()
  await expect(page.getByTestId('review-name')).toHaveText('src/greet.ts')
  await expect(page.locator('.monaco-editor')).toContainText('export function greet(name: any) {', MONACO_LOAD)
  await expect(page.locator('.monaco-editor')).not.toContainText('=====')
  await list.getByRole('button', { name: /src\/util\.py/ }).click()
  await expect(page.getByTestId('review-name')).toHaveText('src/util.py')
  await expect(page.locator('.monaco-editor')).toContainText('def total(value_list):')
})

test('Run review works on the imported code', async ({ page }) => {
  await importLink(page, `${base}/demo/blob/main/src/greet.ts`)
  await expect(page.getByTestId('review-name')).toHaveText('greet.ts')

  await page.getByRole('button', { name: 'Run review' }).click()
  await expect(page).toHaveURL(/\/review\/(?!new)[^/]+$/)
})

test('a link of the wrong shape is refused in the field, before anything is sent', async ({ page }) => {
  let sent = false
  page.on('request', (request) => {
    if (request.url().includes('/api/github/import')) sent = true
  })
  await importLink(page, `${base}/demo/tree/main/src`)

  await expect(page.getByRole('alert')).toHaveText(FORM_ERROR_MESSAGE.githubLinkInvalid)
  await expect(page).toHaveURL(new RegExp(`${githubPage}$`))
  expect(sent).toBe(false)
})

const failureList: [string, string, string][] = [
  ['404 not found or private', `${base}/demo/blob/main/src/missing.ts`, GITHUB_LINK_HINT.notFound],
  ['413 file over the limit', `${base}/demo/blob/main/src/huge.ts`, GITHUB_LINK_HINT.limit.fileChar],
  ['422 unsupported file type', `${base}/demo/blob/main/logo.png`, GITHUB_LINK_HINT.validation],
  ['429 rate limited', `${base}/rate-limited/blob/main/a.ts`, GITHUB_LINK_HINT.rateLimited],
  ['502 GitHub failed', `${base}/broken/blob/main/a.ts`, 'GitHub is unavailable or sent an unexpected answer, try again later.'],
  ['504 GitHub timed out', `${base}/slow/blob/main/a.ts`, 'GitHub took too long to answer, please try again.']
]

for (const [name, url, hint] of failureList) {
  test(`${name}: one error toast, and the page stays`, async ({ page }) => {
    await importLink(page, url)

    await expect(page.getByText(`${prefix} ${hint}`)).toBeVisible()
    await expect(toastList(page)).toHaveCount(1)
    await expect(page).toHaveURL(new RegExp(`${githubPage}$`))
    await expect(page.getByRole('button', { name: GITHUB_LINK_TEXT.import })).toBeEnabled()
  })
}
