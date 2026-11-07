// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { API_PATH, SESSION_TOKEN_PATTERN, SESSION_TOKEN_STORAGE_KEY } from '../../src/lib/api.constants'
import { createAccountService } from '../../src/services/account.service'
import { createApiService, type FetchFn } from '../../src/services/api.service'
import { get } from '../../src/services/data-source'
import { createSessionService } from '../../src/services/session.service'
import { createStorageService } from '../../src/services/storage.service'
import { DEMO_PASSWORD, DEMO_USERNAME, startBackend, type RunningBackend } from '../utils/backendHarness'

// Plan 047: the bearer-token fallback against the real backend app. The harness can switch the
// backend's SESSION_TOKEN_FALLBACK on and drop every Set-Cookie (a browser that blocks the cookie).

interface Call {
  url: string
  headers: Record<string, string>
}

// The browser's localStorage, in memory (this suite runs in node, next to the backend app).
const memory = new Map<string, string>()
const memoryStorage = {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => void memory.set(key, value),
  removeItem: (key: string) => void memory.delete(key)
} as unknown as Storage
const storage = createStorageService(() => memoryStorage)

let running: RunningBackend | undefined
let callList: Call[] = []

function recordFetch(fetchFn: FetchFn): FetchFn {
  return (input, init) => {
    callList.push({ url: input, headers: { ...(init.headers as Record<string, string>) } })
    return fetchFn(input, init)
  }
}

async function start(option: { fallback: boolean; blockCookie: boolean }) {
  running = await startBackend({ signIn: false, sessionTokenFallback: option.fallback, blockCookie: option.blockCookie, storage, wrapFetch: recordFetch })
  return running
}

const signInDemo = (backend: RunningBackend) => createSessionService(backend.source).signIn({ username: DEMO_USERNAME, password: DEMO_PASSWORD })
const stored = () => memory.get(SESSION_TOKEN_STORAGE_KEY) ?? null

// A new page load: a source with no memory of the previous one and no cookie, same storage.
function reloaded(backend: RunningBackend) {
  return createApiService({ baseUrl: backend.baseUrl, fetchFn: (input, init) => globalThis.fetch(input, init), storage })
}

beforeEach(() => {
  memory.clear()
  callList = []
})

afterEach(async () => {
  await running?.close()
  running = undefined
})

describe('sign-in with a cookie that works', () => {
  it('asks for a token, checks the cookie, drops the token and stores nothing', async () => {
    const backend = await start({ fallback: true, blockCookie: false })

    const account = await signInDemo(backend)

    expect(account).not.toHaveProperty('sessionToken')
    expect(stored()).toBeNull()
    expect(callList[0].headers['X-Session-Mode']).toBe('token')
    expect(callList.every((call) => call.headers.Authorization === undefined)).toBe(true)
    await expect(get(backend.source, API_PATH.dashboard)).resolves.toBeDefined()
  })

  it('switch off on the backend: no token in the answer, nothing stored', async () => {
    const backend = await start({ fallback: false, blockCookie: false })

    await signInDemo(backend)

    expect(stored()).toBeNull()
  })
})

describe('sign-in with a blocked cookie', () => {
  it('keeps the token in localStorage and sends it as a bearer on every request', async () => {
    const backend = await start({ fallback: true, blockCookie: true })

    const account = await signInDemo(backend)
    await get(backend.source, API_PATH.dashboard)

    expect(account).not.toHaveProperty('sessionToken')
    const token = JSON.parse(stored() ?? 'null') as string
    expect(token).toMatch(SESSION_TOKEN_PATTERN)
    const last = callList[callList.length - 1]
    expect(last.headers.Authorization).toBe(`Bearer ${token}`)
    // The cookie check was sent without the bearer.
    const check = callList.find((call) => call.url.endsWith(API_PATH.session) && call !== callList[0])
    expect(check?.headers.Authorization).toBeUndefined()
  })

  it('never puts the token in a URL', async () => {
    const backend = await start({ fallback: true, blockCookie: true })

    await signInDemo(backend)
    await get(backend.source, API_PATH.dashboard)

    const token = JSON.parse(stored() ?? 'null') as string
    expect(callList.some((call) => call.url.includes(token))).toBe(false)
  })

  it('register works the same way', async () => {
    const backend = await start({ fallback: true, blockCookie: true })

    await createAccountService(backend.source).register({ username: 'new.person', email: 'new.person@example.com', password: 'Str0ng-pass-phrase-77' })

    expect(JSON.parse(stored() ?? 'null')).toMatch(SESSION_TOKEN_PATTERN)
    await expect(get(backend.source, API_PATH.session)).resolves.toBeDefined()
  })

  it('a reload restores the session from the stored token', async () => {
    const backend = await start({ fallback: true, blockCookie: true })
    await signInDemo(backend)

    const session = await get<{ account: { username: string } }>(reloaded(backend), API_PATH.session)

    expect(session.account.username).toBe(DEMO_USERNAME)
  })

  it('sign-out removes the token, and the next request is a 401', async () => {
    const backend = await start({ fallback: true, blockCookie: true })
    await signInDemo(backend)

    await createSessionService(backend.source).signOut()

    expect(stored()).toBeNull()
    await expect(get(backend.source, API_PATH.session)).rejects.toMatchObject({ status: 401 })
  })

  it('a 401 removes the stored token', async () => {
    const backend = await start({ fallback: true, blockCookie: true })
    await signInDemo(backend)
    memory.set(SESSION_TOKEN_STORAGE_KEY, JSON.stringify('a'.repeat(43)))

    await expect(get(reloaded(backend), API_PATH.dashboard)).rejects.toMatchObject({ status: 401 })

    expect(stored()).toBeNull()
  })

  it('switch off on the backend: nothing is stored and the session does not last', async () => {
    const backend = await start({ fallback: false, blockCookie: true })

    await signInDemo(backend)

    expect(stored()).toBeNull()
    await expect(get(backend.source, API_PATH.session)).rejects.toMatchObject({ status: 401 })
  })

  it('a later sign-in whose cookie works drops the old token', async () => {
    const backend = await start({ fallback: true, blockCookie: true })
    await signInDemo(backend)
    expect(stored()).not.toBeNull()
    const working = await startBackend({ signIn: false, sessionTokenFallback: true, storage })

    try {
      await signInDemo(working)
      expect(stored()).toBeNull()
    } finally {
      await working.close()
    }
  })
})
