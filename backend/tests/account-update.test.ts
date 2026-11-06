import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { buildApp, demoPassword, demoUsername, newAgent, registerAgent, registrationOf, sessionCookieOf, signInAgent, signInCookie } from './helper/app.js'
import { expectContract, expectError } from './helper/contract.js'

// Plan 034, Workstream A (Open Question 1, answer A): PUT /api/account changes the signed-in
// account's user name and/or email. The current password is required; the rules and the
// generic 409 are those of registration; the session stays valid.

const path = '/api/account'
const genericConflict = 'This user name or email cannot be used.'
const alice = registrationOf('alice')
const bob = registrationOf('bob')

describe('PUT /api/account: a valid change', () => {
  it('changes the user name with 200, keeps the session, and only the new name signs in', async () => {
    const { rawApp } = buildApp()
    const agent = await signInAgent(rawApp)

    const response = await agent.put(path).send({ username: 'jane.doe', currentPassword: demoPassword })

    expectContract(response, '/api/account', 'PUT')
    expect(response.status).toBe(200)
    expect(response.body).toEqual({ username: 'jane.doe', fullName: 'John Doe', email: 'john@company.com', avatarUrl: null, memberSince: 'March 12, 2025', signInMethod: 'password', githubLogin: null })
    // The session is kept: no new cookie, and the same agent is still signed in.
    expect(sessionCookieOf(response)).toBeUndefined()
    expect((await agent.get('/api/session')).body.account.username).toBe('jane.doe')
    expect((await agent.get(path)).body.username).toBe('jane.doe')
    // Sign-in follows the new name; the old one is the usual 401.
    await signInAgent(rawApp, 'jane.doe', demoPassword)
    await signInAgent(rawApp, 'JANE.DOE', demoPassword)
    expectError(await newAgent(rawApp).post('/api/session').send({ username: demoUsername, password: demoPassword }), 401, 'unauthorized')
  })

  it('changes the email, trimmed and stored lower-cased', async () => {
    const { app, store } = buildApp()

    const response = await request(app).put(path).send({ email: '  Jane@Example.COM ', currentPassword: demoPassword })

    expectContract(response, '/api/account', 'PUT')
    expect(response.body.email).toBe('jane@example.com')
    expect(response.body.username).toBe(demoUsername)
    expect(store.state.account.email).toBe('jane@example.com')
  })

  it('changes both at once, and the user name is trimmed', async () => {
    const { app } = buildApp()

    const response = await request(app).put(path).send({ username: '  jane_doe-2 ', email: 'jane@example.com', currentPassword: demoPassword })

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ username: 'jane_doe-2', email: 'jane@example.com' })
  })

  it.each([
    ['the same user name', { username: demoUsername }],
    ['the same email', { email: 'john@company.com' }],
    ['a letter-case change of its own user name', { username: 'John.Doe' }],
    ['its own email in another case', { email: 'JOHN@company.com' }]
  ])('accepts %s (only another account conflicts)', async (_label, change) => {
    const { app } = buildApp()

    const response = await request(app).put(path).send({ ...change, currentPassword: demoPassword })

    expect(response.status).toBe(200)
    expectContract(response, '/api/account', 'PUT')
  })

  it('works for a registered account, and never touches another account', async () => {
    const { rawApp, store } = buildApp()
    const aliceAgent = await registerAgent(rawApp, alice)
    const bobAgent = await registerAgent(rawApp, bob)

    const response = await aliceAgent.put(path).send({ username: 'alice2', email: 'alice2@example.com', currentPassword: alice.password })

    expect(response.status).toBe(200)
    expect((await bobAgent.get(path)).body).toMatchObject({ username: 'bob', email: 'bob@example.com' })
    expect(store.state.account.username).toBe(demoUsername)
    await signInAgent(rawApp, 'alice2', alice.password)
    await signInAgent(rawApp, 'bob', bob.password)
    expectError(await newAgent(rawApp).post('/api/session').send({ username: 'alice', password: alice.password }), 401, 'unauthorized')
  })

  it('frees the old user name and email for registration', async () => {
    const { rawApp } = buildApp()
    const aliceAgent = await registerAgent(rawApp, alice)
    await aliceAgent.put(path).send({ username: 'alice2', email: 'alice2@example.com', currentPassword: alice.password })

    await registerAgent(rawApp, alice)
  })
})

