import type { Page } from '@playwright/test'
import { TEST_CONFIG_TEXT } from '../../src/lib/review.constants'
import { createReview, expect, MONACO_LOAD, test } from './fixture'

// Plan 034, Workstream C, on the real backend: Framework and Test Type are kept per review (the
// server stores them with Regenerate and generates in that framework's syntax), and the Generated
// Tests layout ("Tests generated for", the Copy all icon button) at phone, tablet and desktop.

const framework = (page: Page) => page.getByRole('combobox', { name: TEST_CONFIG_TEXT.framework })
const typeBox = (page: Page, name: string) => page.getByRole('checkbox', { name })
const testsTab = (page: Page) => page.getByRole('tab', { name: /Generated tests/ })
const editorText = (page: Page) => page.locator('.monaco-editor .view-lines').last()

test('choose Vitest and only Edge Cases: kept across tabs and a reload, and the generated code changes', async ({ page, request }) => {
  const { id } = await createReview(request, { title: 'Config review' })
  await page.goto(`/review/${id}`)
  await testsTab(page).click()
  await expect(framework(page)).toHaveValue('Jest')
  await expect(editorText(page)).toBeVisible(MONACO_LOAD)
  const before = await editorText(page).innerText()

  await framework(page).selectOption('Vitest')
  await typeBox(page, 'Unit Tests').uncheck()
  await typeBox(page, 'Error Cases').uncheck()
  await page.getByRole('tab', { name: 'Summary' }).click()
  await testsTab(page).click()
  await expect(framework(page)).toHaveValue('Vitest')
  await expect(typeBox(page, 'Unit Tests')).not.toBeChecked()
  await expect(typeBox(page, 'Edge Cases')).toBeChecked()

  // At least one kind is needed.
  await typeBox(page, 'Edge Cases').uncheck()
  await expect(page.getByRole('button', { name: 'Regenerate' })).toBeDisabled()
  await expect(page.getByText(TEST_CONFIG_TEXT.testTypeRequired)).toBeVisible()
  await typeBox(page, 'Edge Cases').check()

  await page.getByRole('button', { name: 'Regenerate' }).click()
  await expect(page.getByText('Tests regenerated')).toBeVisible()
  await expect(editorText(page)).toContainText('vitest')
  expect(await editorText(page).innerText()).not.toBe(before)

  await page.reload()
  await testsTab(page).click()
  await expect(framework(page)).toHaveValue('Vitest')
  await expect(typeBox(page, 'Unit Tests')).not.toBeChecked()
  await expect(typeBox(page, 'Edge Cases')).toBeChecked()
  await expect(typeBox(page, 'Error Cases')).not.toBeChecked()
  await expect(editorText(page)).toContainText('vitest', MONACO_LOAD)
})

for (const [label, width, height] of [
  ['phone 320', 320, 640],
  ['tablet 768', 768, 1024],
  ['desktop 1280', 1280, 800]
] as const) {
  test(`Generated Tests layout at ${label}: every "Tests generated for" file shows, Copy all is an icon button at the top`, async ({ page, request }) => {
    await page.setViewportSize({ width, height })
    const { id } = await createReview(request, { title: 'Layout review' })
    await page.goto(`/review/${id}`)
    await testsTab(page).click()

    const list = page.getByRole('list', { name: TEST_CONFIG_TEXT.generatedFor })
    await list.scrollIntoViewIfNeeded()
    await expect(list).toBeVisible()
    const itemList = list.getByRole('button')
    const count = await itemList.count()
    expect(count).toBeGreaterThan(0)
    for (let index = 0; index < count; index += 1) {
      const item = itemList.nth(index)
      await item.scrollIntoViewIfNeeded()
      await expect(item).toBeInViewport()
      // The name wraps instead of being cut off.
      expect(await item.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(0)
    }

    const copyAll = page.getByRole('button', { name: TEST_CONFIG_TEXT.copyAll })
    await expect(copyAll).toHaveAttribute('title', TEST_CONFIG_TEXT.copyAll)
    await expect(copyAll).toHaveText('')
    expect(await copyAll.evaluate((element) => getComputedStyle(element).borderTopWidth)).not.toBe('0px')
    const titleBox = await page.getByRole('heading', { name: TEST_CONFIG_TEXT.title }).boundingBox()
    const copyBox = await copyAll.boundingBox()
    // On the title's row.
    expect(Math.abs(titleBox!.y + titleBox!.height / 2 - (copyBox!.y + copyBox!.height / 2))).toBeLessThan(12)
    const sideScroll = await page.evaluate(() => document.scrollingElement!.scrollWidth - window.innerWidth)
    expect(sideScroll).toBeLessThanOrEqual(0)
  })
}

test('Copy all copies every test file with a success toast', async ({ page, request, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  const { id } = await createReview(request, { title: 'Copy review' })
  await page.goto(`/review/${id}`)
  await testsTab(page).click()

  await page.getByRole('button', { name: TEST_CONFIG_TEXT.copyAll }).click()
  await expect(page.getByText(TEST_CONFIG_TEXT.copiedAll)).toBeVisible()
  const copied = await page.evaluate(() => navigator.clipboard.readText())
  expect(copied).toMatch(/^\/\/ ---- /)
})
