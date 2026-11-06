import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import GlobalLoader from '../../src/components/GlobalLoader'
import Loader from '../../src/components/Loader'
import { LOADER_TIMING } from '../../src/lib/loader.constants'
import { createRequestTracker } from '../../src/lib/requestTracker'
import { createApiService, type FetchFn } from '../../src/services/api.service'

// QA plan 037: adversarial checks on the request tracker, the global loader timing and the
// Loader's reduced-motion handling. Each test tries an end path or an interaction the
// implementing agent's tests do not cover.

afterEach(() => {
  vi.useRealTimers()
  // @ts-expect-error restore jsdom default (no matchMedia)
  delete window.matchMedia
})

function json(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function controlledFetch() {
  const pendingList: { resolve: (response: Response) => void; reject: (error: unknown) => void }[] = []
  const fetchFn = vi.fn<FetchFn>(
    (_, init) =>
      new Promise<Response>((resolve, reject) => {
        pendingList.push({ resolve, reject })
        init.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
      })
  )
  return { fetchFn, pendingList }
}

async function settled(promise: Promise<unknown>) {
  try {
    await promise
  } catch {
    // The outcome is checked by the test itself.
  }
}

async function advance(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms)
  })
}

describe('QA: request tracker end paths', () => {
  it('returns to zero when every caller of a shared GET cancels its own signal', async () => {
    const tracker = createRequestTracker()
    const { fetchFn } = controlledFetch()
    const source = createApiService({ baseUrl: 'http://api.test/', fetchFn, tracker })
    const aController = new AbortController()
    const bController = new AbortController()
    const a = source.request('GET', '/api/review', undefined, { signal: aController.signal })
    const b = source.request('GET', '/api/review', undefined, { signal: bController.signal })
    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(tracker.pendingCount()).toBe(1)

    aController.abort()
    bController.abort()
    await Promise.all([settled(a), settled(b)])
    // The shared fetch is aborted on a 0 ms timer once the last caller left.
    await vi.waitFor(() => expect(tracker.pendingCount()).toBe(0))
  })

  it('a request released by abortAll and settling later never takes a new request off the count', async () => {
    const tracker = createRequestTracker()
    const { fetchFn, pendingList } = controlledFetch()
    const source = createApiService({ baseUrl: 'http://api.test/', fetchFn, tracker })
    const old = source.request('POST', '/api/review', {})
    source.abortAll?.()
    expect(tracker.pendingCount()).toBe(0)

    const fresh = source.request('POST', '/api/review', {})
    expect(tracker.pendingCount()).toBe(1)
    pendingList[0].resolve(json(201, {}))
    await settled(old)

    expect(tracker.pendingCount()).toBe(1)
    pendingList[1].resolve(json(201, {}))
    await fresh
    expect(tracker.pendingCount()).toBe(0)
  })

  it('a failing background request never touches the count', async () => {
    const tracker = createRequestTracker()
    const countList: number[] = []
    tracker.subscribe(() => countList.push(tracker.pendingCount()))
    const fetchFn = vi.fn<FetchFn>().mockRejectedValue(new TypeError('Failed to fetch'))
    const source = createApiService({ baseUrl: 'http://api.test/', fetchFn, tracker })

    await settled(source.request('GET', '/api/settings', undefined, { background: true }))
    await settled(source.request('PUT', '/api/settings', {}, { background: true }))

    expect(countList).toEqual([])
    expect(tracker.pendingCount()).toBe(0)
  })

  it('50 rapid parallel calls with mixed outcomes all return the count to zero', async () => {
    const tracker = createRequestTracker()
    let n = 0
    const fetchFn = vi.fn<FetchFn>(async () => {
      n += 1
      if (n % 3 === 0) throw new TypeError('Failed to fetch')
      if (n % 3 === 1) return json(500, { error: { code: 'internal', message: 'x' } })
      return json(200, {})
    })
    const source = createApiService({ baseUrl: 'http://api.test/', fetchFn, tracker })

    const list = Array.from({ length: 50 }, (_, i) => source.request(i % 2 ? 'GET' : 'POST', `/api/review/r${i}`, i % 2 ? undefined : {}))
    expect(tracker.pendingCount()).toBe(50)
    await Promise.all(list.map(settled))

    expect(tracker.pendingCount()).toBe(0)
  })
})

