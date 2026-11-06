import type { Page, Route } from '@playwright/test'
import { ACCOUNT_TEXT } from '../../src/lib/account.constants'
import { API_PATH } from '../../src/lib/api.constants'
import { FILE_DRAFT_TEXT, TEST_CONFIG_TEXT } from '../../src/lib/review.constants'
import { DEMO_PASSWORD, FAKE_GITHUB_REPO } from './e2e.constants'
import { apiRoute, connectFakeGithub, createReview, csrfRequest, expect, fulfillJson, MONACO_LOAD, test } from './fixture'

// QA, plan 034: adversarial checks the implementing agent's specs do not cover. A test marked
// `test.fail()` documents a finding of .orchestrate/qa-report.md: it passes while the defect is
// there and turns red once it is fixed (then drop the mark).

const editor = (page: Page) => page.locator('.monaco-editor').first()
const testsTab = (page: Page) => page.getByRole('tab', { name: /Generated tests/ })
const framework = (page: Page) => page.getByRole('combobox', { name: TEST_CONFIG_TEXT.framework })
const fileList = (page: Page) => page.getByRole('navigation', { name: FILE_DRAFT_TEXT.listLabel })

async function openEdit(page: Page) {
  await page.goto('/settings?section=account')
  await page.getByRole('button', { name: ACCOUNT_TEXT.editDetailsLabel }).click()
  return page.getByRole('form', { name: ACCOUNT_TEXT.editHeading })
}

// ---------- Account edit ----------

test('account: Cancel restores the original values when the form is opened again', async ({ page }) => {
  const form = await openEdit(page)
  await form.getByLabel(ACCOUNT_TEXT.username, { exact: true }).fill('someone.else')
  await form.getByLabel(ACCOUNT_TEXT.email, { exact: true }).fill('else@example.com')
  await form.getByRole('button', { name: ACCOUNT_TEXT.cancelDetails }).click()
  await expect(page.getByTestId('account-username')).toHaveText('john.doe')
  const again = page.getByRole('button', { name: ACCOUNT_TEXT.editDetailsLabel })
  await again.click()
  await expect(form.getByLabel(ACCOUNT_TEXT.username, { exact: true })).toHaveValue('john.doe')
  await expect(form.getByLabel(ACCOUNT_TEXT.email, { exact: true })).not.toHaveValue('else@example.com')
})

test('account: client validation shows inline errors with aria-invalid and sends nothing', async ({ page }) => {
  let sent = 0
  page.on('request', (request) => { if (request.method() === 'PUT' && request.url().endsWith(API_PATH.account)) sent += 1 })
  const form = await openEdit(page)
  await form.getByLabel(ACCOUNT_TEXT.username, { exact: true }).fill('a b')
  await form.getByLabel(ACCOUNT_TEXT.email, { exact: true }).fill('not-an-email')
  await form.getByRole('button', { name: ACCOUNT_TEXT.saveDetails }).click()
  await expect(form.getByLabel(ACCOUNT_TEXT.username, { exact: true })).toHaveAttribute('aria-invalid', 'true')
  await expect(form.getByLabel(ACCOUNT_TEXT.email, { exact: true })).toHaveAttribute('aria-invalid', 'true')
  await expect(form.getByLabel(ACCOUNT_TEXT.currentPassword, { exact: true })).toHaveAttribute('aria-invalid', 'true')
  expect(sent).toBe(0)
})

test('account: show/hide current password toggles the input type', async ({ page }) => {
  const form = await openEdit(page)
  const field = form.getByLabel(ACCOUNT_TEXT.currentPassword, { exact: true })
  await field.click()
  await field.fill('secret-value')
  await expect(field).toHaveAttribute('type', 'password')
  await form.getByRole('button', { name: 'Show current password' }).click()
  await expect(field).toHaveAttribute('type', 'text')
  await form.getByRole('button', { name: 'Hide current password' }).click()
  await expect(field).toHaveAttribute('type', 'password')
})

