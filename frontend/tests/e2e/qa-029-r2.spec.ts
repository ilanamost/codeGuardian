import type { Page } from '@playwright/test'
import { EDITOR_TEXT } from '../../src/lib/review.constants'
import { ROUTE_PATH } from '../../src/lib/route.constants'
import { DEMO_PASSWORD, DEMO_USERNAME } from './e2e.constants'
import { createReview, expect, MONACO_LOAD, test } from './fixture'

// QA round 2, plan 029 revision 2 (adversarial): the read-only-until-touched password field must
// not cost a real user anything (keyboard, paste, reveal toggle, Enter, a phone tap, the first
// character), the hidden username of the change form must stay out of tab order and the
// accessibility tree, and the always-visible editor track must be phone-only and not swallow taps.

const passwordInput = (page: Page, label = 'Password') => page.getByLabel(label, { exact: true })
const longLine = `const s = '${'q'.repeat(300)}'\n`
const horizontalBar = (page: Page) => page.locator('.monaco-editor:visible .editor-scrollable > .scrollbar.horizontal').first()

test.describe('signed out, desktop keyboard and mouse', () => {
  test.use({ signIn: false, permissions: ['clipboard-read', 'clipboard-write'] })

  test('keyboard only: Tab into the password, the first character is kept, Enter signs in', async ({ page }) => {
    await page.goto('/login')
    await page.getByLabel('User name').click()
    await page.keyboard.type(DEMO_USERNAME)
    await page.keyboard.press('Tab')
    await expect(passwordInput(page)).toBeFocused()
    await expect(passwordInput(page)).not.toHaveAttribute('readonly', '')
    // Typed right after the focus, with no wait: the first character must not be lost.
    await page.keyboard.type(DEMO_PASSWORD, { delay: 0 })
    await expect(passwordInput(page)).toHaveValue(DEMO_PASSWORD)
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible()
  })

  test('paste into the password works after a click', async ({ page }) => {
    await page.goto('/login')
    await page.evaluate(() => navigator.clipboard.writeText('pasted-secret-1'))
    await passwordInput(page).click()
    await page.keyboard.press('ControlOrMeta+V')
    await expect(passwordInput(page)).toHaveValue('pasted-secret-1')
  })

  test('the reveal toggle works before and after the field is touched', async ({ page }) => {
    await page.goto('/login')
    const reveal = page.getByRole('button', { name: /show password/i })
    await reveal.click()
    await expect(passwordInput(page)).toHaveAttribute('type', 'text')
    await passwordInput(page).click()
    await page.keyboard.type('abc1')
    await expect(passwordInput(page)).toHaveValue('abc1')
    await page.getByRole('button', { name: /hide password/i }).click()
    await expect(passwordInput(page)).toHaveAttribute('type', 'password')
    await expect(passwordInput(page)).toHaveValue('abc1')
  })

  test('a typed character on the read-only field before any focus is not inserted anywhere wrong', async ({ page }) => {
    await page.goto('/login')
    // Script-set focus (as an assistive tool or a password manager would do) arms the field too.
    await passwordInput(page).focus()
    await expect(passwordInput(page)).not.toHaveAttribute('readonly', '')
    await page.keyboard.type('x9')
    await expect(passwordInput(page)).toHaveValue('x9')
  })

  test('accessibility: the field is exposed as a password textbox, read-only only until focused', async ({ page }) => {
    await page.goto('/login')
    const before = await page.locator('#' + (await passwordInput(page).getAttribute('id'))).ariaSnapshot()
    expect(before).toContain('textbox "Password"')
    await passwordInput(page).focus()
    await expect(passwordInput(page)).toBeEditable()
  })
})

test.describe('signed out, phone tap', () => {
  test.use({ signIn: false, viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true })

  test('a tap arms the field and typing starts at the first character', async ({ page }) => {
    await page.goto('/login')
    await passwordInput(page).tap()
    await expect(passwordInput(page)).toBeFocused()
    await expect(passwordInput(page)).not.toHaveAttribute('readonly', '')
    await page.keyboard.type('tap-1')
    await expect(passwordInput(page)).toHaveValue('tap-1')
  })
})