describe('QA: global loader timing under rapid and overlapping calls', () => {
  it('shows at 200 ms when overlapping fast calls keep the count above zero', async () => {
    vi.useFakeTimers()
    const tracker = createRequestTracker()
    render(<GlobalLoader tracker={tracker} />)

    let releaseA = () => {}
    let releaseB = () => {}
    act(() => {
      releaseA = tracker.begin()
    })
    await advance(100)
    act(() => {
      releaseB = tracker.begin()
    })
    await advance(50)
    act(() => releaseA())
    await advance(LOADER_TIMING.showDelayMs - 150 - 1)
    expect(screen.queryByTestId('global-loader')).not.toBeInTheDocument()
    await advance(1)
    expect(screen.getByTestId('global-loader')).toBeInTheDocument()
    act(() => releaseB())
    await advance(LOADER_TIMING.minVisibleMs)
    expect(screen.queryByTestId('global-loader')).not.toBeInTheDocument()
  })

  it('shows when one call ends and the next starts in the same tick (a continuous chain)', async () => {
    vi.useFakeTimers()
    const tracker = createRequestTracker()
    render(<GlobalLoader tracker={tracker} />)

    let release = () => {}
    act(() => {
      release = tracker.begin()
    })
    for (let i = 0; i < 4; i++) {
      await advance(60)
      act(() => {
        release()
        release = tracker.begin()
      })
    }
    // 240 ms of continuous activity in 60 ms calls.
    expect(screen.getByTestId('global-loader')).toBeInTheDocument()
    act(() => release())
    await advance(LOADER_TIMING.minVisibleMs)
    expect(screen.queryByTestId('global-loader')).not.toBeInTheDocument()
  })

  it('a new call inside the minimum window keeps the bar on without a flicker', async () => {
    vi.useFakeTimers()
    const tracker = createRequestTracker()
    render(<GlobalLoader tracker={tracker} />)
    const seen: boolean[] = []

    let release = () => {}
    act(() => {
      release = tracker.begin()
    })
    await advance(LOADER_TIMING.showDelayMs)
    act(() => release())
    await advance(100)
    act(() => {
      release = tracker.begin()
    })
    for (let i = 0; i < 10; i++) {
      await advance(100)
      seen.push(screen.queryByTestId('global-loader') !== null)
    }
    expect(seen.every(Boolean)).toBe(true)
    act(() => release())
    await advance(0)
    expect(screen.queryByTestId('global-loader')).not.toBeInTheDocument()
  })

  it('unmounting while the delay timer runs does not throw or leak a bar', async () => {
    vi.useFakeTimers()
    const tracker = createRequestTracker()
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { unmount } = render(<GlobalLoader tracker={tracker} />)
    act(() => {
      tracker.begin()
    })
    await advance(100)
    unmount()
    await advance(1000)

    expect(screen.queryByTestId('global-loader')).not.toBeInTheDocument()
    expect(errorSpy).not.toHaveBeenCalled()
    errorSpy.mockRestore()
  })
})

describe('QA: Loader follows a reduced-motion change at runtime', () => {
  it('stops spinning when the system setting turns on after the first render', () => {
    let matches = false
    let onChange: (() => void) | undefined
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      get matches() {
        return matches && query.includes('prefers-reduced-motion')
      },
      media: query,
      addEventListener: (_: string, listener: () => void) => {
        onChange = listener
      },
      removeEventListener: vi.fn()
    })) as unknown as typeof window.matchMedia

    render(<Loader />)
    expect(screen.getByTestId('loader-icon')).toHaveClass('animate-spin')

    matches = true
    act(() => onChange?.())
    expect(screen.getByTestId('loader-icon').getAttribute('class')).not.toMatch(/animate-spin/)
    expect(screen.getByRole('status')).toHaveAccessibleName()
  })
})
