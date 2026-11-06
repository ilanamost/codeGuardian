import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import { loadConfig } from '../src/config.js'
import { createFakeGithubSignInClient, type FakeProfileTable } from '../src/lib/github-signin-fake.js'
import { frontendBasePathOf } from '../src/lib/frontend-base.js'
import { createMemoryStore } from '../src/store/memory-store.js'
import { newAgent, signInAgent } from './helper/app.js'

// Plan 043: a path in FRONTEND_URL is the base of the app, and every GitHub sign-in redirect is
// origin + base + app path. The fake GitHub sign-in client keeps everything off the network.

const oauth = { clientId: 'test-client-id', clientSecret: 'canary-client-secret-7f3a', redirectUrl: 'http://localhost:3001/api/auth/github/callback' }
const table: FakeProfileTable = {
  'code-octocat': { id: '583231', login: 'octocat', name: 'The Octocat', email: 'octocat@example.com', emailVerified: true },
  'code-linker': { id: '999', login: 'linker', name: null, email: 'linker@example.com', emailVerified: true },
  'code-unverified': { id: '77', login: 'quiet-user', name: null, email: null, emailVerified: false }
}
const silent = { info: () => undefined, warn: () => undefined }

function makeApp(frontendUrl: string) {
  return createApp(
    { frontendUrl, enableTestRoute: false, githubOAuth: oauth },
    { store: createMemoryStore(), securityLogger: silent, githubSignInClient: createFakeGithubSignInClient(table) }
  )
}

type Browser = ReturnType<typeof newAgent>

async function begin(browser: Browser, returnTo?: string) {
  const response = await browser.get('/api/auth/github').query(returnTo === undefined ? {} : { returnTo })
  expect(response.status).toBe(302)
  return new URL(response.headers.location as string).searchParams.get('state') ?? ''
}

async function locationOf(response: request.Response): Promise<string> {
  expect(response.status).toBe(302)
  return response.headers.location as string
}

// Every redirect the sign-in can make, each as the Location header the browser receives.
async function redirectTable(frontendUrl: string, returnTo = '/review?x=1') {
  const app = makeApp(frontendUrl)
  const callback = (browser: Browser, query: Record<string, string>) => browser.get('/api/auth/github/callback').query(query)

  // A new GitHub user: the account is created. With and without returnTo.
  const created = newAgent(app)
  const createdLocation = await locationOf(await callback(created, { code: 'code-octocat', state: await begin(created, returnTo) }))

  // A returning GitHub user, with returnTo and without.
  const returning = newAgent(app)
  const returningTo = await locationOf(await callback(returning, { code: 'code-octocat', state: await begin(returning, returnTo) }))
  const plain = newAgent(app)
  const plainLocation = await locationOf(await callback(plain, { code: 'code-octocat', state: await begin(plain) }))

  // A login error (bad state), and a provider error from the callback.
  const failing = newAgent(app)
  await begin(failing)
  const badState = await locationOf(await callback(failing, { code: 'code-octocat', state: 'wrong' }))
  const denied = newAgent(app)
  const deniedLocation = await locationOf(await callback(denied, { error: 'access_denied', state: await begin(denied) }))
  const unverified = newAgent(app)
  const unverifiedLocation = await locationOf(await callback(unverified, { code: 'code-unverified', state: await begin(unverified) }))

  // The link flow: the result and an error.
  const linker = await signInAgent(app)
  const linkStarted = await linker.post('/api/auth/github/link')
  expect(linkStarted.status).toBe(200)
  const linkState = new URL(linkStarted.body.url).searchParams.get('state') ?? ''
  const linkError = await locationOf(await callback(linker, { error: 'access_denied', state: linkState }))
  const linkStartedAgain = await linker.post('/api/auth/github/link')
  const linkResult = await locationOf(await callback(linker, { code: 'code-linker', state: new URL(linkStartedAgain.body.url).searchParams.get('state') ?? '' }))

  // The rate-limited redirect.
  const limited = makeApp(frontendUrl)
  for (let index = 0; index < 30; index += 1) await request(limited).get('/api/auth/github')
  const rateLimited = await locationOf(await request(limited).get('/api/auth/github'))

  return { createdLocation, returningTo, plainLocation, badState, deniedLocation, unverifiedLocation, linkError, linkResult, rateLimited }
}

