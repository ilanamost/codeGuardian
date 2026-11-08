import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import { createFakeGithubSignInClient } from '../src/lib/github-signin-fake.js'
import type { GithubProfile } from '../src/lib/github-signin-client.js'
import { createMemoryStore } from '../src/store/memory-store.js'
import { csrfHeader, demoPassword, demoUsername, fixedNow, frontendUrl, sessionCookieOf } from './helper/app.js'
import { expectContract, expectError } from './helper/contract.js'

// Plan 048 (contract 0.19.0): the one-time authCode in the callback redirect fragment and
// POST /api/auth/github/exchange. Validation items 1-6 and 9. Nothing reaches github.com.

const origin = new URL(frontendUrl).origin
const oauth = { clientId: 'test-client-id', clientSecret: 'canary-client-secret-7f3a', redirectUrl: 'http://localhost:3001/api/auth/github/callback' }
const octocat: GithubProfile = { id: '583231', login: 'octocat', name: 'The Octocat', email: 'octocat@example.com', emailVerified: true }
const codePattern = /^[A-Za-z0-9_-]{43}$/
const exchangePath = '/api/auth/github/exchange'

function setup(option: { fallback?: boolean, github?: boolean } = {}) {
  const clock = { value: fixedNow }
  const lineList: string[] = []
  const logger = { info: (line: string) => void lineList.push(line), warn: (line: string) => void lineList.push(line) }
  const client = createFakeGithubSignInClient({ 'code-octocat': octocat, 'code-broken': null })
  const app = createApp(
    { frontendUrl, enableTestRoute: true, sessionTokenFallback: option.fallback ?? true, githubOAuth: option.github === false ? undefined : oauth },
    { store: createMemoryStore(), now: () => clock.value, securityLogger: logger, githubSignInClient: client }
  )
  return { app, clock, lineList }
}

type App = ReturnType<typeof setup>['app']

// GitHub sign-in through the callback; returns the callback response.
async function signIn(app: App, code = 'code-octocat') {
  const browser = request.agent(app).set(csrfHeader, '1')
  const start = await browser.get('/api/auth/github')
  const state = new URL(start.headers.location as string).searchParams.get('state') ?? ''
  const response = await browser.get('/api/auth/github/callback').query({ code, state })
  return { browser, response }
}

function fragmentCodeOf(response: request.Response): string {
  const location = new URL(response.headers.location as string)
  const params = new URLSearchParams(location.hash.slice(1))
  return params.get('auth_code') ?? ''
}

function exchange(app: App, body: unknown = {}) {
  return request(app).post(exchangePath).set(csrfHeader, '1').send(body as object)
}

