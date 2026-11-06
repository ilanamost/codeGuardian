import type { Page } from '@playwright/test'
import { ROUTE_PATH } from '../../src/lib/route.constants'
import { createReview, expect, MONACO_LOAD, test } from './fixture'

// Plan 029 revision 3: on a phone the code editor, with its horizontal scrollbar track at its
// bottom edge, is fully on the first screen above the bottom nav on load, without scrolling the
// page; it shows at least about 8 lines; the findings summary is still reachable by scrolling.

const iphoneUserAgent =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1'
const code = `${Array.from({ length: 40 }, (_, i) => `const v${i} = ${i}`).join('\n')}\n`

async function editorGeometry(page: Page) {
  const editor = page.locator('.monaco-editor:visible').first()
  await expect(editor).toBeVisible(MONACO_LOAD)
  await page.waitForLoadState('networkidle')
  // Let the layout settle (fonts, Monaco's own layout pass, the review answer).
  await page.waitForTimeout(500)
  return page.evaluate(() => {
    const monaco = Array.from(document.querySelectorAll<HTMLElement>('.monaco-editor')).find((item) => item.offsetParent !== null)!
    const section = monaco.closest('section')!.getBoundingClientRect()
    const track = monaco.querySelector('.editor-scrollable > .scrollbar.horizontal')!.getBoundingClientRect()
    const nav = document.querySelector('nav[aria-label="Mobile"]')!.getBoundingClientRect()
    const lineHeight = (monaco.querySelector('.view-line') as HTMLElement).getBoundingClientRect().height
    return {
      top: section.top,
      bottom: section.bottom,
      trackTop: track.top,
      trackBottom: track.bottom,
      navTop: nav.top,
      lineCount: (track.top - monaco.querySelector('.lines-content')!.getBoundingClientRect().top) / lineHeight,
      mainScrollTop: (document.querySelector('main') as HTMLElement).scrollTop
    }
  })
}

function expectOnFirstScreen(geometry: Awaited<ReturnType<typeof editorGeometry>>) {
  expect(geometry.mainScrollTop).toBe(0)
  expect(geometry.top).toBeGreaterThanOrEqual(0)
  expect(geometry.trackTop).toBeGreaterThanOrEqual(geometry.top)
  expect(geometry.trackBottom).toBeLessThanOrEqual(geometry.navTop)
  expect(geometry.bottom).toBeLessThanOrEqual(geometry.navTop)
  expect(geometry.lineCount).toBeGreaterThanOrEqual(8)
}

for (const phone of [
  { name: 'iPhone SE', width: 375, height: 667 },
  { name: 'iPhone 12', width: 390, height: 844 },
  { name: 'Pixel 7', width: 412, height: 915 }
]) {
  test.describe(`${phone.name} ${phone.width}x${phone.height}`, () => {
    test.use({ viewport: { width: phone.width, height: phone.height }, isMobile: true, hasTouch: true, userAgent: iphoneUserAgent })

    test('/review/new shows the whole editor and its track on load', async ({ page }) => {
      await page.goto('/review/new')
      expectOnFirstScreen(await editorGeometry(page))
    })

    test('an existing review shows the whole Summary editor on load, and the findings summary by scrolling', async ({ page, request }) => {
      const review = await createReview(request, { title: 'Phone layout', content: code })
      await page.goto(ROUTE_PATH.review(review.id))
      await expect(page.getByText('Completed', { exact: true })).toBeVisible()
      expectOnFirstScreen(await editorGeometry(page))

      const summary = page.getByRole('heading', { name: 'Findings Summary' })
      await summary.scrollIntoViewIfNeeded()
      await expect(summary).toBeInViewport()
      await expect(page.getByText('Overall Status')).toBeAttached()
    })

    test('the Generated tests editor is whole on the first screen after the tab switch', async ({ page, request }) => {
      const review = await createReview(request, { title: 'Phone tests', content: code })
      await page.goto(ROUTE_PATH.review(review.id))
      await expect(page.getByText('Completed', { exact: true })).toBeVisible()
      await page.getByRole('tab', { name: /Generated tests/ }).click()
      await expect(page.getByTestId('editor-title')).not.toHaveText('Code')
      expectOnFirstScreen(await editorGeometry(page))
    })
  })
}

test.describe('tablet 768x1024 keeps its layout', () => {
  test.use({ viewport: { width: 768, height: 1024 } })

  test('the findings summary stays above the editor and the editor keeps 60% of the screen height', async ({ page, request }) => {
    const review = await createReview(request, { title: 'Tablet layout', content: code })
    await page.goto(ROUTE_PATH.review(review.id))
    await expect(page.locator('.monaco-editor').first()).toBeVisible(MONACO_LOAD)
    const summaryBox = await page.getByRole('heading', { name: 'Findings Summary' }).boundingBox()
    const editorBox = await page.locator('section:has(.monaco-editor)').first().boundingBox()
    const statusBox = await page.getByText('Overall Status').boundingBox()
    expect(summaryBox!.y).toBeLessThan(editorBox!.y)
    expect(statusBox!.y).toBeLessThan(summaryBox!.y)
    expect(editorBox!.height).toBeCloseTo(1024 * 0.6, 0)
  })
})
