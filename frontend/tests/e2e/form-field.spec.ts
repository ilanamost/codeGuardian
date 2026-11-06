import type { Page } from '@playwright/test'
import { DEMO_USERNAME } from './e2e.constants'
import { expect, MONACO_LOAD, test } from './fixture'

// Plan 029 revision 2: every form control has a visible boundary (the input-border token, 3:1),
// error text uses the error-text token (4.5:1), and a password field is empty on load: it stays
// read-only, so the browser cannot autofill a saved (possibly another account's) password, until
// the user clicks or focuses it.

const INPUT_BORDER = { light: 'rgb(115, 125, 148)', dark: 'rgb(110, 124, 160)' }
const ERROR_TEXT = { light: 'rgb(185, 28, 28)', dark: 'rgb(248, 113, 113)' }

async function setTheme(page: Page, theme: 'light' | 'dark') {
  await page.evaluate((value) => document.documentElement.setAttribute('data-theme', value), theme)
}

// The border colour of each visible text input, select and textarea, or of the box around it
// (the password field and the search field draw the border on their wrapper).
async function controlBorderList(page: Page) {
  return page.evaluate(() => {
    const selector = 'input:not([type=checkbox]):not([type=radio]):not([type=file]):not([hidden]), select, textarea'
    return Array.from(document.querySelectorAll<HTMLElement>(selector))
      .filter((element) => !element.closest('.monaco-editor') && element.getBoundingClientRect().width > 0)
      .map((element) => {
        let box: HTMLElement | null = element
        for (let level = 0; box && level < 3 && getComputedStyle(box).borderTopWidth === '0px'; level++) box = box.parentElement
        const name = element.getAttribute('aria-label') ?? element.id
        return { name, color: box ? getComputedStyle(box).borderTopColor : 'none' }
      })
  })
}

async function expectInputBorder(page: Page) {
  for (const theme of ['light', 'dark'] as const) {
    await setTheme(page, theme)
    const list = await controlBorderList(page)
    expect(list.length).toBeGreaterThan(0)
    for (const item of list) expect(item.color, `${item.name} (${theme})`).toBe(INPUT_BORDER[theme])
  }
}

const passwordInput = (page: Page, label: string) => page.getByLabel(label, { exact: true })

test.describe('signed out', () => {
  test.use({ signIn: false })

  test('/login: the password is empty and not autofillable on load, and editable once clicked', async ({ page }) => {
    await page.goto('/login')
    const password = passwordInput(page, 'Password')
    await expect(password).toHaveValue('')
    await expect(password).toHaveAttribute('readonly', '')
    await expect(password).toHaveAttribute('autocomplete', 'current-password')
    await expect(page.getByLabel('User name')).toHaveAttribute('autocomplete', 'username')

    await password.click()
    await expect(password).not.toHaveAttribute('readonly', '')
    await password.pressSequentially('typed-1')
    await expect(password).toHaveValue('typed-1')
  })

  test('/register: both password fields are empty and not autofillable on load', async ({ page }) => {
    await page.goto('/register')
    for (const label of ['Password', 'Confirm password']) {
      await expect(passwordInput(page, label)).toHaveValue('')
      await expect(passwordInput(page, label)).toHaveAttribute('readonly', '')
      await expect(passwordInput(page, label)).toHaveAttribute('autocomplete', 'new-password')
    }
  })

  test('/login and /register: input borders and error text meet the contrast tokens in both themes', async ({ page }) => {
    for (const route of ['/login', '/register']) {
      await page.goto(route)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      await expectInputBorder(page)
    }

    await page.goto('/login')
    await page.getByRole('button', { name: 'Sign in' }).click()
    const fieldError = page.getByRole('alert').first()
    await expect(fieldError).toBeVisible()
    for (const theme of ['light', 'dark'] as const) {
      await setTheme(page, theme)
      await expect(fieldError).toHaveCSS('color', ERROR_TEXT[theme])
    }
  })
})

test('the password-change form starts empty, names the account and is not autofillable on load', async ({ page }) => {
  await page.goto('/settings?section=security')
  await page.getByRole('button', { name: 'Update password' }).click()
  const expected = { 'Current password': 'current-password', 'New password': 'new-password', 'Confirm password': 'new-password' }
  for (const [label, autocomplete] of Object.entries(expected)) {
    await expect(passwordInput(page, label)).toHaveValue('')
    await expect(passwordInput(page, label)).toHaveAttribute('readonly', '')
    await expect(passwordInput(page, label)).toHaveAttribute('autocomplete', autocomplete)
  }
  await expect(page.locator('form input[autocomplete="username"]')).toHaveValue(DEMO_USERNAME)
  await expectInputBorder(page)
})

for (const route of ['/settings?section=ai', '/help?topic=contact', '/help?topic=error-messages', '/github', '/']) {
  test(`every form control on ${route} has the input border in both themes`, async ({ page }) => {
    await page.goto(route)
    await page.waitForLoadState('networkidle')
    await expectInputBorder(page)
  })
}

test('the review name input and the editor language select have the input border', async ({ page }) => {
  await page.goto('/review/new')
  await expect(page.locator('.monaco-editor').first()).toBeVisible(MONACO_LOAD)
  await page.getByRole('button', { name: 'Edit review name' }).click()
  await expectInputBorder(page)
})
