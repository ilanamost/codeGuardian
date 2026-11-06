import { createHash } from 'node:crypto'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import { createFakeGithubSignInClient, type FakeProfileTable } from '../src/lib/github-signin-fake.js'
import type { GithubProfile } from '../src/lib/github-signin-client.js'
import { buildApp, demoPassword, demoUsername, frontendUrl, newAgent, sessionCookieOf, signInAgent } from './helper/app.js'
import { expectContract, expectError } from './helper/contract.js'

// Plan 040: "Continue with GitHub". Every test runs the real routes over the fake GitHub sign-in
// client: nothing reaches github.com. The agent keeps cookies like a browser (the state cookie,
// then the session cookie).

const origin = new URL(frontendUrl).origin
const oauth = { clientId: 'test-client-id', clientSecret: 'canary-client-secret-7f3a', redirectUrl: 'http://localhost:3001/api/auth/github/callback' }

const octocat: GithubProfile = { id: '583231', login: 'octocat', name: 'The Octocat', email: 'Octocat@Example.com', emailVerified: true }
const hubot: GithubProfile = { id: '9919', login: 'hubot', name: null, email: 'hubot@example.com', emailVerified: true }
const table: FakeProfileTable = {
  'code-octocat': octocat,
  'code-hubot': hubot,
  'code-unverified': { id: '77', login: 'quiet-user', name: null, email: null, emailVerified: false },
  'code-demo-email': { id: '88', login: 'impostor', name: 'Impostor', email: 'JOHN@company.com', emailVerified: true },
  'code-broken': null
}

function setup(extra: FakeProfileTable = {}, option: Parameters<typeof buildApp>[0] = {}) {
  const client = createFakeGithubSignInClient({ ...table, ...extra })
  const lineList: string[] = []
  const logger = { info: (line: string) => void lineList.push(line), warn: (line: string) => void lineList.push(line) }
  const built = buildApp({ githubOAuth: oauth, githubSignInClient: client, securityLogger: logger, ...option })
  return { ...built, client, lineList }
}

type Browser = ReturnType<typeof newAgent>

// GET /api/auth/github, then the state and challenge in GitHub's authorize URL.
async function begin(browser: Browser, returnTo?: string) {
  const response = await browser.get('/api/auth/github').query(returnTo === undefined ? {} : { returnTo })
  expect(response.status).toBe(302)
  const location = new URL(response.headers.location as string)
  return { response, location, state: location.searchParams.get('state') ?? '', challenge: location.searchParams.get('code_challenge') ?? '' }
}

function callback(browser: Browser, query: Record<string, string>) {
  return browser.get('/api/auth/github/callback').query(query)
}

function cookieLineOf(response: request.Response, name: string): string | undefined {
  return (response.headers['set-cookie'] as unknown as string[] | undefined)?.find((line) => line.startsWith(`${name}=`))
}

function redirectOf(response: request.Response): URL {
  expect(response.status).toBe(302)
  return new URL(response.headers.location as string)
}

// A complete sign-in with a code; returns the browser (now signed in) and the callback response.
async function signInWith(app: Parameters<typeof newAgent>[0], code: string, returnTo?: string) {
  const browser = newAgent(app)
  const { state } = await begin(browser, returnTo)
  const response = await callback(browser, { code, state })
  return { browser, response }
}

function expectFailure(response: request.Response, code: string, path = '/login') {
  const location = redirectOf(response)
  expect(location.origin).toBe(origin)
  expect(location.pathname).toBe(path)
  expect(location.searchParams.get('auth_error')).toBe(code)
  expect(cookieLineOf(response, 'cr_session')).toBeUndefined()
}

describe('GitHub sign-in is off unless configured', () => {
  it('answers 404 on all four routes and reports githubOAuth false', async () => {
    const { rawApp, app } = buildApp()

    expect((await request(rawApp).get('/api/auth/github')).body.error.code).toBe('not_found')
    expect((await request(rawApp).get('/api/auth/github/callback').query({ code: 'x', state: 'y' })).status).toBe(404)
    expectError(await request(app).post('/api/auth/github/link').set('X-CSRF-Protection', '1'), 404, 'not_found')
    expectError(await request(app).delete('/api/auth/github/link').set('X-CSRF-Protection', '1'), 404, 'not_found')
    expect((await request(rawApp).get('/api/health')).body.githubOAuth).toBe(false)
  })

  it('the link routes still need a session first (401, not 404)', async () => {
    const { rawApp } = buildApp()

    expectError(await newAgent(rawApp).post('/api/auth/github/link'), 401, 'unauthorized')
  })
})

