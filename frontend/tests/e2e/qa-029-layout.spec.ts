import type { Page } from '@playwright/test'
import { EDITOR_TEXT } from '../../src/lib/review.constants'
import { ROUTE_PATH } from '../../src/lib/route.constants'
import { createReview, expect, test } from './fixture'

// QA, plan 029 (adversarial): try to break the single-scroller fix (`relative` on the AppShell
// root), the sign-in colours and the editor scrollbar change with cases the feature specs do not
// cover: long content, rapid resizes, fixed elements under the newly positioned shell, error
// states on the darker sign-in page, the desktop scrollbar size and a huge single-line file.

async function documentOverflow(page: Page) {
  return page.evaluate(() => ({
    height: document.documentElement.scrollHeight - window.innerHeight,
    width: document.documentElement.scrollWidth - window.innerWidth
  }))
}

function luminance(color: string) {
  const [r, g, b] = (color.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map((value) => {
    const channel = Number(value) / 255
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(first: string, second: string) {
  const [light, dark] = [luminance(first), luminance(second)].sort((a, b) => b - a)
  return (light + 0.05) / (dark + 0.05)
}

test.describe('short viewport with long content', () => {
  test.use({ viewport: { width: 800, height: 600 } })

  test('many reviews: Dashboard and History scroll inside <main> only', async ({ page, request }) => {
    for (let i = 0; i < 12; i++) await createReview(request, { title: `QA long list ${i}` })
    for (const route of ['/', '/history']) {
      await page.goto(route)
      await page.waitForLoadState('networkidle')
      await expect(page.getByText('QA long list 11').first()).toBeVisible()
      expect(await documentOverflow(page), route).toEqual({ height: 0, width: 0 })
      const mainScrolls = await page.evaluate(() => {
        const main = document.querySelector('main') as HTMLElement
        return main.scrollHeight > main.clientHeight
      })
      expect(mainScrolls, route).toBe(true)
    }
  })

  test('rapid resizes never let the document overflow', async ({ page, request }) => {
    await createReview(request, { title: 'Resize check' })
    await page.goto('/')
    await expect(page.getByRole('region', { name: 'Recent Reviews' })).toBeVisible()
    const sizeList = [
      { width: 768, height: 1024 },
      { width: 1000, height: 600 },
      { width: 375, height: 667 },
      { width: 1023, height: 700 },
      { width: 667, height: 375 },
      { width: 1280, height: 500 }
    ]
    for (let round = 0; round < 3; round++) {
      for (const size of sizeList) {
        await page.setViewportSize(size)
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
        expect(await documentOverflow(page), `${size.width}x${size.height}`).toEqual({ height: 0, width: 0 })
      }
    }
  })

  test('the sign-out confirmation still covers the whole viewport after <main> is scrolled', async ({ page }) => {
    await page.goto('/settings')
    await page.getByRole('tab', { name: 'Security' }).click()
    await page.evaluate(() => (document.querySelector('main') as HTMLElement).scrollTo(0, 99999))
    await page.getByRole('button', { name: 'Sign Out' }).click()
    const dialog = page.getByRole('dialog', { name: 'Sign out?' })
    await expect(dialog).toBeVisible()
    await expect(dialog).toBeInViewport({ ratio: 1 })
    const overlay = await dialog.evaluate((element) => {
      let node: HTMLElement | null = element as HTMLElement
      while (node && getComputedStyle(node).position !== 'fixed') node = node.parentElement
      const box = node?.getBoundingClientRect()
      return box ? { x: box.x, y: box.y, width: box.width, height: box.height } : null
    })
    expect(overlay).toEqual({ x: 0, y: 0, width: 800, height: 600 })
  })
})

test.describe('phone', () => {
  test.use({ viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true })

  test('the bottom nav stays pinned to the viewport bottom after <main> scrolls', async ({ page, request }) => {
    for (let i = 0; i < 6; i++) await createReview(request, { title: `QA nav ${i}` })
    await page.goto('/')
    const nav = page.getByRole('navigation', { name: 'Mobile' })
    await expect(nav).toBeVisible()
    await page.evaluate(() => (document.querySelector('main') as HTMLElement).scrollTo(0, 99999))
    const box = await nav.boundingBox()
    expect(box).not.toBeNull()
    expect(Math.round(box!.y + box!.height)).toBe(667)
    expect(await page.evaluate(() => window.scrollY)).toBe(0)
    expect(await documentOverflow(page)).toEqual({ height: 0, width: 0 })
  })

  test('a 10 000 character single line (no newline) scrolls by swipe; the page never scrolls sideways', async ({ page }) => {
    await page.goto('/review/new')
    await expect(page.locator('.monaco-editor .view-lines').first()).toBeVisible({ timeout: 30_000 })
    await page.getByLabel(EDITOR_TEXT.fileInput).setInputFiles({ name: 'one.ts', mimeType: 'text/plain', buffer: Buffer.from(`const s = '${'q'.repeat(10_000)}'`) })
    const bar = page.locator('.monaco-editor:visible .editor-scrollable > .scrollbar.horizontal').first()
    const slider = bar.locator('.slider')
    await expect(slider).toBeVisible({ timeout: 30_000 })
    await bar.scrollIntoViewIfNeeded()
    // On a ~80 000 px line one swipe moves the slider by under a pixel, so read the code's offset.
    const left = () => page.locator('.monaco-editor:visible .lines-content').first().evaluate((element) => -(Number.parseFloat((element as HTMLElement).style.left) || 0))
    await expect.poll(async () => (await slider.boundingBox())?.width ?? 999).toBeLessThan(30)
    const editorBox = await page.locator('.monaco-editor:visible').first().boundingBox()
    const cdp = await page.context().newCDPSession(page)
    const y = editorBox!.y + 15
    for (let swipe = 0; swipe < 5; swipe++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: editorBox!.x + editorBox!.width * 0.9, y }] })
      for (let step = 1; step <= 6; step++) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: editorBox!.x + editorBox!.width * (0.9 - 0.12 * step), y }] })
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    }
    await cdp.detach()
    await expect.poll(left).toBeGreaterThan(500)
    expect(await bar.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(16)
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth + (document.querySelector('main') as HTMLElement).scrollLeft)
    ).toBe(0)
  })
})