describe('PUT /api/account: a taken user name or email (generic 409)', () => {
  it.each([
    ['the user name of another account', { username: 'bob' }],
    ['it in another letter case', { username: 'BoB' }],
    ['the email of another account', { email: 'bob@example.com' }],
    ['it in another letter case', { email: 'BOB@Example.com' }],
    ['the demo user name', { username: 'JOHN.DOE' }],
    ['a free user name with a taken email', { username: 'free-name', email: 'bob@example.com' }]
  ])('refuses %s with the one generic message, and nothing changes', async (_label, change) => {
    const { rawApp, store } = buildApp()
    const aliceAgent = await registerAgent(rawApp, alice)
    await registerAgent(rawApp, bob)
    const before = JSON.stringify([...store.orgMap])

    const response = await aliceAgent.put(path).send({ ...change, currentPassword: alice.password })

    expectError(response, 409, 'conflict')
    expectContract(response, '/api/account', 'PUT')
    expect(response.body.error.message).toBe(genericConflict)
    expect(response.body.error.details ?? null).toBeNull()
    expect(JSON.stringify([...store.orgMap])).toBe(before)
  })

  it('gives the same body for a taken user name and a taken email (never says which)', async () => {
    const { rawApp } = buildApp()
    const aliceAgent = await registerAgent(rawApp, alice)
    await registerAgent(rawApp, bob)

    const byName = await aliceAgent.put(path).send({ username: 'bob', currentPassword: alice.password })
    const byEmail = await aliceAgent.put(path).send({ email: 'bob@example.com', currentPassword: alice.password })

    expect({ ...byName.body, requestId: '' }).toEqual({ ...byEmail.body, requestId: '' })
  })
})

describe('PUT /api/account: validation (422, field-specific)', () => {
  it.each([
    ['a user name under 3 characters', { username: 'ab' }, 'username'],
    ['a user name over 32 characters', { username: 'a'.repeat(33) }, 'username'],
    ['a user name with a space', { username: 'jane doe' }, 'username'],
    ['a user name with a slash', { username: 'jane/doe' }, 'username'],
    ['a blank user name', { username: '   ' }, 'username'],
    ['a user name that is not a string', { username: 42 }, 'username'],
    ['an email without @', { email: 'jane.example.com' }, 'email'],
    ['an email over 254 characters', { email: `${'a'.repeat(243)}@example.com` }, 'email'],
    ['an email with a line feed', { email: 'jane@exa\nmple.com' }, 'email'],
    ['an email with a NEL control character', { email: `jane@exa${String.fromCharCode(0x85)}mple.com` }, 'email'],
    ['an email with a line separator', { email: `jane@exa${String.fromCharCode(0x2028)}mple.com` }, 'email'],
    ['an email with a C0 control character', { email: `jane@exa${String.fromCharCode(0x01)}mple.com` }, 'email'],
    ['an email with a NUL character', { email: 'jane@exa\u0000mple.com' }, 'email'],
    ['a current password over 200 characters', { username: 'jane', currentPassword: 'x'.repeat(201) }, 'currentPassword'],
    ['an unknown field', { username: 'jane', fullName: 'Jane' }, 'account update']
  ])('refuses %s on %s, and nothing changes', async (_label, change, field) => {
    const { app, store } = buildApp()
    const before = JSON.stringify(store.state.account)

    const response = await request(app).put(path).send({ currentPassword: demoPassword, ...change })

    expectError(response, 422, 'validation_error')
    expectContract(response, '/api/account', 'PUT')
    expect(response.body.error.details.issue[0].field).toBe(field)
    expect(JSON.stringify(store.state.account)).toBe(before)
  })

  it.each([
    ['no change field', { currentPassword: demoPassword }],
    ['an empty body', {}]
  ])('refuses %s: the user name or the email must be sent', async (_label, body) => {
    const { app } = buildApp()

    const response = await request(app).put(path).send(body)

    expectError(response, 422, 'validation_error')
    expect(response.body.error.details.issue[0]).toEqual({ field: 'account update', message: 'must change the user name, the email or both' })
  })

  it('accepts the 32-character user name and the 254-character email (the upper limits)', async () => {
    const { app } = buildApp()
    const email = `${'a'.repeat(242)}@example.com`

    const response = await request(app).put(path).send({ username: 'a'.repeat(32), email, currentPassword: demoPassword })

    expect(email).toHaveLength(254)
    expect(response.status).toBe(200)
  })

  it('checks the format before the password: a bad format with a wrong password is 422 on the field and is not counted', async () => {
    const { rawApp } = buildApp()
    const agent = await signInAgent(rawApp)

    for (let index = 0; index < 6; index += 1) {
      const response = await agent.put(path).send({ username: 'x', currentPassword: 'wrong-password' })
      expect(response.body.error.details.issue[0].field).toBe('username')
    }
    expect((await agent.put(path).send({ username: 'jane', currentPassword: demoPassword })).status).toBe(200)
  })
})

