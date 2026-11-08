import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { API_PATH, SESSION_TOKEN_STORAGE_KEY } from '../../src/lib/api.constants'
import { completeGithubReturn, takeAuthCode } from '../../src/lib/github-return'
import { createApiService, type FetchFn } from '../../src/services/api.service'
import { createSessionService } from '../../src/services/session.service'
import { createStorageService } from '../../src/services/storage.service'

// QA plan 048: try to break the frontend side of the GitHub return (fragment, exchange, token).

const code = 'C'.repeat(43)
const other = 'D'.repeat(43)
const token = 'T'.repeat(43)
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const unauthorized = () => json(401, { error: { code: 'unauthorized', message: 'x' } })
const go = (url: string) => window.history.replaceState({ keep: 1 }, '', url)

afterEach(() => {
  go('/')
  vi.restoreAllMocks()
})

function setup(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const map = new Map<string, string>()
  const raw = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), removeItem: (k: string) => void map.delete(k) } as unknown as Storage
  const callList: { url: string, method: string, body?: string }[] = []
  const fetchFn: FetchFn = async (url, init) => {
    callList.push({ url, method: init.method ?? 'GET', body: init.body as string | undefined })
    return handler(url, init)
  }
  const session = createSessionService(createApiService({ baseUrl: 'http://api.test', fetchFn, storage: createStorageService(() => raw) }))
  return { map, callList, session }
}
const swapHandler = (cookieWorks: boolean, sessionToken: unknown = token) => (url: string) =>
  url.endsWith(API_PATH.githubExchange) ? json(200, { sessionToken }) : cookieWorks ? json(200, { ok: true }) : unauthorized()

describe('QA 048 frontend: odd fragments', () => {
  it.each([
    [`#auth_code=${code}&auth_code=${other}`, code],
    [`#auth_code=nope&auth_code=${code}`, code],
    [`#auth_code=${code}&extra=1&more`, code],
    [`#keep&auth_code=${code}&x=1`, code]
  ])('%s: every auth_code is stripped, other content kept, no code stays in the URL', (hash, expected) => {
    go(`/repo/${hash}`)
    expect(takeAuthCode()).toBe(expected)
    expect(window.location.href).not.toContain('auth_code')
    expect(window.location.href).not.toContain(code)
    expect(window.location.href).not.toContain(other)
  })

  it.each([
    `#auth_code=${code}%20`,
    `#auth_code=${code}%00`,
    `#auth_code=${code}/`,
    `#auth_code=%${code.slice(2)}`,
    `#auth_code=${code}#${code}`,
    '#auth_code',
    '#auth_code=',
    '#auth_code=<script>'
  ])('%s: stripped and never accepted as a code', (hash) => {
    go(`/${hash}`)
    expect(takeAuthCode()).toBeUndefined()
    expect(window.location.hash).not.toContain('auth_code')
  })

  it.each([`#AUTH_CODE=${code}`, `#x=auth_code=${code}`, `#/auth_code=${code}`, `#${code}`, `#auth-code=${code}`])('%s: not an auth_code, left alone, not taken', (hash) => {
    go(`/${hash}`)
    expect(takeAuthCode()).toBeUndefined()
    expect(window.location.hash).toBe(hash)
  })

  it('a code in the query or the path is never taken or stripped', () => {
    go(`/auth_code=${code}?auth_code=${code}`)
    expect(takeAuthCode()).toBeUndefined()
    expect(window.location.search).toBe(`?auth_code=${code}`)
  })

  it('a 200 KB fragment does not crash or hang', () => {
    go(`/#${'a&'.repeat(100_000)}auth_code=${code}`)
    const started = Date.now()
    expect(takeAuthCode()).toBe(code)
    expect(Date.now() - started).toBeLessThan(2000)
  })

  it('a second read (reload with the cleaned URL, or Back to the same entry) finds nothing', () => {
    go(`/#auth_code=${code}`)
    expect(takeAuthCode()).toBe(code)
    expect(takeAuthCode()).toBeUndefined()
  })

  it('does not add a history entry and keeps the earlier entries as they were', () => {
    go('/earlier')
    window.history.pushState({ n: 2 }, '', `/later#auth_code=${code}`)
    const length = window.history.length
    takeAuthCode()
    expect(window.history.length).toBe(length)
    expect(window.history.state).toEqual({ n: 2 })
    expect(window.location.pathname + window.location.hash).toBe('/later')
  })
})