const expectedPath = {
  createdLocation: '/review?x=1',
  returningTo: '/review?x=1',
  plainLocation: '/',
  badState: '/login?auth_error=invalid_state',
  deniedLocation: '/login?auth_error=access_denied',
  unverifiedLocation: '/login?auth_error=email_unverified',
  linkError: '/settings?section=account&auth_error=access_denied',
  linkResult: '/settings?section=account',
  rateLimited: '/login?auth_error=rate_limited'
}

describe('GitHub sign-in redirects over every kind of FRONTEND_URL', () => {
  it.each([
    ['no path', 'http://localhost:5173', 'http://localhost:5173', ''],
    ['no path, trailing slash', 'http://localhost:5173/', 'http://localhost:5173', ''],
    ['a project page', 'https://user.github.io/repo', 'https://user.github.io', '/repo'],
    ['a project page with a trailing slash', 'https://user.github.io/repo/', 'https://user.github.io', '/repo'],
    ['a project page with repeated trailing slashes', 'https://user.github.io/repo//', 'https://user.github.io', '/repo'],
    ['a deeper path', 'https://user.github.io/a/b/', 'https://user.github.io', '/a/b']
  ])('%s: every redirect is origin + base + path, with no double or missing slash', async (_name, frontendUrl, originText, base) => {
    const table = await redirectTable(frontendUrl)

    for (const [key, path] of Object.entries(expectedPath)) {
      const location = table[key as keyof typeof table]
      // For no path this is exactly today's value: origin + path.
      expect(location, key).toBe(`${originText}${base}${path}`)
      expect(location.slice(originText.length)).not.toMatch(/\/\/|^[^/]/)
    }
    // A base never repeats: the path part has the base exactly once.
    if (base !== '') expect(table.plainLocation).toBe(`${originText}${base}/`)
  })

  it('keeps today\'s no-path values byte for byte', async () => {
    const table = await redirectTable('http://localhost:5173')

    expect(table.plainLocation).toBe('http://localhost:5173/')
    expect(table.badState).toBe('http://localhost:5173/login?auth_error=invalid_state')
    expect(table.linkResult).toBe('http://localhost:5173/settings?section=account')
    expect(table.rateLimited).toBe('http://localhost:5173/login?auth_error=rate_limited')
  })
})

describe('returnTo with a base path', () => {
  const frontendUrl = 'https://user.github.io/repo'

  async function landing(returnTo: string): Promise<string> {
    const app = makeApp(frontendUrl)
    const browser = newAgent(app)
    const state = await begin(browser, returnTo)
    return locationOf(await browser.get('/api/auth/github/callback').query({ code: 'code-octocat', state }))
  }

  it('adds the base to a router path and keeps its query', async () => {
    expect(await landing('/review')).toBe('https://user.github.io/repo/review')
    expect(await landing('/history?page=2')).toBe('https://user.github.io/repo/history?page=2')
  })

  it.each([
    ['https://evil.example'],
    ['//evil.example'],
    ['/\\evil.example'],
    ['\\\\evil.example'],
    ['/a b'],
    ['/a\tb'],
    ['/a\u0000b'],
    ['/café'],
    [`/${'a'.repeat(600)}`],
    ['javascript:alert(1)']
  ])('still drops %j and lands on the app root', async (returnTo) => {
    expect(await landing(returnTo)).toBe('https://user.github.io/repo/')
  })

  it('does not double the base, and cannot climb out of it', async () => {
    // The browser sends router paths, so a value that starts with the base text is just a path.
    expect(await landing('/repo/review')).toBe('https://user.github.io/repo/repo/review')
    // Dot segments would resolve to /x or /evil outside the base: the base root instead.
    expect(await landing('/../x')).toBe('https://user.github.io/repo/')
    expect(await landing('/%2e%2e/evil')).toBe('https://user.github.io/repo/')
    expect(await landing('/a/../../x')).toBe('https://user.github.io/repo/')
    // Staying inside the base is fine.
    expect(await landing('/a/../b')).toBe('https://user.github.io/repo/a/../b')
  })

  it('the base never comes from the request', async () => {
    const app = makeApp('http://localhost:5173')
    const browser = newAgent(app)
    const state = await begin(browser, '/review')
    const response = await browser.get('/api/auth/github/callback').query({ code: 'code-octocat', state, base: '/evil', returnTo: '/evil' })
      .set('X-Forwarded-Prefix', '/evil').set('X-Forwarded-Host', 'evil.example')

    expect(await locationOf(response)).toBe('http://localhost:5173/review')
  })
})

