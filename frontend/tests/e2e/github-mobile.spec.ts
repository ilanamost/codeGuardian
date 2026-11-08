import { devices, type Locator, type Page } from '@playwright/test'
import { GITHUB_LINK_TEXT } from '../../src/lib/github.constants'
import { SESSION_TOKEN_STORAGE_KEY } from '../../src/lib/api.constants'
import { BACKEND_URL, DEMO_PASSWORD, DEMO_USERNAME, FAKE_GITHUB_FILE_ID, FAKE_GITHUB_REPO, FAKE_GITHUB_USER } from './e2e.constants'
import { expect, MONACO_LOAD, test } from './fixture'

// Plan 049 (Q4 A) and plan 050: a phone check of the GitHub Integration wizard and the link import, with the
// session cookie stripped (Safari with a cross-site API) and the session token in localStorage,
// against the real backend on its fake GitHub. The iPhone 13 profile without its WebKit browser
// (the e2e project runs chromium) plus a 320x568 phone. Every button on the page is at least
// 44x44 px (hard assertions, plan 050); a radio or checkbox is tapped through its row.
const { defaultBrowserType: _browser, ...iphone } = devices['iPhone 13']
const MIN_TARGET = 44
const viewportList = [
  { name: 'iPhone 13 390x844', use: iphone },
  { name: 'small phone 320x568', use: { ...iphone, viewport: { width: 320, height: 568 }, screen: { width: 320, height: 568 } } }
]

test.use({ signIn: false })

async function noHorizontalScroll(page: Page) {
  const size = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: window.innerWidth }))
  expect(size.scroll, 'document is wider than the screen').toBeLessThanOrEqual(size.width)
}

async function navTop(page: Page): Promise<number> {
  const box = await page.getByRole('navigation', { name: 'Mobile' }).boundingBox()
  expect(box, 'the bottom navigation is shown').not.toBeNull()
  return box!.y
}

// The control can be scrolled to, lies inside the screen above the bottom navigation, and is the
// element a touch at its centre would hit.
async function reachable(page: Page, control: Locator) {
  await control.scrollIntoViewIfNeeded()
  const box = await control.boundingBox()
  expect(box).not.toBeNull()
  const top = await navTop(page)
  expect(box!.y + box!.height, 'covered by the bottom navigation').toBeLessThanOrEqual(top + 0.5)
  const hit = await control.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    const found = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
    return found !== null && (element === found || element.contains(found) || found.contains(element))
  })
  expect(hit, 'another element sits on top of the control').toBe(true)
}

// A radio or checkbox is tapped through its row (the label around it); other controls are measured as they are.
async function targetSize(control: Locator, row = false) {
  await control.scrollIntoViewIfNeeded()
  const box = await (row ? control.locator('xpath=ancestor::label') : control).boundingBox()
  expect(box).not.toBeNull()
  expect(box!.width, 'tap target width').toBeGreaterThanOrEqual(MIN_TARGET)
  expect(box!.height, 'tap target height').toBeGreaterThanOrEqual(MIN_TARGET)
}

