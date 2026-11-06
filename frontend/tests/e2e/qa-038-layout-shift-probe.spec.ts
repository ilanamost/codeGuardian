import type { Page } from '@playwright/test'
import { expect, MONACO_LOAD, test } from './fixture'

// QA plan 038: where does the intermittent layout shift on /review/new come from? The same
// measurement on the New Review page WITHOUT an import session (no FileDraftList / picker at all):
// if Monaco's mount shifts here too, the shift predates plan 038.

type QaShift = { value: number; at: number; sourceList: string[] }

async function watchShift(page: Page) {
  await page.addInitScript(() => {
    const store = window as unknown as { __qaShiftList: unknown[] }
    store.__qaShiftList = []
    const describe = (node: Node | null) =>
      node instanceof Element ? `${node.tagName.toLowerCase()}${node.id ? `#${node.id}` : ''}.${String(node.className).split(' ').slice(0, 3).join('.')}` : 'null'
    new PerformanceObserver((entryList) => {
      for (const entry of entryList.getEntries() as unknown as { value: number; hadRecentInput: boolean; startTime: number; sources?: { node: Node | null }[] }[]) {
        if (!entry.hadRecentInput) store.__qaShiftList.push({ value: entry.value, at: Math.round(entry.startTime), sourceList: (entry.sources ?? []).map((source) => describe(source.node)) })
      }
    }).observe({ type: 'layout-shift', buffered: true })
  })
}

test('probe: New Review page without an import session, Monaco mount only', async ({ page }) => {
  await watchShift(page)
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/review/new')
  await expect(page.locator('.monaco-editor').first()).toBeVisible(MONACO_LOAD)
  await page.waitForTimeout(1500)
  const list = await page.evaluate(() => (window as unknown as { __qaShiftList: QaShift[] }).__qaShiftList)
  const total = list.reduce((sum, shift) => sum + shift.value, 0)
  test.info().annotations.push({ type: 'qa-shift', description: JSON.stringify(list) })
  expect(total, JSON.stringify(list)).toBeLessThan(0.1)
})
