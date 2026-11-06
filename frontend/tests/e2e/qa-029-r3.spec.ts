import type { Page } from '@playwright/test'
import { EDITOR_TEXT } from '../../src/lib/review.constants'
import { ROUTE_PATH } from '../../src/lib/route.constants'
import { createReview, expect, MONACO_LOAD, test } from './fixture'

// QA round 3, plan 029 revision 3 (adversarial): the phone layout puts the editor and its track on
// the first screen; the scroll guard (lib/editorScrollGuard.ts) must not break Monaco's own
// scrolling (cursor reveal, find, drag selection, popups, IME) on desktop, tablet or phone.

const longLine = `const s = '${'q'.repeat(300)}zzEND'`
const code = `${longLine}\n${Array.from({ length: 30 }, (_, i) => `const v${i} = ${i}`).join('\n')}\n`
const editor = (page: Page) => page.locator('.monaco-editor:visible').first()
const bar = (page: Page) => editor(page).locator('.editor-scrollable > .scrollbar.horizontal')
const sliderLeft = (page: Page) => bar(page).locator('.slider').evaluate((element) => Number.parseFloat((element as HTMLElement).style.left) || 0)

// The clipping boxes never scroll natively, and the view (with its bar) stays inside the editor.
async function expectViewIntact(page: Page) {
  const state = await editor(page).evaluate((root) => {
    const clip = Array.from(root.querySelectorAll<HTMLElement>('.overflow-guard, .editor-scrollable'))
    const box = root.getBoundingClientRect()
    const track = root.querySelector('.editor-scrollable > .scrollbar.horizontal')!.getBoundingClientRect()
    return {
      native: clip.map((element) => element.scrollLeft + element.scrollTop),
      trackInside: track.left >= box.left - 1 && track.right <= box.right + 1 && track.bottom <= box.bottom + 1
    }
  })
  expect(state.native.every((value) => value === 0)).toBe(true)
  expect(state.trackInside).toBe(true)
}

async function openNewWithCode(page: Page) {
  await page.goto('/review/new')
  await expect(editor(page).locator('.view-lines')).toBeVisible(MONACO_LOAD)
  await page.getByLabel(EDITOR_TEXT.fileInput).setInputFiles({ name: 'long.ts', mimeType: 'text/plain', buffer: Buffer.from(code) })
  await expect(page.getByTestId('editor-title')).toHaveText('long.ts')
}

