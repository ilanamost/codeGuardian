import type { Page } from '@playwright/test'
import { API_PATH } from '../../src/lib/api.constants'
import { DASHBOARD_EMPTY_TEXT } from '../../src/lib/dashboard.constants'
import { HISTORY_TEXT } from '../../src/lib/review.constants'
import { ROUTE_PATH } from '../../src/lib/route.constants'
import { FAKE_GITHUB_FILE_ID, FAKE_GITHUB_REPO } from './e2e.constants'
import { apiRoute, connectFakeGithub, createReview, expect, FINDING_CODE, test } from './fixture'

// Plan 019 Scope 6: each button that needs the server, against the real backend. Every journey
// asserts the network call and the resulting UI.

// Monaco renders spaces as non-breaking spaces; only the visible lines are in the DOM.
async function editorText(page: Page): Promise<string> {
  const text = await page.locator('.monaco-editor .view-lines').first().innerText()
  return text.replace(/ /g, ' ')
}

function waitForCall(page: Page, method: string, path: string) {
  return page.waitForResponse((response) => response.request().method() === method && response.url() === apiRoute(path))
}

test.describe('Generated tests Regenerate', () => {
  test('asks the backend for new tests and shows the new code', async ({ page, request }) => {
    // The stub analyzer names the generated test after the review title (here `auth-service`).
    const { id } = await createReview(request, { title: 'Auth Service' })
    await page.goto(ROUTE_PATH.review(id))
    await page.getByRole('tab', { name: /Generated tests/ }).click()
    await expect.poll(() => editorText(page)).toContain("describe('auth-service', () => {")

    const call = waitForCall(page, 'POST', API_PATH.generatedTest(id))
    await page.getByRole('button', { name: 'Regenerate' }).click()

    expect((await call).status()).toBe(200)
    await expect(page.getByText('Tests regenerated')).toBeVisible()
    await expect.poll(() => editorText(page)).toContain("describe('auth-service (regenerated)'")

    // The backend stored it: a reload shows the regenerated tests.
    await page.reload()
    await page.getByRole('tab', { name: /Generated tests/ }).click()
    await expect.poll(() => editorText(page)).toContain("describe('auth-service (regenerated)'")
  })
})

// Plan 030: the wizard reads the backend's fake GitHub (GITHUB_FAKE=true) for the fake user.
test.describe('GitHub wizard', () => {
  test('Switch account disconnects on the backend and clears the connected user', async ({ page }) => {
    await page.goto('/github')
    await connectFakeGithub(page)

    const call = waitForCall(page, 'POST', API_PATH.githubDisconnect)
    await page.getByRole('button', { name: 'Switch account' }).click()

    expect((await call).status()).toBe(204)
    await expect(page.getByText('Not connected')).toBeVisible()
    await expect(page.getByText(/Connected as/)).toHaveCount(0)
    await expect(page.getByRole('textbox', { name: 'GitHub user name' })).toHaveValue('')
  })

  test('Import opens the editor with the file content', async ({ page }) => {
    await page.goto('/github')
    await connectFakeGithub(page)
    await page.getByRole('radio', { name: FAKE_GITHUB_REPO }).click()
    await page.getByRole('button', { name: 'Next' }).click()
    await page.getByRole('checkbox', { name: 'src/greet.ts' }).check()

    const call = waitForCall(page, 'GET', API_PATH.githubFile(FAKE_GITHUB_REPO, FAKE_GITHUB_FILE_ID))
    await page.getByRole('button', { name: 'Approve' }).click()

    expect((await call).status()).toBe(200)
    await expect(page.getByText(`Imported src/greet.ts from ${FAKE_GITHUB_REPO}`)).toBeVisible()
    await expect(page).toHaveURL(/\/review\/new$/)
    await expect(page.getByTestId('review-name')).toHaveText('src/greet.ts')
    await expect.poll(() => editorText(page)).toContain('export function greet(name: any) {')
    await expect(page.getByRole('button', { name: 'Run review' })).toBeEnabled()
  })
})