test('account: a 32-char user name and a CR/LF-free 254-char email save end to end', async ({ page }) => {
  const form = await openEdit(page)
  const email = `${'a'.repeat(242)}@example.com`
  await form.getByLabel(ACCOUNT_TEXT.username, { exact: true }).fill('a'.repeat(32))
  await form.getByLabel(ACCOUNT_TEXT.email, { exact: true }).fill(email)
  await form.getByLabel(ACCOUNT_TEXT.currentPassword, { exact: true }).click()
  await form.getByLabel(ACCOUNT_TEXT.currentPassword, { exact: true }).fill(DEMO_PASSWORD)
  await form.getByRole('button', { name: ACCOUNT_TEXT.saveDetails }).click()
  await expect(page.getByText(ACCOUNT_TEXT.detailsUpdated)).toBeVisible()
  await expect(page.getByTestId('account-email')).toHaveText(email)
  // No horizontal page scroll with the long email in the panel and the sidebar.
  expect(await page.evaluate(() => document.scrollingElement!.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0)
})

test('account: rapid double Save sends a single update', async ({ page }) => {
  let sent = 0
  page.on('request', (request) => { if (request.method() === 'PUT' && new URL(request.url()).pathname === API_PATH.account) sent += 1 })
  const form = await openEdit(page)
  await form.getByLabel(ACCOUNT_TEXT.username, { exact: true }).fill('double.click')
  await form.getByLabel(ACCOUNT_TEXT.currentPassword, { exact: true }).click()
  await form.getByLabel(ACCOUNT_TEXT.currentPassword, { exact: true }).fill(DEMO_PASSWORD)
  const save = form.getByRole('button', { name: ACCOUNT_TEXT.saveDetails })
  await save.dblclick()
  await expect(page.getByTestId('account-username')).toHaveText('double.click')
  expect(sent).toBe(1)
})

test('account: a session of another browser stays valid after the rename and sees the new name', async ({ page, browser }) => {
  const other = await browser.newContext()
  const otherApi = csrfRequest(other.request)
  expect((await otherApi.post(apiRoute(API_PATH.session), { data: { username: 'john.doe', password: DEMO_PASSWORD } })).status()).toBe(200)

  const form = await openEdit(page)
  await form.getByLabel(ACCOUNT_TEXT.username, { exact: true }).fill('renamed.user')
  await form.getByLabel(ACCOUNT_TEXT.currentPassword, { exact: true }).click()
  await form.getByLabel(ACCOUNT_TEXT.currentPassword, { exact: true }).fill(DEMO_PASSWORD)
  await form.getByRole('button', { name: ACCOUNT_TEXT.saveDetails }).click()
  await expect(page.getByTestId('account-username')).toHaveText('renamed.user')

  const read = await otherApi.get(apiRoute(API_PATH.account))
  expect(read.status()).toBe(200)
  expect((await read.json()).username).toBe('renamed.user')
  await other.close()
})

test('account: PUT without the CSRF header is refused', async ({ page }) => {
  const response = await page.request.put(apiRoute(API_PATH.account), { data: { username: 'csrf.attack', currentPassword: DEMO_PASSWORD } })
  expect(response.status()).toBe(403)
})

// Finding F-A1 (a11y), fixed: focus moves into the form on Edit and returns to the Edit button
// after Cancel.
test('account: focus moves into the form on Edit and back to Edit on Cancel', async ({ page }) => {
  await page.goto('/settings?section=account')
  const edit = page.getByRole('button', { name: ACCOUNT_TEXT.editDetailsLabel })
  await edit.focus()
  await page.keyboard.press('Enter')
  const form = page.getByRole('form', { name: ACCOUNT_TEXT.editHeading })
  await expect(form.getByLabel(ACCOUNT_TEXT.username, { exact: true })).toBeFocused({ timeout: 2000 })
  await form.getByRole('button', { name: ACCOUNT_TEXT.cancelDetails }).click()
  await expect(page.getByRole('button', { name: ACCOUNT_TEXT.editDetailsLabel })).toBeFocused({ timeout: 2000 })
})

test('sidebar profile: Tab reaches it and shows a visible focus ring', async ({ page }) => {
  await page.goto('/history')
  const link = page.getByTestId('sidebar-profile')
  await expect(link).toBeVisible()
  let reached = false
  for (let index = 0; index < 40 && !reached; index += 1) {
    await page.keyboard.press('Tab')
    reached = await link.evaluate((element) => element === document.activeElement)
  }
  expect(reached).toBe(true)
  const outline = await link.evaluate((element) => {
    const style = getComputedStyle(element)
    return { style: style.outlineStyle, width: style.outlineWidth }
  })
  expect(outline.style).not.toBe('none')
  expect(outline.width).not.toBe('0px')
  await expect(link).toHaveAttribute('aria-label', /Open account settings for/)
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/settings\?section=account$/)
})

