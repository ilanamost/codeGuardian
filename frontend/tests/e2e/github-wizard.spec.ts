import type { Page } from '@playwright/test'
import { API_PATH } from '../../src/lib/api.constants'
import { GITHUB_TEXT } from '../../src/lib/github.constants'
import { FORM_ERROR_MESSAGE, GITHUB_WIZARD_HINT } from '../../src/utils/error-messages'
import { FAKE_GITHUB_FILE_ID, FAKE_GITHUB_REPO, FAKE_GITHUB_USER, FAKE_GITHUB_USER_NAME } from './e2e.constants'
import { apiRoute, connectFakeGithub, expect, MONACO_LOAD, test } from './fixture'

// Plan 030 (contract 0.9.0): the GitHub Integration wizard on the real backend, which answers
// from its test-only fake GitHub (GITHUB_FAKE=true in playwright.config.ts), so no test reaches
// api.github.com.

function waitForCall(page: Page, method: string, path: string) {
  return page.waitForResponse((response) => response.request().method() === method && response.url().split('?')[0] === apiRoute(path))
}

// Monaco renders spaces as non-breaking spaces; only the visible lines are in the DOM.
async function editorText(page: Page): Promise<string> {
  const text = await page.locator('.monaco-editor .view-lines').first().innerText()
  return text.replace(/ /g, ' ')
}

function usernameField(page: Page) {
  return page.getByRole('textbox', { name: 'GitHub user name' })
}

function repoRadioList(page: Page) {
  return page.getByRole('list', { name: 'Repositories' }).getByRole('radio')
}

test('connect by user name, search, select demo, import a file into the editor', async ({ page }) => {
  await page.goto('/github')
  await expect(page.getByText('Not connected')).toBeVisible()
  await expect(page.getByText(GITHUB_TEXT.publicOnly)).toBeVisible()

  // Checked in the browser first: an empty name sends nothing.
  let connectCount = 0
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url() === apiRoute(API_PATH.githubConnect)) connectCount += 1
  })
  await page.getByRole('button', { name: 'Connect GitHub' }).click()
  await expect(page.getByText(FORM_ERROR_MESSAGE.githubUsernameRequired)).toBeVisible()
  await usernameField(page).fill('-bad-')
  await page.getByRole('button', { name: 'Connect GitHub' }).click()
  await expect(page.getByText(FORM_ERROR_MESSAGE.githubUsernameInvalid)).toBeVisible()
  expect(connectCount).toBe(0)

  const connect = waitForCall(page, 'POST', API_PATH.githubConnect)
  await usernameField(page).fill(FAKE_GITHUB_USER)
  await page.getByRole('button', { name: 'Connect GitHub' }).click()
  const response = await connect
  expect(response.status()).toBe(200)
  expect(response.request().postDataJSON()).toEqual({ username: FAKE_GITHUB_USER })
  expect(await response.json()).toEqual({ login: FAKE_GITHUB_USER, name: FAKE_GITHUB_USER_NAME })

  await expect(page.getByText(`Connected as ${FAKE_GITHUB_USER}`)).toBeVisible()
  await expect(page.getByText(FAKE_GITHUB_USER_NAME)).toBeVisible()
  await expect(usernameField(page)).toHaveCount(0)
  // The fake user's repositories, most recently updated first (GitHub's order).
  await expect(repoRadioList(page)).toHaveCount(6)
  await expect(page.getByRole('note')).toHaveCount(0)

  const search = waitForCall(page, 'GET', API_PATH.githubRepo)
  await page.getByRole('searchbox', { name: 'Search repositories' }).fill('DEM')
  expect((await search).url()).toContain('query=DEM')
  await expect(repoRadioList(page)).toHaveCount(1)

  await page.getByRole('radio', { name: FAKE_GITHUB_REPO }).click()
  await page.getByRole('button', { name: 'Next' }).click()
  // Only supported files that fit the single-file limit: no README, image or huge.ts.
  await expect(page.getByRole('list', { name: 'Files' }).getByRole('checkbox')).toHaveCount(2)
  await expect(page.getByRole('checkbox', { name: 'src/util.py' })).toBeVisible()
  await page.getByRole('checkbox', { name: 'src/greet.ts' }).check()

  const file = waitForCall(page, 'GET', API_PATH.githubFile(FAKE_GITHUB_REPO, FAKE_GITHUB_FILE_ID))
  await page.getByRole('button', { name: 'Approve' }).click()
  expect((await file).status()).toBe(200)

  await expect(page.getByText(`Imported src/greet.ts from ${FAKE_GITHUB_REPO}`)).toBeVisible()
  // A new, unsaved review with the file's code.
  await expect(page).toHaveURL(/\/review\/new$/)
  await expect(page.getByTestId('review-name')).toHaveText('src/greet.ts')
  await expect(page.locator('.monaco-editor').first()).toBeVisible(MONACO_LOAD)
  await expect.poll(() => editorText(page)).toContain('export function greet(name: any) {')
  await expect(page.getByRole('button', { name: 'Run review' })).toBeEnabled()
})

