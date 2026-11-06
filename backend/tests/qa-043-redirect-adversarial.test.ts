import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import { loadConfig } from '../src/config.js'
import { createFakeGithubSignInClient, type FakeProfileTable } from '../src/lib/github-signin-fake.js'
import { createMemoryStore } from '../src/store/memory-store.js'
import { newAgent, signInAgent } from './helper/app.js'

// QA of plan 043: try to leave the frontend origin or base by any redirect route.

const oauth = { clientId: 'test-client-id', clientSecret: 'canary-client-secret-7f3a', redirectUrl: 'http://localhost:3001/api/auth/github/callback' }
const table: FakeProfileTable = {
  'code-octocat': { id: '583231', login: 'octocat', name: 'The Octocat', email: 'octocat@example.com', emailVerified: true },
  'code-linker': { id: '999', login: 'linker', name: null, email: 'linker@example.com', emailVerified: true }
}
const silent = { info: () => undefined, warn: () => undefined }

function makeApp(frontendUrl: string) {
  return createApp(
    { frontendUrl, enableTestRoute: false, githubOAuth: oauth },
    { store: createMemoryStore(), securityLogger: silent, githubSignInClient: createFakeGithubSignInClient(table) }
  )
}

async function landing(frontendUrl: string, returnTo: string): Promise<string> {
  const browser = newAgent(makeApp(frontendUrl))
  const started = await browser.get('/api/auth/github').query({ returnTo })
  const state = new URL(started.headers.location as string).searchParams.get('state') ?? ''
  const response = await browser.get('/api/auth/github/callback').query({ code: 'code-octocat', state })
  expect(response.status).toBe(302)
  return response.headers.location as string
}

const hostile = [
  '//evil.example', '///evil.example', '/\\evil.example', '/\t/evil.example', '/ /evil.example', '/\n/evil.example',
  '/\r\nSet-Cookie: x=1', '/é', '/‮', '/ ', '/\u0085', '/​', 'https://evil.example', 'evil.example', '',
  '/%2e%2e/%2e%2e/evil', '/%2E%2E/evil', '/.%2e/evil', '/%2e./evil', '/..', '/../', '/a/../../evil', '/a/%2e%2e/%2e%2e/evil',
  '/%252e%252e/evil', '/%2f%2fevil.example', '/%5c%5cevil.example', '/%5cevil.example', '/..%2fevil', '/..;/evil',
  '/repo', '/repo/', '/repo/../evil', '/repo/%2e%2e/evil', '/@evil.example', '/:evil', '/?next=//evil.example', '/#//evil.example',
  `/${'a'.repeat(511)}`, `/${'a'.repeat(512)}`, '/\u0000', '/\u007f'
]

describe('QA 043: no returnTo leaves the frontend origin or base', () => {
  it.each([
    ['https://user.github.io/repo', 'https://user.github.io', '/repo'],
    ['https://user.github.io/a/b/', 'https://user.github.io', '/a/b'],
    ['http://localhost:5173', 'http://localhost:5173', '']
  ])('%s', async (frontendUrl, origin, base) => {
    for (const value of hostile) {
      const location = await landing(frontendUrl, value)
      const url = new URL(location)
      expect(url.origin, JSON.stringify(value)).toBe(origin)
      // Inside the base: the path is the base itself or under it (never a sibling such as /repository).
      if (base !== '') expect(url.pathname === `${base}/` || url.pathname.startsWith(`${base}/`), `${JSON.stringify(value)} -> ${location}`).toBe(true)
      expect(location).not.toMatch(/[\r\n]/)
      expect(url.username + url.password).toBe('')
    }
  })

  it('a base that looks like a prefix of another path cannot be escaped to a sibling', async () => {
    const location = await landing('https://user.github.io/repo', '/../repository/x')
    expect(location).toBe('https://user.github.io/repo/')
  })

  it('the link flow ignores a hostile returnTo and stays on the settings page inside the base', async () => {
    const app = makeApp('https://user.github.io/repo')
    const linker = await signInAgent(app)
    const started = await linker.post('/api/auth/github/link').send({ returnTo: '//evil.example' })
    expect(started.status).toBe(200)
    const state = new URL(started.body.url).searchParams.get('state') ?? ''
    const response = await linker.get('/api/auth/github/callback').query({ code: 'code-linker', state })
    expect(response.headers.location).toBe('https://user.github.io/repo/settings?section=account')
  })

  it('failure paths with hostile query values stay inside the base', async () => {
    const app = makeApp('https://user.github.io/repo')
    for (const query of [{ error: '//evil.example', state: 'x' }, { error: 'access_denied\r\nX: y', state: 'x' }, { code: 'bad', state: '../..' }, {}]) {
      const response = await request(app).get('/api/auth/github/callback').query(query)
      expect(response.status).toBe(302)
      const url = new URL(response.headers.location as string)
      expect(url.origin).toBe('https://user.github.io')
      expect(url.pathname).toBe('/repo/login')
    }
  })
})

describe('QA 043: odd FRONTEND_URL values', () => {
  const required = { PORT: '4000' }
  const message = (frontendUrl: string): string => {
    try {
      loadConfig({ ...required, FRONTEND_URL: frontendUrl })
      return ''
    } catch (error) {
      return (error as Error).message
    }
  }

  it.each(['https://u.github.io/repo?', 'https://u.github.io/repo#', 'https://u.github.io/repo/?a=1', 'https://u.github.io/#x'])('refuses %s', (value) => {
    expect(message(value)).toMatch(/FRONTEND_URL/)
  })

  it('uppercase host and scheme: origin and base are normalised', async () => {
    expect(loadConfig({ ...required, FRONTEND_URL: 'HTTPS://User.GitHub.IO/Repo' }).frontendUrl).toBeTruthy()
    const location = await landing('HTTPS://User.GitHub.IO/Repo', '/x')
    expect(location).toBe('https://user.github.io/Repo/x')
  })

  it('userinfo never reaches a redirect', async () => {
    const location = await landing('https://name:pw@user.github.io/repo', '/x')
    expect(location).toBe('https://user.github.io/repo/x')
  })

  it('records what is accepted today for a non-http scheme (observation, not a requirement)', () => {
    for (const value of ['ftp://u.example/repo', 'javascript:alert(1)']) {
      let outcome = 'accepted'
      try {
        loadConfig({ ...required, FRONTEND_URL: value })
      } catch {
        outcome = 'refused'
      }
      console.info(`QA043 FRONTEND_URL ${value} -> ${outcome}`)
    }
    expect(true).toBe(true)
  })

  it('an encoded or dotted path in FRONTEND_URL still redirects inside one origin', async () => {
    for (const value of ['https://u.github.io/a/../b', 'https://u.github.io/%2e%2e/b', 'https://u.github.io/a%2fb', 'https://u.github.io/a b']) {
      const location = await landing(value, '/x')
      expect(new URL(location).origin, value).toBe('https://u.github.io')
    }
  })
})
