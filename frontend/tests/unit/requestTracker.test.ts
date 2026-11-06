import { describe, expect, it, vi } from 'vitest'
import { createRequestTracker, type RequestTracker } from '../../src/lib/requestTracker'
import { createApiService, type FetchFn } from '../../src/services/api.service'
import { AppError } from '../../src/models/app-error'

// Plan 037, Validation 1: the request tracker and how the API data source counts on it.

function json(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

interface Deferred {
  resolve: (response: Response) => void
  reject: (error: unknown) => void
}

// A fetch whose answers the test sends; a cancelled request rejects with its signal's reason, as
// the browser's fetch does.
function controlledFetch() {
  const pendingList: Deferred[] = []
  const fetchFn = vi.fn<FetchFn>(
    (_, init) =>
      new Promise<Response>((resolve, reject) => {
        pendingList.push({ resolve, reject })
        init.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
      })
  )
  return { fetchFn, pendingList }
}

// The highest count the tracker reached, and every count it went through.
function watch(tracker: RequestTracker) {
  const countList: number[] = []
  tracker.subscribe(() => countList.push(tracker.pendingCount()))
  return { countList, max: () => Math.max(0, ...countList) }
}

function sourceOn(tracker: RequestTracker, fetchFn: FetchFn) {
  return createApiService({ baseUrl: 'http://api.test/', fetchFn, tracker })
}

async function settled(promise: Promise<unknown>) {
  try {
    await promise
  } catch {
    // The outcome is checked by the test itself.
  }
}

describe('request tracker', () => {
  it('counts a request until it is released', () => {
    const tracker = createRequestTracker()

    const release = tracker.begin()
    expect(tracker.pendingCount()).toBe(1)

    release()
    expect(tracker.pendingCount()).toBe(0)
  })

  it('never goes negative when a release is called again', () => {
    const tracker = createRequestTracker()
    const release = tracker.begin()

    release()
    release()

    expect(tracker.pendingCount()).toBe(0)
  })

  it('does not count a background request', () => {
    const tracker = createRequestTracker()
    const { countList } = watch(tracker)

    tracker.begin({ background: true })

    expect(tracker.pendingCount()).toBe(0)
    expect(countList).toEqual([])
  })

  it('stops notifying a listener that unsubscribed', () => {
    const tracker = createRequestTracker()
    const listener = vi.fn()
    const unsubscribe = tracker.subscribe(listener)

    unsubscribe()
    tracker.begin()

    expect(listener).not.toHaveBeenCalled()
  })
})

describe('api.service on the request tracker', () => {
  it('counts a request while it runs and releases it on success', async () => {
    const tracker = createRequestTracker()
    const { fetchFn, pendingList } = controlledFetch()
    const request = sourceOn(tracker, fetchFn).request('POST', '/api/review', { a: 1 })

    expect(tracker.pendingCount()).toBe(1)
    pendingList[0].resolve(json(200, { ok: true }))
    await request

    expect(tracker.pendingCount()).toBe(0)
  })

  it('releases a request that failed with an error status', async () => {
    const tracker = createRequestTracker()
    const fetchFn = vi.fn<FetchFn>().mockResolvedValue(json(500, { error: { code: 'internal', message: 'x' } }))

    await expect(sourceOn(tracker, fetchFn).request('PUT', '/api/settings', {})).rejects.toBeInstanceOf(AppError)

    expect(tracker.pendingCount()).toBe(0)
  })

  it('releases a request that failed on the network', async () => {
    const tracker = createRequestTracker()
    const fetchFn = vi.fn<FetchFn>().mockRejectedValue(new TypeError('Failed to fetch'))

    await expect(sourceOn(tracker, fetchFn).request('GET', '/api/dashboard')).rejects.toMatchObject({ kind: 'network' })

    expect(tracker.pendingCount()).toBe(0)
  })

  it('releases a request that timed out', async () => {
    const tracker = createRequestTracker()
    const fetchFn = vi.fn<FetchFn>().mockRejectedValue(new DOMException('The operation timed out.', 'TimeoutError'))

    await settled(sourceOn(tracker, fetchFn).request('DELETE', '/api/review/r1'))

    expect(tracker.pendingCount()).toBe(0)
  })

  it('releases a request its caller cancelled', async () => {
    const tracker = createRequestTracker()
    const { fetchFn } = controlledFetch()
    const controller = new AbortController()
    const request = sourceOn(tracker, fetchFn).request('POST', '/api/review', {}, { signal: controller.signal })

    controller.abort()
    await expect(request).rejects.toMatchObject({ kind: 'abort' })

    expect(tracker.pendingCount()).toBe(0)
  })

  it('releases every shared GET that abortAll cancelled', async () => {
    const tracker = createRequestTracker()
    const { fetchFn } = controlledFetch()
    const source = sourceOn(tracker, fetchFn)
    const request = source.request('GET', '/api/dashboard')
    expect(tracker.pendingCount()).toBe(1)

    source.abortAll?.()
    await expect(request).rejects.toMatchObject({ kind: 'abort' })

    expect(tracker.pendingCount()).toBe(0)
  })

  it('lets go at abortAll of a request whose fetch never answers (the safety reset)', () => {
    const tracker = createRequestTracker()
    const { fetchFn } = controlledFetch()
    const source = sourceOn(tracker, fetchFn)
    void settled(source.request('POST', '/api/review', {}))
    expect(tracker.pendingCount()).toBe(1)

    source.abortAll?.()

    expect(tracker.pendingCount()).toBe(0)
  })

  it('counts a shared GET with several callers once, until its one fetch settles', async () => {
    const tracker = createRequestTracker()
    const { max } = watch(tracker)
    const { fetchFn, pendingList } = controlledFetch()
    const source = sourceOn(tracker, fetchFn)

    const requestList = [source.request('GET', '/api/review'), source.request('GET', '/api/review'), source.request('GET', '/api/review')]
    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(tracker.pendingCount()).toBe(1)

    pendingList[0].resolve(json(200, []))
    await Promise.all(requestList)

    expect(max()).toBe(1)
    expect(tracker.pendingCount()).toBe(0)
  })

  it('never counts a background request', async () => {
    const tracker = createRequestTracker()
    const { countList } = watch(tracker)
    const { fetchFn, pendingList } = controlledFetch()
    const request = sourceOn(tracker, fetchFn).request('GET', '/api/review/r1', undefined, { background: true })

    expect(tracker.pendingCount()).toBe(0)
    pendingList[0].resolve(json(200, {}))
    await request

    expect(countList).toEqual([])
  })

  it('counts a background GET once a caller the user started joins it', async () => {
    const tracker = createRequestTracker()
    const { fetchFn, pendingList } = controlledFetch()
    const source = sourceOn(tracker, fetchFn)
    const poll = source.request('GET', '/api/review/r1', undefined, { background: true })
    expect(tracker.pendingCount()).toBe(0)

    const load = source.request('GET', '/api/review/r1')
    expect(tracker.pendingCount()).toBe(1)

    pendingList[0].resolve(json(200, {}))
    await Promise.all([poll, load])
    expect(tracker.pendingCount()).toBe(0)
  })

  it('returns to zero once a mix of successes and failures has ended', async () => {
    const tracker = createRequestTracker()
    const { fetchFn, pendingList } = controlledFetch()
    const source = sourceOn(tracker, fetchFn)
    const requestList = [source.request('POST', '/api/review', {}), source.request('GET', '/api/dashboard'), source.request('PATCH', '/api/review/r1', {})]
    expect(tracker.pendingCount()).toBe(3)

    pendingList[0].resolve(json(201, {}))
    pendingList[1].reject(new TypeError('Failed to fetch'))
    pendingList[2].resolve(json(404, { error: { code: 'not_found', message: 'x' } }))
    await Promise.all(requestList.map(settled))

    expect(tracker.pendingCount()).toBe(0)
  })
})
