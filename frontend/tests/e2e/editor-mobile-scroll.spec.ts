import type { Locator, Page } from '@playwright/test'
import { EDITOR_TEXT } from '../../src/lib/review.constants'
import { ROUTE_PATH } from '../../src/lib/route.constants'
import { createReview, expect, MONACO_LOAD, test } from './fixture'

// Plan 029: on a phone (touch, mobile user agent, as in Chrome DevTools' device mode) a long line
// of either editor scrolls by a swipe and by dragging the slider, and the horizontal scrollbar
// can be seen: a slider with at least 3:1 contrast on the editor (WCAG non-text contrast) on a
// visible track. Before the fix the slider was the app's faint grey thumb (about 1.7:1) on no
// track, 20 px wide on a long line, which looked like no scrollbar at all.

const iphoneUserAgent =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1'
const longCode = `const longLine = '${'x'.repeat(300)}'\n${Array.from({ length: 20 }, (_, i) => `const v${i} = ${i}`).join('\n')}\n`

const editor = (page: Page) => page.locator('.monaco-editor:visible').first()
const horizontalBar = (page: Page) => editor(page).locator('.editor-scrollable > .scrollbar.horizontal')
const slider = (page: Page) => horizontalBar(page).locator('.slider')

// A one-finger drag through the browser's touch input (touch and pointer events, page gestures).
async function touchDrag(page: Page, from: { x: number; y: number }, dx: number) {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] })
  for (let step = 1; step <= 8; step++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x + (dx * step) / 8, y: from.y }] })
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await cdp.detach()
}

const sliderLeft = (page: Page) => slider(page).evaluate((element) => Number.parseFloat((element as HTMLElement).style.left) || 0)

async function center(locator: Locator) {
  const box = await locator.boundingBox()
  expect(box).not.toBeNull()
  return { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 }
}