test('change-password form: the hidden username is out of tab order and the accessibility tree; Tab and typing work', async ({ page }) => {
  await page.goto('/settings?section=security')
  await page.getByRole('button', { name: 'Update password' }).click()
  const hidden = page.locator('form input[autocomplete="username"]')
  await expect(hidden).toBeHidden()
  await expect(hidden).toHaveAttribute('readonly', '')
  expect(await hidden.evaluate((element) => (element as HTMLInputElement).form?.method)).toBeDefined()
  // Not exposed: no unnamed textbox in the form.
  const formSnapshot = await page.locator('form').first().ariaSnapshot()
  expect(formSnapshot).not.toContain(DEMO_USERNAME)

  await passwordInput(page, 'Current password').click()
  await page.keyboard.type('cur-1')
  await page.keyboard.press('Tab')
  // The next stop is the reveal toggle of the same field, then New password; never the hidden input.
  const stops: string[] = []
  for (let i = 0; i < 4; i++) {
    stops.push(await page.evaluate(() => `${document.activeElement?.tagName}:${document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.id}`))
    await page.keyboard.press('Tab')
  }
  expect(stops.join(' ')).not.toMatch(/username/i)
  await passwordInput(page, 'New password').focus()
  await page.keyboard.type('new-pass-1')
  await expect(passwordInput(page, 'New password')).toHaveValue('new-pass-1')
  await expect(passwordInput(page, 'Current password')).toHaveValue('cur-1')
})

test.describe('editor track at md and up', () => {
  for (const viewport of [{ width: 768, height: 1024 }, { width: 1023, height: 700 }]) {
    test(`${viewport.width}x${viewport.height}: no forced track on an empty editor`, async ({ page }) => {
      await page.setViewportSize(viewport)
      await page.goto('/review/new')
      await expect(page.locator('.monaco-editor .view-lines').first()).toBeVisible(MONACO_LOAD)
      await expect(horizontalBar(page)).toHaveCSS('opacity', '0')
    })
  }
})

test.describe('editor track on a 375x667 phone', () => {
  test.use({ viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true })

  test('Generated tests editor with short code shows the track too', async ({ page, request }) => {
    const review = await createReview(request, { title: 'Short', content: 'const a = 1\n' })
    await page.goto(ROUTE_PATH.review(review.id))
    await page.getByRole('tab', { name: /Generated tests/ }).click()
    await expect(page.locator('.monaco-editor:visible .view-lines').first()).toBeVisible(MONACO_LOAD)
    await horizontalBar(page).scrollIntoViewIfNeeded()
    await expect(horizontalBar(page)).toHaveCSS('opacity', '1')
    await expect(horizontalBar(page)).toHaveCSS('visibility', 'visible')
  })

  // Round 2 recorded the track below the fold on load (y 1004 vs nav 603). Revision 3 moved the
  // editor up on phones, so the track must now be on the first screen without any page scroll.
  test('discoverability: on load the track is on the first screen, above the nav, with no page scroll', async ({ page }) => {
    await page.goto('/review/new')
    await expect(page.locator('.monaco-editor .view-lines').first()).toBeVisible(MONACO_LOAD)
    await page.waitForLoadState('networkidle')
    const navTop = (await page.getByRole('navigation', { name: 'Mobile' }).boundingBox())!.y
    const onLoad = (await horizontalBar(page).boundingBox())!
    expect(onLoad.y).toBeGreaterThan(0)
    expect(onLoad.y + onLoad.height).toBeLessThanOrEqual(navTop)
    expect(await page.evaluate(() => (document.querySelector('main') as HTMLElement).scrollTop)).toBe(0)
  })

  // With nothing to scroll the forced track is still Monaco's .invisible bar (pointer-events: none),
  // so a tap on the band reaches the code; once a line overflows the band is the real scrollbar.
  async function hitAtBand(page: Page) {
    await horizontalBar(page).scrollIntoViewIfNeeded()
    const bar = (await horizontalBar(page).boundingBox())!
    return page.evaluate(
      ({ x, yBand, yAbove }) => {
        const band = document.elementFromPoint(x, yBand)
        const above = document.elementFromPoint(x, yAbove)
        return {
          bandIsScrollbar: band?.closest('.scrollbar.horizontal') !== null,
          bandIsCode: band?.closest('.monaco-editor') !== null && band?.closest('.scrollbar') === null,
          aboveIsCode: above?.closest('.monaco-editor') !== null && above?.closest('.scrollbar') === null
        }
      },
      { x: bar.x + bar.width / 2, yBand: bar.y + bar.height / 2, yAbove: bar.y - 10 }
    )
  }

  test('the forced track lets taps through to the code until a line overflows; then it is the scrollbar', async ({ page }) => {
    await page.goto('/review/new')
    await expect(page.locator('.monaco-editor .view-lines').first()).toBeVisible(MONACO_LOAD)
    expect(await hitAtBand(page)).toEqual({ bandIsScrollbar: false, bandIsCode: true, aboveIsCode: true })
    await page.getByLabel(EDITOR_TEXT.fileInput).setInputFiles({ name: 'long.ts', mimeType: 'text/plain', buffer: Buffer.from(longLine) })
    await expect(horizontalBar(page).locator('.slider')).toBeVisible()
    expect(await hitAtBand(page)).toEqual({ bandIsScrollbar: true, bandIsCode: false, aboveIsCode: true })
  })
})
