import type { Locator, Page } from '@playwright/test'
import { expect, test } from './fixture'

// QA plan 032: the outcome banner, its hint and the copy buttons must be readable (WCAG AA,
// 4.5:1 for this small text) in the light and the dark theme. Colors are measured from the page:
// the element's text color against the first opaque background behind it, both normalised by
// painting them on a canvas, so any CSS color syntax (hex, rgb, oklch, color-mix) works.

async function contrastOf(locator: Locator): Promise<number> {
  return locator.evaluate((element) => {
    const canvas = document.createElement('canvas')
    canvas.width = 1
    canvas.height = 1
    const context = canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D
    const rgbaOf = (color: string) => {
      context.clearRect(0, 0, 1, 1)
      context.fillStyle = color
      context.fillRect(0, 0, 1, 1)
      const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data
      return { r: r ?? 0, g: g ?? 0, b: b ?? 0, a: (a ?? 0) / 255 }
    }
    let node: Element | null = element
    let background = { r: 255, g: 255, b: 255, a: 1 }
    while (node) {
      const color = rgbaOf(getComputedStyle(node).backgroundColor)
      if (color.a > 0.99) {
        background = color
        break
      }
      node = node.parentElement
    }
    const text = rgbaOf(getComputedStyle(element).color)
    const blend = (channel: 'r' | 'g' | 'b') => text[channel] * text.a + background[channel] * (1 - text.a)
    const luminance = (r: number, g: number, b: number) => {
      const linear = (value: number) => {
        const s = value / 255
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
      }
      return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
    }
    const textL = luminance(blend('r'), blend('g'), blend('b'))
    const backL = luminance(background.r, background.g, background.b)
    return (Math.max(textL, backL) + 0.05) / (Math.min(textL, backL) + 0.05)
  })
}

async function submit(page: Page) {
  await page.goto('/help?topic=contact')
  await page.getByRole('radio', { name: 'Other' }).check()
  await expect(page.getByLabel('Email address')).not.toHaveValue('')
  await page.getByLabel('Describe the problem').fill('Contrast check for the outcome banner')
  await page.getByRole('button', { name: 'Submit request' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'mail app' })).toBeVisible()
}

for (const theme of ['light', 'dark'] as const) {
  test(`outcome banner, hint and copy buttons reach 4.5:1 contrast in the ${theme} theme`, async ({ page }) => {
    await submit(page)
    await page.evaluate((value) => document.documentElement.setAttribute('data-theme', value), theme)

    const target: [string, Locator][] = [
      ['outcome', page.getByRole('status').filter({ hasText: 'mail app' })],
      ['address', page.getByTestId('support-address')],
      ['hint', page.getByText('Nothing opened? Copy the message')],
      ['Copy message', page.getByRole('button', { name: 'Copy message' })],
      ['Copy address', page.getByRole('button', { name: 'Copy address' })]
    ]
    const ratioList: string[] = []
    for (const [name, locator] of target) {
      await expect(locator).toBeVisible()
      const ratio = await contrastOf(locator)
      ratioList.push(`${name} ${ratio.toFixed(2)}`)
      expect(ratio, `${theme} ${name}: ${ratioList.join(', ')}`).toBeGreaterThanOrEqual(4.5)
    }
    console.log(`[qa-032 contrast ${theme}] ${ratioList.join(', ')}`)
  })
}
