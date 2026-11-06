import { API_PATH } from '../../src/lib/api.constants'
import { BACKEND_URL } from './e2e.constants'
import { expect, test } from './fixture'

test('app loads and shows the product title', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByRole('complementary').getByText('AI Code Reviewer', { exact: true })).toBeVisible()
})

test(`runs against the real API: the dashboard comes from the backend at ${BACKEND_URL}`, async ({ page }) => {
  const dashboard = page.waitForResponse(`${BACKEND_URL}${API_PATH.dashboard}`)
  await page.goto('/')

  expect((await dashboard).status()).toBe(200)
  await expect(page.getByTestId('stat-total')).toBeVisible()
})
