import type { Page, Route } from '@playwright/test'
import { API_PATH } from '../../src/lib/api.constants'
import { ACCOUNT_TEXT, SECURITY_TEXT } from '../../src/lib/account.constants'
import { AUTH_ERROR_CODE_LIST, AUTH_ERROR_TEXT, SESSION_TEXT } from '../../src/lib/session.constants'
import { FRONTEND_URL } from './e2e.constants'
import { apiRoute, expect, fulfillJson, signInAs, test } from './fixture'

// Plan 040: GitHub sign-in in the browser. The backend's GitHub OAuth is not available to these
// specs and none of them reaches github.com: the health flag and the redirects are forced with
// page.route. The "callback" signs in with the demo password (the same session cookie the real
// callback sets), then redirects to the frontend as the backend does.

const buttonName = SESSION_TEXT.continueWithGithub

// GET /api/health with githubOAuth forced (CORS headers and the rest of the body stay real).
async function forceGithubFlag(page: Page, enabled: boolean) {
  await page.route(apiRoute(API_PATH.health), async (route: Route) => {
    const response = await route.fetch()
    const body = (await response.json()) as Record<string, unknown>
    await route.fulfill({ response, json: { ...body, githubOAuth: enabled } })
  })
}

// A browser navigation to the backend start route answered with a redirect.
async function redirectStart(page: Page, location: string, beforeRedirect?: () => Promise<void>) {
  const seen: { url: string; type: string }[] = []
  await page.route(new RegExp(`^${apiRoute(API_PATH.githubSignIn).replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}(\\?.*)?$`), async (route: Route) => {
    seen.push({ url: route.request().url(), type: route.request().resourceType() })
    await beforeRedirect?.()
    await route.fulfill({ status: 302, headers: { Location: location } })
  })
  return seen
}

test.describe('Continue with GitHub, signed out', () => {
  test.use({ signIn: false })

  test('the button is absent when GitHub sign-in is not configured', async ({ page }) => {
    await forceGithubFlag(page, false)
    await page.goto('/login')
    await expect(page.getByRole('button', { name: SESSION_TEXT.signIn })).toBeVisible()
    await expect(page.getByRole('link', { name: buttonName })).toHaveCount(0)

    await page.goto('/register')
    await expect(page.getByRole('button', { name: SESSION_TEXT.register })).toBeVisible()
    await expect(page.getByRole('link', { name: buttonName })).toHaveCount(0)
  })

  test('the button is on /login and /register when configured, keyboard reachable and inside a 375 px screen', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 700 })
    await forceGithubFlag(page, true)
    await page.goto('/login')

    const link = page.getByRole('link', { name: buttonName })
    await expect(link).toBeVisible()
    await link.focus()
    await expect(link).toBeFocused()
    const box = await link.boundingBox()
    expect(box && box.x >= 0 && box.x + box.width <= 375).toBe(true)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)

    await page.goto('/register')
    await expect(page.getByRole('link', { name: buttonName })).toBeVisible()
  })

  test('the button navigates the browser to the backend start route (not a fetch), and the callback signs the user in', async ({ page, request }) => {
    await forceGithubFlag(page, true)
    const seen = await redirectStart(page, `${FRONTEND_URL}/`, () => signInAs(request))
    await page.goto('/login')

    await page.getByRole('link', { name: buttonName }).click()

    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible()
    expect(seen).toHaveLength(1)
    expect(seen[0].type).toBe('document')
    expect(new URL(seen[0].url).pathname).toBe(API_PATH.githubSignIn)
  })

  test('a page asked for before sign-in is sent along as returnTo', async ({ page }) => {
    await forceGithubFlag(page, true)
    const seen = await redirectStart(page, `${FRONTEND_URL}/login`)
    await page.goto('/history')
    await expect(page).toHaveURL(/\/login$/)

    await page.getByRole('link', { name: buttonName }).click()

    await expect(page.getByRole('button', { name: SESSION_TEXT.signIn })).toBeVisible()
    expect(new URL(seen[0].url).searchParams.get('returnTo')).toBe('/history')
  })

  for (const theme of ['light', 'dark'] as const) {
    test(`the button is visible with a visible keyboard focus ring in the ${theme} theme`, async ({ page }) => {
      await forceGithubFlag(page, true)
      await page.goto('/login')
      await page.evaluate((value) => document.documentElement.setAttribute('data-theme', value), theme)

      const link = page.getByRole('link', { name: buttonName })
      await expect(link).toBeVisible()
      await page.keyboard.press('Tab')
      for (let step = 0; step < 10 && !(await link.evaluate((element) => element === document.activeElement)); step += 1) await page.keyboard.press('Tab')
      await expect(link).toBeFocused()

      const look = await link.evaluate((element) => {
        const style = getComputedStyle(element)
        return { outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth, outlineColor: style.outlineColor }
      })
      expect(look.outlineStyle).not.toBe('none')
      expect(look.outlineWidth).toBe('2px')
      expect(look.outlineColor).not.toBe('rgba(0, 0, 0, 0)')
    })
  }

  for (const code of AUTH_ERROR_CODE_LIST) {
    test(`auth_error=${code} shows its message and leaves the URL clean; no session`, async ({ page }) => {
      await forceGithubFlag(page, true)
      await redirectStart(page, `${FRONTEND_URL}/login?auth_error=${code}`)
      await page.goto('/login')

      await page.getByRole('link', { name: buttonName }).click()

      await expect(page.getByRole('alert')).toHaveText(AUTH_ERROR_TEXT[code])
      await expect(page).toHaveURL(/\/login$/)
      await expect(page.getByRole('navigation', { name: 'Main' })).toHaveCount(0)
      await page.reload()
      await expect(page.getByRole('button', { name: SESSION_TEXT.signIn })).toBeVisible()
      await expect(page.getByRole('alert')).toHaveCount(0)
    })
  }

  test('an unknown auth_error value shows the provider message', async ({ page }) => {
    await forceGithubFlag(page, false)
    await page.goto('/login?auth_error=%3Cb%3Ex%3C%2Fb%3E')
    await expect(page.getByRole('alert')).toHaveText(AUTH_ERROR_TEXT.provider_error)
  })
})