describe('callback fragment', () => {
  it('appends #auth_code=<43 chars> when the switch is on, and still sets the cookie', async () => {
    const { app } = setup()

    const { response } = await signIn(app)

    expect(response.status).toBe(302)
    const location = new URL(response.headers.location as string)
    expect(location.origin).toBe(origin)
    expect(location.hash).toMatch(/^#auth_code=[A-Za-z0-9_-]{43}$/)
    expect(location.search).toBe('')
    expect(sessionCookieOf(response)).toBeDefined()
    expect(response.headers['cache-control']).toBe('no-store')
  })

  it('keeps the return path and puts the code only in the fragment', async () => {
    const { app } = setup()
    const browser = request.agent(app).set(csrfHeader, '1')
    const start = await browser.get('/api/auth/github').query({ returnTo: '/review/abc' })
    const state = new URL(start.headers.location as string).searchParams.get('state') ?? ''

    const response = await browser.get('/api/auth/github/callback').query({ code: 'code-octocat', state })

    const location = new URL(response.headers.location as string)
    expect(location.pathname).toBe('/review/abc')
    expect(location.search).toBe('')
    expect(location.hash).toMatch(/^#auth_code=[A-Za-z0-9_-]{43}$/)
    expect((response.headers.location as string).split('#')).toHaveLength(2)
  })

  it('has no fragment when the switch is off, and the cookie is still set', async () => {
    const { app } = setup({ fallback: false })

    const { response } = await signIn(app)

    expect(new URL(response.headers.location as string).hash).toBe('')
    expect(response.headers.location).not.toContain('auth_code')
    expect(sessionCookieOf(response)).toBeDefined()
  })

  it('has no fragment on a failure redirect or when the user denied', async () => {
    const { app } = setup()
    const browser = request.agent(app).set(csrfHeader, '1')
    const start = await browser.get('/api/auth/github')
    const state = new URL(start.headers.location as string).searchParams.get('state') ?? ''

    const denied = await browser.get('/api/auth/github/callback').query({ error: 'access_denied', state })
    const bad = await signIn(app, 'code-broken')

    for (const response of [denied, bad.response]) {
      const location = new URL(response.headers.location as string)
      expect(location.searchParams.get('auth_error')).not.toBeNull()
      expect(location.hash).toBe('')
      expect(sessionCookieOf(response)).toBeUndefined()
    }
  })

  it('has no fragment on the Link flow (a signed-in account links GitHub)', async () => {
    const { app } = setup()
    const browser = request.agent(app).set(csrfHeader, '1')
    expect((await browser.post('/api/session').set('X-Session-Mode', 'token').send({ username: demoUsername, password: demoPassword })).status).toBe(200)
    const link = await browser.post('/api/auth/github/link')
    const state = new URL(link.body.url as string).searchParams.get('state') ?? ''

    const response = await browser.get('/api/auth/github/callback').query({ code: 'code-octocat', state })

    expect(new URL(response.headers.location as string).hash).toBe('')
  })
})

describe('POST /api/auth/github/exchange', () => {
  it('swaps a valid code for the session token, with no cookie and no-store', async () => {
    const { app } = setup()
    const { response: callback } = await signIn(app)
    const code = fragmentCodeOf(callback)
    expect(code).toMatch(codePattern)

    const response = await exchange(app, { code })

    expectContract(response, '/api/auth/github/exchange', 'POST')
    expect(response.status).toBe(200)
    expect(Object.keys(response.body)).toEqual(['sessionToken'])
    expect(response.body.sessionToken).toMatch(codePattern)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.headers['set-cookie']).toBeUndefined()
    expect(response.body.sessionToken).not.toBe(code)
  })

  it('returns a token that works as a bearer for GET /api/session', async () => {
    const { app } = setup()
    const { response: callback } = await signIn(app)
    const { body } = await exchange(app, { code: fragmentCodeOf(callback) })

    const restore = await request(app).get('/api/session').set('Authorization', `Bearer ${body.sessionToken}`)

    expect(restore.status).toBe(200)
    expect(restore.body.account.username).toBe('octocat')
  })

  it('answers 401 when the same code is used a second time', async () => {
    const { app } = setup()
    const { response: callback } = await signIn(app)
    const code = fragmentCodeOf(callback)
    expect((await exchange(app, { code })).status).toBe(200)

    const second = await exchange(app, { code })

    expectContract(second, exchangePath, 'POST')
    expectError(second, 401, 'unauthorized')
    expect(second.headers['cache-control']).toBe('no-store')
  })

  it('answers 401 for a code older than 60 seconds, and 200 just under', async () => {
    const { app, clock } = setup()
    const fresh = fragmentCodeOf((await signIn(app)).response)
    const stale = fragmentCodeOf((await signIn(app)).response)

    clock.value += 59_999
    expect((await exchange(app, { code: fresh })).status).toBe(200)
    clock.value += 1
    expectError(await exchange(app, { code: stale }), 401, 'unauthorized')
  })

  it('gives every invalid code the same 401 body message', async () => {
    const { app } = setup()
    const { response: callback } = await signIn(app)
    const good = fragmentCodeOf(callback)
    await exchange(app, { code: good })

    const bodyList = [
      { code: 'a'.repeat(43) },
      { code: good },
      { code: 'short' },
      { code: 'a'.repeat(44) },
      { code: 'a'.repeat(42) },
      { code: `${'a'.repeat(42)}!` },
      { code: '' },
      { code: 42 },
      { code: null },
      { code: ['a'.repeat(43)] },
      { code: { code: 'a'.repeat(43) } },
      {},
      { other: 'a'.repeat(43) }
    ]
    const messageSet = new Set<string>()
    for (const body of bodyList) {
      const response = await exchange(app, body)
      expectError(response, 401, 'unauthorized')
      expect(response.headers['cache-control']).toBe('no-store')
      messageSet.add(response.body.error.message)
      expect(response.body.error.details).toBeUndefined()
    }
    expect(messageSet.size).toBe(1)
  })

  it('answers 401 for a missing body', async () => {
    const { app } = setup()

    expectError(await request(app).post(exchangePath).set(csrfHeader, '1'), 401, 'unauthorized')
  })

  it('answers 403 without the CSRF header and refuses a foreign Origin', async () => {
    const { app } = setup()
    const { response: callback } = await signIn(app)
    const code = fragmentCodeOf(callback)

    const noHeader = await request(app).post(exchangePath).send({ code })
    const foreign = await request(app).post(exchangePath).set(csrfHeader, '1').set('Origin', 'https://evil.example').send({ code })

    expectContract(noHeader, exchangePath, 'POST')
    expectError(noHeader, 403, 'forbidden')
    expectError(foreign, 403, 'forbidden')
    // Neither refusal used up the code.
    expect((await exchange(app, { code })).status).toBe(200)
  })

  it('accepts the frontend Origin', async () => {
    const { app } = setup()
    const { response: callback } = await signIn(app)

    const response = await request(app).post(exchangePath).set(csrfHeader, '1').set('Origin', origin).send({ code: fragmentCodeOf(callback) })

    expect(response.status).toBe(200)
  })

  it('shares the per-IP bucket of the GitHub sign-in routes: 429 with Retry-After after 30 calls', async () => {
    const { app } = setup()

    for (let index = 0; index < 30; index += 1) expect((await exchange(app, { code: 'a'.repeat(43) })).status).toBe(401)
    const limited = await exchange(app, { code: 'a'.repeat(43) })

    expectContract(limited, exchangePath, 'POST')
    expect(limited.status).toBe(429)
    expect(limited.headers['retry-after']).toBeDefined()
    expect(limited.headers['cache-control']).toBe('no-store')
  })
})

describe('the switch is off, or GitHub sign-in is not configured', () => {
  it('answers 404 (not 401) when the switch is off, with no session', async () => {
    const { app } = setup({ fallback: false })

    const response = await exchange(app, { code: 'a'.repeat(43) })

    expectContract(response, exchangePath, 'POST')
    expectError(response, 404, 'not_found')
  })

  it('answers 404 when GitHub sign-in is not configured', async () => {
    const { app } = setup({ github: false })

    expectError(await exchange(app, { code: 'a'.repeat(43) }), 404, 'not_found')
  })
})

describe('logs and bodies never hold a code or a token', () => {
  it('logs auth.github.exchange with success and invalid_auth_code only', async () => {
    const { app, lineList } = setup()
    const { response: callback } = await signIn(app)
    const code = fragmentCodeOf(callback)
    const ok = await exchange(app, { code })
    const token = ok.body.sessionToken as string
    const bad = await exchange(app, { code })

    const exchangeLineList = lineList.filter((line) => line.includes('auth.github.exchange'))
    expect(exchangeLineList.map((line) => JSON.parse(line).reason)).toEqual(['success', 'invalid_auth_code'])
    const everything = [...lineList, JSON.stringify(bad.body), bad.text].join('\n')
    expect(everything).not.toContain(code)
    expect(everything).not.toContain(token)
    expect(lineList.join('\n')).not.toContain(oauth.clientSecret)
  })

  it('the callback response and the log hold no code outside the fragment', async () => {
    const { app, lineList } = setup()

    const { response } = await signIn(app)
    const code = fragmentCodeOf(response)

    expect(response.text).not.toContain(code)
    expect((response.headers.location as string).split('#')[0]).not.toContain(code)
    expect(lineList.join('\n')).not.toContain(code)
  })

  it('a rate-limited exchange is logged with rate_limited and no code', async () => {
    const { app, lineList } = setup()

    for (let index = 0; index < 31; index += 1) await exchange(app, { code: 'b'.repeat(43) })

    expect(lineList.join('\n')).not.toContain('b'.repeat(43))
    expect(lineList.some((line) => line.includes('auth.github.exchange') && line.includes('rate_limited'))).toBe(true)
  })
})

describe('test reset', () => {
  it('forgets codes in flight', async () => {
    const { app } = setup()
    const { response } = await signIn(app)
    const code = fragmentCodeOf(response)

    await request(app).post('/api/test/reset').set(csrfHeader, '1')

    expectError(await exchange(app, { code }), 401, 'unauthorized')
  })
})