describe('FRONTEND_URL start-up validation', () => {
  const required = { PORT: '4000' }

  it('derives the base path', () => {
    expect(frontendBasePathOf('https://user.github.io')).toBe('')
    expect(frontendBasePathOf('https://user.github.io/')).toBe('')
    expect(frontendBasePathOf('https://user.github.io/repo')).toBe('/repo')
    expect(frontendBasePathOf('https://user.github.io/repo/')).toBe('/repo')
  })

  it('starts with no path, with a trailing slash, and with a path', () => {
    for (const frontendUrl of ['http://localhost:5173', 'http://localhost:5173/', 'https://user.github.io/repo', 'https://user.github.io/repo/']) {
      expect(loadConfig({ ...required, FRONTEND_URL: frontendUrl }).frontendUrl).toBe(frontendUrl)
    }
  })

  it.each([
    ['a query', 'https://user.github.io/repo?secret-canary=1'],
    ['a fragment', 'https://user.github.io/repo#secret-canary'],
    ['an empty query', 'https://user.github.io/repo?'],
    ['an empty fragment', 'https://user.github.io/repo#']
  ])('refuses %s, naming FRONTEND_URL and never the value', (_name, frontendUrl) => {
    let message = ''
    try {
      loadConfig({ ...required, FRONTEND_URL: frontendUrl })
    } catch (error) {
      message = (error as Error).message
    }

    expect(message).toMatch(/FRONTEND_URL/)
    expect(message).not.toMatch(/secret-canary|github\.io/)
  })
})

describe('CORS and CSRF with a path in FRONTEND_URL', () => {
  const frontendUrl = 'https://user.github.io/repo'
  const origin = 'https://user.github.io'
  const body = { username: 'john.doe', password: 'mock-password' }

  it('accepts the origin and refuses the origin plus the path, and any other origin', async () => {
    const app = makeApp(frontendUrl)

    const good = await request(app).options('/api/session').set('origin', origin).set('access-control-request-method', 'POST')
    expect(good.headers['access-control-allow-origin']).toBe(origin)
    expect(good.headers['access-control-allow-credentials']).toBe('true')
    for (const other of [frontendUrl, `${frontendUrl}/`, 'https://evil.example', 'null']) {
      const refused = await request(app).options('/api/session').set('origin', other).set('access-control-request-method', 'POST')
      expect(refused.headers['access-control-allow-origin'], other).toBeUndefined()
    }

    expect((await request(app).post('/api/session').set('origin', origin).set('X-CSRF-Protection', '1').send(body)).status).toBe(200)
    expect((await request(app).post('/api/session').set('origin', frontendUrl).set('X-CSRF-Protection', '1').send(body)).status).toBe(403)
    expect((await request(app).post('/api/session').set('origin', 'https://evil.example').set('X-CSRF-Protection', '1').send(body)).status).toBe(403)
  })
})

describe('cookies with a base path', () => {
  it('are the same as without one', async () => {
    const cookieLineOf = async (frontendUrl: string) => {
      const response = await request(makeApp(frontendUrl)).get('/api/auth/github')
      return ((response.headers['set-cookie'] as unknown as string[])[0] ?? '').replace(/=[^;]*;/, '=<value>;').replace(/Expires=[^;]*;/, 'Expires=<date>;')
    }

    expect(await cookieLineOf('https://user.github.io/repo')).toBe(await cookieLineOf('https://user.github.io'))
  })
})