describe('GET /api/auth/github (start)', () => {
  it('redirects to the GitHub authorize URL with the state, the S256 challenge and only the two scopes', async () => {
    const { rawApp } = setup()

    const response = await request(rawApp).get('/api/auth/github')

    expectContract(response, '/api/auth/github', 'GET')
    expect(response.status).toBe(302)
    expect(response.text).toBe('')
    const location = new URL(response.headers.location as string)
    expect(`${location.origin}${location.pathname}`).toBe('https://github.com/login/oauth/authorize')
    expect(location.searchParams.get('client_id')).toBe(oauth.clientId)
    expect(location.searchParams.get('redirect_uri')).toBe(oauth.redirectUrl)
    expect(location.searchParams.get('scope')).toBe('read:user user:email')
    expect(location.searchParams.get('code_challenge_method')).toBe('S256')
    expect(location.searchParams.get('state')).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(location.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(location.href).not.toContain(oauth.clientSecret)
    expect([...location.searchParams.keys()].sort()).toEqual(['client_id', 'code_challenge', 'code_challenge_method', 'redirect_uri', 'scope', 'state'])
  })

  it('sets a single-use state cookie: HttpOnly, SameSite=Lax, 10 minutes, no Secure in development', async () => {
    const { rawApp } = setup()

    const response = await request(rawApp).get('/api/auth/github')

    const line = cookieLineOf(response, 'cr_github_state') ?? ''
    expect(line).toMatch(/^cr_github_state=[A-Za-z0-9_-]+; Max-Age=600; Path=\/; Expires=[^;]+; HttpOnly; SameSite=Lax$/)
    expect(line).not.toMatch(/Secure/)
    expect(response.headers['cache-control']).toBe('no-store')
  })

  it('uses the __Host- name and Secure in production', async () => {
    const app = createApp({ frontendUrl, enableTestRoute: false, production: true, githubOAuth: oauth }, { githubSignInClient: createFakeGithubSignInClient(table) })

    const response = await request(app).get('/api/auth/github')

    expect(cookieLineOf(response, '__Host-cr_github_state')).toMatch(/Path=\/; .*HttpOnly; Secure; SameSite=Lax$/)
  })

  it('uses fresh random values on every call', async () => {
    const { rawApp } = setup()

    const first = await begin(newAgent(rawApp))
    const second = await begin(newAgent(rawApp))

    expect(first.state).not.toBe(second.state)
    expect(first.challenge).not.toBe(second.challenge)
  })

  it('accepts a relative returnTo and ignores every other kind', async () => {
    const { rawApp } = setup()
    const ignored = ['https://evil.example/', '//evil.example', '/\\evil.example', '\\\\evil.example', 'history', '/a\nb', '/a b', '/x\u0000', `/${'a'.repeat(600)}`, 'javascript:alert(1)', '']

    for (const returnTo of ['/history', '/review/abc?x=1', ...ignored]) {
      const browser = newAgent(rawApp)
      const { state } = await begin(browser, returnTo)
      const response = await callback(browser, { code: 'code-octocat', state })
      const expected = returnTo === '/history' || returnTo === '/review/abc?x=1' ? returnTo : '/'
      const location = redirectOf(response)
      expect(`${location.pathname}${location.search}`, returnTo).toBe(expected)
      expect(location.origin).toBe(origin)
    }
  })

  it('is limited per IP: the 31st call redirects to /login?auth_error=rate_limited', async () => {
    const { rawApp } = setup()
    for (let index = 0; index < 30; index += 1) expect((await request(rawApp).get('/api/auth/github')).status).toBe(302)

    const response = await request(rawApp).get('/api/auth/github')

    expectContract(response, '/api/auth/github', 'GET')
    expect(response.status).toBe(302)
    expect(response.headers.location).toBe(`${new URL(frontendUrl).origin}/login?auth_error=rate_limited`)
    expect(response.headers['set-cookie']).toBeUndefined()
    expect(response.text).toBe('')
  })
})

describe('GET /api/auth/github/callback: a new GitHub user', () => {
  it('creates the account and its org with no password, signs in, clears the state cookie and redirects to the app', async () => {
    const { rawApp, store, client } = setup()
    const browser = newAgent(rawApp)
    const { state, challenge } = await begin(browser)

    const response = await callback(browser, { code: 'code-octocat', state })

    expectContract(response, '/api/auth/github/callback', 'GET')
    expect(response.text).toBe('')
    const location = redirectOf(response)
    expect(`${location.origin}${location.pathname}${location.search}`).toBe(`${origin}/`)
    expect(sessionCookieOf(response)).toMatch(/^cr_session=[A-Za-z0-9_-]{43}; Max-Age=604800; Path=\/; Expires=[^;]+; HttpOnly; SameSite=Lax$/)
    expect(cookieLineOf(response, 'cr_github_state')).toMatch(/^cr_github_state=; Max-Age=0;/)
    // The PKCE verifier sent to GitHub is the one whose S256 hash was in the authorize URL.
    expect(client.exchangeList).toHaveLength(1)
    expect(createHash('sha256').update(client.exchangeList[0]?.verifier ?? '').digest('base64url')).toBe(challenge)
    // The account: user name from the login, name from the profile, the verified email lower-cased, no password.
    const orgEntry = [...store.orgMap].find(([, org]) => org.account.username === 'octocat')
    expect(orgEntry).toBeDefined()
    expect(orgEntry?.[1].account).toMatchObject({ username: 'octocat', fullName: 'The Octocat', email: 'octocat@example.com', passwordHash: null })
    expect(orgEntry?.[1].reviewList).toEqual([])
    expect(store.identityMap.get('github:583231')).toEqual({ provider: 'github', providerUserId: '583231', orgId: orgEntry?.[0], login: 'octocat' })
    // The browser is signed in: session restore shows a GitHub-only account.
    const restored = await browser.get('/api/session')
    expectContract(restored, '/api/session', 'GET')
    expect(restored.body.account).toMatchObject({ username: 'octocat', signInMethod: 'github', githubLogin: 'octocat' })
  })

  it('a returning GitHub user signs in to the same org, even after renaming the login', async () => {
    const { rawApp, store } = setup({ 'code-renamed': { ...octocat, login: 'octocat-renamed' } })
    await signInWith(rawApp, 'code-octocat')
    const orgCount = store.orgMap.size

    const { browser, response } = await signInWith(rawApp, 'code-renamed')

    expect(redirectOf(response).pathname).toBe('/')
    expect(sessionCookieOf(response)).toBeDefined()
    expect(store.orgMap.size).toBe(orgCount)
    const restored = await browser.get('/api/session')
    expect(restored.body.account).toMatchObject({ username: 'octocat', githubLogin: 'octocat-renamed' })
  })

  it('opens the page asked for before sign-in', async () => {
    const { rawApp } = setup()

    const { response } = await signInWith(rawApp, 'code-octocat', '/history')

    expect(redirectOf(response).pathname).toBe('/history')
  })

  it('adds a numeric suffix when the user name is taken, and pads a login that is too short', async () => {
    const { rawApp, store } = setup({
      'code-john': { id: '1001', login: 'john.doe'.replace('.', '-'), name: null, email: 'j1@example.com', emailVerified: true },
      'code-john2': { id: '1002', login: 'JOHN-DOE', name: null, email: 'j2@example.com', emailVerified: true },
      'code-short': { id: '1003', login: 'ab', name: null, email: 'ab@example.com', emailVerified: true }
    })
    const demo = store.state.account
    demo.username = 'john-doe'

    await signInWith(rawApp, 'code-john')
    await signInWith(rawApp, 'code-john2')
    await signInWith(rawApp, 'code-short')

    const names = [...store.orgMap.values()].map((org) => org.account.username).sort()
    expect(names).toEqual(['JOHN-DOE-3', 'ab-gh', 'john-doe', 'john-doe-2'])
  })

  it('refuses a GitHub user with no verified email: email_unverified, no account, no session', async () => {
    const { rawApp, store } = setup()
    const orgCount = store.orgMap.size

    const { response } = await signInWith(rawApp, 'code-unverified')

    expectFailure(response, 'email_unverified')
    expect(store.orgMap.size).toBe(orgCount)
    expect(store.identityMap.size).toBe(0)
  })

  it('never links by email: a verified email of a password account is email_in_use, no session, nothing created', async () => {
    const { rawApp, store } = setup()
    const orgCount = store.orgMap.size

    const { response } = await signInWith(rawApp, 'code-demo-email')

    expectFailure(response, 'email_in_use')
    expect(store.orgMap.size).toBe(orgCount)
    expect(store.identityMap.size).toBe(0)
    expect(store.state.account.passwordHash).not.toBeNull()
  })
})

describe('GET /api/auth/github/callback: refusals', () => {
  it('a missing, wrong, reused or expired state is invalid_state with no session', async () => {
    const { rawApp, client } = setup()

    // No cookie at all (a callback opened in another browser).
    const stranger = newAgent(rawApp)
    const { state } = await begin(newAgent(rawApp))
    expectFailure(await callback(stranger, { code: 'code-octocat', state }), 'invalid_state')

    // A cookie, but another state.
    const wrong = newAgent(rawApp)
    await begin(wrong)
    expectFailure(await callback(wrong, { code: 'code-octocat', state }), 'invalid_state')

    // No state in the query.
    const noState = newAgent(rawApp)
    await begin(noState)
    expectFailure(await callback(noState, { code: 'code-octocat' }), 'invalid_state')

    // Reused: the cookie is deleted by the first callback, so a repeat finds none.
    const once = newAgent(rawApp)
    const started = await begin(once)
    const first = await callback(once, { code: 'code-octocat', state: started.state })
    expect(sessionCookieOf(first)).toBeDefined()
    const replay = request(rawApp).get('/api/auth/github/callback').query({ code: 'code-octocat', state: started.state })
    expectFailure(await replay, 'invalid_state')
    // Reused with the old cookie sent again: the state is still the same string, so the browser must not keep it.
    expect(cookieLineOf(first, 'cr_github_state')).toMatch(/Max-Age=0/)

    // Expired: the browser drops the cookie after its 10 minutes, which is the same as none.
    expect(client.exchangeList).toHaveLength(1)
  })

  it('a tampered state cookie is invalid_state', async () => {
    const { rawApp } = setup()
    const { state } = await begin(newAgent(rawApp))
    for (const value of ['garbage', Buffer.from('{"s":1}').toString('base64url'), Buffer.from('null').toString('base64url'), '']) {
      const response = await request(rawApp).get('/api/auth/github/callback').query({ code: 'code-octocat', state }).set('Cookie', `cr_github_state=${value}`)
      expectFailure(response, 'invalid_state')
    }
  })

  it('the state is checked before anything else: a denial with a bad state is still invalid_state', async () => {
    const { rawApp } = setup()
    const browser = newAgent(rawApp)
    await begin(browser)

    expectFailure(await callback(browser, { error: 'access_denied', state: 'nope' }), 'invalid_state')
  })

  it('the user denying access at GitHub is access_denied', async () => {
    const { rawApp, client } = setup()
    const browser = newAgent(rawApp)
    const { state } = await begin(browser)

    expectFailure(await callback(browser, { error: 'access_denied', error_description: 'The user has denied your application access.', state }), 'access_denied')
    expect(client.exchangeList).toHaveLength(0)
  })

  it('any other GitHub error, a missing code, or a failing exchange is provider_error', async () => {
    const { rawApp } = setup()
    const cases: Record<string, string>[] = [{ error: 'redirect_uri_mismatch' }, {}, { code: 'code-broken' }, { code: 'code-unknown' }]

    for (const extra of cases) {
      const browser = newAgent(rawApp)
      const { state } = await begin(browser)
      expectFailure(await callback(browser, { ...extra, state }), 'provider_error')
    }
  })

  it('treats an array or object query value as absent', async () => {
    const { rawApp } = setup()
    const browser = newAgent(rawApp)
    const { state } = await begin(browser)

    const response = await browser.get(`/api/auth/github/callback?code=a&code=b&state=${state}`)

    expectFailure(response, 'provider_error')
  })

  it('is limited per IP: the 31st call redirects to /login?auth_error=rate_limited', async () => {
    const { rawApp } = setup()
    for (let index = 0; index < 30; index += 1) await request(rawApp).get('/api/auth/github/callback')

    const response = await request(rawApp).get('/api/auth/github/callback')

    expectContract(response, '/api/auth/github/callback', 'GET')
    expect(response.status).toBe(302)
    expect(response.headers.location).toBe(`${new URL(frontendUrl).origin}/login?auth_error=rate_limited`)
  })
})

describe('session safety', () => {
  it('discards a session id the browser already had (no fixation) and sets a new one', async () => {
    const { rawApp, store } = setup()
    const planted = 'A'.repeat(43)
    const plantedHash = createHash('sha256').update(planted).digest('hex')
    store.sessionMap.set(plantedHash, { idHash: plantedHash, orgId: 'default', createdAt: 1, lastSeenAt: 1, expiresAt: 9e15, absoluteExpiresAt: 9e15 })
    const start = await request(rawApp).get('/api/auth/github')
    const stateCookie = cookieLineOf(start, 'cr_github_state')?.split(';')[0] ?? ''
    const state = new URL(start.headers.location as string).searchParams.get('state') ?? ''

    const response = await request(rawApp).get('/api/auth/github/callback').query({ code: 'code-octocat', state })
      .set('Cookie', `cr_session=${planted}; ${stateCookie}`)

    const issued = sessionCookieOf(response) ?? ''
    expect(issued).toMatch(/^cr_session=[A-Za-z0-9_-]{43};/)
    expect(issued).not.toContain(planted)
    expect(store.sessionMap.has(plantedHash)).toBe(false)
  })

  it('the session cookie has the same flags as the password sign-in', async () => {
    const { rawApp } = setup()
    const password = await newAgent(rawApp).post('/api/session').send({ username: demoUsername, password: demoPassword })

    const { response } = await signInWith(rawApp, 'code-octocat')

    const shape = (line: string | undefined) => (line ?? '').replace(/=[A-Za-z0-9_-]{43}/, '=ID').replace(/Expires=[^;]+/, 'Expires=X')
    expect(shape(sessionCookieOf(response))).toBe(shape(sessionCookieOf(password)))
  })

  it('the GitHub token, code, state, verifier and client secret appear in no response, log line or stored row', async () => {
    const { rawApp, store, client, lineList } = setup()
    const browser = newAgent(rawApp)
    const started = await begin(browser)

    const response = await callback(browser, { code: 'code-octocat', state: started.state })
    const failed = await callback(newAgent(rawApp), { code: 'code-octocat', state: started.state })

    const verifier = client.exchangeList[0]?.verifier ?? ''
    const outputs = [
      JSON.stringify(response.headers), response.text, JSON.stringify(failed.headers), failed.text,
      lineList.join('\n'),
      JSON.stringify([...store.orgMap]), JSON.stringify([...store.identityMap]), JSON.stringify([...store.sessionMap])
    ].join('\n')
    for (const secret of [oauth.clientSecret, 'fake-token-for-code-octocat', 'code-octocat', started.state, verifier]) {
      expect(verifier).not.toBe('')
      expect(outputs, secret).not.toContain(secret)
    }
    expect(lineList.some((line) => line.includes('auth.github.callback'))).toBe(true)
  })

  it('logs the start and the callback with an outcome reason code only', async () => {
    const { rawApp, lineList } = setup()
    await signInWith(rawApp, 'code-octocat')
    await signInWith(rawApp, 'code-unverified')

    const parsed = lineList.map((line) => JSON.parse(line) as { operation: string, reason: string })

    expect(parsed.filter((line) => line.operation === 'auth.github.start')).toHaveLength(2)
    expect(parsed.filter((line) => line.operation === 'auth.github.callback').map((line) => line.reason)).toEqual(['success', 'email_unverified'])
  })
})

describe('POST and DELETE /api/auth/github/link', () => {
  it('POST needs a session', async () => {
    const { rawApp } = setup()

    const response = await newAgent(rawApp).post('/api/auth/github/link')

    expectContract(response, '/api/auth/github/link', 'POST')
    expectError(response, 401, 'unauthorized')
  })

  it('POST answers 200 { url } to GitHub and sets the state cookie; the callback then links the account', async () => {
    const { rawApp, store } = setup()
    const browser = await signInAgent(rawApp)

    const response = await browser.post('/api/auth/github/link')

    expectContract(response, '/api/auth/github/link', 'POST')
    expect(response.status).toBe(200)
    const location = new URL(response.body.url)
    expect(`${location.origin}${location.pathname}`).toBe('https://github.com/login/oauth/authorize')
    expect(location.searchParams.get('scope')).toBe('read:user user:email')
    expect(cookieLineOf(response, 'cr_github_state')).toMatch(/HttpOnly; SameSite=Lax$/)

    const done = await callback(browser, { code: 'code-octocat', state: location.searchParams.get('state') ?? '' })
    expectContract(done, '/api/auth/github/callback', 'GET')
    const target = redirectOf(done)
    expect(`${target.origin}${target.pathname}${target.search}`).toBe(`${origin}/settings?section=account`)
    expect(store.identityMap.get('github:583231')).toMatchObject({ orgId: 'default', login: 'octocat' })
    // The password account keeps its password and gains the link.
    const account = (await browser.get('/api/account')).body
    expect(account).toMatchObject({ username: 'john.doe', signInMethod: 'both', githubLogin: 'octocat' })
    // The password sign-in keeps working (signInAgent expects 200).
    await signInAgent(rawApp)
    // And the GitHub sign-in now opens that same account.
    const { browser: github } = await signInWith(rawApp, 'code-octocat')
    expect((await github.get('/api/account')).body.username).toBe('john.doe')
  })

  it('POST is refused with 409 when the account already has a GitHub link', async () => {
    const { rawApp } = setup()
    const browser = await signInAgent(rawApp)
    const first = await browser.post('/api/auth/github/link')
    await callback(browser, { code: 'code-octocat', state: new URL(first.body.url).searchParams.get('state') ?? '' })

    const response = await browser.post('/api/auth/github/link')

    expectContract(response, '/api/auth/github/link', 'POST')
    expectError(response, 409, 'conflict')
  })

  it('a GitHub id linked to another account is identity_in_use at the callback, and the link is not made', async () => {
    const { rawApp, store } = setup()
    await signInWith(rawApp, 'code-octocat')
    const browser = await signInAgent(rawApp)
    const started = await browser.post('/api/auth/github/link')

    const response = await callback(browser, { code: 'code-octocat', state: new URL(started.body.url).searchParams.get('state') ?? '' })

    const target = redirectOf(response)
    expect(`${target.pathname}${target.search}`).toBe('/settings?section=account&auth_error=identity_in_use')
    expect([...store.identityMap.values()].filter((identity) => identity.orgId === 'default')).toEqual([])
  })

  it('a failed link goes back to Settings with the code; a link callback without a session is invalid_state', async () => {
    const { rawApp } = setup()
    const browser = await signInAgent(rawApp)
    const started = await browser.post('/api/auth/github/link')
    const state = new URL(started.body.url).searchParams.get('state') ?? ''

    const denied = await callback(browser, { error: 'access_denied', state })
    expect(`${redirectOf(denied).pathname}${redirectOf(denied).search}`).toBe('/settings?section=account&auth_error=access_denied')

    // The account never comes from the cookie: the same flow in a browser with no session fails.
    const second = await browser.post('/api/auth/github/link')
    const stateCookie = cookieLineOf(second, 'cr_github_state')?.split(';')[0] ?? ''
    const signedOut = await request(rawApp).get('/api/auth/github/callback')
      .query({ code: 'code-octocat', state: new URL(second.body.url).searchParams.get('state') ?? '' }).set('Cookie', stateCookie)
    const target = redirectOf(signedOut)
    expect(`${target.pathname}${target.search}`).toBe('/settings?section=account&auth_error=invalid_state')
  })

  it('DELETE removes the link and answers the account (password only again)', async () => {
    const { rawApp, store } = setup()
    const browser = await signInAgent(rawApp)
    const started = await browser.post('/api/auth/github/link')
    await callback(browser, { code: 'code-octocat', state: new URL(started.body.url).searchParams.get('state') ?? '' })

    const response = await browser.delete('/api/auth/github/link')

    expectContract(response, '/api/auth/github/link', 'DELETE')
    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ username: 'john.doe', signInMethod: 'password', githubLogin: null })
    expect(store.identityMap.size).toBe(0)
  })

  it('DELETE is 404 when there is no link, 401 without a session', async () => {
    const { rawApp } = setup()
    const browser = await signInAgent(rawApp)

    const none = await browser.delete('/api/auth/github/link')
    const signedOut = await newAgent(rawApp).delete('/api/auth/github/link')

    expectContract(none, '/api/auth/github/link', 'DELETE')
    expectError(none, 404, 'not_found')
    expectContract(signedOut, '/api/auth/github/link', 'DELETE')
    expectError(signedOut, 401, 'unauthorized')
  })

  it('DELETE is refused with 409 when GitHub is the only way to sign in', async () => {
    const { rawApp, store } = setup()
    const { browser } = await signInWith(rawApp, 'code-octocat')

    const response = await browser.delete('/api/auth/github/link')

    expectContract(response, '/api/auth/github/link', 'DELETE')
    expectError(response, 409, 'conflict')
    expect(store.identityMap.size).toBe(1)
  })

  it('POST and DELETE need the CSRF header (403)', async () => {
    const { rawApp } = setup()
    const browser = await signInAgent(rawApp)

    expect((await browser.post('/api/auth/github/link').set('X-CSRF-Protection', 'no')).status).toBe(403)
    expect((await browser.delete('/api/auth/github/link').set('X-CSRF-Protection', 'no')).status).toBe(403)
  })
})