test('phone 375: the bottom nav reaches Settings > Account in one tap (the sidebar is hidden)', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 740 })
  await page.goto('/history')
  await expect(page.getByTestId('sidebar-profile')).toBeHidden()
  await page.getByRole('navigation', { name: 'Mobile' }).getByRole('link', { name: /settings/i }).click()
  await expect(page.getByRole('tab', { name: 'Account' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('button', { name: ACCOUNT_TEXT.editDetailsLabel })).toBeVisible()
})

for (const theme of ['light', 'dark'] as const) {
  test(`account edit form: error text and field labels reach 4.5:1 contrast in the ${theme} theme`, async ({ page }) => {
    const form = await openEdit(page)
    await page.evaluate((value) => document.documentElement.setAttribute('data-theme', value), theme)
    await form.getByLabel(ACCOUNT_TEXT.username, { exact: true }).fill('x')
    await form.getByRole('button', { name: ACCOUNT_TEXT.saveDetails }).click()
    const ratioList = await page.evaluate(() => {
      function rgb(value: string) {
        const match = value.match(/[\d.]+/g)!.map(Number)
        return { r: match[0], g: match[1], b: match[2], a: match[3] ?? 1 }
      }
      function lum({ r, g, b }: { r: number; g: number; b: number }) {
        const f = (c: number) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
      }
      function background(element: Element | null): { r: number; g: number; b: number } {
        while (element) {
          const color = rgb(getComputedStyle(element).backgroundColor)
          if (color.a > 0.5) return color
          element = element.parentElement
        }
        return { r: 255, g: 255, b: 255 }
      }
      const form = document.querySelector('form[aria-label="Edit account details"]')!
      const textList = [...form.querySelectorAll('label, [id$="-error"], p, input')].filter((element) => (element as HTMLElement).offsetParent && element.textContent?.trim() || element.tagName === 'INPUT')
      return textList.map((element) => {
        const front = lum(rgb(getComputedStyle(element).color))
        const back = lum(background(element))
        const ratio = (Math.max(front, back) + 0.05) / (Math.min(front, back) + 0.05)
        return { text: (element.textContent || (element as HTMLInputElement).value || element.tagName).slice(0, 30), ratio: Math.round(ratio * 100) / 100 }
      })
    })
    console.log(`[qa-034 contrast ${theme}]`, JSON.stringify(ratioList))
    for (const { text, ratio } of ratioList) expect(ratio, `${theme}: ${text}`).toBeGreaterThanOrEqual(4.5)
  })
}

// ---------- Test configuration ----------

test('test config: Vitest regenerated, reload, back to Jest (= default) and regenerate stores Jest', async ({ page, request }) => {
  const { id } = await createReview(request, { title: 'Config flip' })
  await page.goto(`/review/${id}`)
  await testsTab(page).click()
  await framework(page).selectOption('Vitest')
  await page.getByRole('button', { name: 'Regenerate' }).click()
  await expect(page.getByText('Tests regenerated')).toBeVisible()
  await page.reload()
  await testsTab(page).click()
  await expect(framework(page)).toHaveValue('Vitest')

  await framework(page).selectOption('Jest')
  await page.getByRole('button', { name: 'Regenerate' }).click()
  await expect(page.getByText('Tests regenerated').first()).toBeVisible()
  await expect.poll(async () => (await (await request.get(apiRoute(API_PATH.reviewById(id)))).json()).testConfig.framework).toBe('Jest')
  const body = await (await request.get(apiRoute(API_PATH.reviewById(id)))).json()
  expect(body.generatedTest[0].code).toContain('@jest/globals')
})