describe('QA 048 frontend: the exchange', () => {
  it('two starts racing on the same URL send one exchange only', async () => {
    const { callList, session } = setup(swapHandler(false))
    go(`/#auth_code=${code}`)
    await Promise.all([completeGithubReturn(session), completeGithubReturn(session)])
    expect(callList.filter((call) => call.url.endsWith(API_PATH.githubExchange))).toHaveLength(1)
  })

  it('the code goes in the POST body only, never in a URL', async () => {
    const { callList, session } = setup(swapHandler(false))
    go(`/#auth_code=${code}`)
    await completeGithubReturn(session)
    for (const call of callList) expect(call.url).not.toContain(code)
    expect(callList[0].body).toBe(JSON.stringify({ code }))
  })

  it.each([
    ['too short', 'short'],
    ['too long', 'T'.repeat(44)],
    ['a number', 42],
    ['an object', { a: 1 }],
    ['null', null]
  ])('a 200 with a sessionToken that is %s is never stored as a token', async (_name, bad) => {
    const { map, session } = setup(swapHandler(false, bad))
    go(`/#auth_code=${code}`)
    await completeGithubReturn(session).catch(() => undefined)
    expect(map.has(SESSION_TOKEN_STORAGE_KEY)).toBe(false)
  })

  it('cookie working: no storage write of any kind, nothing returned to the caller', async () => {
    const { map, session } = setup(swapHandler(true))
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    go(`/#auth_code=${code}`)
    const result = await session.exchangeGithubCode(takeAuthCode()!)
    expect(result).toBeUndefined()
    expect(map.size).toBe(0)
    expect(setItem).not.toHaveBeenCalled()
    expect(JSON.stringify(window.localStorage) + JSON.stringify(window.sessionStorage)).not.toContain(token)
  })

  it('cookie blocked: only cr.sessionToken is written, the code is in no storage', async () => {
    const { map, session } = setup(swapHandler(false))
    go(`/#auth_code=${code}`)
    await completeGithubReturn(session)
    expect([...map.keys()]).toEqual([SESSION_TOKEN_STORAGE_KEY])
    expect([...map.values()].join('')).not.toContain(code)
    expect(JSON.stringify(window.localStorage) + JSON.stringify(window.sessionStorage)).not.toContain(code)
  })

  it('a rejected exchange removes a token stored earlier (documented: any 401 clears it) and shows only the login failure', async () => {
    const { map, session } = setup(() => unauthorized())
    map.set(SESSION_TOKEN_STORAGE_KEY, JSON.stringify(token))
    go(`/#auth_code=${code}`)
    await completeGithubReturn(session)
    expect(map.has(SESSION_TOKEN_STORAGE_KEY)).toBe(false)
    expect(window.location.search).toBe('?auth_error=invalid_state')
  })

  it('a server error body that echoes the code is not written to the console or the URL', async () => {
    const spy = [vi.spyOn(console, 'log'), vi.spyOn(console, 'warn'), vi.spyOn(console, 'error'), vi.spyOn(console, 'info')]
    const { session } = setup(() => json(500, { error: { code: 'internal', message: `boom ${code}` } }))
    go(`/#auth_code=${code}`)
    await completeGithubReturn(session)
    for (const one of spy) expect(one).not.toHaveBeenCalled()
    expect(window.location.href).not.toContain(code)
  })

  it('a hanging exchange never resolves: the start would stay blank (finding, no timeout in api.service)', async () => {
    const { session } = setup(() => new Promise<Response>(() => undefined))
    go(`/#auth_code=${code}`)
    const outcome = await Promise.race([completeGithubReturn(session).then(() => 'done'), new Promise((resolve) => setTimeout(() => resolve('hung'), 300))])
    // Records today's behaviour. 'hung' means main.tsx would not render until the network gives up.
    expect(['done', 'hung']).toContain(outcome)
    console.info(`QA048 hanging exchange outcome: ${outcome}`)
  })
})

describe('QA 048 frontend: the code and the token stay out of state, toasts and logs', () => {
  const root = join(__dirname, '..', '..', 'src')
  const read = (file: string) => readFileSync(join(root, file), 'utf8').split(String.fromCharCode(10)).filter((line) => !line.trim().startsWith('//')).join(' ')

  it('the return module and main.tsx never import the store, toasts or a logger', () => {
    for (const text of [read('lib/github-return.ts'), read('main.tsx')]) {
      expect(text).not.toMatch(/sonner|toast|dispatch|console\.|createSlice|useSelector/i)
    }
    expect(read('lib/github-return.ts')).not.toMatch(/localStorage|sessionStorage/)
  })

  it('the session service method returns nothing and no slice mentions the exchange', () => {
    expect(read('services/session.service.ts')).toMatch(/exchangeGithubCode\(code, signal\) \{\s*await post/)
    expect(read('store/session.slice.ts') ?? '').not.toMatch(/auth_code|authCode|sessionToken|githubExchange/)
  })
})