test('Switch account returns to the connect card and the server forgets the account', async ({ page, request }) => {
  await page.goto('/github')
  await connectFakeGithub(page)
  await page.getByRole('button', { name: 'Switch account' }).click()

  await expect(usernameField(page)).toHaveValue('')
  await expect(page.getByText('Not connected')).toBeVisible()
  await expect(page.getByRole('list', { name: 'Repositories' })).toHaveCount(0)
  // 409 conflict: the repository routes need a connection again.
  expect((await request.get(apiRoute(API_PATH.githubRepo))).status()).toBe(409)

  await connectFakeGithub(page, 'empty-user')
  await expect(page.getByText(GITHUB_TEXT.noRepo)).toBeVisible()
})

test('an unknown user name shows the user-not-found toast and keeps the field', async ({ page }) => {
  await page.goto('/github')
  await usernameField(page).fill('no-such-user')
  await page.getByRole('button', { name: 'Connect GitHub' }).click()

  await expect(page.getByText(`GitHub authorization failed. ${GITHUB_WIZARD_HINT.userNotFound}`)).toHaveCount(1)
  await expect(usernameField(page)).toHaveValue('no-such-user')
  await expect(page.getByText('Not connected')).toBeVisible()
})

test('GitHub\'s rate limit on connect shows its toast', async ({ page }) => {
  await page.goto('/github')
  await usernameField(page).fill('rate-limited')
  await page.getByRole('button', { name: 'Connect GitHub' }).click()

  await expect(page.getByText(`GitHub authorization failed. ${GITHUB_WIZARD_HINT.rateLimited}`)).toHaveCount(1)
})

test('a user with more than 100 repositories gets the "Showing the first 100" note', async ({ page }) => {
  await page.goto('/github')
  await connectFakeGithub(page, 'busy-user')

  await expect(page.getByRole('note')).toHaveText(GITHUB_TEXT.repoTruncated(100))
  await expect(repoRadioList(page)).toHaveCount(100)
})

test('a repository with more than 500 files gets the note, and one without a commit the empty state', async ({ page }) => {
  await page.goto('/github')
  await connectFakeGithub(page)
  await page.getByRole('radio', { name: 'many-file' }).click()
  await page.getByRole('button', { name: 'Next' }).click()

  await expect(page.getByRole('note')).toHaveText(GITHUB_TEXT.fileTruncated(500))
  await expect(page.getByRole('list', { name: 'Files' }).getByRole('checkbox')).toHaveCount(500)

  await page.getByRole('button', { name: 'Select repository' }).click()
  await page.getByRole('radio', { name: 'empty' }).click()
  await page.getByRole('button', { name: 'Next' }).click()
  await expect(page.getByText(GITHUB_TEXT.noFile)).toBeVisible()
  await expect(page.getByRole('note')).toHaveCount(0)
})

for (const [repo, hint] of [
  ['rate-limited', GITHUB_WIZARD_HINT.rateLimited],
  ['broken', 'GitHub is unavailable or sent an unexpected answer, try again later.'],
  ['slow', 'GitHub took too long to answer, please try again.']
] as const) {
  test(`the file list of ${repo} shows one constant toast`, async ({ page }) => {
    await page.goto('/github')
    await connectFakeGithub(page)
    await page.getByRole('radio', { name: repo }).click()

    await expect(page.getByText(`Could not load the repository files. ${hint}`)).toHaveCount(1)
  })
}

test('a 409 after the server lost the connection shows the toast and the connect card', async ({ page, request }) => {
  await page.goto('/github')
  await connectFakeGithub(page)
  // Switch account somewhere else (another tab): the server forgets the account.
  expect((await request.post(apiRoute(API_PATH.githubDisconnect))).status()).toBe(204)

  await page.getByRole('searchbox', { name: 'Search repositories' }).fill('d')

  await expect(page.getByText(`Could not load your GitHub repositories. ${GITHUB_WIZARD_HINT.notConnected}`)).toHaveCount(1)
  await expect(usernameField(page)).toBeVisible()
  await expect(page.getByText('Not connected')).toBeVisible()
})
