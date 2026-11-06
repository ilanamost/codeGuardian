import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildApp, fixedNow, newAgent, registrationOf, sessionCookieOf, signInAgent } from './helper/app.js'
import { expectContract, expectError } from './helper/contract.js'

// Plan 028, Scope 2 (Open Question 6, answer A): POST /api/account creates an account with its
// own org and signs it in.

const alice = registrationOf('alice')

describe('POST /api/account (registration)', () => {
  it('creates the account with 201, signs it in, and the new account starts empty', async () => {
    const { rawApp, store } = buildApp()
    const agent = newAgent(rawApp)

    const response = await agent.post('/api/account').send({ ...alice, username: '  alice  ', email: ' Alice@Example.com ' })

    expectContract(response, '/api/account', 'POST')
    expect(response.status).toBe(201)
    expect(response.body).toEqual({ username: 'alice', fullName: 'alice', email: 'alice@example.com', avatarUrl: null, memberSince: 'October 22, 2026', signInMethod: 'password', githubLogin: null })
    expect(sessionCookieOf(response)).toMatch(/^cr_session=[A-Za-z0-9_-]{43}; Max-Age=604800; Path=\/; Expires=[^;]+; HttpOnly; SameSite=Lax$/)
    expect((await agent.get('/api/session')).body.account.username).toBe('alice')
    expect((await agent.get('/api/settings')).body).toEqual(store.state.settings)
    expect((await agent.get('/api/review')).body).toEqual([])
    const dashboard = (await agent.get('/api/dashboard')).body
    expect(dashboard.statList.map((stat: { value: number }) => stat.value)).toEqual([0, 0, 0, 0])
    expect(store.orgMap.size).toBe(2)
  })

  it('stores a scrypt hash, never the password, and signs in with it afterwards', async () => {
    const { rawApp, store } = buildApp()

    await newAgent(rawApp).post('/api/account').send(alice)

    const org = [...store.orgMap.values()].find((item) => item.account.username === 'alice')
    expect(org?.account.passwordHash).toMatch(/^scrypt\$[0-9a-f]+\$[0-9a-f]+$/)
    expect(JSON.stringify([...store.orgMap])).not.toContain(alice.password)
    await signInAgent(rawApp, 'alice', alice.password)
  })

  it('discards a session id sent with the sign-up', async () => {
    const { rawApp } = buildApp()
    const demo = await signInAgent(rawApp)

    const response = await demo.post('/api/account').send(alice)

    expect(response.status).toBe(201)
    expect((await demo.get('/api/account')).body.username).toBe('alice')
  })

  it.each([
    ['the same user name', { ...registrationOf('bob'), username: 'alice' }],
    ['the same user name in other case', { ...registrationOf('bob'), username: 'ALICE' }],
    ['the same email', { ...registrationOf('bob'), email: 'alice@example.com' }],
    ['the same email in other case', { ...registrationOf('bob'), email: 'ALICE@EXAMPLE.COM' }],
    ['the demo user name in other case', { ...registrationOf('bob'), username: 'John.Doe' }],
    ['the demo email', { ...registrationOf('bob'), email: 'john@company.com' }]
  ])('answers 409 with the one generic body for %s, and creates nothing', async (_label, body) => {
    const { rawApp, store } = buildApp()
    await newAgent(rawApp).post('/api/account').send(alice)

    const response = await newAgent(rawApp).post('/api/account').send(body)

    expectError(response, 409, 'conflict')
    expectContract(response, '/api/account', 'POST')
    expect(response.body.error).toEqual({ code: 'conflict', message: 'This user name or email cannot be used.' })
    expect(response.headers['set-cookie']).toBeUndefined()
    expect(store.orgMap.size).toBe(2)
  })

  it.each([
    ['a user name under 3 characters', { ...alice, username: 'al' }, 'username'],
    ['a user name over 32 characters', { ...alice, username: 'a'.repeat(33) }, 'username'],
    ['a user name with a space', { ...alice, username: 'ali ce' }, 'username'],
    ['a user name with a slash', { ...alice, username: 'ali/ce' }, 'username'],
    ['an invalid email', { ...alice, email: 'not-an-email' }, 'email'],
    ['an email over 254 characters', { ...alice, email: `${'a'.repeat(250)}@b.co` }, 'email'],
    ['an unknown field', { ...alice, confirmPassword: alice.password }, 'registration'],
    ['a missing password', { username: 'alice', email: 'alice@example.com' }, 'password']
  ])('answers 422 for %s, with the field, never echoing the password', async (_label, body, field) => {
    const { rawApp, store } = buildApp()

    const response = await newAgent(rawApp).post('/api/account').send(body)

    expectError(response, 422, 'validation_error')
    expectContract(response, '/api/account', 'POST')
    expect(response.body.error.details.issue[0].field).toBe(field)
    expect(response.text).not.toContain(alice.password)
    expect(store.orgMap.size).toBe(1)
  })

  // Open Question 7.
  it.each([
    ['too short', 'abc1', undefined],
    ['no digit', 'only-letters', 'must contain at least one letter and one digit'],
    ['no letter', '12345678901', 'must contain at least one letter and one digit'],
    ['equal to the user name', 'Alice2026', 'must not be the user name or the email'],
    ['equal to the email', 'ALICE2026@example.com', 'must not be the user name or the email'],
    ['a common password', 'Qwerty123', 'is too common']
  ])('answers 422 on password for a password %s', async (_label, password, message) => {
    const { rawApp, store } = buildApp()
    const body = { username: 'alice2026', email: 'alice2026@example.com', password }

    const response = await newAgent(rawApp).post('/api/account').send(body)

    expectError(response, 422, 'validation_error')
    expect(response.body.error.details.issue).toEqual([{ field: 'password', message: message ?? expect.any(String) }])
    expect(response.text).not.toContain(password)
    expect(store.orgMap.size).toBe(1)
  })

  it('needs X-CSRF-Protection (403) and refuses a foreign Origin (403), creating nothing', async () => {
    const { rawApp, store } = buildApp()

    const noHeader = await request(rawApp).post('/api/account').send(alice)
    const foreign = await newAgent(rawApp).post('/api/account').set('origin', 'http://evil.example').send(alice)

    for (const response of [noHeader, foreign]) {
      expectError(response, 403, 'forbidden')
      expectContract(response, '/api/account', 'POST')
    }
    expect(store.orgMap.size).toBe(1)
  })

  it('allows 5 sign-ups per client IP per hour, then 429 with Retry-After', async () => {
    const clock = { now: fixedNow }
    const { rawApp } = buildApp({ now: () => clock.now })

    for (let index = 0; index < 5; index += 1) {
      expect((await newAgent(rawApp).post('/api/account').send(registrationOf(`user${index}`))).status).toBe(201)
    }
    const limited = await newAgent(rawApp).post('/api/account').send(registrationOf('user5'))

    expectError(limited, 429, 'rate_limited')
    expectContract(limited, '/api/account', 'POST')
    expect(limited.headers['retry-after']).toBe('3600')
    expect(limited.body.error.details).toEqual({ retryAfterSecond: 3600 })
    clock.now += 60 * 60 * 1000
    expect((await newAgent(rawApp).post('/api/account').send(registrationOf('user5'))).status).toBe(201)
  })
})

describe('registration logs', () => {
  const logLine: string[] = []

  beforeEach(() => {
    logLine.length = 0
    for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, level).mockImplementation((...arg: unknown[]) => { logLine.push(arg.map(String).join(' ')) })
    }
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('log success and conflict with a reason, never the password, the hash, the user name or the cookie', async () => {
    const { rawApp, store } = buildApp({ securityLogger: console })
    const created = await newAgent(rawApp).post('/api/account').send(alice)
    await newAgent(rawApp).post('/api/account').send({ ...registrationOf('bob'), username: 'alice' })

    const entryList = logLine.map((line) => JSON.parse(line) as Record<string, string>)
    expect(entryList.map((entry) => [entry.operation, entry.reason])).toEqual([['account.register', 'success'], ['account.register', 'conflict']])
    expect(entryList[0]?.requestId).toBe(created.headers['x-request-id'])
    const hash = [...store.orgMap.values()].find((org) => org.account.username === 'alice')?.account.passwordHash ?? ''
    const cookie = (sessionCookieOf(created) ?? '').split(';')[0] ?? ''
    for (const secret of [alice.password, hash, cookie, 'alice@example.com', '"alice"']) expect(logLine.join('\n')).not.toContain(secret)
  })
})