test.describe('Settings account and security', () => {
  test('the Account panel shows the backend profile', async ({ page }) => {
    // Plan 028: the account comes with the session restore (GET /api/session) on load.
    const call = waitForCall(page, 'GET', API_PATH.session)
    await page.goto('/settings')

    const { account: profile } = await (await call).json()
    const panel = page.getByRole('tabpanel')
    await expect(panel.getByText(profile.fullName)).toBeVisible()
    await expect(panel.getByText(profile.email)).toBeVisible()
    await expect(panel.getByText(profile.memberSince)).toBeVisible()
    await expect(panel.getByRole('img', { name: 'Profile image' })).toHaveText('JD')
  })

  async function changePassword(page: Page, current: string, next: string) {
    await page.getByRole('button', { name: 'Update password' }).click()
    await page.getByLabel('Current password', { exact: true }).click()
    await page.getByLabel('Current password', { exact: true }).fill(current)
    await page.getByLabel('New password', { exact: true }).click()
    await page.getByLabel('New password', { exact: true }).fill(next)
    await page.getByLabel('Confirm password', { exact: true }).click()
    await page.getByLabel('Confirm password', { exact: true }).fill(next)
    const call = waitForCall(page, 'PUT', API_PATH.accountPassword)
    await page.getByRole('button', { name: 'Save password' }).click()
    return (await call).status()
  }

  test('a wrong current password shows the field error; a valid change works, and the new password works next time', async ({ page }) => {
    await page.goto('/settings')
    await page.getByRole('tab', { name: 'Security' }).click()

    expect(await changePassword(page, 'not-the-password', 'long-enough-1')).toBe(422)
    await expect(page.getByRole('alert')).toHaveText('Current password is not correct.')
    // An immediate count: a retrying toHaveCount(0) also passes once a shown toast has expired.
    await page.waitForTimeout(500)
    expect(await page.locator('[data-sonner-toast]').count()).toBe(0)
    await page.getByRole('button', { name: 'Cancel' }).click()

    expect(await changePassword(page, 'mock-password', 'long-enough-1')).toBe(204)
    await expect(page.getByText('Password updated')).toBeVisible()

    expect(await changePassword(page, 'mock-password', 'long-enough-2')).toBe(422)
    await expect(page.getByRole('alert')).toHaveText('Current password is not correct.')
    await page.getByRole('button', { name: 'Cancel' }).click()

    expect(await changePassword(page, 'long-enough-1', 'long-enough-2')).toBe(204)
    await expect(page.getByText('Password updated')).toHaveCount(2)
  })

  test('Sign out asks first, then calls DELETE /api/session and shows its toast', async ({ page }) => {
    await page.goto('/settings')
    await page.getByRole('tab', { name: 'Security' }).click()

    const call = waitForCall(page, 'DELETE', API_PATH.session)
    await page.getByRole('button', { name: 'Sign Out' }).click()
    await page.getByRole('dialog', { name: 'Sign out?' }).getByRole('button', { name: 'Sign out' }).click()

    expect((await call).status()).toBe(204)
    await expect(page.getByText('Signed out', { exact: true })).toBeVisible()
    await expect(page).toHaveURL(/\/login$/)
  })
})

