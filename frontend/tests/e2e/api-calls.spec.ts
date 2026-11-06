import type { Page, Request } from '@playwright/test'
import { API_PATH } from '../../src/lib/api.constants'
import { NEW_REVIEW_ID, ROUTE_PATH } from '../../src/lib/route.constants'
import { sectionList } from '../../src/lib/settings.constants'
import { BACKEND_URL } from './e2e.constants'
import { createReview, expect, test } from './fixture'

// Plan 026: every /api/* GET a page needs is sent once when the page loads. The frontend e2e
// server is the Vite dev server, so React StrictMode mounts every effect twice here, which is
// where the duplicates showed. Each test records the GETs from the start of a load (or a tab
// click) until the network is idle and fails on any URL sent more than once.

const API_PREFIX = `${BACKEND_URL}/api/`

const QUIET_MS = 500

// Records the API GETs a page sends; `idle` waits until no API request has been pending or
// started for QUIET_MS (page.waitForLoadState('networkidle') resolves at once after a click).
function recordGet(page: Page) {
  const urlList: string[] = []
  const pendingSet = new Set<Request>()
  let seen = 0
  const isApi = (request: Request) => request.url().startsWith(API_PREFIX)
  const onRequest = (request: Request) => {
    if (!isApi(request)) return
    seen += 1
    pendingSet.add(request)
    if (request.method() === 'GET') urlList.push(request.url().slice(BACKEND_URL.length))
  }
  const onDone = (request: Request) => pendingSet.delete(request)
  page.on('request', onRequest)
  page.on('requestfinished', onDone)
  page.on('requestfailed', onDone)
  return {
    urlList,
    async idle() {
      for (;;) {
        const before = seen
        await page.waitForTimeout(QUIET_MS)
        if (seen === before && pendingSet.size === 0) break
      }
      page.off('request', onRequest)
      page.off('requestfinished', onDone)
      page.off('requestfailed', onDone)
    }
  }
}

function duplicateOf(urlList: string[]): Record<string, number> {
  const countOf: Record<string, number> = {}
  for (const url of urlList) countOf[url] = (countOf[url] ?? 0) + 1
  return Object.fromEntries(Object.entries(countOf).filter(([, count]) => count > 1))
}

function expectUnique(label: string, urlList: string[]) {
  const duplicate = duplicateOf(urlList)
  test.info().annotations.push({ type: 'api-get', description: `${label}: ${JSON.stringify(urlList)}` })
  if (Object.keys(duplicate).length) console.log(`[api-calls] ${label} duplicates: ${JSON.stringify(duplicate)}`)
  expect(duplicate, `${label} sent the same GET more than once: ${JSON.stringify(urlList)}`).toEqual({})
}

async function loadAndRecord(page: Page, path: string): Promise<string[]> {
  const recorder = recordGet(page)
  await page.goto(path)
  await page.waitForLoadState('networkidle')
  await recorder.idle()
  return recorder.urlList
}

const staticRouteList = [
  { label: 'dashboard', path: '/' },
  { label: 'new review', path: ROUTE_PATH.newReview },
  { label: 'history', path: ROUTE_PATH.history },
  { label: 'github', path: '/github' },
  { label: 'help', path: '/help' }
]

for (const { label, path } of staticRouteList) {
  test(`${label} (${path}) sends each API GET once on load`, async ({ page }) => {
    const urlList = await loadAndRecord(page, path)
    expectUnique(label, urlList)
    // Plan 028: the session restore runs once per page load, and it brings the account, so no
    // GET /api/account is sent on load.
    expect(urlList.filter((url) => url === API_PATH.session)).toHaveLength(1)
    expect(urlList).not.toContain(API_PATH.account)
  })
}

test('review page (/review/:id) sends each API GET once on load', async ({ page, request }) => {
  const { id } = await createReview(request, { title: 'Api call count' })
  expect(id).not.toBe(NEW_REVIEW_ID)

  const urlList = await loadAndRecord(page, ROUTE_PATH.review(id))

  await expect(page.getByRole('heading', { name: 'Review Results' })).toBeVisible()
  expect(urlList.some((url) => url.includes(id))).toBe(true)
  expectUnique('review', urlList)
})

test('settings page and each of its tabs send each API GET once', async ({ page }) => {
  expectUnique('settings', await loadAndRecord(page, '/settings'))

  for (const { label } of sectionList) {
    const recorder = recordGet(page)
    await page.getByRole('tab', { name: label }).click()
    await expect(page.getByRole('tab', { name: label })).toHaveAttribute('aria-selected', 'true')
    await recorder.idle()
    expectUnique(`settings tab ${label}`, recorder.urlList)
  }
})
