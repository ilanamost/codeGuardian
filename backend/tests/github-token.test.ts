import { describe, expect, it } from 'vitest'
import { AppError } from '../src/lib/error.js'
import { createConfiguredGithubClient } from '../src/lib/github-client-of.js'
import type { GithubClient } from '../src/lib/github-fetch.js'
import { GITHUB_API } from '../src/utils/constants.js'
import { API, budget, delay, fakeGithub, fileResponse, jsonResponse, stall, type FakeCall, type FakeHandler } from './helper/github.js'

// Plan 049: the GitHub token on the client (Authorization header, 401 retry, SSRF) and its wiring.

const token = 'ghp_CANARY_TOKEN_049'
const authorization = `Bearer ${token}`
const sha = '0123456789abcdef0123456789abcdef01234567'

const answer: FakeHandler = (url) => {
  if (url.pathname.includes('/contents/')) return fileResponse('const a = 1\n')
  if (url.pathname.endsWith('/pulls/7/files')) return jsonResponse([{ filename: 'a.ts', status: 'added', changes: 1 }])
  if (url.pathname.endsWith('/pulls/7')) return jsonResponse({ changed_files: 1, head: { sha } })
  if (url.pathname === '/users/octo/repos') return jsonResponse([{ name: 'repo', description: null, private: false }])
  if (url.pathname === '/users/octo') return jsonResponse({ login: 'octo', name: null })
  if (url.pathname.includes('/git/trees/')) return jsonResponse({ tree: [{ path: 'a.ts', type: 'blob', size: 3 }], truncated: false })
  return jsonResponse({ message: 'Not Found' }, 404)
}

// One call of each client method.
const callByName: Record<string, (client: GithubClient) => Promise<unknown>> = {
  getFile: (client) => client.getFile('octo', 'repo', ['a.ts'], 'main', budget()),
  getPull: (client) => client.getPull('octo', 'repo', 7, budget()),
  listPullFile: (client) => client.listPullFile('octo', 'repo', 7, budget()),
  getUser: (client) => client.getUser('octo', budget()),
  listUserRepo: (client) => client.listUserRepo('octo', budget()),
  getTree: (client) => client.getTree('octo', 'repo', budget())
}

const headerOf = (call: FakeCall | undefined, name: string) => new Headers(call?.init.headers).get(name)

async function failure(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise
  } catch (error) {
    expect(error).toBeInstanceOf(AppError)
    return error as AppError
  }
  throw new Error('The call did not fail.')
}

