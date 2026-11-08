import { devices, type Page } from '@playwright/test'
import { API_PATH } from '../../src/lib/api.constants'
import { ROUTE_PATH } from '../../src/lib/route.constants'
import { FAKE_GITHUB_USER } from './e2e.constants'
import { apiRoute, createReview, expect, MONACO_LOAD, test } from './fixture'

// QA for plan 050: tries to break the tooltip fix, the scrollbar rule and the tap targets.
const { defaultBrowserType: _browser, ...iphone } = devices['iPhone 13']
const small = { ...iphone, viewport: { width: 320, height: 568 }, screen: { width: 320, height: 568 } }

type Handle = { setValue: (v: string) => void; getScrolledVisiblePosition: (p: { lineNumber: number; column: number }) => { left: number; top: number; height: number } | null; getDomNode: () => HTMLElement | null }
type W = { monaco: { editor: { getEditors: () => Handle[] } } }

const longWord = 'x'.repeat(700)
const manyFinding = (count: number, message: string) =>
  Array.from({ length: count }, (_, i) => ({ message: `${i + 1}. ${message}`, detail: 'Fix it.', line_start: 1 }))

async function openFindings(page: Page, request: Parameters<typeof createReview>[0], findingList: Array<{ message: string; detail: string; line_start: number }>) {
  const review = await createReview(request, { title: 'QA 050' })
  await page.route(apiRoute(API_PATH.reviewById(review.id)), async (route) => {
    if (route.request().method() !== 'GET') return route.continue()
    const response = await route.fetch()
    const json = await response.json()
    json.finding = findingList.map((f) => ({ ...json.finding[0], ...f }))
    return route.fulfill({ response, json })
  })
  await page.goto(ROUTE_PATH.review(review.id))
  const glyph = page.locator('.monaco-editor .editor-finding-glyph').first()
  await expect(glyph).toBeVisible(MONACO_LOAD)
  await glyph.hover()
  const hover = page.locator('.monaco-hover:visible').first()
  await expect(hover).toBeVisible()
  await page.waitForTimeout(500)
  return hover
}

const boxOf = (hover: ReturnType<Page['locator']>) =>
  hover.evaluate((el) => {
    const b = el.getBoundingClientRect()
    return { left: b.left, top: b.top, right: b.right, bottom: b.bottom, w: window.innerWidth, h: window.innerHeight, bg: getComputedStyle(el).backgroundColor }
  })

const sizes = [
  { name: 'desktop', use: { viewport: { width: 1280, height: 720 } } },
  { name: 'tablet 768x1024', use: { viewport: { width: 768, height: 1024 } } },
  { name: 'iPhone', use: iphone },
  { name: 'small', use: small }
]

for (const s of sizes) {
  test.describe(`tooltip adversarial, ${s.name}`, () => {
    test.use(s.use)

    // Known limit of plan 050 (QA F2, backlog): a hover wider than the window is still cut. Skipped until fixed.
    test.fixme('a single 700 character word without spaces stays inside the window width', async ({ page, request }) => {
      const hover = await openFindings(page, request, [{ message: longWord, detail: longWord, line_start: 1 }])
      const b = await boxOf(hover)
      expect(b.left).toBeGreaterThanOrEqual(0)
      expect(b.right).toBeLessThanOrEqual(b.w)
      expect(b.top).toBeGreaterThanOrEqual(0)
      expect(b.bottom, 'hover bottom vs window').toBeLessThanOrEqual(b.h)
    })

    // Known limit of plan 050 (QA F1, backlog): a hover taller than the window is still cut. Skipped until fixed.
    test.fixme('four findings on one line: hover inside the window', async ({ page, request }) => {
      const hover = await openFindings(page, request, manyFinding(4, 'The input reaches eval without any check, so a caller can run any code.'))
      const b = await boxOf(hover)
      expect(b.left).toBeGreaterThanOrEqual(0)
      expect(b.right).toBeLessThanOrEqual(b.w)
      expect(b.top).toBeGreaterThanOrEqual(0)
      expect(b.bottom, 'hover bottom vs window').toBeLessThanOrEqual(b.h)
    })

    test('light theme: hover has an opaque background and is visible', async ({ page, request }) => {
      await page.goto('/settings')
      await page.getByRole('tab', { name: 'Appearance' }).click()
      await page.getByRole('radio', { name: 'Light' }).check()
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
      const hover = await openFindings(page, request, [{ message: 'A short finding message for the light theme.', detail: 'Fix it.', line_start: 1 }])
      const b = await boxOf(hover)
      expect(b.bg).not.toMatch(/rgba\(0, 0, 0, 0\)|transparent/)
      expect(b.right).toBeLessThanOrEqual(b.w)
      expect(b.bottom).toBeLessThanOrEqual(b.h)
    })

    test('the read-only Generated tests editor: scrollbars match and nothing throws', async ({ page, request }) => {
      const errors: string[] = []
      page.on('pageerror', (e) => errors.push(e.message))
      const review = await createReview(request, { title: 'Auth Service', content: 'export function load(input: string) {\n  return eval(input)\n}\n' })
      await page.goto(ROUTE_PATH.review(review.id))
      await expect(page.locator('.monaco-editor .view-lines').first()).toBeVisible(MONACO_LOAD)
      await page.getByRole('tab', { name: /Generated tests/ }).click()
      await expect(page.locator('.monaco-editor .view-lines').first()).toContainText("describe('auth-service'")
      const bar = await page.locator('.monaco-editor .editor-scrollable > .scrollbar.horizontal').first().boundingBox()
      const expected = (s.use as { viewport?: { width: number } }).viewport?.width ?? 390
      expect(bar!.height).toBe(expected >= 768 ? 12 : 16)
      await page.locator('.monaco-editor .view-lines').first().hover()
      await page.waitForTimeout(400)
      expect(errors).toEqual([])
    })
  })
}