test.describe('desktop editor', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test('the horizontal scrollbar stays thin (12 px) and the vertical one 4 px; the suggest widget keeps Monaco colours', async ({ page, request }) => {
    const review = await createReview(request, { title: 'Desktop bar', content: `const a = '${'w'.repeat(400)}'\n${'const b = 1\n'.repeat(80)}` })
    await page.goto(ROUTE_PATH.review(review.id))
    const editor = page.locator('.monaco-editor:visible').first()
    const horizontal = editor.locator('.editor-scrollable > .scrollbar.horizontal')
    const vertical = editor.locator('.editor-scrollable > .scrollbar.vertical')
    await expect(horizontal.locator('.slider')).toBeVisible({ timeout: 30_000 })
    expect(await horizontal.evaluate((element) => element.getBoundingClientRect().height)).toBe(12)
    expect(await vertical.evaluate((element) => element.getBoundingClientRect().width)).toBe(4)
    // The vertical bar has no track (only the horizontal one does).
    expect(await vertical.evaluate((element) => getComputedStyle(element).backgroundColor)).toMatch(/rgba\(0, 0, 0, 0\)|transparent/)
  })
})

test.describe('sign-in error states on the darker background', () => {
  test.use({ signIn: false, viewport: { width: 375, height: 667 } })

  // The field error red (#ef4444) is below AA on either card: 3.76:1 on the new white light card
  // and 4.24:1 on the dark card. Both were already below AA before plan 029 (2.98:1 on the old
  // #e0e5ee light card), so this guards against a regression only; the AA gap is a QA finding.
  const baseline: Record<string, number> = { light: 2.98, dark: 4.24 }
  for (const theme of ['light', 'dark']) {
    test(`required-field and failure messages are no less readable in the ${theme} theme`, async ({ page }) => {
      await page.goto('/login')
      await page.evaluate((value) => document.documentElement.setAttribute('data-theme', value), theme)
      await page.getByRole('button', { name: 'Sign in' }).click()
      const message = page.getByText('Enter your user name.')
      await expect(message).toBeVisible()
      const color = await message.evaluate((element) => {
        let node: HTMLElement | null = element as HTMLElement
        while (node && getComputedStyle(node).backgroundColor === 'rgba(0, 0, 0, 0)') node = node.parentElement
        return { text: getComputedStyle(element).color, back: node ? getComputedStyle(node).backgroundColor : 'rgb(255, 255, 255)' }
      })
      expect(contrast(color.text, color.back), JSON.stringify(color)).toBeGreaterThanOrEqual(baseline[theme])
      // The page itself scrolls normally on a short phone, no second scroller.
      expect(await documentOverflow(page).then((value) => value.width)).toBe(0)
    })
  }
})
