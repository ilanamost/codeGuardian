import { apiRoute, expect, test } from './fixture'

// QA plan 041: every captured /api request body is readable JSON with no kid, iv or ct field,
// and no crypto route is called.
test.describe('plain wire (plan 041)', () => {
  test.use({ signIn: false })

  test('register, then visit settings and history: bodies are plain JSON, no crypto call', async ({ page, request }) => {
    const seen: { url: string; body: string | null }[] = []
    page.on('request', (req) => {
      if (req.url().includes('/api/')) seen.push({ url: req.url(), body: req.postData() })
    })

    await page.goto('/register')
    await page.getByLabel('User name').fill('grace.hopper')
    await page.getByLabel('Email address').fill('grace@example.com')
    await page.getByLabel('Password', { exact: true }).click()
    await page.getByLabel('Password', { exact: true }).fill('compiler-queen1')
    await page.getByLabel('Confirm password', { exact: true }).click()
    await page.getByLabel('Confirm password', { exact: true }).fill('compiler-queen1')
    await page.getByRole('button', { name: 'Create account' }).click()
    await expect(page).toHaveURL(/\/$/)
    await page.goto('/settings')
    await page.goto('/history')

    const withBody = seen.filter((entry) => entry.body)
    expect(withBody.length).toBeGreaterThan(0)
    for (const entry of withBody) {
      const parsed = JSON.parse(entry.body as string)
      for (const key of ['kid', 'iv', 'ct']) expect(parsed, entry.url).not.toHaveProperty(key)
    }
    expect(seen.some((entry) => /crypto/.test(entry.url))).toBe(false)
    expect(withBody.some((entry) => entry.body?.includes('compiler-queen1'))).toBe(true)

    for (const route of ['/api/crypto/key', '/api/crypto/session']) {
      const method = route.endsWith('session') ? 'post' : 'get'
      const response = await request[method](apiRoute(route))
      expect(response.status(), route).toBe(404)
    }
  })
})