// sRGB colour (rgb(), rgba() or color(srgb ...)) blended over an opaque background, then the
// WCAG contrast ratio of the two.
function sliderContrast(sliderColor: string, background: string) {
  const parse = (color: string) => {
    const number = (color.match(/-?\d*\.?\d+/g) ?? []).map(Number)
    if (color.startsWith('color(')) return { rgb: number.slice(0, 3).map((value) => value * 255), alpha: number[3] ?? 1 }
    return { rgb: number.slice(0, 3), alpha: number[3] ?? 1 }
  }
  const front = parse(sliderColor)
  const back = parse(background)
  const blended = front.rgb.map((value, index) => value * front.alpha + back.rgb[index] * (1 - front.alpha))
  const luminance = (rgb: number[]) => {
    const [r, g, b] = rgb.map((value) => {
      const channel = value / 255
      return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  const [light, dark] = [luminance(blended), luminance(back.rgb)].sort((a, b) => b - a)
  return (light + 0.05) / (dark + 0.05)
}

async function expectScrollable(page: Page) {
  await expect(slider(page)).toBeVisible(MONACO_LOAD)
  // Monaco measures the long line after it renders; the slider is then narrower than the bar.
  await expect
    .poll(async () => ((await slider(page).boundingBox())?.width ?? 0) < ((await horizontalBar(page).boundingBox())?.width ?? 0))
    .toBe(true)
  // The whole editor fits above the bottom nav on a phone (revision 3); scrolling only the bar into
  // view could leave the editor's top under a toast at the top of a landscape screen.
  await editor(page).evaluate((element) => element.closest('section')?.scrollIntoView({ block: 'nearest' }))
  // The bar fades in when it first appears (for example right after a tab switch).
  await expect(horizontalBar(page)).toHaveCSS('opacity', '1')

  // Visible: a 16 px bar below md, with a track and a slider that stands out from the editor.
  const look = await horizontalBar(page).evaluate((bar) => {
    const sliderElement = bar.querySelector('.slider') as HTMLElement
    return {
      height: bar.getBoundingClientRect().height,
      track: getComputedStyle(bar).backgroundColor,
      slider: getComputedStyle(sliderElement).backgroundColor,
      editor: getComputedStyle(bar.closest('section') as HTMLElement).backgroundColor
    }
  })
  expect(look.height).toBeGreaterThanOrEqual(16)
  expect(look.track).not.toBe('rgba(0, 0, 0, 0)')
  expect(sliderContrast(look.slider, look.editor)).toBeGreaterThanOrEqual(3)

  // The bar sits above the bottom nav, not under it.
  const barBox = await horizontalBar(page).boundingBox()
  const navBox = await page.getByRole('navigation', { name: 'Mobile' }).boundingBox()
  expect((barBox?.y ?? 0) + (barBox?.height ?? 0)).toBeLessThanOrEqual(navBox?.y ?? 0)

  // Dragging the slider with a finger scrolls the code to the right...
  const start = await sliderLeft(page)
  await touchDrag(page, await center(slider(page)), 20)
  await expect.poll(() => sliderLeft(page)).toBeGreaterThan(start)

  // ...and a swipe on the code scrolls it back.
  const afterDrag = await sliderLeft(page)
  const editorBox = await editor(page).boundingBox()
  await touchDrag(page, { x: editorBox!.x + editorBox!.width * 0.3, y: editorBox!.y + editorBox!.height * 0.6 }, 120)
  await expect.poll(() => sliderLeft(page)).toBeLessThan(afterDrag)

  // The page itself never scrolls sideways.
  expect(
    await page.evaluate(() => {
      const main = document.querySelector('main') as HTMLElement
      return document.documentElement.scrollWidth - window.innerWidth + main.scrollLeft
    })
  ).toBe(0)
}

for (const phone of [
  { name: 'iPhone SE', width: 375, height: 667, deviceScaleFactor: 2 },
  { name: 'iPhone 12', width: 390, height: 844, deviceScaleFactor: 3 },
  { name: 'iPhone SE landscape', width: 667, height: 375, deviceScaleFactor: 2 }
]) {
  test.describe(phone.name, () => {
    test.use({
      viewport: { width: phone.width, height: phone.height },
      deviceScaleFactor: phone.deviceScaleFactor,
      isMobile: true,
      hasTouch: true,
      userAgent: iphoneUserAgent
    })

    test('a new review scrolls a long line after upload, a language switch and typing', async ({ page }) => {
      await page.goto('/review/new')
      await expect(page.locator('.monaco-editor .view-lines').first()).toBeVisible(MONACO_LOAD)
      await page.getByLabel(EDITOR_TEXT.fileInput).setInputFiles({ name: 'long.ts', mimeType: 'text/plain', buffer: Buffer.from(longCode) })
      await expect(page.getByTestId('editor-title')).toHaveText('long.ts')
      await expectScrollable(page)

      await page.getByRole('combobox', { name: 'Language' }).selectOption('Python')
      await expectScrollable(page)

      await page.locator('.monaco-editor .view-lines').first().tap()
      await page.keyboard.press('ControlOrMeta+Home')
      await page.keyboard.type(`typed = '${'z'.repeat(80)}'\n`)
      await expectScrollable(page)
    })

    test('an existing review scrolls a long line in the Summary editor', async ({ page, request }) => {
      const review = await createReview(request, { title: 'Long line', content: longCode })
      await page.goto(ROUTE_PATH.review(review.id))
      await expectScrollable(page)
    })
  })
}

for (const phone of [
  { name: 'iPhone SE', width: 375, height: 667 },
  { name: 'iPhone 12', width: 390, height: 844 }
]) {
  test.describe(`${phone.name} Generated tests`, () => {
    test.use({ viewport: { width: phone.width, height: phone.height }, isMobile: true, hasTouch: true, userAgent: iphoneUserAgent })

    test('the Generated tests editor scrolls its long lines', async ({ page, request }) => {
      const review = await createReview(request, { title: 'Generated', content: longCode })
      await page.goto(ROUTE_PATH.review(review.id))
      await page.getByRole('tab', { name: /Generated tests/ }).click()
      await expectScrollable(page)
    })
  })
}

// Revision 2: Monaco hides the horizontal bar while no line overflows (the empty /review/new
// editor, short code), so on a phone the user saw no bar at all. Below md the track always shows;
// its slider appears once there is something to scroll. From md up Monaco's own behaviour stays.
async function barLook(page: Page) {
  await expect(page.locator('.monaco-editor .view-lines').first()).toBeVisible(MONACO_LOAD)
  await horizontalBar(page).scrollIntoViewIfNeeded()
  return horizontalBar(page).evaluate((bar) => {
    const style = getComputedStyle(bar)
    const sliderElement = bar.querySelector('.slider') as HTMLElement
    return {
      shown: style.opacity === '1' && style.visibility === 'visible',
      height: bar.getBoundingClientRect().height,
      track: style.backgroundColor,
      slider: getComputedStyle(sliderElement).display !== 'none' && sliderElement.getBoundingClientRect().width > 0
    }
  })
}

test.describe('iPhone SE, nothing to scroll yet', () => {
  test.use({ viewport: { width: 375, height: 667 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: iphoneUserAgent })

  test('the empty /review/new editor shows the track, and the slider once a line overflows', async ({ page }) => {
    await page.goto('/review/new')
    const empty = await barLook(page)
    expect(empty.shown).toBe(true)
    expect(empty.height).toBeGreaterThanOrEqual(16)
    expect(empty.track).not.toBe('rgba(0, 0, 0, 0)')
    expect(empty.slider).toBe(false)

    await page.getByLabel(EDITOR_TEXT.fileInput).setInputFiles({ name: 'long.ts', mimeType: 'text/plain', buffer: Buffer.from(longCode) })
    await expect.poll(async () => (await barLook(page)).slider).toBe(true)
  })

  test('an existing review with short code shows the track', async ({ page, request }) => {
    const review = await createReview(request, { title: 'Short code', content: 'const a = 1\n' })
    await page.goto(ROUTE_PATH.review(review.id))
    const look = await barLook(page)
    expect(look.shown).toBe(true)
    expect(look.slider).toBe(false)
  })
})

test.describe('desktop, nothing to scroll', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test('Monaco still hides the horizontal bar when no line overflows', async ({ page }) => {
    await page.goto('/review/new')
    await expect(page.locator('.monaco-editor .view-lines').first()).toBeVisible(MONACO_LOAD)
    await expect(horizontalBar(page)).toHaveCSS('opacity', '0')
  })
})

// Revision 3: typing at the end of a long line made the browser scroll Monaco's clipping box
// natively (scrollLeft about 1160 px). The whole view moved out of the editor: the horizontal bar
// disappeared and the short lines looked empty.
test.describe('iPhone SE, typing a long line', () => {
  test.use({ viewport: { width: 375, height: 667 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: iphoneUserAgent })

  test('the editor view and its scrollbar stay in place', async ({ page }) => {
    await page.goto('/review/new')
    await expect(page.locator('.monaco-editor .view-lines').first()).toBeVisible(MONACO_LOAD)
    await page.getByLabel(EDITOR_TEXT.fileInput).setInputFiles({ name: 'long.ts', mimeType: 'text/plain', buffer: Buffer.from(longCode) })
    await expect(page.getByTestId('editor-title')).toHaveText('long.ts')
    // As a user: scroll the long line sideways, switch the language, then type at the top.
    await expectScrollable(page)
    await page.getByRole('combobox', { name: 'Language' }).selectOption('Python')
    await expectScrollable(page)
    await page.locator('.monaco-editor .view-lines').first().tap()
    await page.keyboard.press('ControlOrMeta+Home')
    await page.keyboard.type(`typed = '${'z'.repeat(80)}'\n`)

    const place = await editor(page).evaluate((monaco) => {
      const clip = monaco.querySelector('.editor-scrollable') as HTMLElement
      const section = monaco.closest('section')!.getBoundingClientRect()
      const bar = clip.querySelector(':scope > .scrollbar.horizontal')!.getBoundingClientRect()
      return { scrollLeft: clip.scrollLeft, scrollTop: clip.scrollTop, barInside: bar.left >= section.left && bar.right <= section.right }
    })
    expect(place).toEqual({ scrollLeft: 0, scrollTop: 0, barInside: true })
    await expectScrollable(page)
  })
})

// Plan 050: the vertical bar is as thick as the horizontal one (16 px below md), so a finger can
// drag it down to the last line of a long file. The bar needs touch-action: none, or the browser
// takes the vertical drag for a page pan after the first move and the slider barely moves.
const tallCode = `${Array.from({ length: 120 }, (_, i) => `const row${i} = ${i}`).join('\n')}\nconst lastRow = 'the end'`
const verticalBar = (page: Page) => editor(page).locator('.editor-scrollable > .scrollbar.vertical')

async function touchDragDown(page: Page, from: { x: number; y: number }, dy: number) {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] })
  for (let step = 1; step <= 8; step++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x, y: from.y + (dy * step) / 8 }] })
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await cdp.detach()
}