describe('PUT /api/account: the current password (Open Question 1, answer A)', () => {
  it.each([
    ['a wrong current password', { currentPassword: 'wrong-password' }, 'is not correct'],
    ['a missing current password', {}, 'is required'],
    ['an empty current password', { currentPassword: '' }, 'is required']
  ])('refuses %s with 422 on currentPassword, like the password change, and nothing changes', async (_label, password, message) => {
    const { app, store } = buildApp()
    const before = JSON.stringify(store.state.account)

    const response = await request(app).put(path).send({ username: 'jane', email: 'jane@example.com', ...password })

    expectError(response, 422, 'validation_error')
    expectContract(response, '/api/account', 'PUT')
    expect(response.body.error.message).toBe('The current password is not correct.')
    expect(response.body.error.details.issue).toEqual([{ field: 'currentPassword', message }])
    expect(JSON.stringify(store.state.account)).toBe(before)
    expect(JSON.stringify(response.body)).not.toContain('wrong-password')
  })

  it('counts wrong and missing passwords toward the user name failure limit: the 6th try is 429, even with the right password', async () => {
    const { rawApp } = buildApp()
    const agent = await signInAgent(rawApp)

    for (const currentPassword of ['wrong-1', 'wrong-2', undefined, 'wrong-4', 'wrong-5']) {
      expect((await agent.put(path).send({ username: 'jane', currentPassword })).status).toBe(422)
    }
    const response = await agent.put(path).send({ username: 'jane', currentPassword: demoPassword })

    expectError(response, 429, 'rate_limited')
    expectContract(response, '/api/account', 'PUT')
    expect(Number(response.headers['retry-after'])).toBeGreaterThan(0)
    expect(response.body.error.details.retryAfterSecond).toBe(Number(response.headers['retry-after']))
    expect((await agent.get(path)).body.username).toBe(demoUsername)
  })

  it('shares the limit with sign-in and the password change of the same user name', async () => {
    const { rawApp } = buildApp()
    const agent = await signInAgent(rawApp)

    for (let index = 0; index < 3; index += 1) await agent.put(path).send({ email: 'jane@example.com', currentPassword: 'wrong' })
    for (let index = 0; index < 2; index += 1) await agent.put('/api/account/password').send({ currentPassword: 'wrong', newPassword: 'brand-new-pass-42' })

    expectError(await newAgent(rawApp).post('/api/session').send({ username: demoUsername, password: demoPassword }), 429, 'rate_limited')
    expectError(await agent.put(path).send({ email: 'jane@example.com', currentPassword: demoPassword }), 429, 'rate_limited')
  })

  it('does not count a right password, and another account keeps its own limit', async () => {
    const { rawApp } = buildApp()
    const aliceAgent = await registerAgent(rawApp, alice)
    const demoAgent = await signInAgent(rawApp)
    for (let index = 0; index < 5; index += 1) await demoAgent.put(path).send({ username: 'jane', currentPassword: 'wrong' })

    for (let index = 0; index < 6; index += 1) {
      expect((await aliceAgent.put(path).send({ username: `alice${index}`, currentPassword: alice.password })).status).toBe(200)
    }
  })
})

describe('PUT /api/account: session and CSRF', () => {
  it('answers 401 without a session, and nothing changes', async () => {
    const { rawApp, store } = buildApp()

    const response = await newAgent(rawApp).put(path).send({ username: 'jane', currentPassword: demoPassword })

    expectError(response, 401, 'unauthorized')
    expectContract(response, '/api/account', 'PUT')
    expect(store.state.account.username).toBe(demoUsername)
  })

  it('answers 403 without the X-CSRF-Protection header, and nothing changes', async () => {
    const { rawApp, store } = buildApp()
    const cookie = await signInCookie(rawApp)

    const response = await request(rawApp).put(path).set('cookie', cookie).send({ username: 'jane', currentPassword: demoPassword })

    expectError(response, 403, 'forbidden')
    expectContract(response, '/api/account', 'PUT')
    expect(store.state.account.username).toBe(demoUsername)
  })

  it('answers 403 for a foreign Origin, and nothing changes', async () => {
    const { rawApp, store } = buildApp()
    const cookie = await signInCookie(rawApp)

    const response = await request(rawApp).put(path).set('cookie', cookie).set('X-CSRF-Protection', '1').set('Origin', 'https://evil.example')
      .send({ username: 'jane', currentPassword: demoPassword })

    expectError(response, 403, 'forbidden')
    expect(store.state.account.username).toBe(demoUsername)
  })

  it('keeps every session of the account valid after the change (no rotation)', async () => {
    const { rawApp } = buildApp()
    const first = await signInAgent(rawApp)
    const second = await signInAgent(rawApp)

    expect((await first.put(path).send({ username: 'jane', currentPassword: demoPassword })).status).toBe(200)

    expect((await second.get(path)).body.username).toBe('jane')
  })
})
