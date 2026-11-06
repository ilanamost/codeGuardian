import { describe, expect, it, vi } from 'vitest'
import { AppError } from '../../src/models/app-error'
import { createApiService, type FetchFn } from '../../src/services/api.service'
import { ERROR_CODE } from '../../src/utils/error-messages'

// QA adversarial pass for plan 026 (in-flight GET sharing).

function json(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
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

interface Pending {
  resolve: (response: Response) => void
  reject: (error: unknown) => void
  signal?: AbortSignal | null
}

function deferredFetch() {
  const pendingList: Pending[] = []
  const fetchFn = vi.fn<FetchFn>(
    (_, init) =>
      new Promise<Response>((resolve, reject) => {
        pendingList.push({ resolve, reject, signal: init.signal })
        if (init.signal?.aborted) reject(new DOMException('aborted', 'AbortError'))
        init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      })
  )
  return { fetchFn, pendingList }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('QA: api.service GET sharing adversarial', () => {
  it('sends a new fetch for a retry after a shared GET failed with a server error', async () => {
    const { fetchFn, pendingList } = deferredFetch()
    const api = source(fetchFn)

    const first = caught(api.request('GET', '/api/review'))
    const second = caught(api.request('GET', '/api/review'))
    pendingList[0].resolve(json(503, { error: { code: 'x', message: 'down' } }))
    await first
    await second
    expect(fetchFn).toHaveBeenCalledTimes(1)

    const retry = api.request('GET', '/api/review')
    expect(fetchFn).toHaveBeenCalledTimes(2)
    pendingList[1].resolve(json(200, [1]))
    await expect(retry).resolves.toEqual([1])
  })

  it('sends a new fetch for a retry after a shared GET failed with a network error', async () => {
    const { fetchFn, pendingList } = deferredFetch()
    const api = source(fetchFn)

    const first = caught(api.request('GET', '/api/settings'))
    const second = caught(api.request('GET', '/api/settings', undefined, { signal: new AbortController().signal }))
    pendingList[0].reject(new TypeError('Failed to fetch'))
    expect((await first).kind).toBe('network')
    expect((await second).kind).toBe('network')

    const retry = api.request('GET', '/api/settings')
    pendingList[1].resolve(json(200, { ok: true }))
    await expect(retry).resolves.toEqual({ ok: true })
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })

  it('gives each caller its own error object for a shared failure', async () => {
    const { fetchFn, pendingList } = deferredFetch()
    const api = source(fetchFn)

    const first = caught(api.request('GET', '/api/review'))
    const second = caught(api.request('GET', '/api/review'))
    pendingList[0].resolve(json(404, { error: { code: 'not_found', message: 'no' } }))
    const [a, b] = await Promise.all([first, second])
    expect(a).not.toBe(b)
    expect(a.status).toBe(404)
    expect(b.status).toBe(404)
  })

  it('shares a malformed JSON body as a parse error for every caller', async () => {
    const { fetchFn, pendingList } = deferredFetch()
    const api = source(fetchFn)

    const first = caught(api.request('GET', '/api/review'))
    const second = caught(api.request('GET', '/api/review'))
    pendingList[0].resolve(new Response('{not json', { status: 200 }))
    expect((await first).code).toBe(ERROR_CODE.parse)
    expect((await second).code).toBe(ERROR_CODE.parse)
  })

  it('does not leak a mutation of one caller response body into another caller', async () => {
    const { fetchFn, pendingList } = deferredFetch()
    const api = source(fetchFn)

    const first = api.request<{ list: { id: string }[] }>('GET', '/api/review')
    const second = api.request<{ list: { id: string }[] }>('GET', '/api/review')
    pendingList[0].resolve(json(200, { list: [{ id: 'a' }] }))
    const a = await first
    a.list[0].id = 'mutated'
    a.list.push({ id: 'extra' })
    const b = await second
    expect(b).toEqual({ list: [{ id: 'a' }] })
  })

  it('sends one fetch for a burst of 50 identical GETs and resolves all of them', async () => {
    const { fetchFn, pendingList } = deferredFetch()
    const api = source(fetchFn)

    const all = Array.from({ length: 50 }, (_, index) =>
      api.request('GET', '/api/dashboard', undefined, index % 2 ? { signal: new AbortController().signal } : {})
    )
    pendingList[0].resolve(json(200, { n: 1 }))
    const result = await Promise.all(all)
    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(result.every((item) => JSON.stringify(item) === '{"n":1}')).toBe(true)
  })

  it('keeps the shared fetch for a caller without a signal when every signal caller aborts', async () => {
    const { fetchFn, pendingList } = deferredFetch()
    const api = source(fetchFn)
    const controller = new AbortController()

    const noSignal = api.request('GET', '/api/settings')
    const aborted = caught(api.request('GET', '/api/settings', undefined, { signal: controller.signal }))
    controller.abort()
    expect((await aborted).kind).toBe('abort')
    await tick()
    await tick()

    expect(pendingList[0].signal?.aborted).toBe(false)
    pendingList[0].resolve(json(200, { ok: 1 }))
    await expect(noSignal).resolves.toEqual({ ok: 1 })
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('survives repeated StrictMode mount/unmount cycles with one fetch', async () => {
    const { fetchFn, pendingList } = deferredFetch()
    const api = source(fetchFn)
    const abortedList: Promise<AppError>[] = []

    for (let index = 0; index < 5; index += 1) {
      const mount = new AbortController()
      abortedList.push(caught(api.request('GET', '/api/review/r1', undefined, { signal: mount.signal })))
      mount.abort()
    }
    const last = api.request('GET', '/api/review/r1', undefined, { signal: new AbortController().signal })
    await tick()
    await tick()

    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(pendingList[0].signal?.aborted).toBe(false)
    pendingList[0].resolve(json(200, { id: 'r1' }))
    await expect(last).resolves.toEqual({ id: 'r1' })
    for (const aborted of abortedList) expect((await aborted).kind).toBe('abort')
  })

  it('a stale delayed cancel does not abort a newer shared fetch for the same URL', async () => {
    const { fetchFn, pendingList } = deferredFetch()
    const api = source(fetchFn)
    const controller = new AbortController()

    const aborted = caught(api.request('GET', '/api/review', undefined, { signal: controller.signal }))
    controller.abort()
    // The first fetch settles before the one-tick cancel runs.
    pendingList[0].resolve(json(200, []))
    await aborted
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    const fresh = api.request('GET', '/api/review', undefined, { signal: new AbortController().signal })
    await tick()
    await tick()

    const newest = pendingList[pendingList.length - 1]
    expect(newest.signal?.aborted).toBe(false)
    newest.resolve(json(200, ['fresh']))
    await expect(fresh).resolves.toEqual(['fresh'])
  })

  it('does not leave an entry behind after every caller aborted: the next GET fetches and resolves', async () => {
    const { fetchFn, pendingList } = deferredFetch()
    const api = source(fetchFn)

    for (let round = 0; round < 3; round += 1) {
      const controller = new AbortController()
      const aborted = caught(api.request('GET', '/api/history', undefined, { signal: controller.signal }))
      controller.abort()
      await aborted
      await tick()
      expect(pendingList[round].signal?.aborted).toBe(true)
    }
    expect(fetchFn).toHaveBeenCalledTimes(3)

    const next = api.request('GET', '/api/history')
    pendingList[3].resolve(json(200, { ok: true }))
    await expect(next).resolves.toEqual({ ok: true })
  })

  it('aborting a caller after its shared GET resolved changes nothing', async () => {
    const { fetchFn, pendingList } = deferredFetch()
    const api = source(fetchFn)
    const controller = new AbortController()

    const first = api.request('GET', '/api/review', undefined, { signal: controller.signal })
    pendingList[0].resolve(json(200, { a: 1 }))
    await expect(first).resolves.toEqual({ a: 1 })
    controller.abort()
    await tick()

    const second = api.request('GET', '/api/review')
    expect(fetchFn).toHaveBeenCalledTimes(2)
    expect(pendingList[1].signal?.aborted).toBe(false)
    pendingList[1].resolve(json(200, { a: 2 }))
    await expect(second).resolves.toEqual({ a: 2 })
  })

  it('never shares a GET that carries a body', async () => {
    const fetchFn = vi.fn<FetchFn>(async () => json(200, {}))
    const api = source(fetchFn)

    await Promise.all([api.request('GET', '/api/x', { a: 1 }), api.request('GET', '/api/x', { a: 1 })])
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })

  it('does not share a concurrent POST with a GET on the same URL', async () => {
    const { fetchFn, pendingList } = deferredFetch()
    const api = source(fetchFn)

    const get = api.request('GET', '/api/review/r1')
    const post = api.request('POST', '/api/review/r1')
    expect(fetchFn).toHaveBeenCalledTimes(2)
    expect(fetchFn.mock.calls[1][1].method).toBe('POST')
    pendingList[0].resolve(json(200, { g: 1 }))
    pendingList[1].resolve(json(200, { p: 1 }))
    await expect(get).resolves.toEqual({ g: 1 })
    await expect(post).resolves.toEqual({ p: 1 })
  })

  it('keeps separate data sources independent', async () => {
    const { fetchFn } = deferredFetch()
    void source(fetchFn).request('GET', '/api/review').catch(() => undefined)
    void source(fetchFn).request('GET', '/api/review').catch(() => undefined)
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })
})
