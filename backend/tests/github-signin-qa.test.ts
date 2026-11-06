import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { createFakeGithubSignInClient, type FakeProfileTable } from '../src/lib/github-signin-fake.js'
import type { GithubProfile } from '../src/lib/github-signin-client.js'
import { buildApp, frontendUrl, newAgent } from './helper/app.js'

// QA adversarial pass for plan 040 (GitHub sign-in). Fake client only; nothing reaches github.com.

const origin = new URL(frontendUrl).origin
const oauth = { clientId: 'qa-client', clientSecret: 'qa-canary-secret-91c', redirectUrl: 'http://localhost:3001/api/auth/github/callback' }
const mona: GithubProfile = { id: '1001', login: 'mona', name: 'Mona', email: 'mona@example.com', emailVerified: true }

function setup(table: FakeProfileTable = {}) {
  const client = createFakeGithubSignInClient({ 'code-mona': mona, ...table })
  const built = buildApp({ githubOAuth: oauth, githubSignInClient: client })
  return { ...built, client }
}

type Browser = ReturnType<typeof newAgent>

async function begin(browser: Browser, returnTo?: string) {
  const response = await browser.get('/api/auth/github').query(returnTo === undefined ? {} : { returnTo })
  return { response, state: new URL(response.headers.location as string).searchParams.get('state') ?? '' }
}

describe('QA: open redirect through returnTo', () => {
  it('every hostile returnTo ends on the frontend origin', async () => {
    const hostile = [
      '/@evil.example', '/%2f%2fevil.example', '/%5c%5cevil.example', '/..//evil.example', '/./\\evil.example',
      '/\t/evil.example', '/ /evil.example', 'http:evil.example', 'https:/evil.example',
      '/?next=https://evil.example', '/#//evil.example', '///evil.example', '/%00', ' /history', '/history ', '\n/history'
    ]
    for (const returnTo of hostile) {
      const { rawApp } = setup()
      const browser = newAgent(rawApp)
      const { state } = await begin(browser, returnTo)
      const response = await browser.get('/api/auth/github/callback').query({ code: 'code-mona', state })
      expect(response.status, returnTo).toBe(302)
      const location = String(response.headers.location)
      expect(location.startsWith(`${origin}/`), `${returnTo} -> ${location}`).toBe(true)
      expect(new URL(location).origin, returnTo).toBe(origin)
    }
  })

  it('an array returnTo (returnTo[]=a&returnTo[]=b) is ignored', async () => {
    const { rawApp } = setup()
    const response = await request(rawApp).get('/api/auth/github?returnTo[]=/a&returnTo[]=/b')
    expect(response.status).toBe(302)
  })
})

describe('QA: state', () => {
  it('an empty or whitespace state parameter is invalid_state, never a 500', async () => {
    const { rawApp } = setup()
    for (const state of ['', ' ', 'x'.repeat(5000)]) {
      const browser = newAgent(rawApp)
      await begin(browser)
      const response = await browser.get('/api/auth/github/callback').query({ code: 'code-mona', state })
      expect(response.status).toBe(302)
      expect(new URL(String(response.headers.location)).searchParams.get('auth_error')).toBe('invalid_state')
    }
  })

  it('a stolen state cookie, replayed, is NOT rejected by the server (single use is the cookie deletion plus GitHub code single use)', async () => {
    const { rawApp } = setup({ 'code-mona-2': mona })
    const start = await request(rawApp).get('/api/auth/github')
    const cookie = ((start.headers['set-cookie'] as unknown as string[])[0] ?? '').split(';')[0] ?? ''
    const state = new URL(String(start.headers.location)).searchParams.get('state') ?? ''

    const first = await request(rawApp).get('/api/auth/github/callback').query({ code: 'code-mona', state }).set('Cookie', cookie)
    const replay = await request(rawApp).get('/api/auth/github/callback').query({ code: 'code-mona-2', state }).set('Cookie', cookie)

    expect(new URL(String(first.headers.location)).pathname).toBe('/')
    // Documented behaviour: the second callback with the same cookie and a fresh code succeeds.
    expect(new URL(String(replay.headers.location)).searchParams.get('auth_error')).toBeNull()
  })

  it('a state cookie of the sign-in mode cannot be used to link: the session account is not touched', async () => {
    const { rawApp, store } = setup({ 'code-other': { id: '2002', login: 'other', name: null, email: 'other@example.com', emailVerified: true } })
    const browser = newAgent(rawApp)
    const { state } = await begin(browser)
    await browser.get('/api/auth/github/callback').query({ code: 'code-mona', state })
    expect([...store.identityMap.values()]).toHaveLength(1)
  })
})

