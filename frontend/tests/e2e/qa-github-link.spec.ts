import { GITHUB_LINK_TEXT } from '../../src/lib/github.constants'
import { expect, test } from './fixture'

// QA adversarial pass for plan 023 (AI-46), against the backend on its fake GitHub.
const fileLink = 'https://github.com/example-org/demo/blob/main/src/greet.ts'

test('QA: a double click on Import sends one import, and the browser never calls GitHub itself', async ({ page }) => {
  const importList: string[] = []
  const githubList: string[] = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.pathname === '/api/github/import') importList.push(request.postData() ?? '')
    if (url.hostname.endsWith('github.com')) githubList.push(request.url())
  })
  await page.goto('/github')
  await page.getByRole('textbox', { name: GITHUB_LINK_TEXT.label }).fill(fileLink)
  await page.getByRole('button', { name: GITHUB_LINK_TEXT.import }).dblclick()

  await expect(page.getByTestId('review-name')).toHaveText('greet.ts')
  expect(importList).toEqual([JSON.stringify({ url: fileLink })])
  expect(githubList).toEqual([])
})

test('QA: a hostile look-alike host is refused in the field and nothing is sent', async ({ page }) => {
  let sent = false
  page.on('request', (request) => {
    if (request.url().includes('/api/github/import')) sent = true
  })
  await page.goto('/github')
  await page.getByRole('textbox', { name: GITHUB_LINK_TEXT.label }).fill('https://gіthub.com/example-org/demo/pull/1')
  await page.getByRole('button', { name: GITHUB_LINK_TEXT.import }).click()

  await expect(page.getByRole('alert')).toBeVisible()
  expect(sent).toBe(false)
})