test.describe('Settings > Account and Security, signed in', () => {
  test('Link GitHub asks the backend for the URL and navigates the browser to it', async ({ page }) => {
    await forceGithubFlag(page, true)
    let posted = 0
    await page.route(apiRoute(API_PATH.githubSignInLink), async (route: Route) => {
      if (route.request().method() === 'POST') posted += 1
      // The "GitHub" page is the Settings page with a failed-link answer, as the callback sends.
      await fulfillJson(route, 200, { url: `${FRONTEND_URL}/settings?section=account&auth_error=identity_in_use` })
    })
    await page.goto('/settings?section=account')
    await expect(page.getByTestId('github-sign-in-state')).toHaveText(ACCOUNT_TEXT.githubNotConnected)

    await page.getByRole('button', { name: ACCOUNT_TEXT.githubLink }).click()

    await expect(page.getByRole('alert')).toHaveText(AUTH_ERROR_TEXT.identity_in_use)
    await expect(page).toHaveURL(/\/settings\?section=account$/)
    expect(posted).toBe(1)
  })

  test('there is no GitHub row when it is not configured', async ({ page }) => {
    await forceGithubFlag(page, false)
    await page.goto('/settings?section=account')
    await expect(page.getByTestId('account-username')).toBeVisible()
    await expect(page.getByText(ACCOUNT_TEXT.githubHeading)).toHaveCount(0)
  })

  test('a GitHub-only account sees its login, a disabled Unlink, and no password form', async ({ page }) => {
    await forceGithubFlag(page, false)
    await page.route(apiRoute(API_PATH.session), async (route: Route) => {
      if (route.request().method() !== 'GET') return route.fallback()
      const response = await route.fetch()
      const body = (await response.json()) as { account: Record<string, unknown> }
      return route.fulfill({ response, json: { ...body, account: { ...body.account, signInMethod: 'github', githubLogin: 'octocat' } } })
    })

    await page.goto('/settings?section=account')
    await expect(page.getByTestId('github-sign-in-state')).toHaveText('Connected as @octocat')
    await expect(page.getByRole('button', { name: ACCOUNT_TEXT.githubUnlink })).toBeDisabled()
    await expect(page.getByRole('button', { name: ACCOUNT_TEXT.editDetailsLabel })).toHaveCount(0)

    await page.getByRole('tab', { name: 'Security' }).click()
    await expect(page.getByText(SECURITY_TEXT.githubOnly)).toBeVisible()
    await expect(page.getByRole('button', { name: SECURITY_TEXT.updatePassword })).toHaveCount(0)
    await expect(page.getByRole('button', { name: SECURITY_TEXT.signOut })).toBeVisible()
  })
})