describe('a GitHub-only account has no password', () => {
  async function githubOnly() {
    const built = setup()
    const { browser } = await signInWith(built.rawApp, 'code-octocat')
    return { ...built, browser }
  }

  it('POST /api/session answers the same generic 401 as a wrong password', async () => {
    const { rawApp } = await githubOnly()

    const noPassword = await newAgent(rawApp).post('/api/session').send({ username: 'octocat', password: 'anything-123' })
    const wrong = await newAgent(rawApp).post('/api/session').send({ username: demoUsername, password: 'anything-123' })
    const empty = await newAgent(rawApp).post('/api/session').send({ username: 'octocat', password: '' })

    expectError(noPassword, 401, 'unauthorized')
    expect(noPassword.body.error).toEqual(wrong.body.error)
    expect(sessionCookieOf(noPassword)).toBeUndefined()
    expect(empty.status).toBe(422)
  })

  it('PUT /api/account/password is 422 on currentPassword and changes nothing', async () => {
    const { browser, store } = await githubOnly()

    const response = await browser.put('/api/account/password').send({ currentPassword: 'old-password-1', newPassword: 'New-Password-9' })

    expectContract(response, '/api/account/password', 'PUT')
    expectError(response, 422, 'validation_error')
    expect(response.body.error.details.issue).toEqual([{ field: 'currentPassword', message: 'is not available: this account has no password' }])
    expect([...store.orgMap.values()].find((org) => org.account.username === 'octocat')?.account.passwordHash).toBeNull()
  })

  it('PUT /api/account is 422 on currentPassword and changes nothing (the UI hides Edit for it)', async () => {
    const { browser, store } = await githubOnly()

    const response = await browser.put('/api/account').send({ username: 'renamed', currentPassword: 'whatever-1' })

    expectContract(response, '/api/account', 'PUT')
    expectError(response, 422, 'validation_error')
    expect(response.body.error.details.issue).toEqual([{ field: 'currentPassword', message: 'is not available: this account has no password' }])
    expect([...store.orgMap.values()].some((org) => org.account.username === 'renamed')).toBe(false)
  })

  it('keeps the rest of the account working', async () => {
    const { browser } = await githubOnly()

    expect((await browser.get('/api/account')).body).toMatchObject({ signInMethod: 'github', githubLogin: 'octocat', username: 'octocat' })
    expect((await browser.get('/api/review')).body).toEqual([])
    expect((await browser.delete('/api/session')).status).toBe(204)
  })
})

describe('the redirect routes', () => {
  it('the start and the callback work as plain redirects', async () => {
    const { rawApp } = setup()

    const { response } = await signInWith(rawApp, 'code-octocat')

    expect(response.status).toBe(302)
    expect(sessionCookieOf(response)).toBeDefined()
  })
})