test.describe('resize with a tooltip open', () => {
  test.use({ viewport: { width: 1280, height: 720 } })
  test('after shrinking to 320x568 the hover is gone or inside the window', async ({ page, request }) => {
    const hover = await openFindings(page, request, [{ message: 'The input reaches eval without any check, so a caller can run any code in this process.', detail: 'Fix it.', line_start: 1 }])
    await expect(hover).toBeVisible()
    await page.setViewportSize({ width: 320, height: 568 })
    await page.waitForTimeout(800)
    const visible = await page.locator('.monaco-hover:visible').count()
    if (visible > 0) {
      const b = await boxOf(page.locator('.monaco-hover:visible').first())
      expect(b.right, 'hover right after resize').toBeLessThanOrEqual(b.w)
      expect(b.left).toBeGreaterThanOrEqual(0)
    }
  })

  test('scrolling the page while a hover is open does not leave a floating box over the page', async ({ page, request }) => {
    await page.setViewportSize({ width: 390, height: 500 })
    const hover = await openFindings(page, request, [{ message: 'A finding message.', detail: 'Fix it.', line_start: 1 }])
    await expect(hover).toBeVisible()
    await page.mouse.wheel(0, 600)
    await page.waitForTimeout(800)
    const stillOpen = await page.locator('.monaco-hover:visible').count()
    const editorTop = await page.locator('.monaco-editor').first().evaluate((el) => el.getBoundingClientRect().bottom)
    // Either the hover closed, or the editor is still on screen.
    expect(stillOpen === 0 || editorTop > 0, `hover open=${stillOpen} editorBottom=${editorTop}`).toBe(true)
  })
})

test.describe('vertical scrollbar still scrolls normally', () => {
  test.use({ viewport: { width: 1280, height: 720 } })
  test('mouse wheel scrolls the code on desktop, and the 12 px bar is clickable', async ({ page }) => {
    await page.goto('/review/new')
    await expect(page.locator('.monaco-editor .view-lines').first()).toBeVisible(MONACO_LOAD)
    const code = Array.from({ length: 200 }, (_, i) => `const row${i} = ${i}`).join('\n') + "\nconst lastRow = 1"
    await page.evaluate((c) => (window as unknown as W).monaco.editor.getEditors()[0].setValue(c), code)
    const bar = page.locator('.monaco-editor .editor-scrollable > .scrollbar.vertical').first()
    expect((await bar.boundingBox())!.width).toBeGreaterThan(0)
    const lines = page.locator('.monaco-editor .view-lines').first()
    await lines.click()
    await page.keyboard.press('Control+End')
    await expect(lines).toContainText('lastRow')
    // Click on the track near the top: jumps back up.
    const box = (await bar.boundingBox())!
    await page.mouse.click(box.x + 6, box.y + 4)
    await expect(lines).not.toContainText('lastRow')
  })
})

// Button sizes around the 767/768 boundary.
async function measure(page: Page) {
  const size = async (name: string) => {
    const box = await page.getByRole('button', { name, exact: true }).first().boundingBox()
    return box ? { w: Math.round(box.width), h: Math.round(box.height) } : null
  }
  return { connect: await size('Connect GitHub'), importButton: await size('Import') }
}

for (const width of [767, 768]) {
  test.describe(`boundary ${width}`, () => {
    test.use({ viewport: { width, height: 900 } })
    test(`Connect GitHub and Import at ${width}`, async ({ page }) => {
      await page.goto('/github')
      const m = await measure(page)
      if (width === 767) {
        expect(m.connect!.h).toBeGreaterThanOrEqual(44)
        expect(m.importButton!.h).toBeGreaterThanOrEqual(44)
      } else {
        expect(m.connect).toMatchObject({ h: 32 })
        expect(m.importButton).toMatchObject({ h: 36 })
      }
    })

    test(`wizard Cancel, Next, Switch account at ${width}`, async ({ page }) => {
      await page.goto('/github')
      await page.getByRole('textbox', { name: 'GitHub user name' }).fill(FAKE_GITHUB_USER)
      await page.getByRole('button', { name: 'Connect GitHub' }).click()
      await expect(page.getByText(`Connected as ${FAKE_GITHUB_USER}`)).toBeVisible()
      const h = async (name: string) => Math.round((await page.getByRole('button', { name, exact: true }).first().boundingBox())!.height)
      const heights = { sw: await h('Switch account'), cancel: await h('Cancel'), next: await h('Next') }
      if (width === 767) {
        for (const [k, v] of Object.entries(heights)) expect(v, k).toBeGreaterThanOrEqual(44)
      } else {
        expect(heights).toEqual({ sw: 16, cancel: 38, next: 38 })
      }
    })
  })
}