for (const viewport of [{ width: 1280, height: 800 }, { width: 768, height: 1024 }]) {
  test.describe(`guard vs Monaco at ${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport })

    test('End on the long line reveals the cursor (Monaco scrolls), typing there keeps it in view', async ({ page }) => {
      await openNewWithCode(page)
      await editor(page).locator('.view-lines').click({ position: { x: 30, y: 8 } })
      await page.keyboard.press('ControlOrMeta+Home')
      await page.keyboard.press('End')
      await expect.poll(() => sliderLeft(page)).toBeGreaterThan(0)
      await page.keyboard.type('_tail')
      const cursor = await editor(page).locator('.cursor').first().boundingBox()
      const box = (await editor(page).boundingBox())!
      expect(cursor!.x).toBeGreaterThanOrEqual(box.x)
      expect(cursor!.x).toBeLessThanOrEqual(box.x + box.width)
      await expectViewIntact(page)
    })

    test('find widget reveals a match at the end of the long line', async ({ page }) => {
      await openNewWithCode(page)
      await editor(page).locator('.view-lines').click({ position: { x: 30, y: 30 } })
      await page.keyboard.press('ControlOrMeta+Home')
      await page.keyboard.press('ControlOrMeta+F')
      await expect(editor(page).locator('.find-widget.visible')).toBeVisible()
      await page.keyboard.type('zzEND')
      await page.keyboard.press('Enter')
      await expect.poll(() => sliderLeft(page)).toBeGreaterThan(0)
      await expect(editor(page).locator('.currentFindMatch').first()).toBeInViewport()
      await expectViewIntact(page)
    })

    test('a mouse drag past the right edge auto-scrolls the selection', async ({ page }) => {
      await openNewWithCode(page)
      const box = (await editor(page).locator('.view-lines').boundingBox())!
      await page.mouse.move(box.x + 60, box.y + 8)
      await page.mouse.down()
      await page.mouse.move(box.x + box.width + 40, box.y + 8, { steps: 10 })
      await page.waitForTimeout(800)
      await page.mouse.move(box.x + box.width + 60, box.y + 8, { steps: 4 })
      await page.mouse.up()
      await expect.poll(() => sliderLeft(page)).toBeGreaterThan(0)
      await expectViewIntact(page)
    })

    test('autocomplete opens and the view stays put', async ({ page }) => {
      await openNewWithCode(page)
      await editor(page).locator('.view-lines').click({ position: { x: 30, y: 30 } })
      await page.keyboard.press('ControlOrMeta+End')
      await page.keyboard.type('con')
      await page.keyboard.press('Control+Space')
      await expect(page.locator('.suggest-widget.visible')).toBeVisible()
      await page.keyboard.press('Escape')
      await expectViewIntact(page)
    })
  })
}

test('desktop hover popup on a finding still opens', async ({ page, request }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  const review = await createReview(request, { title: 'Hover' })
  await page.goto(ROUTE_PATH.review(review.id))
  await expect(editor(page).locator('.view-lines')).toBeVisible(MONACO_LOAD)
  const word = editor(page).locator('.view-line').first()
  // The review text arrives after the API call; wait until the line has it.
  await expect(word).toContainText(/\S/)
  const box = (await word.boundingBox())!
  await page.mouse.move(box.x + 120, box.y + box.height / 2)
  await expect(page.locator('.monaco-hover:not(.hidden)').first()).toBeVisible({ timeout: 5000 })
  await expectViewIntact(page)
})

test.describe('phone IME and keyboard-open', () => {
  test.use({ viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true })

  test('IME composition at the end of the long line keeps the view and the bar inside the editor', async ({ page }) => {
    await openNewWithCode(page)
    await editor(page).locator('.view-lines').tap()
    await page.keyboard.press('ControlOrMeta+Home')
    await page.keyboard.press('End')
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Input.imeSetComposition', { text: 'ni', selectionStart: 2, selectionEnd: 2 })
    await cdp.send('Input.imeSetComposition', { text: 'nihon', selectionStart: 5, selectionEnd: 5 })
    await cdp.send('Input.insertText', { text: '日本' })
    await cdp.detach()
    await expect(editor(page).locator('.view-line').first()).toContainText('日本')
    await expectViewIntact(page)
  })

  test('a keyboard-sized viewport (resizes-content) does not overflow the document or push the bar out', async ({ page }) => {
    await openNewWithCode(page)
    await editor(page).locator('.view-lines').tap()
    await page.keyboard.press('ControlOrMeta+End')
    await page.setViewportSize({ width: 375, height: 360 })
    await page.keyboard.type('const typed = 1')
    await page.waitForTimeout(300)
    expect(await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight)).toBe(0)
    await expectViewIntact(page)
  })
})

// Geometry on load at the sizes the agent did not test: 360x640 portrait (asserted) and small
// landscape phones (logged only: the plan's acceptance is portrait).
async function geometry(page: Page) {
  await expect(editor(page)).toBeVisible(MONACO_LOAD)
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(500)
  return page.evaluate(() => {
    const monaco = Array.from(document.querySelectorAll<HTMLElement>('.monaco-editor')).find((item) => item.offsetParent !== null)!
    const section = monaco.closest('section')!.getBoundingClientRect()
    const track = monaco.querySelector('.editor-scrollable > .scrollbar.horizontal')!.getBoundingClientRect()
    const nav = document.querySelector('nav[aria-label="Mobile"]')?.getBoundingClientRect()
    const line = (monaco.querySelector('.view-line') as HTMLElement).getBoundingClientRect().height
    return {
      top: Math.round(section.top),
      trackBottom: Math.round(track.bottom),
      limit: Math.round(nav && nav.height > 0 ? nav.top : window.innerHeight),
      lines: Math.floor((track.top - monaco.querySelector('.lines-content')!.getBoundingClientRect().top) / line),
      mainScrollTop: (document.querySelector('main') as HTMLElement).scrollTop
    }
  })
}

for (const size of [
  { width: 360, height: 640, assert: true },
  { width: 640, height: 360, assert: false },
  { width: 667, height: 375, assert: false },
  { width: 844, height: 390, assert: false },
  { width: 915, height: 412, assert: false }
]) {
  test.describe(`on load ${size.width}x${size.height}`, () => {
    test.use({ viewport: { width: size.width, height: size.height }, isMobile: true, hasTouch: true })

    test('editor and track position on /review/new, Summary and Generated tests', async ({ page, request }) => {
      const review = await createReview(request, { title: 'Geo', content: code })
      const result: Record<string, Awaited<ReturnType<typeof geometry>>> = {}
      await page.goto('/review/new')
      result.new = await geometry(page)
      await page.goto(ROUTE_PATH.review(review.id))
      await expect(page.getByText('Completed', { exact: true })).toBeVisible()
      result.summary = await geometry(page)
      await page.getByRole('tab', { name: /Generated tests/ }).click()
      await expect(page.getByTestId('editor-title')).not.toHaveText('Code')
      result.tests = await geometry(page)
      console.log(`QA-R3 geo ${size.width}x${size.height}`, JSON.stringify(result))
      if (size.assert) {
        for (const [name, item] of Object.entries(result)) {
          expect(item.mainScrollTop, name).toBe(0)
          expect(item.top, name).toBeGreaterThanOrEqual(0)
          expect(item.trackBottom, name).toBeLessThanOrEqual(item.limit)
          expect(item.lines, name).toBeGreaterThanOrEqual(8)
        }
      }
    })
  })
}
