import request from 'supertest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp } from '../src/app.js'
import { loadConfig } from '../src/config.js'
import { createMemoryStore } from '../src/store/memory-store.js'
import { csrfHeader, demoPassword, demoUsername, fixedNow, frontendUrl, registrationOf, sessionCookieName, sessionCookieOf } from './helper/app.js'
import { expectContract, expectError } from './helper/contract.js'

// Plan 047 (contract 0.18.0): the bearer-token session fallback. Validation items 1-7.

const tokenPattern = /^[A-Za-z0-9_-]{43}$/
const modeHeader = 'X-Session-Mode'
const wrongToken = 'A'.repeat(43)

function buildTokenApp(sessionTokenFallback: boolean, logger = { info: () => undefined, warn: () => undefined }) {
  const store = createMemoryStore()
  const app = createApp({ frontendUrl, enableTestRoute: false, sessionTokenFallback }, { store, now: () => fixedNow, securityLogger: logger })
  return { app, store }
}

type App = ReturnType<typeof buildTokenApp>['app']

function signIn(app: App, mode = true) {
  const call = request(app).post('/api/session').set(csrfHeader, '1')
  return (mode ? call.set(modeHeader, 'token') : call).send({ username: demoUsername, password: demoPassword })
}

async function tokenOf(app: App): Promise<string> {
  const response = await signIn(app)
  expect(response.status).toBe(200)
  return response.body.sessionToken as string
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('SESSION_TOKEN_FALLBACK setting (item 1)', () => {
  const base = { PORT: '3001', FRONTEND_URL: frontendUrl }

  it('defaults to off, accepts on and off, and refuses anything else without echoing it', () => {
    expect(loadConfig(base).sessionTokenFallback).toBe(false)
    expect(loadConfig({ ...base, SESSION_TOKEN_FALLBACK: '' }).sessionTokenFallback).toBe(false)
    expect(loadConfig({ ...base, SESSION_TOKEN_FALLBACK: 'off' }).sessionTokenFallback).toBe(false)
    expect(loadConfig({ ...base, SESSION_TOKEN_FALLBACK: 'on' }).sessionTokenFallback).toBe(true)
    expect(() => loadConfig({ ...base, SESSION_TOKEN_FALLBACK: 'maybe-secret-value' })).toThrow(/SESSION_TOKEN_FALLBACK/)
    try {
      loadConfig({ ...base, SESSION_TOKEN_FALLBACK: 'maybe-secret-value' })
    } catch (error) {
      expect((error as Error).message).not.toContain('maybe-secret-value')
    }
  })

  it('switch off: X-Session-Mode: token returns no sessionToken on sign-in or register', async () => {
    const { app } = buildTokenApp(false)

    const signedIn = await signIn(app)
    const registered = await request(app).post('/api/account').set(csrfHeader, '1').set(modeHeader, 'token').send(registrationOf('offuser'))

    expect(signedIn.status).toBe(200)
    expect(signedIn.body).not.toHaveProperty('sessionToken')
    expectContract(signedIn, '/api/session', 'POST')
    expect(registered.status).toBe(201)
    expect(registered.body).not.toHaveProperty('sessionToken')
    expect(sessionCookieOf(signedIn)).toBeDefined()
  })

  it('switch off: a bearer token is still accepted (the switch only controls issuing)', async () => {
    const { app, store } = buildTokenApp(true)
    const token = await tokenOf(app)
    const off = createApp({ frontendUrl, enableTestRoute: false, sessionTokenFallback: false }, { store, now: () => fixedNow })

    expect((await request(off).get('/api/dashboard').set('Authorization', `Bearer ${token}`)).status).toBe(200)
  })
})

describe('issuing the token (item 2)', () => {
  it('sign-in returns a 43-character URL-safe sessionToken that equals the cookie value', async () => {
    const { app } = buildTokenApp(true)

    const response = await signIn(app)

    expect(response.status).toBe(200)
    expect(response.body.sessionToken).toMatch(tokenPattern)
    expect(sessionCookieOf(response)).toContain(`${sessionCookieName}=${response.body.sessionToken}`)
    expect(response.body.username).toBe(demoUsername)
    expectContract(response, '/api/session', 'POST')
  })

  it('register returns a sessionToken that is a working session', async () => {
    const { app } = buildTokenApp(true)

    const response = await request(app).post('/api/account').set(csrfHeader, '1').set(modeHeader, 'token').send(registrationOf('tokenuser'))

    expect(response.status).toBe(201)
    expect(response.body.sessionToken).toMatch(tokenPattern)
    expect(response.headers['cache-control']).toBe('no-store')
    expectContract(response, '/api/account', 'POST')
    const restored = await request(app).get('/api/session').set('Authorization', `Bearer ${response.body.sessionToken}`)
    expect(restored.status).toBe(200)
    expect(restored.body.account.username).toBe('tokenuser')
  })

  it('without the header there is no token; any other header value is ignored', async () => {
    const { app } = buildTokenApp(true)

    const none = await signIn(app, false)
    const other = await request(app).post('/api/session').set(csrfHeader, '1').set(modeHeader, 'cookie').send({ username: demoUsername, password: demoPassword })
    const register = await request(app).post('/api/account').set(csrfHeader, '1').send(registrationOf('plainuser'))

    for (const response of [none, other, register]) {
      expect(response.body).not.toHaveProperty('sessionToken')
      expect(String(response.headers['cache-control'] ?? '')).not.toContain('no-store')
    }
    expect(register.status).toBe(201)
  })

  it('a failed sign-in returns no token and the same 401 as before', async () => {
    const { app } = buildTokenApp(true)

    const response = await request(app).post('/api/session').set(csrfHeader, '1').set(modeHeader, 'token').send({ username: demoUsername, password: 'wrong-password-1' })

    expectError(response, 401, 'unauthorized')
    expect(JSON.stringify(response.body)).not.toContain('sessionToken')
  })
})

describe('accepting the bearer token (items 3, 4)', () => {
  it('authorises protected routes with no cookie', async () => {
    const { app } = buildTokenApp(true)
    const token = await tokenOf(app)

    const review = await request(app).get('/api/review').set('Authorization', `Bearer ${token}`)
    const account = await request(app).get('/api/account').set('Authorization', `Bearer ${token}`)
    const restored = await request(app).get('/api/session').set('Authorization', `Bearer ${token}`)

    expect(review.status).toBe(200)
    expect(account.status).toBe(200)
    expect(restored.status).toBe(200)
    expect(restored.body.account.username).toBe(demoUsername)
  })

  it.each([
    ['a wrong token', wrongToken],
    ['a short token', 'abc'],
    ['a token with bad characters', `${'A'.repeat(42)}!`],
    ['a token that is too long', 'A'.repeat(44)],
    ['an empty token', '']
  ])('%s is the generic 401', async (_name, value) => {
    const { app } = buildTokenApp(true)

    const response = await request(app).get('/api/review').set('Authorization', `Bearer ${value}`)

    expectError(response, 401, 'unauthorized')
    expect(JSON.stringify(response.body)).not.toContain(value === '' ? 'Bearer' : value)
  })

  it('other schemes and a missing token are no session', async () => {
    const { app } = buildTokenApp(true)
    const token = await tokenOf(app)

    for (const header of [`Basic ${token}`, token, `bearer${token}`]) {
      expectError(await request(app).get('/api/review').set('Authorization', header), 401, 'unauthorized')
    }
  })

  it('accepts the scheme in any letter case', async () => {
    const { app } = buildTokenApp(true)
    const token = await tokenOf(app)

    expect((await request(app).get('/api/review').set('Authorization', `bearer ${token}`)).status).toBe(200)
  })

  it('an expired token is 401', async () => {
    const store = createMemoryStore()
    let clock = fixedNow
    const app = createApp({ frontendUrl, enableTestRoute: false, sessionTokenFallback: true }, { store, now: () => clock })
    const token = await tokenOf(app)

    clock += 8 * 60 * 60 * 1000 + 1000

    expectError(await request(app).get('/api/review').set('Authorization', `Bearer ${token}`), 401, 'unauthorized')
  })

  it('DELETE /api/session with the bearer token signs out, and the token then gets 401', async () => {
    const { app } = buildTokenApp(true)
    const token = await tokenOf(app)

    const out = await request(app).delete('/api/session').set(csrfHeader, '1').set('Authorization', `Bearer ${token}`)

    expect(out.status).toBe(204)
    expectError(await request(app).get('/api/review').set('Authorization', `Bearer ${token}`), 401, 'unauthorized')
    expectError(await request(app).get('/api/session').set('Authorization', `Bearer ${token}`), 401, 'unauthorized')
  })
})

describe('bearer versus cookie (item 5)', () => {
  it('the bearer token wins over a stale cookie', async () => {
    const { app } = buildTokenApp(true)
    const token = await tokenOf(app)

    const response = await request(app).get('/api/review').set('Cookie', `${sessionCookieName}=${wrongToken}`).set('Authorization', `Bearer ${token}`)

    expect(response.status).toBe(200)
  })

  it('an invalid bearer token with a valid cookie is 401 (no silent fallback to the cookie)', async () => {
    const { app } = buildTokenApp(true)
    const cookieValue = await tokenOf(app)

    const guarded = await request(app).get('/api/review').set('Cookie', `${sessionCookieName}=${cookieValue}`).set('Authorization', `Bearer ${wrongToken}`)
    const restore = await request(app).get('/api/session').set('Cookie', `${sessionCookieName}=${cookieValue}`).set('Authorization', `Bearer ${wrongToken}`)
    const malformed = await request(app).get('/api/review').set('Cookie', `${sessionCookieName}=${cookieValue}`).set('Authorization', 'Bearer not-a-token')

    for (const response of [guarded, restore, malformed]) expectError(response, 401, 'unauthorized')
  })

  it('the cookie alone still works', async () => {
    const { app } = buildTokenApp(true)
    const cookieValue = await tokenOf(app)

    expect((await request(app).get('/api/review').set('Cookie', `${sessionCookieName}=${cookieValue}`)).status).toBe(200)
  })

  it('signing in with a bearer token sent discards it (no session fixation)', async () => {
    const { app } = buildTokenApp(true)
    const first = await tokenOf(app)

    const second = await request(app).post('/api/session').set(csrfHeader, '1').set(modeHeader, 'token').set('Authorization', `Bearer ${first}`).send({ username: demoUsername, password: demoPassword })

    expect(second.status).toBe(200)
    expect(second.body.sessionToken).not.toBe(first)
  })
})

describe('CORS and CSRF with a bearer token (item 6)', () => {
  it('the preflight allows Authorization and X-Session-Mode for FRONTEND_URL', async () => {
    const { app } = buildTokenApp(true)

    const response = await request(app)
      .options('/api/session')
      .set('Origin', frontendUrl)
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'authorization,x-session-mode,x-csrf-protection,content-type')

    expect(response.status).toBeLessThan(300)
    expect(response.headers['access-control-allow-origin']).toBe(frontendUrl)
    expect(response.headers['access-control-allow-credentials']).toBe('true')
    const allowed = String(response.headers['access-control-allow-headers']).toLowerCase()
    for (const name of ['authorization', 'x-session-mode', 'x-csrf-protection', 'content-type']) expect(allowed).toContain(name)
  })

  it('a foreign Origin still gets no CORS header', async () => {
    const { app } = buildTokenApp(true)

    const response = await request(app)
      .options('/api/session')
      .set('Origin', 'http://evil.example')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'authorization,x-session-mode')

    expect(response.headers['access-control-allow-origin']).toBeUndefined()
    expect(response.headers['access-control-allow-headers']).toBeUndefined()
  })

  it('a state-changing request with a bearer token still needs the CSRF header and the Origin', async () => {
    const { app } = buildTokenApp(true)
    const token = await tokenOf(app)
    const body = { source_type: 'snippet', language: 'Go', content: 'x' }

    const noHeader = await request(app).post('/api/review').set('Authorization', `Bearer ${token}`).send(body)
    const foreign = await request(app).post('/api/review').set(csrfHeader, '1').set('Origin', 'http://evil.example').set('Authorization', `Bearer ${token}`).send(body)
    const allowed = await request(app).post('/api/review').set(csrfHeader, '1').set('Origin', frontendUrl).set('Authorization', `Bearer ${token}`).send(body)

    expectError(noHeader, 403, 'forbidden')
    expectError(foreign, 403, 'forbidden')
    expect(allowed.status).toBe(202)
  })
})