test.describe('New review', () => {
  test('blank review -> type code -> save -> completed with stub findings, in History and on the Dashboard', async ({ page }) => {
    await page.goto('/review/new')
    await expect(page.getByText('Not analyzed yet')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Run review' })).toBeDisabled()

    await page.locator('.monaco-editor .view-lines').first().click()
    // One input event: typed key by key, Monaco's suggest widget can swallow characters.
    await page.keyboard.insertText('const value: any = 1 // TODO later')
    await expect.poll(() => editorText(page)).toContain('const value: any = 1')

    const create = waitForCall(page, 'POST', API_PATH.review)
    await page.getByRole('button', { name: 'Run review' }).click()

    const created = await create
    expect(created.status()).toBe(202)
    const { id } = await created.json()
    await expect(page).toHaveURL(new RegExp(`/review/${id}$`))
    await expect(page.getByText('Review started')).toBeVisible()
    await expect(page.getByText('Completed', { exact: true })).toBeVisible()
    await expect(page.getByText('Line 1 - Stub rule no-any')).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Findings (2)' })).toBeVisible()

    await page.goto('/history')
    await expect(page.getByTestId('review-row').getByRole('link', { name: /New review/ })).toBeVisible()

    await page.goto('/')
    await expect(page.getByRole('region', { name: 'Recent Reviews' }).getByRole('link', { name: /New review/ })).toBeVisible()
  })
})

// Plan 019 addendum: the backend starts empty, and the Dashboard is computed from the reviews.
test.describe('Empty store and computed Dashboard', () => {
  test('after the reset the Dashboard and History are empty; two reviews then show up in both', async ({ page, request }) => {
    await page.goto('/')
    for (const id of ['total', 'completed', 'failed', 'quality']) {
      await expect(page.getByTestId(`stat-${id}`)).toContainText('0')
    }
    await expect(page.getByTestId('severity-empty')).toHaveText(new RegExp(DASHBOARD_EMPTY_TEXT.severityTitle))
    await expect(page.getByTestId('category-empty')).toHaveText(new RegExp(DASHBOARD_EMPTY_TEXT.categoryTitle))
    await expect(page.getByTestId('activity-empty')).toHaveText(new RegExp(DASHBOARD_EMPTY_TEXT.activityTitle))
    await expect(page.getByTestId('recent-empty')).toHaveText(new RegExp(DASHBOARD_EMPTY_TEXT.recentTitle))
    expect(await page.getByTestId('review-row').count()).toBe(0)
    await page.goto('/history')
    await expect(page.getByTestId('history-empty')).toHaveText(new RegExp(HISTORY_TEXT.emptyTitle))
    expect(await page.getByTestId('review-row').count()).toBe(0)

    // Security and maintainability findings, then one readability finding.
    const first = await createReview(request, { title: 'Eval service', content: FINDING_CODE })
    const second = await createReview(request, { title: 'Logger', content: 'console.log(1)\n' })
    const detailList = await Promise.all(
      [first, second].map(async ({ id }) => (await request.get(apiRoute(API_PATH.reviewById(id)))).json())
    )
    const findingList = detailList.flatMap((detail) => detail.finding as { category: string }[])
    const quality = Math.round(detailList.reduce((sum, detail) => sum + detail.qualityScore, 0) / detailList.length)

    await page.goto('/')
    await expect(page.getByTestId('stat-total')).toContainText('2')
    await expect(page.getByTestId('stat-completed')).toContainText('2')
    await expect(page.getByTestId('stat-failed')).toContainText('0')
    await expect(page.getByTestId('stat-quality')).toContainText(String(quality))
    await expect(page.getByTestId('severity-total')).toHaveText(String(findingList.length))
    const category = page.getByRole('region', { name: 'Findings by Category' })
    for (const [label, id] of [['Security', 'security'], ['Maintainability', 'maintainability'], ['Readability', 'readability']]) {
      await expect(category).toContainText(label)
      await expect(category).toContainText(String(findingList.filter((item) => item.category === id).length))
    }
    expect(await category.getByText('Performance').count()).toBe(0)
    expect(await page.getByTestId('activity-empty').count()).toBe(0)
    const recent = page.getByRole('region', { name: 'Recent Reviews' })
    await expect(recent.getByTestId('review-row')).toHaveCount(2)
    await expect(recent.getByTestId('review-row').first()).toContainText('Logger')

    await page.goto('/history')
    await expect(page.getByTestId('review-row')).toHaveCount(2)
    await expect(page.getByTestId('review-row').getByRole('link', { name: /Eval service/ })).toBeVisible()
    expect(await page.getByTestId('history-empty').count()).toBe(0)
  })
})