test('test config: Mocha + Error Cases only is kept after leaving to History and reopening', async ({ page, request }) => {
  const { id, title } = await createReview(request, { title: 'Config reopen' })
  await page.goto(`/review/${id}`)
  await testsTab(page).click()
  await framework(page).selectOption('Mocha')
  await page.getByRole('checkbox', { name: 'Unit Tests' }).uncheck()
  await page.getByRole('checkbox', { name: 'Edge Cases' }).uncheck()
  await page.getByRole('button', { name: 'Regenerate' }).click()
  await expect(page.getByText('Tests regenerated')).toBeVisible()
  await expect(page.locator('.monaco-editor .view-lines').last()).toContainText('chai', MONACO_LOAD)

  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Review History' }).click()
  await page.getByText(title).first().click()
  await testsTab(page).click()
  await expect(framework(page)).toHaveValue('Mocha')
  await expect(page.getByRole('checkbox', { name: 'Unit Tests' })).not.toBeChecked()
  await expect(page.getByRole('checkbox', { name: 'Edge Cases' })).not.toBeChecked()
  await expect(page.getByRole('checkbox', { name: 'Error Cases' })).toBeChecked()
})

test('test config: an unsent choice is NOT kept across a reload (only Regenerate stores it)', async ({ page, request }) => {
  const { id } = await createReview(request, { title: 'Unsent choice' })
  await page.goto(`/review/${id}`)
  await testsTab(page).click()
  await framework(page).selectOption('Mocha')
  await page.reload()
  await testsTab(page).click()
  // Documents current behaviour (finding F-C2): the choice reverts to the stored one.
  await expect(framework(page)).toHaveValue('Jest')
})

test('test config: rapid repeated Regenerate clicks send one request at a time', async ({ page, request }) => {
  const { id } = await createReview(request, { title: 'Rapid regen' })
  let inFlight = 0
  let maxInFlight = 0
  await page.route(apiRoute(API_PATH.generatedTest(id)), async (route: Route) => {
    if (route.request().method() !== 'POST') return route.continue()
    inFlight += 1
    maxInFlight = Math.max(maxInFlight, inFlight)
    await new Promise((resolve) => setTimeout(resolve, 400))
    await route.continue()
    inFlight -= 1
  })
  await page.goto(`/review/${id}`)
  await testsTab(page).click()
  const button = page.getByRole('button', { name: 'Regenerate' })
  await button.click()
  await button.click({ force: true }).catch(() => undefined)
  await button.click({ force: true }).catch(() => undefined)
  await expect(page.getByText('Tests regenerated').first()).toBeVisible()
  expect(maxInFlight).toBe(1)
})

