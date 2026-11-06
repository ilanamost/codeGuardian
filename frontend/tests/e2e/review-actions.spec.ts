import type { Locator, Page } from '@playwright/test'
import { ROUTE_PATH } from '../../src/lib/route.constants'
import { createReview, expect, test } from './fixture'

// A review with findings, created before each test (the backend starts with no reviews;
// /review/new is blank until saved, see api-integration.spec.ts).
let reviewId = ''
let reviewPath = ''

test.beforeEach(async ({ request }) => {
  reviewId = (await createReview(request, { title: 'Authentication Service' })).id
  reviewPath = ROUTE_PATH.review(reviewId)
})

async function expectNoScroll(element: Locator) {
  const size = await element.evaluate((node) => ({
    scrollHeight: node.scrollHeight,
    clientHeight: node.clientHeight,
    scrollWidth: node.scrollWidth,
    clientWidth: node.clientWidth
  }))
  expect(size.scrollHeight).toBeLessThanOrEqual(size.clientHeight)
  expect(size.scrollWidth).toBeLessThanOrEqual(size.clientWidth)
}

async function isScrollable(element: Locator) {
  return element.evaluate((node) => node.scrollHeight > node.clientHeight || node.scrollWidth > node.clientWidth)
}

const panelLocator = (page: Page) =>
  page.getByText('Findings Summary').locator('xpath=ancestor::div[contains(@class, "shadow-card")][1]')

const longNameList = [
  { label: 'with spaces', name: 'Very long review name '.repeat(4).slice(0, 80).trim() },
  { label: 'without spaces', name: 'A'.repeat(80) }
]

for (const width of [375, 768, 1024, 1280, 1920]) {
  for (const { label, name } of longNameList) {
    test.describe(`Review page ${width}x720 with an 80 character name ${label}`, () => {
      test.use({ viewport: { width, height: 720 } })

      test('header stays compact and nothing overflows', async ({ page }) => {
        await page.goto(reviewPath)
        await page.getByRole('button', { name: 'Edit review name' }).click()
        await page.getByRole('textbox', { name: 'Review name' }).fill(name)
        await page.keyboard.press('Enter')

        await expect(page.getByRole('heading', { name: 'Review Results' })).toBeVisible()
        await expect(page.getByRole('button', { name: 'Edit review name' })).toBeVisible()
        await expect(page.getByTestId('review-name')).toHaveAttribute('title', name)
        const noHorizontalOverflow = await page.evaluate(() => {
          const main = document.querySelector('main')
          return document.documentElement.scrollWidth <= window.innerWidth && (main?.scrollWidth ?? 0) <= (main?.clientWidth ?? 0)
        })
        expect(noHorizontalOverflow).toBe(true)

        if (width >= 1024) {
          const header = await page.locator('header').first().boundingBox()
          expect(header?.height ?? 0).toBeLessThan(60)
          await expectNoScroll(page.getByRole('tablist'))
          await expectNoScroll(page.getByRole('tabpanel'))
          await expectNoScroll(panelLocator(page))
          const button = await page.getByRole('button', { name: 'View all findings' }).boundingBox()
          expect((button?.y ?? 0) + (button?.height ?? 0)).toBeLessThanOrEqual(720)
        }
      })
    })
  }
}

for (const width of [1024, 1280, 1920]) {
  test.describe(`Review page ${width}x720`, () => {
    test.use({ viewport: { width, height: 720 } })

    test('tab row, tab panel and Findings Summary panel do not scroll', async ({ page }) => {
      await page.goto(reviewPath)
      await expect(page.getByRole('tablist')).toBeVisible()

      await expectNoScroll(page.getByRole('tablist'))
      await expectNoScroll(page.getByRole('tabpanel'))
      await expectNoScroll(panelLocator(page))
    })
  })

  test.describe(`Review page ${width}x600`, () => {
    test.use({ viewport: { width, height: 600 } })

    test('no nested scrollbars: at most one scroll region in the tab panel', async ({ page }) => {
      await page.goto(reviewPath)
      await expect(page.getByRole('tablist')).toBeVisible()

      await expectNoScroll(page.getByRole('tablist'))
      const scrollable = [await isScrollable(page.getByRole('tabpanel')), await isScrollable(panelLocator(page))]
      expect(scrollable.filter(Boolean).length).toBeLessThanOrEqual(1)
    })
  })
}

test.describe('Review page actions at 1280x720', () => {
  test.use({ viewport: { width: 1280, height: 720 } })

  test('Download report yields a .pdf file', async ({ page }) => {
    await page.goto(reviewPath)

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Download report' }).click()
    ])

    expect(download.suggestedFilename()).toBe(`review-${reviewId}.pdf`)
  })

  test('View all findings opens the Findings tab', async ({ page }) => {
    await page.goto(reviewPath)

    await page.getByRole('button', { name: 'View all findings' }).click()

    await expect(page.getByRole('tab', { name: /^Findings/ })).toHaveAttribute('aria-selected', 'true')
  })

  test('Save review survives a reload and can be clicked twice', async ({ page }) => {
    await page.goto(reviewPath)

    await page.getByRole('button', { name: 'Save review' }).click()
    await expect(page.getByText('Review saved')).toBeVisible()
    await page.getByRole('button', { name: 'Save review' }).click()
    await expect(page.getByRole('button', { name: 'Save review' })).toBeEnabled()
    await page.reload()

    await expect(page.getByRole('button', { name: 'Save review' })).toBeEnabled()
  })

  test('renamed review keeps its name after save and shows in History', async ({ page, request }) => {
    const { id } = await createReview(request, { title: 'Payment API' })
    await page.goto(ROUTE_PATH.review(id))

    await page.getByRole('button', { name: 'Edit review name' }).click()
    await page.getByRole('textbox', { name: 'Review name' }).fill('Payments v2')
    await page.keyboard.press('Enter')
    await page.getByRole('button', { name: 'Save review' }).click()
    await page.reload()
    await expect(page.getByTestId('review-name')).toHaveText('Payments v2')

    await page.goto('/history')
    await expect(page.getByRole('link', { name: /Payments v2/ })).toBeVisible()
  })

  test('deleting a review removes it from History and Dashboard', async ({ page }) => {
    await page.goto('/history')

    await page.getByRole('button', { name: 'Delete review Authentication Service' }).click()
    await page.getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(page.getByText('Review deleted')).toBeVisible()
    await expect(page.getByRole('link', { name: /Authentication Service/ })).toHaveCount(0)

    await page.goto('/')
    await expect(page.getByRole('link', { name: /Authentication Service/ })).toHaveCount(0)
    await page.goto(reviewPath)
    await expect(page.getByRole('heading', { name: 'Review not found' })).toBeVisible()
  })
})
