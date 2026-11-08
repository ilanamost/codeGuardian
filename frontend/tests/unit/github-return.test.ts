import { afterEach, describe, expect, it, vi } from 'vitest'
import { API_PATH, CSRF_HEADER, GITHUB_EXCHANGE_TIMEOUT_MS, SESSION_TOKEN_STORAGE_KEY } from '../../src/lib/api.constants'
import { completeGithubReturn, takeAuthCode } from '../../src/lib/github-return'
import { AUTH_ERROR_TEXT } from '../../src/lib/session.constants'
import { createApiService, type FetchFn } from '../../src/services/api.service'
import { createSessionService } from '../../src/services/session.service'
import { createStorageService } from '../../src/services/storage.service'

// Plan 048: the return from GitHub. The one-time code arrives in the URL fragment, is removed at
// once, is swapped for a session token, and the token is kept only when the cookie did not stick.

const code = 'C'.repeat(43)
const token = 'T'.repeat(43)
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const unauthorized = () => json(401, { error: { code: 'unauthorized', message: 'x' } })

function go(url: string) {
  window.history.replaceState({ keep: 1 }, '', url)
}

afterEach(() => {
  go('/')
})

describe('takeAuthCode', () => {
  it('reads a valid code and removes it, keeping path, query and other hash content', () => {
    go(`/repo/history?a=1&b=2#section&auth_code=${code}&x=y`)
    expect(takeAuthCode()).toBe(code)
    expect(window.location.pathname).toBe('/repo/history')
    expect(window.location.search).toBe('?a=1&b=2')
    expect(window.location.hash).toBe('#section&x=y')
    expect(window.history.state).toEqual({ keep: 1 })
  })

  it('leaves no hash when the code was the only content', () => {
    go(`/#auth_code=${code}`)
    expect(takeAuthCode()).toBe(code)
    expect(window.location.href).toBe(`${window.location.origin}/`)
    expect(window.location.hash).toBe('')
  })

  it('replaces the entry instead of adding one', () => {
    go('/start')
    const before = window.history.length
    go(`/start#auth_code=${code}`)
    takeAuthCode()
    expect(window.history.length).toBe(before)
  })

  it('does nothing without an auth_code in the hash', () => {
    go('/page?auth_code=' + code + '#other')
    const spy = vi.spyOn(window.history, 'replaceState')
    expect(takeAuthCode()).toBeUndefined()
    expect(spy).not.toHaveBeenCalled()
    expect(window.location.search).toBe(`?auth_code=${code}`)
    expect(window.location.hash).toBe('#other')
    spy.mockRestore()
  })

  it.each(['short', 'C'.repeat(42), 'C'.repeat(44), `${'C'.repeat(42)}!`, ''])('strips a malformed code (%s) and returns nothing', (value) => {
    go(`/page#auth_code=${value}`)
    expect(takeAuthCode()).toBeUndefined()
    expect(window.location.hash).toBe('')
  })
})

function setup(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const map = new Map<string, string>()
  const raw = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), removeItem: (k: string) => void map.delete(k) } as unknown as Storage
  const storage = createStorageService(() => raw)
  const callList: { url: string; method: string; headers: Record<string, string>; body?: string }[] = []
  const fetchFn: FetchFn = async (url, init) => {
    callList.push({ url, method: init.method ?? 'GET', headers: { ...(init.headers as Record<string, string>) }, body: init.body as string | undefined })
    return handler(url, init)
  }
  const session = createSessionService(createApiService({ baseUrl: 'http://api.test', fetchFn, storage }))
  return { map, callList, session }
}

