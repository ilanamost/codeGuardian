import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import { createMemoryStore } from '../src/store/memory-store.js'
import { csrfHeader, demoPassword, demoUsername, fixedNow, frontendUrl, sessionCookieName } from './helper/app.js'
import { expectError } from './helper/contract.js'

// QA plan 047: try to break the bearer-token fallback.

const logs: string[] = []
const capture = (...arg: unknown[]) => void logs.push(arg.map((item) => JSON.stringify(item)).join(' '))

function build() {
  return createApp({ frontendUrl, enableTestRoute: false, sessionTokenFallback: true }, { store: createMemoryStore(), now: () => fixedNow, securityLogger: { info: capture, warn: capture } })
}

type App = ReturnType<typeof build>

async function signIn(app: App) {
  return request(app).post('/api/session').set(csrfHeader, '1').set('X-Session-Mode', 'token').send({ username: demoUsername, password: demoPassword })
}

describe('QA 048: malformed and hostile Authorization headers', () => {
  it.each([
    ['trailing text', (t: string) => `Bearer ${t} extra`],
    ['two tokens', (t: string) => `Bearer ${t},Bearer ${t}`],
    ['token with a suffix', (t: string) => `Bearer ${t}A`],
    ['token minus a char', (t: string) => `Bearer ${t.slice(1)}`],
    ['lowercase-scheme glued', (t: string) => `bearer${t}`]
  ])('%s is the generic 401 and never echoes the value', async (_name, build_) => {
    const app = build()
    const token = (await signIn(app)).body.sessionToken as string
    const header = build_(token)

    const response = await request(app).get('/api/review').set('Authorization', header)

    expectError(response, 401, 'unauthorized')
    expect(JSON.stringify(response.body)).not.toContain(token.slice(1, 20))
  })

  it('a 64 KB Authorization header is refused without echoing it', async () => {
    const app = build()
    const big = `Bearer ${'A'.repeat(64 * 1024)}`

    // Node refuses an oversized header (431 or a reset socket); it must never be a session.
    let status = 431
    let text = ''
    try {
      const response = await request(app).get('/api/review').set('Authorization', big)
      status = response.status
      text = response.text
    } catch {
      status = 431
    }
    expect([401, 431]).toContain(status)
    expect(text).not.toContain('AAAAAAAAAA')
  })

  it('a token in the query string or body is never a credential', async () => {
    const app = build()
    const token = (await signIn(app)).body.sessionToken as string

    for (const url of [`/api/review?sessionToken=${token}`, `/api/review?access_token=${token}`, `/api/review?token=${token}`]) {
      expectError(await request(app).get(url), 401, 'unauthorized')
    }
  })

  it('a token in a custom header is not a credential', async () => {
    const app = build()
    const token = (await signIn(app)).body.sessionToken as string

    expectError(await request(app).get('/api/review').set('X-Session-Token', token), 401, 'unauthorized')
  })

  it('a NUL or newline smuggled into the value cannot reach the app as a session', async () => {
    const app = build()
    const token = (await signIn(app)).body.sessionToken as string

    // Node refuses the header itself on the client side; either way no session results.
    let status = 0
    try {
      status = (await request(app).get('/api/review').set('Authorization', `Bearer ${token}\r\nX-Evil: 1`)).status
    } catch {
      status = 401
    }
    expect(status).toBe(401)
  })
})

