import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import { createMemoryStore } from '../src/store/memory-store.js'
import { buildApp, demoPassword, demoUsername, fixedNow, frontendUrl, newAgent, sessionCookieOf, signInAgent } from './helper/app.js'
import { expectContract, expectError } from './helper/contract.js'

// Plan 028, Scope 1 and 3: sign in, session restore and sign out against the real routes.

const hour = 60 * 60 * 1000
const minute = 60 * 1000

function clockApp(start = fixedNow) {
  const clock = { now: start }
  const { rawApp, store } = buildApp({ now: () => clock.now })
  return { rawApp, store, clock }
}

function cookieValueOf(line: string | undefined): string {
  return (line ?? '').split(';')[0] ?? ''
}

describe('POST /api/session', () => {
  it('signs in with 200, the account and an HttpOnly, SameSite=Lax cookie with no Secure in development', async () => {
    const { rawApp, store } = buildApp()

    const response = await newAgent(rawApp).post('/api/session').send({ username: demoUsername, password: demoPassword })

    expectContract(response, '/api/session', 'POST')
    expect(response.status).toBe(200)
    expect(response.body).toEqual({ username: 'john.doe', fullName: 'John Doe', email: 'john@company.com', avatarUrl: null, memberSince: 'March 12, 2025', signInMethod: 'password', githubLogin: null })
    const cookie = sessionCookieOf(response)
    expect(cookie).toMatch(/^cr_session=[A-Za-z0-9_-]{43}; Max-Age=604800; Path=\/; Expires=[^;]+; HttpOnly; SameSite=Lax$/)
    expect(cookie).not.toMatch(/Secure/)
    // Only the hash is stored, never the id.
    const id = cookieValueOf(cookie).slice('cr_session='.length)
    expect([...store.sessionMap.keys()]).toHaveLength(1)
    expect(JSON.stringify([...store.sessionMap])).not.toContain(id)
    expect([...store.sessionMap.keys()][0]).toMatch(/^[0-9a-f]{64}$/)
  })

  it('matches the user name regardless of case and trims it', async () => {
    const { rawApp } = buildApp()

    const response = await newAgent(rawApp).post('/api/session').send({ username: '  John.DOE ', password: demoPassword })

    expect(response.status).toBe(200)
  })

  it('uses Secure and the __Host- name with NODE_ENV=production', async () => {
    const app = createApp({ frontendUrl, enableTestRoute: false, production: true }, { store: createMemoryStore(), securityLogger: { info: () => undefined, warn: () => undefined } })

    const response = await newAgent(app).post('/api/session').send({ username: demoUsername, password: demoPassword })
    const header = response.headers['set-cookie'] as unknown as string[]

    expect(response.status).toBe(200)
    expect(header[0]).toMatch(/^__Host-cr_session=[A-Za-z0-9_-]{43}; Max-Age=604800; Path=\/; Expires=[^;]+; HttpOnly; Secure; SameSite=Lax$/)
  })

  it('answers a wrong password and an unknown user with the identical 401 body', async () => {
    const { rawApp } = buildApp()

    const wrong = await newAgent(rawApp).post('/api/session').send({ username: demoUsername, password: 'not-the-password-1' })
    const unknown = await newAgent(rawApp).post('/api/session').send({ username: 'nobody.here', password: 'not-the-password-1' })

    for (const response of [wrong, unknown]) {
      expectError(response, 401, 'unauthorized')
      expectContract(response, '/api/session', 'POST')
      expect(response.headers['set-cookie']).toBeUndefined()
      expect(response.text).not.toContain('not-the-password-1')
    }
    expect(wrong.body.error).toEqual(unknown.body.error)
    expect(wrong.body.error.message).toBe('Incorrect user name or password.')
  })

  it.each([
    ['an unknown field', { username: demoUsername, password: demoPassword, remember: true }],
    ['a missing password', { username: demoUsername }],
    ['an empty user name', { username: '   ', password: demoPassword }],
    ['a user name over 64 characters', { username: 'u'.repeat(65), password: demoPassword }],
    ['a password over 200 characters', { username: demoUsername, password: `${demoPassword}${'x'.repeat(200)}` }]
  ])('answers 422 for %s, never echoing the password', async (_label, body) => {
    const { rawApp } = buildApp()

    const response = await newAgent(rawApp).post('/api/session').send(body)

    expectError(response, 422, 'validation_error')
    expectContract(response, '/api/session', 'POST')
    expect(response.text).not.toContain(demoPassword)
  })

  it('rotates: a session id sent with the sign-in is discarded and the new id differs', async () => {
    const { rawApp } = buildApp()
    const first = await newAgent(rawApp).post('/api/session').send({ username: demoUsername, password: demoPassword })
    const old = cookieValueOf(sessionCookieOf(first))

    const second = await request(rawApp).post('/api/session').set('X-CSRF-Protection', '1').set('cookie', old)
      .send({ username: demoUsername, password: demoPassword })

    const renewed = cookieValueOf(sessionCookieOf(second))
    expect(second.status).toBe(200)
    expect(renewed).not.toBe(old)
    expectError(await request(rawApp).get('/api/account').set('cookie', old), 401, 'unauthorized')
    expect((await request(rawApp).get('/api/account').set('cookie', renewed)).status).toBe(200)
  })

  it('sweeps expired sessions on each sign-in', async () => {
    const { rawApp, store, clock } = clockApp()
    await signInAgent(rawApp)
    clock.now += 9 * hour

    await signInAgent(rawApp)

    expect(store.sessionMap.size).toBe(1)
  })
})