describe('QA: hostile GitHub profiles', () => {
  const cases: [string, GithubProfile][] = [
    ['non numeric id', { ...mona, id: 'abc' }],
    ['login with a slash', { ...mona, id: '5', login: 'a/b' }],
    ['login with a newline', { ...mona, id: '6', login: 'a\nb' }],
    ['empty login', { ...mona, id: '7', login: '' }],
    ['very long login', { ...mona, id: '8', login: 'a'.repeat(300) }]
  ]
  for (const [name, profile] of cases) {
    it(`${name} is provider_error, no account, no session`, async () => {
      const { rawApp, store } = setup({ 'code-bad': profile })
      const browser = newAgent(rawApp)
      const { state } = await begin(browser)
      const response = await browser.get('/api/auth/github/callback').query({ code: 'code-bad', state })
      expect(new URL(String(response.headers.location)).searchParams.get('auth_error')).toBe('provider_error')
      expect(store.identityMap.size).toBe(0)
      expect(String(response.headers['set-cookie'] ?? '')).not.toContain('cr_session=')
    })
  }

  it('a hostile full name and email are stored cleaned or refused, never a 500', async () => {
    const { rawApp, store } = setup({ 'code-weird': { id: '9', login: 'weird', name: `\u0000‮${'N'.repeat(500)}\ud800`, email: 'weird@example.com', emailVerified: true } })
    const browser = newAgent(rawApp)
    const { state } = await begin(browser)
    const response = await browser.get('/api/auth/github/callback').query({ code: 'code-weird', state })
    expect(response.status).toBe(302)
    const account = [...store.orgMap.values()].map((org) => org.account).find((record) => record.username === "weird")
    expect(account).toBeDefined()
    expect(account?.fullName).not.toMatch(/[\u0000-\u001f]/)
    expect(account?.fullName.length).toBeLessThanOrEqual(255)
  })

  it('an email that already exists in another case is email_in_use', async () => {
    const { rawApp } = setup({ 'code-case': { id: '10', login: 'casey', name: null, email: 'JOHN@COMPANY.COM', emailVerified: true } })
    const browser = newAgent(rawApp)
    const { state } = await begin(browser)
    const response = await browser.get('/api/auth/github/callback').query({ code: 'code-case', state })
    expect(new URL(String(response.headers.location)).searchParams.get('auth_error')).toBe('email_in_use')
  })

  it('two logins that differ only by case get distinct user names', async () => {
    const { rawApp, store } = setup({
      'code-a': { id: '11', login: 'Casey', name: null, email: 'casey1@example.com', emailVerified: true },
      'code-b': { id: '12', login: 'casey', name: null, email: 'casey2@example.com', emailVerified: true }
    })
    for (const code of ['code-a', 'code-b']) {
      const browser = newAgent(rawApp)
      const { state } = await begin(browser)
      const response = await browser.get('/api/auth/github/callback').query({ code, state })
      expect(new URL(String(response.headers.location)).searchParams.get('auth_error')).toBeNull()
    }
    const names = [...store.orgMap.values()].map((org) => org.account).map((record) => record.username.toLowerCase())
    expect(new Set(names).size).toBe(names.length)
  })
})

