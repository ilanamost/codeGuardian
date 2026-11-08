import { devices, type Locator, type Page } from '@playwright/test'
import { API_PATH } from '../../src/lib/api.constants'
import { ROUTE_PATH } from '../../src/lib/route.constants'
import { apiRoute, createReview, expect, MONACO_LOAD, test } from './fixture'

// Plan 050: a long syntax error and a long AI finding show their whole text in the Monaco hover,
// and the hover lies inside the browser window and is not cut by the editor box (the editor
// section has overflow-hidden). The hover is "fully visible" when it is inside the window, shows
// all of the message, and the element at each of a grid of points over it (8 px in from its
// edges, where Monaco puts its resize handles) is the hover itself.
const { defaultBrowserType: _browser, ...iphone } = devices['iPhone 13']
const viewportList = [
  { name: 'desktop 1280x720', use: { viewport: { width: 1280, height: 720 } } },
  { name: 'iPhone 13 390x844', use: iphone },
  { name: 'small phone 320x568', use: { ...iphone, viewport: { width: 320, height: 568 }, screen: { width: 320, height: 568 } } }
]

type EditorHandle = {
  setValue: (value: string) => void
  getScrolledVisiblePosition: (position: { lineNumber: number; column: number }) => { left: number; top: number; height: number } | null
  getDomNode: () => HTMLElement | null
}
type W = { monaco: { editor: { getEditors: () => EditorHandle[] } } }

const TS_ERROR = 'Unexpected token. A constructor, method, accessor, or property was expected.'
const FINDING_MESSAGE =
  'The input reaches eval without any check, so a caller can run any code in this process and read or change data it should never see.'
const FINDING_DETAIL =
  'Replace eval with a parser for the one format you expect, validate the input against a schema first, and return a clear error when it does not match.'

const normalize = (text: string) => text.replace(/\s+/g, ' ').trim()

async function expectFullyVisible(page: Page, hover: Locator, text: string) {
  await expect(hover).toBeVisible()
  // The hover fades in and is placed after its content is measured.
  await page.waitForTimeout(500)
  const result = await hover.evaluate((element) => {
    const box = element.getBoundingClientRect()
    let shown = 0
    let total = 0
    const cover: string[] = []
    for (let i = 0; i < 6; i += 1) {
      for (let j = 0; j < 6; j += 1) {
        const x = box.x + 8 + ((box.width - 16) * i) / 5
        const y = box.y + 8 + ((box.height - 16) * j) / 5
        total += 1
        const found = document.elementFromPoint(x, y)
        if (found && element.contains(found)) shown += 1
        else cover.push(`${Math.round(x)},${Math.round(y)} ${found?.tagName}.${found?.className}`)
      }
    }
    const content = element.querySelector('.monaco-hover-content') as HTMLElement | null
    return {
      box: { left: box.left, top: box.top, right: box.right, bottom: box.bottom },
      window: { width: window.innerWidth, height: window.innerHeight },
      shown,
      cover: cover.slice(0, 3),
      total,
      text: element.textContent ?? '',
      cut: content ? content.scrollHeight - content.clientHeight : 0
    }
  })
  expect(result.box.left, 'hover left edge').toBeGreaterThanOrEqual(0)
  expect(result.box.top, 'hover top edge').toBeGreaterThanOrEqual(0)
  expect(result.box.right, 'hover right edge').toBeLessThanOrEqual(result.window.width)
  expect(result.box.bottom, 'hover bottom edge').toBeLessThanOrEqual(result.window.height)
  expect(result.cover, "covered").toEqual([])
  expect(result.shown, 'points of the hover that are not covered or clipped').toBe(result.total)
  expect(normalize(result.text)).toContain(normalize(text))
  expect(result.cut, 'hover content scrolls instead of showing all of the message').toBeLessThanOrEqual(1)
}

for (const viewport of viewportList) {
  test.describe(viewport.name, () => {
    test.use(viewport.use)

    test('a long TypeScript syntax error is fully visible in its hover', async ({ page }) => {
      await page.goto('/review/new')
      await expect(page.locator('.monaco-editor .view-lines').first()).toBeVisible(MONACO_LOAD)
      await page.getByRole('combobox', { name: 'Language' }).selectOption('TypeScript')
      await page.evaluate((code) => (window as unknown as W).monaco.editor.getEditors()[0].setValue(code), 'class Widget { + }\n')
      await expect(page.locator('.monaco-editor .squiggly-error').first()).toBeVisible({ timeout: 20_000 })

      // The mouse goes over the first marker (line 1, column 16), as a user's would.
      const point = await page.evaluate(() => {
        const editor = (window as unknown as W).monaco.editor.getEditors()[0]
        const place = editor.getScrolledVisiblePosition({ lineNumber: 1, column: 16 })!
        const box = editor.getDomNode()!.getBoundingClientRect()
        return { x: box.x + place.left + 2, y: box.y + place.top + place.height / 2 }
      })
      await page.mouse.move(point.x - 30, point.y)
      await page.mouse.move(point.x, point.y)
      await expectFullyVisible(page, page.locator('.monaco-hover:visible').first(), TS_ERROR)
    })

    test('a long AI finding is fully visible in its hover', async ({ page, request }) => {
      const review = await createReview(request, { title: 'Long finding' })
      await page.route(apiRoute(API_PATH.reviewById(review.id)), async (route) => {
        if (route.request().method() !== 'GET') return route.continue()
        const response = await route.fetch()
        const json = await response.json()
        json.finding = [{ ...json.finding[0], message: FINDING_MESSAGE, detail: FINDING_DETAIL, line_start: 1 }]
        return route.fulfill({ response, json })
      })
      await page.goto(ROUTE_PATH.review(review.id))
      const glyph = page.locator('.monaco-editor .editor-finding-glyph').first()
      await expect(glyph).toBeVisible(MONACO_LOAD)
      await glyph.hover()
      await expectFullyVisible(page, page.locator('.monaco-hover:visible').first(), `${FINDING_MESSAGE} ${FINDING_DETAIL}`)
    })
  })
}