describe('the token is never logged or echoed (item 7)', () => {
  it('a full sign-in, a use and a failed request leave no token in logs, bodies or URLs', async () => {
    const lines: string[] = []
    const capture = (...arg: unknown[]) => void lines.push(arg.map(String).join(' '))
    const spies = [vi.spyOn(console, 'log'), vi.spyOn(console, 'info'), vi.spyOn(console, 'warn'), vi.spyOn(console, 'error'), vi.spyOn(console, 'debug')]
    for (const spy of spies) spy.mockImplementation(capture)
    const { app } = buildTokenApp(true, { info: capture, warn: capture })

    const response = await signIn(app)
    const token = response.body.sessionToken as string
    const ok = await request(app).get('/api/review').set('Authorization', `Bearer ${token}`)
    const bad = await request(app).get('/api/review').set('Authorization', `Bearer ${wrongToken}`)
    const wrongPassword = await request(app).post('/api/session').set(csrfHeader, '1').set(modeHeader, 'token').send({ username: demoUsername, password: 'wrong-password-1' })
    await request(app).delete('/api/session').set(csrfHeader, '1').set('Authorization', `Bearer ${token}`)
    const afterSignOut = await request(app).get('/api/review').set('Authorization', `Bearer ${token}`)

    const output = lines.join('\n')
    expect(lines.length).toBeGreaterThan(0)
    expect(output).not.toContain(token)
    expect(output).not.toContain(wrongToken)
    expect(output.toLowerCase()).not.toContain('bearer')
    expect(output.toLowerCase()).not.toContain('authorization')
    for (const item of [ok, bad, wrongPassword, afterSignOut]) {
      expect(JSON.stringify(item.body)).not.toContain(token)
      expect(JSON.stringify(item.body)).not.toContain(wrongToken)
      expect(item.headers.location ?? '').not.toContain(token)
    }
  })
})