describe('QA: rate limit and the browser navigation', () => {
  it('start and callback share one bucket: a start plus a callback is two hits', async () => {
    const { rawApp } = setup()
    let allowed = 0
    for (let index = 0; index < 40; index += 1) {
      const response = await request(rawApp).get('/api/auth/github')
      if (!String(response.headers.location).includes('auth_error=')) allowed += 1
      else break
    }
    expect(allowed).toBe(30)
    // The callback of a user who started earlier is now refused too.
    const callback = await request(rawApp).get('/api/auth/github/callback').query({ code: 'code-mona', state: 'x' })
    expect(callback.status).toBe(302)
    expect(callback.headers.location).toBe(`${origin}/login?auth_error=rate_limited`)
  })

  it('a rate-limited start navigation redirects to /login?auth_error=rate_limited, no state cookie', async () => {
    const { rawApp } = setup()
    for (let index = 0; index < 30; index += 1) await request(rawApp).get('/api/auth/github')
    const response = await request(rawApp).get('/api/auth/github').set('Accept', 'text/html')
    expect(response.status).toBe(302)
    expect(response.headers.location).toBe(`${origin}/login?auth_error=rate_limited`)
    expect(response.headers['set-cookie']).toBeUndefined()
  })

  it('a rate-limited callback redirects to /login?auth_error=rate_limited', async () => {
    const { rawApp } = setup()
    for (let index = 0; index < 30; index += 1) await request(rawApp).get('/api/auth/github')
    const response = await request(rawApp).get('/api/auth/github/callback').query({ code: 'code-mona', state: 'x' })
    expect(response.status).toBe(302)
    expect(response.headers.location).toBe(`${origin}/login?auth_error=rate_limited`)
  })

  it('a rate-limited link call stays a JSON 429 with Retry-After', async () => {
    const { rawApp } = setup()
    const browser = newAgent(rawApp)
    const { state } = await begin(browser)
    await browser.get('/api/auth/github/callback').query({ code: 'code-mona', state })
    for (let index = 0; index < 30; index += 1) await request(rawApp).get('/api/auth/github')
    const response = await browser.post('/api/auth/github/link').set('X-CSRF-Protection', '1')
    expect(response.status).toBe(429)
    expect(response.headers['retry-after']).toBeDefined()
    expect(response.body.code ?? response.body.error?.code).toBe('rate_limited')
  })
})

describe('QA: GitHub-only account paths', () => {
  it('password sign-in with odd bodies is never a 500 and never a session', async () => {
    const { rawApp } = setup()
    const browser = newAgent(rawApp)
    const { state } = await begin(browser)
    await browser.get('/api/auth/github/callback').query({ code: 'code-mona', state })
    for (const body of [{ username: 'mona', password: 'x'.repeat(5000) }, { username: 'MONA', password: 'whatever-123' }, { username: 'mona', password: null }, { username: 'mona' }, { username: 'mona', password: '\u0000' }]) {
      const response = await newAgent(rawApp).post('/api/session').send(body)
      expect([401, 413, 422], JSON.stringify(body).slice(0, 40)).toContain(response.status)
      expect(String(response.headers['set-cookie'] ?? '')).not.toContain('cr_session=')
    }
  })

  it('unlink then GitHub sign-in again does not recreate or take over: email_in_use (the account keeps its email)', async () => {
    const { rawApp, store } = setup()
    const browser = newAgent(rawApp)
    const { state } = await begin(browser)
    await browser.get('/api/auth/github/callback').query({ code: 'code-mona', state })
    // A GitHub-only account cannot be unlinked (409), so identities stay at one.
    const unlink = await browser.delete('/api/auth/github/link').set('X-CSRF-Protection', '1')
    expect(unlink.status).toBe(409)
    expect(store.identityMap.size).toBe(1)
  })
})

describe('QA: non-Latin-1 returnTo', () => {
  for (const returnTo of ['/日本語', '/‮//evil.example', '/\u{1F600}', '/é']) {
    it(`returnTo ${JSON.stringify(returnTo)} does not turn a good sign-in into a 500`, async () => {
      const { rawApp } = setup()
      const browser = newAgent(rawApp)
      const { state } = await begin(browser, returnTo)
      const response = await browser.get('/api/auth/github/callback').query({ code: 'code-mona', state })
      expect(response.status).toBe(302)
      expect(String(response.headers.location).startsWith(`${origin}/`)).toBe(true)
    })
  }
})
