import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildApp, demoPassword, demoUsername, newAgent, sessionCookieOf, signInAgent } from './helper/app.js'
import { expectContract, expectError } from './helper/contract.js'

// The seeded demo password, the same as the frontend's mock password. Not a secret.
const seededPassword = demoPassword
const newPassword = 'brand-new-pass-42'

describe('GET /api/account', () => {
  it('returns the signed-in profile with the user name and without any password field', async () => {
    const { app } = buildApp()

    const response = await request(app).get('/api/account')

    expectContract(response, '/api/account', 'GET')
    expect(response.body).toEqual({ username: 'john.doe', fullName: 'John Doe', email: 'john@company.com', avatarUrl: null, memberSince: 'March 12, 2025', signInMethod: 'password', githubLogin: null })
  })

  it('answers 401 without a session', async () => {
    const { rawApp } = buildApp()

    const response = await request(rawApp).get('/api/account')

    expectError(response, 401, 'unauthorized')
    expectContract(response, '/api/account', 'GET')
  })
})

describe('PUT /api/account/password', () => {
  it('changes the password with 204, and the new one is current from then on', async () => {
    const { app } = buildApp()

    const response = await request(app).put('/api/account/password').send({ currentPassword: seededPassword, newPassword })

    expectContract(response, '/api/account/password', 'PUT')
    expect(response.status).toBe(204)
    expectError(await request(app).put('/api/account/password').send({ currentPassword: seededPassword, newPassword: 'another-pass-1' }), 422, 'validation_error')
    expect((await request(app).put('/api/account/password').send({ currentPassword: newPassword, newPassword: 'another-pass-1' })).status).toBe(204)
  })

  it('rotates the session: a new cookie, the old id and every other session end, and only the new password signs in', async () => {
    const { rawApp } = buildApp()
    const agent = await signInAgent(rawApp)
    const other = await signInAgent(rawApp)
    const before = sessionCookieOf(await newAgent(rawApp).post('/api/session').send({ username: demoUsername, password: seededPassword }))

    const response = await agent.put('/api/account/password').send({ currentPassword: seededPassword, newPassword })

    expect(response.status).toBe(204)
    const rotated = sessionCookieOf(response)
    expect(rotated).toMatch(/^cr_session=[A-Za-z0-9_-]{43}; Max-Age=604800; Path=\/; Expires=.+; HttpOnly; SameSite=Lax$/)
    expect((await agent.get('/api/account')).status).toBe(200)
    expectError(await other.get('/api/account'), 401, 'unauthorized')
    expectError(await request(rawApp).get('/api/account').set('cookie', (before ?? '').split(';')[0] ?? ''), 401, 'unauthorized')
    expectError(await newAgent(rawApp).post('/api/session').send({ username: demoUsername, password: seededPassword }), 401, 'unauthorized')
    expect((await newAgent(rawApp).post('/api/session').send({ username: demoUsername, password: newPassword })).status).toBe(200)
  })

  it('stores a scrypt hash, never the plain password', async () => {
    const { app, store } = buildApp()

    await request(app).put('/api/account/password').send({ currentPassword: seededPassword, newPassword })

    expect(store.state.account.passwordHash).toMatch(/^scrypt\$[0-9a-f]+\$[0-9a-f]+$/)
    expect(JSON.stringify(store.state)).not.toContain(newPassword)
  })

  it('returns 422 on currentPassword for a wrong current password', async () => {
    const { app } = buildApp()

    const response = await request(app).put('/api/account/password').send({ currentPassword: 'wrong-password', newPassword })

    expectError(response, 422, 'validation_error')
    expectContract(response, '/api/account/password', 'PUT')
    expect(response.body.error.details.issue[0].field).toBe('currentPassword')
  })

  it.each([
    ['a new password under 8 characters', { currentPassword: seededPassword, newPassword: 'short1' }],
    ['a new password equal to the current one', { currentPassword: seededPassword, newPassword: seededPassword }],
    ['a missing current password', { newPassword }],
    ['an unknown field', { currentPassword: seededPassword, newPassword, extra: true }]
  ])('returns 422 for %s', async (_label, body) => {
    const { app } = buildApp()

    const response = await request(app).put('/api/account/password').send(body)

    expectError(response, 422, 'validation_error')
    expectContract(response, '/api/account/password', 'PUT')
  })

  // Plan 028, Open Question 7: the same rules as registration.
  it.each([
    ['no digit', 'only-letters-here', 'must contain at least one letter and one digit', undefined],
    ['no letter', '1234567890', 'must contain at least one letter and one digit', undefined],
    ['the user name', 'JOHN.doe42', 'must not be the user name or the email', { username: 'john.DOE42' }],
    ['the email', 'JOHN42@company.com', 'must not be the user name or the email', { email: 'john42@company.com' }],
    ['a common password', 'Password123', 'is too common', undefined]
  ])('returns 422 on newPassword for a new password with %s', async (_label, weak, message, accountChange) => {
    const { app, store } = buildApp()
    Object.assign(store.state.account, accountChange ?? {})

    const response = await request(app).put('/api/account/password').send({ currentPassword: seededPassword, newPassword: weak })

    expectError(response, 422, 'validation_error')
    expect(response.body.error.details.issue[0]).toEqual({ field: 'newPassword', message })
    expect(response.text).not.toContain(weak)
  })

  it('needs the CSRF header (403) and a session (401)', async () => {
    const { rawApp } = buildApp()
    const agent = await signInAgent(rawApp)

    const noHeader = await request(rawApp).put('/api/account/password').set('cookie', 'cr_session=x').send({ currentPassword: seededPassword, newPassword })
    const noSession = await request(rawApp).put('/api/account/password').set('X-CSRF-Protection', '1').send({ currentPassword: seededPassword, newPassword })

    expectError(noHeader, 403, 'forbidden')
    expectContract(noHeader, '/api/account/password', 'PUT')
    expectError(noSession, 401, 'unauthorized')
    expect((await agent.get('/api/account')).status).toBe(200)
  })
})

describe('password secrecy', () => {
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

  it('never puts the password or its hash in a response or a log line', async () => {
    const { app, store } = buildApp({ securityLogger: console })
    const responseText: string[] = []
    const send = async (body: string | object) => {
      const response = await request(app).put('/api/account/password').set('content-type', 'application/json').send(body)
      responseText.push(JSON.stringify(response.headers), response.text)
    }

    await send({ currentPassword: 'wrong-password', newPassword })
    await send({ currentPassword: seededPassword, newPassword: 'short1' })
    await send(`{"currentPassword":"${seededPassword}","newPassword":"${newPassword}"`)
    await send({ currentPassword: seededPassword, newPassword })
    await send({ currentPassword: seededPassword, newPassword, extra: newPassword })

    const everything = [...responseText, ...logLine].join('\n')
    for (const secret of [seededPassword, newPassword, 'wrong-password', 'short1', store.state.account.passwordHash]) {
      expect(everything).not.toContain(secret)
    }
  })
})