describe('completeGithubReturn', () => {
  it('swaps the code, finds the cookie blocked, and keeps the token as cr.sessionToken', async () => {
    const { map, callList, session } = setup((url) => (url.endsWith(API_PATH.githubExchange) ? json(200, { sessionToken: token }) : unauthorized()))
    go(`/#auth_code=${code}`)
    await completeGithubReturn(session)

    const exchange = callList[0]
    expect(exchange.url).toBe(`http://api.test${API_PATH.githubExchange}`)
    expect(exchange.method).toBe('POST')
    expect(exchange.headers[CSRF_HEADER.name]).toBe('1')
    expect(exchange.headers['Content-Type']).toBe('application/json')
    expect(JSON.parse(exchange.body!)).toEqual({ code })
    expect(exchange.url).not.toContain(code)
    // The cookie check: GET /api/session with no bearer.
    expect(callList[1].url).toBe(`http://api.test${API_PATH.session}`)
    expect(callList[1].headers.Authorization).toBeUndefined()
    expect(JSON.parse(map.get(SESSION_TOKEN_STORAGE_KEY)!)).toBe(token)
    expect(window.location.hash).toBe('')
    expect(window.location.search).toBe('')
  })

  it('sends the token as a bearer on later requests', async () => {
    const { callList, session } = setup((url) => (url.endsWith(API_PATH.githubExchange) ? json(200, { sessionToken: token }) : unauthorized()))
    go(`/#auth_code=${code}`)
    await completeGithubReturn(session)
    await session.restore().catch(() => undefined)
    expect(callList.at(-1)!.headers.Authorization).toBe(`Bearer ${token}`)
  })

  it('drops the token when the cookie works', async () => {
    const { map, session } = setup((url) => (url.endsWith(API_PATH.githubExchange) ? json(200, { sessionToken: token }) : json(200, { ok: true })))
    go(`/#auth_code=${code}`)
    await completeGithubReturn(session)
    expect(map.has(SESSION_TOKEN_STORAGE_KEY)).toBe(false)
  })

  it.each([
    ['401', () => unauthorized()],
    ['404', () => json(404, { error: { code: 'not_found', message: 'x' } })],
    ['429', () => json(429, { error: { code: 'rate_limited', message: 'x' } })]
  ])('a %s exchange stores no token and sends the user to the login page with the invalid_state message', async (_name, answer) => {
    const { map, callList, session } = setup(() => answer())
    go(`/history#auth_code=${code}`)
    await completeGithubReturn(session)

    expect(callList).toHaveLength(1)
    expect(map.size).toBe(0)
    expect(window.location.pathname).toBe('/login')
    expect(window.location.search).toBe('?auth_error=invalid_state')
    expect(window.location.hash).toBe('')
    expect(AUTH_ERROR_TEXT.invalid_state).toBe('The GitHub sign-in expired or was not started here. Please try again.')
  })

  it('a network failure is the same failure', async () => {
    const { map, session } = setup(() => {
      throw new TypeError('offline')
    })
    go(`/#auth_code=${code}`)
    await completeGithubReturn(session)
    expect(map.size).toBe(0)
    expect(window.location.search).toBe('?auth_error=invalid_state')
  })

  it('with no fragment nothing is called and the URL is untouched', async () => {
    const { callList, map, session } = setup(() => unauthorized())
    go('/history?x=1#top')
    await completeGithubReturn(session)
    expect(callList).toEqual([])
    expect(map.size).toBe(0)
    expect(window.location.pathname + window.location.search + window.location.hash).toBe('/history?x=1#top')
  })

  it('a malformed code is stripped and never sent', async () => {
    const { callList, session } = setup(() => unauthorized())
    go('/#auth_code=nope')
    await completeGithubReturn(session)
    expect(callList).toEqual([])
    expect(window.location.hash).toBe('')
  })

  describe('a hanging exchange', () => {
    afterEach(() => {
      vi.useRealTimers()
    })

    it('gives up after the timeout, renders anyway on the invalid_state address, and never retries', async () => {
      vi.useFakeTimers()
      const { map, callList, session } = setup(() => new Promise<Response>(() => undefined))
      go(`/history#auth_code=${code}`)
      let done = false
      const finished = completeGithubReturn(session).then(() => {
        done = true
      })

      await vi.advanceTimersByTimeAsync(GITHUB_EXCHANGE_TIMEOUT_MS - 1)
      expect(done).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      await finished

      expect(done).toBe(true)
      expect(callList).toHaveLength(1)
      expect(map.size).toBe(0)
      expect(window.location.pathname).toBe('/login')
      expect(window.location.search).toBe('?auth_error=invalid_state')
      expect(window.location.hash).toBe('')
    })

    it('ignores a late success: no token is stored after the timeout', async () => {
      vi.useFakeTimers()
      let answer: (response: Response) => void = () => undefined
      const { map, callList, session } = setup((url) => (url.endsWith(API_PATH.githubExchange) ? new Promise<Response>((resolve) => (answer = resolve)) : unauthorized()))
      go(`/#auth_code=${code}`)
      const finished = completeGithubReturn(session)
      await vi.advanceTimersByTimeAsync(GITHUB_EXCHANGE_TIMEOUT_MS)
      await finished

      answer(json(200, { sessionToken: token }))
      await vi.advanceTimersByTimeAsync(1000)

      expect(map.size).toBe(0)
      expect(callList).toHaveLength(1)
      expect(window.location.search).toBe('?auth_error=invalid_state')
    })

    it('a fast answer clears the timer and is not disturbed by it', async () => {
      vi.useFakeTimers()
      const { map, session } = setup((url) => (url.endsWith(API_PATH.githubExchange) ? json(200, { sessionToken: token }) : unauthorized()))
      go(`/#auth_code=${code}`)
      await completeGithubReturn(session)
      expect(vi.getTimerCount()).toBe(0)
      await vi.advanceTimersByTimeAsync(GITHUB_EXCHANGE_TIMEOUT_MS * 2)
      expect(JSON.parse(map.get(SESSION_TOKEN_STORAGE_KEY)!)).toBe(token)
      expect(window.location.search).toBe('')
    })
  })

  it('never writes the code or the token to the console', async () => {
    const spy = [vi.spyOn(console, 'log'), vi.spyOn(console, 'info'), vi.spyOn(console, 'warn'), vi.spyOn(console, 'error'), vi.spyOn(console, 'debug')]
    const { session } = setup((url) => (url.endsWith(API_PATH.githubExchange) ? json(200, { sessionToken: token }) : unauthorized()))
    go(`/#auth_code=${code}`)
    await completeGithubReturn(session)
    for (const one of spy) {
      expect(one).not.toHaveBeenCalled()
      one.mockRestore()
    }
  })
})
