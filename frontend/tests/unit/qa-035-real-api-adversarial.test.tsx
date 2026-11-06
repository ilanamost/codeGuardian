// QA for plan 035 (remove the mock data source). Adversarial pass: the app now has only the HTTP
// data source, so this tries to break it where the backend is down, answers oddly or is not
// configured, and restores the HTTP-source cases that were deleted with qa-data-source.test.ts
// and qa-parity.test.ts although they never used the JSON data source.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fireEvent, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '../../src/App'
import { SESSION_TEXT } from '../../src/lib/session.constants'
import { AppError } from '../../src/models/app-error'
import { createApiService, type FetchFn } from '../../src/services/api.service'
import { createDashboardService } from '../../src/services/dashboard.service'
import { createServices } from '../../src/services'
import { preferenceFor } from '../../src/services/notification.service'
import { createReviewService } from '../../src/services/review.service'
import { ERROR_CODE, PAGE_ERROR_MESSAGE } from '../../src/utils/error-messages'
import { renderWithStore, settle } from '../utils/renderWithStore'

vi.mock('@monaco-editor/react', () => ({ default: () => <div data-testid="monaco" /> }))

async function caught(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (error) {
    return error
  }
  throw new Error('expected a rejection')
}

function appWith(fetchFn: FetchFn) {
  const toast = { success: vi.fn(), error: vi.fn() }
  const services = createServices({ dataSource: createApiService({ baseUrl: 'http://x', fetchFn }), notification: { toast, dedupeMs: 0 } })
  return { services, toast }
}

const failing = (): FetchFn =>
  vi.fn<FetchFn>(async () => {
    throw new TypeError('Failed to fetch')
  })

describe('QA 035: backend down, Retry abuse', () => {
  it('rapid Retry clicks while the backend is still down send one restore at a time and one toast per attempt', async () => {
    const fetchFn = failing()
    const { services, toast } = appWith(fetchFn)

    renderWithStore(<App />, { route: '/', services, session: 'unknown' })
    await settle()
    expect(toast.error).toHaveBeenCalledTimes(1)

    const retry = screen.getByRole('button', { name: SESSION_TEXT.retry })
    for (let index = 0; index < 10; index++) fireEvent.click(retry)
    await settle()
    await settle()

    // 1 initial restore + 1 retry: the other 9 clicks hit the in-flight condition.
    expect(fetchFn).toHaveBeenCalledTimes(2)
    expect(toast.error).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('alert')).toHaveTextContent(PAGE_ERROR_MESSAGE.sessionUnavailable)
    expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument()
  })

  it('the backend coming back with a 401 on Retry opens the sign-in page with no new error toast', async () => {
    let up = false
    const fetchFn = vi.fn<FetchFn>(async () => {
      if (!up) throw new TypeError('Failed to fetch')
      return new Response(JSON.stringify({ error: { code: 'unauthorized', message: 'No session' } }), {
        status: 401,
        headers: { 'content-type': 'application/json' }
      })
    })
    const { services, toast } = appWith(fetchFn)

    renderWithStore(<App />, { route: '/review/r1?tab=tests#x', services, session: 'unknown' })
    await settle()
    up = true
    fireEvent.click(screen.getByRole('button', { name: SESSION_TEXT.retry }))
    await settle()
    await settle()

    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
    expect(toast.error).toHaveBeenCalledTimes(1)
  })
})

describe('QA 035: the session endpoint answers oddly', () => {
  it.each<[string, () => Response]>([
    ['an HTML page with 200 (VITE_API_URL pointing at the dev server)', () => new Response('<!doctype html><html></html>', { status: 200, headers: { 'content-type': 'text/html' } })],
    ['a 500 with a malformed body', () => new Response('{not json', { status: 500 })],
    ['a 200 with an empty body', () => new Response('', { status: 200 })],
    ['a 200 with a session of the wrong shape', () => new Response(JSON.stringify({ expiresAt: 42 }), { status: 200, headers: { 'content-type': 'application/json' } })]
  ])('%s: never signs in, shows the session error state and one toast', async (_name, answer) => {
    const fetchFn = vi.fn<FetchFn>(async () => answer())
    const { services, toast } = appWith(fetchFn)

    renderWithStore(<App />, { route: '/', services, session: 'unknown' })
    await settle()
    await settle()

    expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(PAGE_ERROR_MESSAGE.sessionUnavailable)
    expect(toast.error).toHaveBeenCalledTimes(1)
  })
})

describe('QA 035: VITE_API_URL missing', () => {
  afterEach(() => {
    vi.doUnmock('../../src/lib/config')
    vi.resetModules()
  })

  // Fixed after QA 035 (F1): an unset VITE_API_URL used to reject with a raw TypeError from buildUrl.
  it('a request with no base URL rejects as an AppError and never calls fetch', async () => {
    vi.resetModules()
    vi.doMock('../../src/lib/config', async (importOriginal) => ({ ...(await importOriginal<object>()), API_URL: undefined }))
    const api = await import('../../src/services/api.service')
    const fetchFn = vi.fn<FetchFn>()

    const error = await caught(api.createApiService({ fetchFn }).request('GET', '/api/session'))

    expect(fetchFn).not.toHaveBeenCalled()
    expect(error).toMatchObject({ name: 'AppError' })
  })
})

