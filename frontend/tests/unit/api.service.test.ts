import { describe, expect, it, vi } from 'vitest'
import { AppError } from '../../src/models/app-error'
import { createApiService, type FetchFn } from '../../src/services/api.service'
import { ERROR_CODE } from '../../src/utils/error-messages'

function json(status: number, body?: unknown, header: Record<string, string> = {}): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...header }
  })
}

function source(fetchFn: FetchFn) {
  return createApiService({ baseUrl: 'http://api.test/', fetchFn })
}

async function caught(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise
  } catch (error) {
    expect(error).toBeInstanceOf(AppError)
    return error as AppError
  }
  throw new Error('expected the request to fail')
}

describe('api.service request', () => {
  it('sends JSON once and returns the parsed body', async () => {
    const fetchFn = vi.fn<FetchFn>().mockResolvedValue(json(200, { ok: true }))

    const result = await source(fetchFn).request('POST', '/api/review', { a: 1 })

    expect(result).toEqual({ ok: true })
    expect(fetchFn).toHaveBeenCalledTimes(1)
    const [url, init] = fetchFn.mock.calls[0]
    expect(url).toBe('http://api.test/api/review')
    expect(init.method).toBe('POST')
    expect(init.body).toBe('{"a":1}')
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/json' })
  })

  it('sends no body and no content type for a GET', async () => {
    const fetchFn = vi.fn<FetchFn>().mockResolvedValue(json(200, []))

    await source(fetchFn).request('GET', '/api/review')

    const [, init] = fetchFn.mock.calls[0]
    expect(init.body).toBeUndefined()
    expect(init.headers).not.toHaveProperty('Content-Type')
  })

  it('adds query parameters and skips undefined ones', async () => {
    const fetchFn = vi.fn<FetchFn>().mockResolvedValue(json(200, []))

    await source(fetchFn).request('GET', 'api/github/repo', undefined, { query: { query: 'api', page: undefined } })

    expect(fetchFn.mock.calls[0][0]).toBe('http://api.test/api/github/repo?query=api')
  })

  it('returns undefined for 204 No Content', async () => {
    const fetchFn = vi.fn<FetchFn>().mockResolvedValue(new Response(null, { status: 204 }))

    await expect(source(fetchFn).request('DELETE', '/api/review/r1')).resolves.toBeUndefined()
  })

  it('maps a network failure to a network AppError, without retrying', async () => {
    const fetchFn = vi.fn<FetchFn>().mockRejectedValue(new TypeError('Failed to fetch'))

    const error = await caught(source(fetchFn).request('GET', '/x'))

    expect(error.code).toBe(ERROR_CODE.network)
    expect(error.kind).toBe('network')
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('passes the caller signal straight to fetch for a non-GET', async () => {
    const controller = new AbortController()
    const fetchFn = vi.fn<FetchFn>().mockResolvedValue(json(200, {}))

    await source(fetchFn).request('POST', '/x', {}, { signal: controller.signal })

    expect(fetchFn.mock.calls[0][1].signal).toBe(controller.signal)
  })

  it('reports a request cancelled by the caller as abort', async () => {
    const controller = new AbortController()
    const never: FetchFn = (_, init) =>
      new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))
    const pending = source(never).request('GET', '/slow', undefined, { signal: controller.signal })
    controller.abort()

    expect((await caught(pending)).kind).toBe('abort')
  })

  it.each([
    [400, ERROR_CODE.validation, 'validation'],
    [401, ERROR_CODE.unauthorized, 'http'],
    [404, ERROR_CODE.notFound, 'http'],
    [408, ERROR_CODE.timeout, 'timeout'],
    [422, ERROR_CODE.validation, 'validation'],
    [500, ERROR_CODE.server, 'http']
  ])('maps HTTP %i to %s through AppError.fromResponse', async (status, code, kind) => {
    const body = { error: { code: 'x', message: 'Server says no' }, requestId: 'req-42' }
    const fetchFn = vi.fn<FetchFn>().mockResolvedValue(json(status, body))

    const error = await caught(source(fetchFn).request('GET', '/x'))

    expect(error.code).toBe(code)
    expect(error.kind).toBe(kind)
    expect(error.status).toBe(status)
    expect(error.requestId).toBe('req-42')
    // The server text is kept internal; the user sees a constant.
    expect(error.message).toBe('Server says no')
    expect(error.userMessage).not.toContain('Server says no')
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('falls back to the x-request-id header and a generic message for a body without the error shape', async () => {
    const response = new Response('oops', { status: 500, headers: { 'x-request-id': 'hdr-1' } })

    const error = await caught(source(vi.fn<FetchFn>().mockResolvedValue(response)).request('GET', '/x'))

    expect(error.requestId).toBe('hdr-1')
    expect(error.message).toBe('HTTP 500')
  })

  it('maps malformed JSON in a success response to a parse AppError', async () => {
    const response = new Response('{not json', { status: 200 })

    const error = await caught(source(vi.fn<FetchFn>().mockResolvedValue(response)).request('GET', '/x'))

    expect(error.code).toBe(ERROR_CODE.parse)
    expect(error.kind).toBe('parse')
  })
})

// A fetch that stays pending until the test resolves it, and rejects when its signal aborts.
function deferredFetch() {
  const resolveList: ((response: Response) => void)[] = []
  const fetchFn = vi.fn<FetchFn>(
    (_, init) =>
      new Promise<Response>((resolve, reject) => {
        resolveList.push(resolve)
        if (init.signal?.aborted) reject(new DOMException('aborted', 'AbortError'))
        init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      })
  )
  return { fetchFn, resolveAt: (index: number, response: Response) => resolveList[index](response) }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('api.service in-flight GET sharing (plan 026)', () => {
  it('sends one fetch for two identical GETs issued while the first is pending', async () => {
    const { fetchFn, resolveAt } = deferredFetch()
    const api = source(fetchFn)

    const first = api.request<{ n: number }>('GET', '/api/settings')
    const second = api.request<{ n: number }>('GET', '/api/settings')
    resolveAt(0, json(200, { n: 1 }))

    const [a, b] = await Promise.all([first, second])
    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(a).toEqual({ n: 1 })
    expect(b).toEqual({ n: 1 })
    // Each caller parses the body itself, so a store cannot freeze the other caller's object.
    expect(a).not.toBe(b)
  })

  it('shares a failure with every caller', async () => {
    const { fetchFn, resolveAt } = deferredFetch()
    const api = source(fetchFn)

    const first = caught(api.request('GET', '/api/review'))
    const second = caught(api.request('GET', '/api/review'))
    resolveAt(0, json(500, { error: { code: 'x', message: 'down' } }))

    expect((await first).code).toBe(ERROR_CODE.server)
    expect((await second).code).toBe(ERROR_CODE.server)
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('sends separate fetches for different URLs and different queries', async () => {
    const fetchFn = vi.fn<FetchFn>(async () => json(200, []))
    const api = source(fetchFn)

    await Promise.all([
      api.request('GET', '/api/review'),
      api.request('GET', '/api/dashboard'),
      api.request('GET', '/api/github/repo', undefined, { query: { query: 'a' } }),
      api.request('GET', '/api/github/repo', undefined, { query: { query: 'b' } })
    ])

    expect(fetchFn).toHaveBeenCalledTimes(4)
  })

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'] as const)('never shares a %s', async (method) => {
    const fetchFn = vi.fn<FetchFn>(async () => json(200, {}))
    const api = source(fetchFn)

    await Promise.all([api.request(method, '/api/review/r1', { a: 1 }), api.request(method, '/api/review/r1', { a: 1 })])

    expect(fetchFn).toHaveBeenCalledTimes(2)
  })

  it('sends a new fetch for a GET issued after the first one finished (no caching)', async () => {
    const fetchFn = vi.fn<FetchFn>(async () => json(200, {}))
    const api = source(fetchFn)

    await api.request('GET', '/api/settings')
    await api.request('GET', '/api/settings')

    expect(fetchFn).toHaveBeenCalledTimes(2)
  })

  it('keeps the shared fetch alive for the other caller when one caller aborts', async () => {
    const { fetchFn, resolveAt } = deferredFetch()
    const api = source(fetchFn)
    const controller = new AbortController()

    const aborted = caught(api.request('GET', '/api/review/r1', undefined, { signal: controller.signal }))
    const kept = api.request('GET', '/api/review/r1', undefined, { signal: new AbortController().signal })
    controller.abort()
    expect((await aborted).kind).toBe('abort')
    await tick()

    resolveAt(0, json(200, { id: 'r1' }))
    await expect(kept).resolves.toEqual({ id: 'r1' })
    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(fetchFn.mock.calls[0][1].signal?.aborted).toBe(false)
  })

  it('lets a StrictMode remount join the fetch its first mount aborted', async () => {
    const { fetchFn, resolveAt } = deferredFetch()
    const api = source(fetchFn)
    const firstMount = new AbortController()

    const first = caught(api.request('GET', '/api/review/r1', undefined, { signal: firstMount.signal }))
    firstMount.abort()
    const second = api.request('GET', '/api/review/r1', undefined, { signal: new AbortController().signal })
    await tick()

    resolveAt(0, json(200, { id: 'r1' }))
    expect((await first).kind).toBe('abort')
    await expect(second).resolves.toEqual({ id: 'r1' })
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('cancels the shared fetch once every caller has aborted, and a later GET fetches again', async () => {
    const { fetchFn } = deferredFetch()
    const api = source(fetchFn)
    const one = new AbortController()
    const two = new AbortController()

    const first = caught(api.request('GET', '/api/review', undefined, { signal: one.signal }))
    const second = caught(api.request('GET', '/api/review', undefined, { signal: two.signal }))
    one.abort()
    two.abort()
    expect((await first).kind).toBe('abort')
    expect((await second).kind).toBe('abort')
    await tick()

    expect(fetchFn.mock.calls[0][1].signal?.aborted).toBe(true)
    void api.request('GET', '/api/review').catch(() => undefined)
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })

  it('does not share a GET whose caller signal is already aborted, and does not cancel a pending one', async () => {
    const { fetchFn, resolveAt } = deferredFetch()
    const api = source(fetchFn)
    const pending = api.request('GET', '/x')
    const controller = new AbortController()
    controller.abort()

    const error = await caught(api.request('GET', '/x', undefined, { signal: controller.signal }))
    resolveAt(0, json(200, { ok: true }))

    expect(error.kind).toBe('abort')
    expect(fetchFn).toHaveBeenCalledTimes(2)
    expect(fetchFn.mock.calls[1][1].signal).toBe(controller.signal)
    await expect(pending).resolves.toEqual({ ok: true })
  })
})

describe('AppError.fromResponse', () => {
  it('maps the status to a code and kind and keeps the server message internal', () => {
    const error = AppError.fromResponse(409, { error: { code: 'conflict', message: 'taken' }, requestId: 'r1' })

    expect(error).toMatchObject({ code: ERROR_CODE.conflict, kind: 'http', status: 409, requestId: 'r1', message: 'taken' })
  })

  it('uses the header request id and a generic message when the body has no error shape', () => {
    expect(AppError.fromResponse(503, 'down', 'hdr')).toMatchObject({ code: ERROR_CODE.server, requestId: 'hdr', message: 'HTTP 503' })
    expect(AppError.fromResponse(418, undefined).code).toBe(ERROR_CODE.unknown)
  })
})