describe('GET /api/session', () => {
  it('restores the session: 200 with the account and the idle expiry', async () => {
    const { rawApp } = buildApp()
    const agent = await signInAgent(rawApp)

    const response = await agent.get('/api/session')

    expectContract(response, '/api/session', 'GET')
    expect(response.body).toEqual({
      account: { username: 'john.doe', fullName: 'John Doe', email: 'john@company.com', avatarUrl: null, memberSince: 'March 12, 2025', signInMethod: 'password', githubLogin: null },
      expiresAt: new Date(fixedNow + 8 * hour).toISOString()
    })
  })

  it('answers 401 without a cookie, with a tampered id and with an unknown id, and never sets a cookie', async () => {
    const { rawApp } = buildApp()
    const agent = await signInAgent(rawApp)
    const good = (await agent.get('/api/session')).status

    for (const cookie of [undefined, 'cr_session=tampered!', `cr_session=${'A'.repeat(43)}`, 'cr_session=']) {
      const pending = request(rawApp).get('/api/session')
      const response = await (cookie ? pending.set('cookie', cookie) : pending)
      expectError(response, 401, 'unauthorized')
      expectContract(response, '/api/session', 'GET')
      expect(response.headers['set-cookie']).toBeUndefined()
    }
    expect(good).toBe(200)
  })

  it('rolls the idle expiry (written at most once a minute) and ends after 8 idle hours', async () => {
    const { rawApp, store, clock } = clockApp()
    const agent = await signInAgent(rawApp)
    const [session] = [...store.sessionMap.values()]

    clock.now += 30 * 1000
    await agent.get('/api/session')
    expect(store.sessionMap.get(session?.idHash ?? '')?.lastSeenAt).toBe(fixedNow)

    clock.now = fixedNow + 7 * hour
    expect((await agent.get('/api/session')).body.expiresAt).toBe(new Date(fixedNow + 15 * hour).toISOString())
    expect(store.sessionMap.get(session?.idHash ?? '')?.lastSeenAt).toBe(fixedNow + 7 * hour)

    clock.now = fixedNow + 15 * hour - minute
    expect((await agent.get('/api/account')).status).toBe(200)

    clock.now += 8 * hour + minute
    expectError(await agent.get('/api/account'), 401, 'unauthorized')
    // Expired sessions are deleted when read.
    expect(store.sessionMap.size).toBe(0)
  })

  it('ends 7 days after sign-in even when used every hour', async () => {
    const { rawApp, clock } = clockApp()
    const agent = await signInAgent(rawApp)

    for (let hourCount = 1; hourCount < 7 * 24; hourCount += 1) {
      clock.now = fixedNow + hourCount * hour
      if ((await agent.get('/api/session')).status !== 200) expect.fail(`ended early at hour ${hourCount}`)
    }
    clock.now = fixedNow + 7 * 24 * hour

    expectError(await agent.get('/api/session'), 401, 'unauthorized')
  })
})

describe('DELETE /api/session', () => {
  it('signs out with 204, clears the cookie (Max-Age=0) and the same cookie then gets 401', async () => {
    const { rawApp, store } = buildApp()
    const agent = newAgent(rawApp)
    const signIn = await agent.post('/api/session').send({ username: demoUsername, password: demoPassword })
    const cookie = cookieValueOf(sessionCookieOf(signIn))

    const response = await agent.delete('/api/session')

    expectContract(response, '/api/session', 'DELETE')
    expect(response.status).toBe(204)
    expect(sessionCookieOf(response)).toMatch(/^cr_session=; Max-Age=0; Path=\/; Expires=[^;]+; HttpOnly; SameSite=Lax$/)
    expect(store.sessionMap.size).toBe(0)
    expectError(await request(rawApp).get('/api/review').set('cookie', cookie), 401, 'unauthorized')
    expectError(await request(rawApp).get('/api/session').set('cookie', cookie), 401, 'unauthorized')
  })

  it('ends only that session', async () => {
    const { rawApp } = buildApp()
    const first = await signInAgent(rawApp)
    const second = await signInAgent(rawApp)

    await first.delete('/api/session')

    expect((await second.get('/api/account')).status).toBe(200)
  })

  it('answers 401 without a session and 403 without the CSRF header', async () => {
    const { rawApp } = buildApp()
    const agent = await signInAgent(rawApp)

    const noSession = await newAgent(rawApp).delete('/api/session')
    const noHeader = await request(rawApp).delete('/api/session')

    expectError(noSession, 401, 'unauthorized')
    expectContract(noSession, '/api/session', 'DELETE')
    expectError(noHeader, 403, 'forbidden')
    expect((await agent.get('/api/account')).status).toBe(200)
  })
})
