import type { Page, Request } from '@playwright/test'
import { API_PATH } from '../../src/lib/api.constants'
import { SUPPORT_EMAIL } from '../../src/lib/help.constants'
import { apiRoute, expect, test } from './fixture'
import { SUPPORT_REQUEST_HOURLY_LIMIT } from './e2e.constants'

// Plan 032: Contact Support with the real backend. Submit stores the request (ticket SUP-NNNN),
// then hands a mailto: link to the user's mail app. The test browser has no mail app: Chromium
// reports the hand-off as a `mailto:` request (page.route cannot catch it), which these tests
// record and take apart. The fixture resets the backend (and its rate limit) and signs in first.

const toastList = (page: Page) => page.locator('[data-sonner-toast]')
const description = 'The review never finishes on my file & it says 100% = done? #42'

// Every mailto: link the page hands to the mail app.
function recordMailto(page: Page): URL[] {
  const linkList: URL[] = []
  page.on('request', (request: Request) => {
    if (request.url().startsWith('mailto:')) linkList.push(new URL(request.url()))
  })
  return linkList
}

async function fillAndSubmit(page: Page, text = description) {
  await page.goto('/help?topic=contact')
  await page.getByRole('radio', { name: 'Other' }).check()
  await expect(page.getByLabel('Email address')).not.toHaveValue('')
  await page.getByLabel('Review ID (optional)').fill('r-42')
  await page.getByLabel('Describe the problem').fill(text)
  await page.getByRole('button', { name: 'Submit request' }).click()
}

test('Submit stores the request and opens the mail app once with the ready message', async ({ page }) => {
  const linkList = recordMailto(page)
  const stored = page.waitForResponse((response) => response.url() === apiRoute(API_PATH.supportRequest) && response.request().method() === 'POST')

  await fillAndSubmit(page)

  const response = await stored
  expect(response.status()).toBe(201)
  const { ticket } = (await response.json()) as { ticket: string }
  expect(ticket).toMatch(/^SUP-\d+$/)
  await expect.poll(() => linkList.length).toBe(1)

  const link = linkList[0] as URL
  expect(link.protocol).toBe('mailto:')
  expect(link.pathname).toBe(SUPPORT_EMAIL)
  expect([...link.searchParams.keys()]).toEqual(['subject', 'body'])
  expect(link.searchParams.get('subject')).toBe(`[${ticket}] Other (Normal)`)
  expect(link.searchParams.get('body')).toBe(
    [
      `Ticket: ${ticket}`,
      'Issue type: Other',
      "Priority: Normal — feature isn't working as expected",
      'From: john@company.com',
      'Review ID: r-42',
      '',
      'Description:',
      description
    ].join('\r\n')
  )

  const banner = page.getByRole('status').filter({ hasText: 'mail app' })
  await expect(banner).toHaveText(`Your mail app should open with the message. Press Send there to contact support. Ticket ${ticket}.`)
  await expect(page.getByTestId('support-address')).toHaveText(SUPPORT_EMAIL)
  await expect(toastList(page).filter({ hasText: `Press Send there to contact support. Ticket ${ticket}.` })).toBeVisible()
  await expect(page.getByText('no message was sent')).toHaveCount(0)
  // The form keeps the values.
  await expect(page.getByLabel('Describe the problem')).toHaveValue(description)
  await expect(page.getByLabel('Review ID (optional)')).toHaveValue('r-42')
  await expect(page).toHaveURL(/\/help\?topic=contact$/)
})

test('a double click sends one request and opens the mail app once', async ({ page }) => {
  const linkList = recordMailto(page)
  const postList: string[] = []
  page.on('request', (request) => {
    if (request.url() === apiRoute(API_PATH.supportRequest) && request.method() === 'POST') postList.push(request.url())
  })
  await page.goto('/help?topic=contact')
  await page.getByRole('radio', { name: 'Other' }).check()
  await expect(page.getByLabel('Email address')).not.toHaveValue('')
  await page.getByLabel('Describe the problem').fill(description)

  await page.getByRole('button', { name: 'Submit request' }).dblclick()

  await expect(page.getByRole('status').filter({ hasText: 'mail app' })).toBeVisible()
  // Both clicks were delivered before the outcome showed; a second POST would have started by now.
  await expect.poll(() => linkList.length).toBe(1)
  expect(postList).toHaveLength(1)
  expect(linkList).toHaveLength(1)
})

test('Copy message and Copy address put the message and the address on the clipboard', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  recordMailto(page)
  await fillAndSubmit(page)
  const ticket = /SUP-\d+/.exec((await page.getByRole('status').filter({ hasText: 'mail app' }).textContent()) ?? '')?.[0]

  await page.getByRole('button', { name: 'Copy message' }).click()
  await expect(toastList(page).filter({ hasText: 'Message copied' })).toBeVisible()
  const message = await page.evaluate(() => navigator.clipboard.readText())
  expect(message.startsWith(`[${ticket}] Other (Normal)\r\n\r\nTicket: ${ticket}\r\n`)).toBe(true)
  expect(message.endsWith(description)).toBe(true)

  await page.getByRole('button', { name: 'Copy address' }).click()
  await expect(toastList(page).filter({ hasText: 'Support address copied' })).toBeVisible()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(SUPPORT_EMAIL)
})

test('a refused clipboard shows the error toast', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: () => Promise.reject(new DOMException('Write permission denied.', 'NotAllowedError')) }
    })
  })
  recordMailto(page)
  await fillAndSubmit(page)

  await page.getByRole('button', { name: 'Copy address' }).click()

  await expect(toastList(page).filter({ hasText: 'Could not copy to clipboard' })).toBeVisible()
  await expect(toastList(page).filter({ hasText: 'Support address copied' })).toHaveCount(0)
})

test('the outcome and copy buttons are readable in the dark theme', async ({ page }) => {
  recordMailto(page)
  await fillAndSubmit(page)
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'))

  await expect(page.getByRole('status').filter({ hasText: 'mail app' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Copy message' })).toBeVisible()
  const color = await page.getByRole('status').filter({ hasText: 'mail app' }).evaluate((element) => getComputedStyle(element).color)
  // --color-text of the dark theme (#e6ebf5).
  expect(color).toBe('rgb(230, 235, 245)')
})

test('the sixth request in an hour shows the rate-limit toast, opens nothing and keeps the values', async ({ page, request }) => {
  for (let index = 0; index < SUPPORT_REQUEST_HOURLY_LIMIT; index += 1) {
    const response = await request.post(apiRoute(API_PATH.supportRequest), {
      data: { issueType: 'other', email: 'john@company.com', reviewId: '', priority: 'low', description: `Earlier request number ${index}` }
    })
    expect(response.status()).toBe(201)
  }
  const linkList = recordMailto(page)

  const text = 'One request too many this hour'
  await fillAndSubmit(page, text)

  await expect(toastList(page).filter({ hasText: /^Could not submit your request\. Too many support requests\. Try again (in \d+ (minute|second)s?|later)\.$/ })).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: 'mail app' })).toHaveCount(0)
  await expect(page.getByLabel('Describe the problem')).toHaveValue(text)
  await expect(page.getByRole('radio', { name: 'Other' })).toBeChecked()
  expect(linkList).toHaveLength(0)
})

test('an invalid submit sends nothing and opens nothing', async ({ page }) => {
  const linkList = recordMailto(page)
  await page.goto('/help?topic=contact')

  await page.getByRole('button', { name: 'Submit request' }).click()

  // Validation runs in the submit handler before anything is stored or opened.
  await expect(page.getByText('Select an issue type')).toBeVisible()
  expect(linkList).toHaveLength(0)
})
