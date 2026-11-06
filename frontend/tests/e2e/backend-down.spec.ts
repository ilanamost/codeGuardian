import { SESSION_TEXT } from '../../src/lib/session.constants'
import { PAGE_ERROR_MESSAGE } from '../../src/utils/error-messages'
import { BACKEND_URL } from './e2e.constants'
import { expect, test } from './fixture'

// Plan 035, Validation 7 (Open Question 4A): the frontend has no mock data source, so with the
// backend unreachable it shows the existing session error state and error notification only.
// "Unreachable" is forced at the network layer: every request to the backend fails.
test.describe('backend unreachable', () => {
  test.use({ signIn: false })

  test('shows the session error state with Retry and one error toast; once it is back, Retry opens the sign-in page', async ({ page }) => {
    const backendPattern = `${BACKEND_URL}/**`
    await page.route(backendPattern, (route) => route.abort('failed'))
    await page.goto('/')

    await expect(page.getByRole('alert').filter({ hasText: PAGE_ERROR_MESSAGE.sessionUnavailable })).toBeVisible()
    await expect(page.locator('[data-sonner-toast]').filter({ hasText: 'Could not check your session.' })).toHaveCount(1)
    await expect(page.getByRole('navigation', { name: 'Main' })).toHaveCount(0)

    await page.unroute(backendPattern)
    await page.getByRole('button', { name: SESSION_TEXT.retry }).click()

    await expect(page).toHaveURL(/\/login$/)
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
  })
})