for (const theme of ['light', 'dark'] as const) {
  for (const [width, height] of [[320, 640], [375, 740], [768, 1024], [1280, 800]] as const) {
    test(`generated tests layout ${width}px ${theme}: 8 long-named files all visible, Copy all beside the title, no side scroll`, async ({ page, request }) => {
      await page.setViewportSize({ width, height })
      const { id } = await createReview(request, { title: 'Layout stress' })
      // Eight files with long names, so "Tests generated for" must scroll or wrap rather than clip.
      await page.route(apiRoute(API_PATH.reviewById(id)), async (route: Route) => {
        if (route.request().method() !== 'GET') return route.continue()
        const response = await route.fetch()
        const body = await response.json()
        const base = body.generatedTest[0]
        const generatedTest = Array.from({ length: 8 }, (_, index) => ({
          ...base,
          id: `${base.id}-${index}`,
          testFile: `src/features/very-long-directory-name/component-number-${index}-with-a-long-name.test.ts`,
          sourceFile: `src/features/very-long-directory-name/component-number-${index}-with-a-long-name.ts`
        }))
        return route.fulfill({ response, json: { ...body, generatedTest } })
      })
      await page.goto(`/review/${id}`)
      await page.evaluate((value) => document.documentElement.setAttribute('data-theme', value), theme)
      await testsTab(page).click()

      const list = page.getByRole('list', { name: TEST_CONFIG_TEXT.generatedFor })
      await expect(list).toBeAttached()
      const itemList = list.getByRole('button')
      await expect(itemList).toHaveCount(8)
      for (let index = 0; index < 8; index += 1) {
        const item = itemList.nth(index)
        await item.scrollIntoViewIfNeeded()
        await expect(item).toBeInViewport({ ratio: 1 })
        expect(await item.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(0)
      }
      // The heading text itself is not cut.
      const heading = page.getByText(TEST_CONFIG_TEXT.generatedFor, { exact: true })
      expect(await heading.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(0)

      const copyAll = page.getByRole('button', { name: TEST_CONFIG_TEXT.copyAll })
      await expect(copyAll).toHaveAttribute('aria-label', TEST_CONFIG_TEXT.copyAll)
      await expect(copyAll).toHaveAttribute('title', TEST_CONFIG_TEXT.copyAll)
      const style = await copyAll.evaluate((element) => {
        const computed = getComputedStyle(element)
        return { border: computed.borderTopWidth, borderColor: computed.borderTopColor, cursor: computed.cursor, width: element.getBoundingClientRect().width }
      })
      expect(style.border).not.toBe('0px')
      expect(style.width).toBeGreaterThanOrEqual(24)
      const titleBox = await page.getByRole('heading', { name: TEST_CONFIG_TEXT.title }).boundingBox()
      const copyBox = await copyAll.boundingBox()
      expect(Math.abs(titleBox!.y + titleBox!.height / 2 - (copyBox!.y + copyBox!.height / 2))).toBeLessThan(12)
      expect(copyBox!.x).toBeGreaterThan(titleBox!.x)
      // Hover changes the background (clearly a button).
      const before = await copyAll.evaluate((element) => getComputedStyle(element).backgroundColor)
      await copyAll.hover()
      await expect.poll(() => copyAll.evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe(before)
      expect(await page.evaluate(() => document.scrollingElement!.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0)
      // Plan 029 phone order: the editor comes before the configuration panel below md.
      if (width < 768) {
        const order = await page.evaluate((title) => {
          const editorTop = document.querySelectorAll('.monaco-editor')[document.querySelectorAll('.monaco-editor').length - 1].getBoundingClientRect().top
          const heading = [...document.querySelectorAll('h1, h2, h3, h4')].find((element) => element.textContent?.trim() === title)!
          return { editorTop, headingTop: heading.getBoundingClientRect().top }
        }, TEST_CONFIG_TEXT.title)
        expect(order.editorTop).toBeLessThan(order.headingTop)
      }
    })
  }
}

// ---------- Multi-file import ----------

function fakeFile(index: number, size = 60) {
  const path = `src/qa/file-${String(index).padStart(2, '0')}.ts`
  const id = Buffer.from(path).toString('base64url')
  const head = `export const value${index} = ${index}\n`
  return { id, path, language: 'TypeScript', content: head + '/'.repeat(Math.max(0, size - head.length)) }
}

// The wizard's repository file list answers `count` QA files; each file answers via `answer`.
async function routeManyFiles(page: Page, count: number, answer: (index: number, route: Route) => Promise<void>) {
  const list = Array.from({ length: count }, (_, index) => fakeFile(index))
  await page.route(apiRoute(API_PATH.githubFileList(FAKE_GITHUB_REPO)), async (route: Route) => {
    if (route.request().method() !== 'GET') return route.continue()
    return fulfillJson(route, 200, { items: list.map(({ id, path, language }) => ({ id, path, language })), truncated: false })
  })
  await page.route(new RegExp(`/api/github/repo/${FAKE_GITHUB_REPO}/file/[^/?]+$`), async (route: Route) => {
    if (route.request().method() === 'OPTIONS') return fulfillJson(route, 204, {})
    const id = decodeURIComponent(new URL(route.request().url()).pathname.split('/').at(-1)!)
    const index = list.findIndex((file) => file.id === id)
    return answer(index, route)
  })
  return list
}

async function tickAll(page: Page, count: number) {
  await page.goto('/github')
  await connectFakeGithub(page)
  await page.getByRole('radio', { name: FAKE_GITHUB_REPO }).click()
  await page.getByRole('button', { name: 'Next' }).click()
  for (let index = 0; index < count; index += 1) await page.getByRole('checkbox', { name: fakeFile(index).path }).check()
}

test('multi-file: 21 ticked files are refused with a clear message and Approve is off', async ({ page }) => {
  await routeManyFiles(page, 21, (index, route) => fulfillJson(route, 200, fakeFile(index)))
  await tickAll(page, 21)
  await expect(page.getByRole('alert').filter({ hasText: 'Select at most 20 files' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Approve' })).toBeDisabled()
})

test('multi-file: downloads are sequential and a 429 stops the rest; earlier files are kept', async ({ page }) => {
  let inFlight = 0
  let maxInFlight = 0
  const askedList: number[] = []
  await routeManyFiles(page, 6, async (index, route) => {
    askedList.push(index)
    inFlight += 1
    maxInFlight = Math.max(maxInFlight, inFlight)
    await new Promise((resolve) => setTimeout(resolve, 150))
    inFlight -= 1
    if (index === 2) return fulfillJson(route, 429, { error: { code: 'rate_limited', message: 'GitHub rate limit.' } })
    return fulfillJson(route, 200, fakeFile(index))
  })
  await tickAll(page, 6)
  await page.getByRole('button', { name: 'Approve' }).click()
  await expect(fileList(page)).toBeVisible()
  expect(maxInFlight).toBe(1)
  expect(askedList).toEqual([0, 1, 2])
  await expect(fileList(page).getByTestId('file-draft-mark')).toHaveText(['Draft', 'Draft', 'Not imported', 'Not imported', 'Not imported', 'Not imported'])
  await expect(editor(page)).toContainText('export const value0', MONACO_LOAD)
})

test('multi-file: 20 files of 50 000 characters import, switch quickly, and no code reaches browser storage', async ({ page }) => {
  test.setTimeout(180_000)
  await routeManyFiles(page, 20, (index, route) => fulfillJson(route, 200, fakeFile(index, 50_000)))
  await tickAll(page, 20)
  const started = Date.now()
  await page.getByRole('button', { name: 'Approve' }).click()
  await expect(fileList(page)).toBeVisible({ timeout: 60_000 })
  console.log(`[qa-034] 20 x 50 000 import took ${Date.now() - started} ms`)
  await expect(fileList(page).getByRole('button')).toHaveCount(20)
  await expect(editor(page)).toContainText('export const value0', MONACO_LOAD)
  const switchStart = Date.now()
  for (const index of [19, 7, 13, 0]) {
    await fileList(page).getByRole('button', { name: new RegExp(fakeFile(index).path.replace(/\./g, '\\.')) }).click()
    await expect(editor(page)).toContainText(`export const value${index} `)
  }
  console.log(`[qa-034] 4 switches took ${Date.now() - switchStart} ms`)
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }))
  expect(stored).not.toContain('export const value')
  expect(stored).not.toContain('/'.repeat(200))
  const heap = await page.evaluate(() => (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0)
  console.log(`[qa-034] JS heap after 20 x 50 000 import: ${Math.round(heap / 1_048_576)} MB`)
})

test('multi-file: drafts keep separate edits and languages, and Run review creates only one review', async ({ page, request }) => {
  const before = (await (await request.get(apiRoute(API_PATH.review))).json()) as unknown[] | { items: unknown[] }
  const countBefore = Array.isArray(before) ? before.length : before.items.length
  await page.goto('/github')
  await connectFakeGithub(page)
  await page.getByRole('radio', { name: FAKE_GITHUB_REPO }).click()
  await page.getByRole('button', { name: 'Next' }).click()
  for (const path of ['src/greet.ts', 'src/util.py']) await page.getByRole('checkbox', { name: path }).check()
  await page.getByRole('button', { name: 'Approve' }).click()
  const list = fileList(page)
  await expect(list).toBeVisible()
  await expect(editor(page)).toContainText('export function greet', MONACO_LOAD)

  // Edit greet.ts, switch to util.py and back: the edit is kept and util.py is untouched.
  await page.evaluate(() => (window as unknown as { monaco: { editor: { getEditors: () => { setValue: (v: string) => void }[] } } }).monaco.editor.getEditors()[0].setValue('const qaEdited = 1\n'))
  await list.getByRole('button', { name: /src\/util\.py/ }).click()
  await expect(editor(page)).toContainText('def total')
  await expect(editor(page)).not.toContainText('qaEdited')
  await expect(page.getByRole('combobox', { name: /language/i }).first()).toHaveValue('Python')
  await list.getByRole('button', { name: /src\/greet\.ts/ }).click()
  await expect(editor(page)).toContainText('qaEdited')
  await expect(page.getByRole('combobox', { name: /language/i }).first()).toHaveValue('TypeScript')

  // A Python syntax error on the util.py draft gets the plan 032 squiggle.
  await list.getByRole('button', { name: /src\/util\.py/ }).click()
  await expect(editor(page)).toContainText('def total')
  await page.evaluate(() => (window as unknown as { monaco: { editor: { getEditors: () => { setValue: (v: string) => void }[] } } }).monaco.editor.getEditors()[0].setValue('def broken(:\n    return 1\n'))
  await expect(page.locator('.monaco-editor .squiggly-error').first()).toBeVisible({ timeout: 20_000 })

  await list.getByRole('button', { name: /src\/greet\.ts/ }).click()
  await page.getByRole('button', { name: 'Run review' }).click()
  await expect(page).toHaveURL(/\/review\/(?!new)[^/]+$/)
  await expect.poll(async () => {
    const after = (await (await request.get(apiRoute(API_PATH.review))).json()) as unknown[] | { items: unknown[] }
    return Array.isArray(after) ? after.length : after.items.length
  }).toBe(countBefore + 1)
  await expect(list.getByRole('button', { name: /src\/util\.py/ }).getByTestId('file-draft-mark')).toHaveText('Draft')
})

test('multi-file: a single ticked file opens without the file list', async ({ page }) => {
  await page.goto('/github')
  await connectFakeGithub(page)
  await page.getByRole('radio', { name: FAKE_GITHUB_REPO }).click()
  await page.getByRole('button', { name: 'Next' }).click()
  await page.getByRole('checkbox', { name: 'src/greet.ts' }).check()
  await page.getByRole('button', { name: 'Approve' }).click()
  await expect(editor(page)).toContainText('export function greet', MONACO_LOAD)
  await expect(fileList(page)).toHaveCount(0)
})

// Finding F-B1, fixed: the browser Back button with unsaved drafts asks first, like in-app links
// and tab close/reload.
test('multi-file: browser Back with unsaved drafts asks before dropping them', async ({ page }) => {
  await page.goto('/history')
  await page.goto('/github')
  await connectFakeGithub(page)
  await page.getByRole('radio', { name: FAKE_GITHUB_REPO }).click()
  await page.getByRole('button', { name: 'Next' }).click()
  for (const path of ['src/greet.ts', 'src/util.py']) await page.getByRole('checkbox', { name: path }).check()
  await page.getByRole('button', { name: 'Approve' }).click()
  await expect(fileList(page)).toBeVisible()
  let dialogShown = false
  page.on('dialog', async (dialog) => { dialogShown = true; await dialog.dismiss() })
  await page.goBack()
  const inApp = page.getByRole('alertdialog').or(page.getByRole('dialog')).filter({ hasText: FILE_DRAFT_TEXT.leaveTitle })
  await page.waitForTimeout(1000)
  const asked = dialogShown || await inApp.isVisible().catch(() => false)
  console.log(`[qa-034] browser Back: url=${page.url()} asked=${asked}`)
  expect(asked).toBe(true)
})

// F-B1 fixed: Stay keeps the page and the drafts; Leave goes back and drops them.
test('multi-file: browser Back keeps the drafts on Stay and drops them on Leave', async ({ page }) => {
  await page.goto('/github')
  await connectFakeGithub(page)
  await page.getByRole('radio', { name: FAKE_GITHUB_REPO }).click()
  await page.getByRole('button', { name: 'Next' }).click()
  for (const path of ['src/greet.ts', 'src/util.py']) await page.getByRole('checkbox', { name: path }).check()
  await page.getByRole('button', { name: 'Approve' }).click()
  await expect(fileList(page)).toBeVisible()
  const dialog = page.getByRole('dialog', { name: FILE_DRAFT_TEXT.leaveTitle })
  await page.goBack()
  await expect(dialog).toBeVisible()
  await expect(page).toHaveURL(/\/review\/new$/)
  await dialog.getByRole('button', { name: FILE_DRAFT_TEXT.stay }).click()
  await expect(fileList(page)).toBeVisible()
  await expect(fileList(page).getByRole('button')).toHaveCount(2)
  await page.goBack()
  await dialog.getByRole('button', { name: FILE_DRAFT_TEXT.leaveConfirm }).click()
  await expect(page).toHaveURL(/\/github$/)
  await page.goForward()
  await expect(page).toHaveURL(/\/review\/new$/)
  await expect(fileList(page)).toHaveCount(0)
})