describe('QA 048: the token stays out of logs and error bodies', () => {
  it('404, 400 and 403 answers with a valid bearer carry no token, and the log has none', async () => {
    logs.length = 0
    const app = build()
    const token = (await signIn(app)).body.sessionToken as string
    const auth = `Bearer ${token}`

    const notFound = await request(app).get(`/api/nope?x=1`).set('Authorization', auth)
    const badBody = await request(app).post('/api/review').set(csrfHeader, '1').set('Origin', frontendUrl).set('Authorization', auth).set('Content-Type', 'application/json').send('{bad json')
    const noCsrf = await request(app).delete('/api/session').set('Authorization', auth)

    for (const item of [notFound, badBody, noCsrf]) {
      expect(item.text).not.toContain(token)
      expect(JSON.stringify(item.headers)).not.toContain(token.slice(0, 30))
    }
    expect(logs.join('\n')).not.toContain(token)
    expect(logs.join('\n').toLowerCase()).not.toContain('bearer')
    // The unauthenticated sign-out was refused by CSRF, so the session still lives.
    expect((await request(app).get('/api/session').set('Authorization', auth)).status).toBe(200)
  })

  // QA finding (fixed): the answer that carries the token is Cache-Control: no-store.
  it('the sign-in answer that carries the token is not cacheable', async () => {
    const app = build()

    const response = await signIn(app)

    const cache = String(response.headers['cache-control'] ?? '').toLowerCase()
    expect(response.body.sessionToken).toBeDefined()
    expect(cache).toContain('no-store')
  })

  it('the cookie stays HttpOnly when a token is also returned', async () => {
    const app = build()

    const response = await signIn(app)

    const cookie = (response.headers['set-cookie'] as unknown as string[]).find((line) => line.startsWith(`${sessionCookieName}=`)) ?? ''
    expect(cookie).toMatch(/HttpOnly/i)
  })
})

describe('QA 048: lifecycle and repetition', () => {
  it('twelve parallel token sign-ins give twelve different tokens, each a working session', async () => {
    const app = build()

    const list = await Promise.all(Array.from({ length: 12 }, () => signIn(app)))
    const tokens = list.map((item) => item.body.sessionToken as string)

    expect(new Set(tokens).size).toBe(12)
    const probe = await Promise.all(tokens.slice(0, 10).map((token) => request(app).get('/api/session').set('Authorization', `Bearer ${token}`)))
    expect(probe.every((item) => item.status === 200)).toBe(true)
  })

  it('signing out twice with the same bearer: the second is 401, not a crash', async () => {
    const app = build()
    const token = (await signIn(app)).body.sessionToken as string
    const out = () => request(app).delete('/api/session').set(csrfHeader, '1').set('Authorization', `Bearer ${token}`)

    expect((await out()).status).toBe(204)
    expectError(await out(), 401, 'unauthorized')
  })

  it('sign-out with a bearer and a different valid cookie ends the bearer session, and the cookie session keeps working (documented stale-cookie behaviour)', async () => {
    const app = build()
    const first = (await signIn(app)).body.sessionToken as string
    const second = (await signIn(app)).body.sessionToken as string

    const out = await request(app).delete('/api/session').set(csrfHeader, '1').set('Cookie', `${sessionCookieName}=${second}`).set('Authorization', `Bearer ${first}`)

    expect(out.status).toBe(204)
    expectError(await request(app).get('/api/review').set('Authorization', `Bearer ${first}`), 401, 'unauthorized')
    // Finding candidate: the other session (cookie) is left alive.
    expect((await request(app).get('/api/review').set('Cookie', `${sessionCookieName}=${second}`)).status).toBe(200)
  })

  it('password rate limit still applies to token sign-ins (no bypass through the header)', async () => {
    const app = build()
    let last = 0
    for (let i = 0; i < 40; i += 1) {
      last = (await request(app).post('/api/session').set(csrfHeader, '1').set('X-Session-Mode', 'token').send({ username: demoUsername, password: `wrong-password-${i}` })).status
      if (last === 429) break
    }
    expect(last).toBe(429)
  })

  it('CORS preflight from a foreign origin gets neither the credentials nor the new headers', async () => {
    const app = build()

    const response = await request(app)
      .options('/api/account')
      .set('Origin', 'https://evil.example')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'authorization,x-session-mode')

    expect(response.headers['access-control-allow-origin']).toBeUndefined()
    expect(response.headers['access-control-allow-credentials']).toBeUndefined()
    expect(response.headers['access-control-allow-headers']).toBeUndefined()
  })
})