describe('github client: the token header', () => {
  it.each(Object.keys(callByName))('%s sends Authorization: Bearer <token> to api.github.com', async (name) => {
    const github = fakeGithub(answer)

    await callByName[name]?.(github.client({ authorization }))

    expect(github.callList).toHaveLength(1)
    expect(new URL(github.callList[0]?.url ?? '').origin).toBe(API)
    expect(headerOf(github.callList[0], 'authorization')).toBe(authorization)
  })

  it('sends no Authorization header without a token', async () => {
    const github = fakeGithub(answer)
    for (const run of Object.values(callByName)) await run(github.client())

    expect(github.callList).toHaveLength(6)
    for (const call of github.callList) expect(headerOf(call, 'authorization')).toBeNull()
  })

  it.each([301, 302, 307, 308])('a %d is still a 502 and the token never goes to the redirect target', async (status) => {
    const github = fakeGithub(() => new Response(null, { status, headers: { location: 'https://evil.example.com/steal' } }))

    const error = await failure(github.client({ authorization }).getFile('octo', 'repo', ['a.ts'], 'main', budget()))

    expect(error.status).toBe(502)
    expect(error.code).toBe('upstream_error')
    expect(error.message).not.toContain(token)
    expect(github.callList).toHaveLength(1)
    expect(github.callList[0]?.init.redirect).toBe('manual')
    for (const call of github.callList) expect(new URL(call.url).origin).toBe(API)
  })

  it('a 403 with x-ratelimit-remaining 0 is still rate_limited with resetAt, and the token is not in the error', async () => {
    const github = fakeGithub(() => jsonResponse({ message: 'rate limit' }, 403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1798761600' }))

    const error = await failure(github.client({ authorization }).getUser('octo', budget()))

    expect(error.status).toBe(429)
    expect(error.code).toBe('rate_limited')
    expect(error.details).toEqual({ resetAt: '2027-01-01T00:00:00.000Z' })
    expect(github.callList).toHaveLength(1)
    expect(JSON.stringify(error)).not.toContain(token)
  })
})

describe('github client: a token GitHub refuses (401)', () => {
  it('retries the call once without the token and logs one warning that names the setting, not the value', async () => {
    const warnList: string[] = []
    const github = fakeGithub((url, init, index) => index === 0 ? jsonResponse({ message: 'Bad credentials' }, 401) : answer(url, init, index))

    const result = await github.client({ authorization, warn: (line) => warnList.push(line) }).getFile('octo', 'repo', ['a.ts'], 'main', budget())

    expect(result).toEqual({ kind: 'text', text: 'const a = 1\n' })
    expect(github.callList).toHaveLength(2)
    expect(github.callList[0]?.url).toBe(github.callList[1]?.url)
    expect(headerOf(github.callList[0], 'authorization')).toBe(authorization)
    expect(headerOf(github.callList[1], 'authorization')).toBeNull()
    expect(warnList).toHaveLength(1)
    expect(warnList[0]).toContain('GITHUB_API_TOKEN')
    expect(warnList[0]).not.toContain(token)
    expect(warnList[0]).not.toContain('Bearer')
  })

  it('a second 401 is the existing upstream error, after exactly two calls', async () => {
    const warnList: string[] = []
    const github = fakeGithub(() => jsonResponse({ message: 'Bad credentials' }, 401))

    const error = await failure(github.client({ authorization, warn: (line) => warnList.push(line) }).getUser('octo', budget()))

    expect(error.status).toBe(502)
    expect(error.code).toBe('upstream_error')
    expect(github.callList).toHaveLength(2)
    expect(github.callList.filter((call) => headerOf(call, 'authorization') !== null)).toHaveLength(1)
    expect(warnList).toHaveLength(1)
  })

  it.each([500, 403, 404])('a %d with a token is not retried', async (status) => {
    const github = fakeGithub(() => jsonResponse({ message: 'x' }, status))

    await failure(github.client({ authorization }).getUser('octo', budget()))

    expect(github.callList).toHaveLength(1)
  })

  it('a 401 without a token is not retried and logs nothing', async () => {
    const warnList: string[] = []
    const github = fakeGithub(() => jsonResponse({ message: 'x' }, 401))

    const error = await failure(github.client({ warn: (line) => warnList.push(line) }).getUser('octo', budget()))

    expect(error.status).toBe(502)
    expect(github.callList).toHaveLength(1)
    expect(warnList).toEqual([])
  })

  it('the retry shares the call timeout of the request', async () => {
    const github = fakeGithub((_url, _init, index) => index === 0 ? delay(60, () => jsonResponse({ message: 'x' }, 401)) : stall())
    const started = Date.now()

    const error = await failure(github.client({ authorization, callTimeoutMs: 120, warn: () => undefined }).getUser('octo', budget()))

    expect(error.status).toBe(504)
    expect(error.details).toMatchObject({ limit: 'callTimeout' })
    expect(Date.now() - started).toBeLessThan(1500)
    expect(github.callList).toHaveLength(2)
  })

  it('the retry shares the total timeout of the request', async () => {
    const github = fakeGithub((_url, _init, index) => index === 0 ? delay(40, () => jsonResponse({ message: 'x' }, 401)) : stall())

    const error = await failure(github.client({ authorization, warn: () => undefined }).getUser('octo', budget(100)))

    expect(error.status).toBe(504)
    expect(error.details).toMatchObject({ limit: 'totalTimeout' })
    expect(github.callList).toHaveLength(2)
  })
})

describe('createConfiguredGithubClient: the wiring of index.ts', () => {
  it('passes the token from the config as Authorization: Bearer <token>', async () => {
    const github = fakeGithub(answer)

    await createConfiguredGithubClient({ githubFake: false, githubApiToken: token }, { fetch: github.fetch }).getUser('octo', budget())

    expect(headerOf(github.callList[0], GITHUB_API.headerName.authorization)).toBe(authorization)
  })

  it('sends no header when the config has no token', async () => {
    const github = fakeGithub(answer)

    await createConfiguredGithubClient({ githubFake: false, githubApiToken: undefined }, { fetch: github.fetch }).getUser('octo', budget())

    expect(headerOf(github.callList[0], GITHUB_API.headerName.authorization)).toBeNull()
  })

  it('the fake GitHub (GITHUB_FAKE) ignores the token: it is never given to the fake fetch', async () => {
    const real = fakeGithub(answer)
    const fake = fakeGithub(answer)

    await createConfiguredGithubClient({ githubFake: true, githubApiToken: token }, { fetch: real.fetch, fakeFetch: fake.fetch }).getUser('octo', budget())

    expect(real.callList).toHaveLength(0)
    expect(fake.callList).toHaveLength(1)
    expect(headerOf(fake.callList[0], 'authorization')).toBeNull()
  })
})