for (const phone of [
  { name: 'iPhone 12', width: 390, height: 844 },
  { name: 'small phone', width: 320, height: 568 }
]) {
  test.describe(`${phone.name} vertical scrollbar`, () => {
    test.use({ viewport: { width: phone.width, height: phone.height }, isMobile: true, hasTouch: true, userAgent: iphoneUserAgent })

    test('dragging the 16 px vertical bar reaches the last line', async ({ page }) => {
      await page.goto('/review/new')
      await expect(page.locator('.monaco-editor .view-lines').first()).toBeVisible(MONACO_LOAD)
      await page.getByLabel(EDITOR_TEXT.fileInput).setInputFiles({ name: 'tall.ts', mimeType: 'text/plain', buffer: Buffer.from(tallCode) })
      await expect(page.getByTestId('editor-title')).toHaveText('tall.ts')
      await editor(page).evaluate((element) => element.closest('section')?.scrollIntoView({ block: 'nearest' }))

      const bar = verticalBar(page)
      const thumb = bar.locator('.slider')
      await expect(thumb).toBeVisible()
      await expect(bar).toHaveCSS('opacity', '1')
      const barBox = await bar.boundingBox()
      expect(barBox!.width).toBeGreaterThanOrEqual(16)
      expect(await editor(page).locator('.view-lines').first().textContent()).not.toContain('lastRow')

      // Drag the slider from where it is to the bottom of the bar.
      const from = await center(thumb)
      await touchDragDown(page, from, barBox!.y + barBox!.height - from.y + 40)
      await expect(editor(page).locator('.view-lines').first()).toContainText('lastRow')
    })
  })
}