// Restored from the deleted tests/unit/qa-data-source.test.ts: these cases test the HTTP data
// source (api.service.ts), not the JSON data source, and had no copy elsewhere.
describe('QA 035 (restored): HTTP data source status and cancel handling', () => {
  const respond = (status: number, text: string | null): FetchFn => vi.fn<FetchFn>(async () => new Response(text, { status }))

  it.each([
    [403, ERROR_CODE.forbidden],
    [409, ERROR_CODE.conflict],
    [429, ERROR_CODE.rateLimited],
    [502, ERROR_CODE.server],
    [503, ERROR_CODE.server],
    [418, ERROR_CODE.unknown],
    [599, ERROR_CODE.server]
  ])('maps HTTP %i to %s', async (status, code) => {
    const error = await caught(createApiService({ baseUrl: 'http://x', fetchFn: respond(status, '{}') }).request('GET', '/a'))

    expect(error).toMatchObject({ code, kind: 'http', status })
  })

  it('maps the status (not parse) when an error body is malformed JSON', async () => {
    const error = await caught(createApiService({ baseUrl: 'http://x', fetchFn: respond(404, '<html>') }).request('GET', '/a'))

    expect(error).toMatchObject({ code: ERROR_CODE.notFound, status: 404 })
  })

  it('returns undefined for a 200 with an empty body, and the service then rejects it as parse', async () => {
    const source = createApiService({ baseUrl: 'http://x', fetchFn: respond(200, '') })

    await expect(source.request('GET', '/a')).resolves.toBeUndefined()
    await expect(createDashboardService(source).get()).rejects.toMatchObject({ code: ERROR_CODE.parse })
  })

  it('reports an abort while the body is being read as abort, not network', async () => {
    const controller = new AbortController()
    const fetchFn: FetchFn = async () =>
      ({
        ok: true,
        status: 200,
        headers: new Headers(),
        text: () =>
          new Promise<string>((_resolve, reject) => {
            controller.abort()
            reject(new DOMException('aborted', 'AbortError'))
          })
      }) as unknown as Response

    const error = await caught(createApiService({ baseUrl: 'http://x', fetchFn }).request('GET', '/a', undefined, { signal: controller.signal }))

    expect(error).toMatchObject({ kind: 'abort', code: ERROR_CODE.abort })
  })

  it('a fetch AbortError without a caller abort is a network failure (it is not hidden)', async () => {
    const fetchFn = vi.fn<FetchFn>().mockRejectedValue(new DOMException('aborted', 'AbortError'))

    const error = await caught(createApiService({ baseUrl: 'http://x', fetchFn }).request('GET', '/a', undefined, { signal: new AbortController().signal }))

    expect(error).toMatchObject({ kind: 'network' })
  })

  it('an aborted review load never becomes an error the store reports', async () => {
    const controller = new AbortController()
    controller.abort()
    const fetchFn: FetchFn = () => Promise.reject(new DOMException('aborted', 'AbortError'))
    const error = await caught(createReviewService(createApiService({ baseUrl: 'http://x', fetchFn })).get('r1', { signal: controller.signal }))

    expect(AppError.from(error).forAction(ERROR_CODE.reviewLoad).kind).toBe('abort')
  })

  it('a body that cannot be serialized (BigInt) fails before fetch', async () => {
    const fetchFn = vi.fn<FetchFn>()
    const error = await caught(createApiService({ baseUrl: 'http://x', fetchFn }).request('POST', '/a', { n: BigInt(1) }))

    expect(error).toMatchObject({ kind: 'network' })
    expect(fetchFn).not.toHaveBeenCalled()
  })
})

// Restored from the deleted tests/unit/qa-parity.test.ts: a regression guard for a fixed QA
// round 1 defect in notification.service.ts, unrelated to the JSON data source.
describe('QA 035 (restored): notification policy for Regenerate', () => {
  it('a server failure of Regenerate follows the Review failed preference', () => {
    expect(preferenceFor({ code: ERROR_CODE.testRegenerate, kind: 'http' })).toBe('reviewFailed')
  })

  it('a network failure of Regenerate always shows', () => {
    expect(preferenceFor({ code: ERROR_CODE.testRegenerate, kind: 'network' })).toBeNull()
  })
})

// Replaces the drift guard of the deleted seed.test.ts: about 45 unit test files now trust the
// fixture fake backend, so its copies of the backend seed must not drift.
describe('QA 035: fixture copies of the backend seed', () => {
  const fixtureDir = resolve(__dirname, '../fixtures')
  const backendDir = resolve(__dirname, '../../../backend/src/data')
  const readJson = (dir: string, name: string): unknown => JSON.parse(readFileSync(resolve(dir, name), 'utf8'))

  it.each(['github.json', 'github-file-content.json', 'settings.json'])('%s equals the backend seed', (name) => {
    expect(readJson(fixtureDir, name)).toEqual(readJson(backendDir, name))
  })
})