for (const viewport of viewportList) {
  test.describe(viewport.name, () => {
    test.use(viewport.use)

    test.beforeEach(async ({ page, playwright }) => {
      // Strip every Set-Cookie, as Safari does for a cross-site API.
      await page.route(`${BACKEND_URL}/**`, async (route) => {
        if (route.request().method() === 'OPTIONS') return route.continue()
        const api = await playwright.request.newContext()
        const response = await api.fetch(route.request())
        const headers = { ...response.headers() }
        delete headers['set-cookie']
        const body = await response.body()
        await api.dispose()
        return route.fulfill({ status: response.status(), headers, body })
      })
      await page.goto('/login')
      await page.getByLabel('User name').fill(DEMO_USERNAME)
      await page.getByLabel('Password', { exact: true }).click()
      await page.getByLabel('Password', { exact: true }).fill(DEMO_PASSWORD)
      await page.getByRole('button', { name: 'Sign in' }).click()
      await expect(page.getByRole('navigation', { name: 'Mobile' })).toBeVisible()
      expect(await page.context().cookies()).toEqual([])
      expect(await page.evaluate((key) => window.localStorage.getItem(key), SESSION_TOKEN_STORAGE_KEY)).not.toBeNull()
    })

    test('the wizard: connect, search, pick a repository, tick a file, import', async ({ page }) => {
      await page.goto('/github')
      await noHorizontalScroll(page)
      const field = page.getByRole('textbox', { name: 'GitHub user name' })
      const connectButton = page.getByRole('button', { name: 'Connect GitHub' })
      await reachable(page, field)
      await reachable(page, connectButton)
      await targetSize(connectButton)
      await targetSize(page.getByRole('button', { name: GITHUB_LINK_TEXT.import }))

      await field.fill(FAKE_GITHUB_USER)
      await connectButton.tap()
      await expect(page.getByText(`Connected as ${FAKE_GITHUB_USER}`)).toBeVisible()
      await noHorizontalScroll(page)

      const switchAccount = page.getByRole('button', { name: 'Switch account' })
      await reachable(page, switchAccount)
      await targetSize(switchAccount)

      const radioList = page.getByRole('list', { name: 'Repositories' }).getByRole('radio')
      await expect(radioList).toHaveCount(6)
      const search = page.getByRole('searchbox', { name: 'Search repositories' })
      await reachable(page, search)
      await reachable(page, radioList.first())
      await reachable(page, radioList.last())
      for (let index = 0; index < 6; index += 1) await targetSize(radioList.nth(index), true)

      await search.fill('DEM')
      await expect(radioList).toHaveCount(1)
      const demo = page.getByRole('radio', { name: FAKE_GITHUB_REPO })
      await reachable(page, demo)
      await demo.tap()
      const next = page.getByRole('button', { name: 'Next' })
      await reachable(page, next)
      await targetSize(next)
      await targetSize(page.getByRole('button', { name: 'Cancel' }))
      await next.tap()

      const checkboxList = page.getByRole('list', { name: 'Files' }).getByRole('checkbox')
      await expect(checkboxList).toHaveCount(2)
      await noHorizontalScroll(page)
      await reachable(page, checkboxList.first())
      await reachable(page, checkboxList.last())
      for (let index = 0; index < 2; index += 1) await targetSize(checkboxList.nth(index), true)

      await page.getByRole('checkbox', { name: 'src/greet.ts' }).tap()
      const approve = page.getByRole('button', { name: 'Approve' })
      await reachable(page, approve)
      await targetSize(approve)
      await targetSize(page.getByRole('button', { name: 'Cancel' }))
      await targetSize(page.getByRole('button', { name: 'Select repository' }))
      await approve.tap()

      await expect(page).toHaveURL(/\/review\/new$/)
      await expect(page.getByTestId('review-name')).toHaveText('src/greet.ts')
      await expect(page.locator('.monaco-editor')).toContainText('export function greet(name: any) {', MONACO_LOAD)
      expect(FAKE_GITHUB_FILE_ID).toBeTruthy()
    })

    test('Paste a GitHub link imports into the editor', async ({ page }) => {
      await page.goto('/github')
      await noHorizontalScroll(page)
      const field = page.getByRole('textbox', { name: GITHUB_LINK_TEXT.label })
      const importButton = page.getByRole('button', { name: GITHUB_LINK_TEXT.import })
      await reachable(page, field)
      await field.fill('https://github.com/example-org/demo/blob/main/src/greet.ts')
      await reachable(page, importButton)
      await targetSize(importButton)
      await importButton.tap()

      await expect(page).toHaveURL(/\/review\/new$/)
      await expect(page.getByTestId('review-name')).toHaveText('greet.ts')
      await expect(page.locator('.monaco-editor')).toContainText('export function greet(name: any) {', MONACO_LOAD)
    })
  })
}
