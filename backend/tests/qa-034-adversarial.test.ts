import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { addReview, buildApp, demoPassword, demoUsername, newAgent, registerAgent, registrationOf, signInAgent } from './helper/app.js'
import { expectError } from './helper/contract.js'

// QA, plan 034: adversarial checks of PUT /api/account and the test configuration on
// POST /api/review/{id}/generated-test that the implementing agent's tests do not cover.

const path = '/api/account'
const alice = registrationOf('alice')
const bob = registrationOf('bob')

describe('QA 034: PUT /api/account races', () => {
  it('two accounts racing for the same free user name: exactly one wins, the other gets the generic 409', async () => {
    const { rawApp } = buildApp()
    const aliceAgent = await registerAgent(rawApp, alice)
    const bobAgent = await registerAgent(rawApp, bob)

    const [first, second] = await Promise.all([
      aliceAgent.put(path).send({ username: 'carol', currentPassword: alice.password }),
      bobAgent.put(path).send({ username: 'CAROL', currentPassword: bob.password })
    ])

    const statusList = [first.status, second.status].sort()
    expect(statusList).toEqual([200, 409])
    const loser = first.status === 409 ? first : second
    expect(loser.body.error.message).toBe('This user name or email cannot be used.')
  })

  it('two accounts racing for the same free email: exactly one wins', async () => {
    const { rawApp } = buildApp()
    const aliceAgent = await registerAgent(rawApp, alice)
    const bobAgent = await registerAgent(rawApp, bob)

    const [first, second] = await Promise.all([
      aliceAgent.put(path).send({ email: 'shared@example.com', currentPassword: alice.password }),
      bobAgent.put(path).send({ email: 'Shared@Example.com', currentPassword: bob.password })
    ])

    expect([first.status, second.status].sort()).toEqual([200, 409])
  })

  it('a rename racing a registration of the same name never gives both', async () => {
    const { rawApp } = buildApp()
    const aliceAgent = await registerAgent(rawApp, alice)

    const [renamed, registered] = await Promise.all([
      aliceAgent.put(path).send({ username: 'dave', currentPassword: alice.password }),
      newAgent(rawApp).post(path).send({ username: 'DAVE', email: 'dave@example.com', password: 'dave-Secret-42' })
    ])

    expect([renamed.status, registered.status].filter((status) => status === 200 || status === 201)).toHaveLength(1)
  })
})

describe('QA 034: PUT /api/account hostile input', () => {
  it.each([
    ['a CR inside the user name', { username: 'jane\rdoe' }],
    ['a LF inside the user name', { username: 'jane\ndoe' }],
    ['a line separator inside the user name', { username: 'jane doe' }],
    ['a tab inside the user name', { username: 'jane\tdoe' }],
    ['a non-ASCII look-alike user name', { username: 'jоhn.doe' }],
    ['a null user name', { username: null }],
    ['a null email', { email: null }],
    ['an array user name', { username: ['jane'] }],
    ['a CR inside the email', { email: 'jane@exa\rmple.com' }],
    ['a paragraph separator inside the email', { email: 'jane@exa mple.com' }],
    ['a DEL inside the email', { email: 'jane@exa\u007fmple.com' }],
    ['a lone surrogate in the email', { email: 'jane@exa\ud800mple.com' }],
    ['a 255-character email', { email: `${'a'.repeat(243)}@example.com` }],
    ['a 33-character user name', { username: 'a'.repeat(33) }],
    ['an org id field', { username: 'jane', orgId: 'other' }],
    ['a password hash field', { username: 'jane', passwordHash: 'x' }]
  ])('refuses %s with 422 and nothing changes', async (_label, change) => {
    const { app, store } = buildApp()
    const before = JSON.stringify(store.state.account)

    const response = await request(app).put(path).send({ currentPassword: demoPassword, ...change })

    expectError(response, 422, 'validation_error')
    expect(JSON.stringify(store.state.account)).toBe(before)
  })

  it('refuses a __proto__ key (strict body) and does not pollute objects', async () => {
    const { app, store } = buildApp()
    const before = JSON.stringify(store.state.account)

    const response = await request(app).put(path).set('Content-Type', 'application/json')
      .send(`{"username":"jane","currentPassword":"${demoPassword}","__proto__":{"polluted":true}}`)

    expect([400, 422]).toContain(response.status)
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    expect(JSON.stringify(store.state.account)).toBe(before)
  })

  it('edge whitespace (CR/LF, line separator) around the user name is trimmed, never stored', async () => {
    const { app, store } = buildApp()

    const response = await request(app).put(path).send({ username: '\r\n jane  ', currentPassword: demoPassword })

    expect(response.status).toBe(200)
    expect(store.state.account.username).toBe('jane')
  })

  // QA 034 finding F-A2: `it.fails` passes while the defect is there; drop it once fixed.
  it.fails('a stored email never exceeds 254 characters, even when lower-casing grows it', async () => {
    const { app, store } = buildApp()
    // U+0130 lower-cases to two UTF-16 units ("i" + combining dot), so 254 typed characters can
    // become 255 stored ones.
    const email = `İ${'a'.repeat(241)}@example.com`
    expect(email).toHaveLength(254)

    const response = await request(app).put(path).send({ email, currentPassword: demoPassword })

    if (response.status === 200) expect(store.state.account.email.length).toBeLessThanOrEqual(254)
    else expectError(response, 422, 'validation_error')
  })

  it('another account\'s password does not authorize a change', async () => {
    const { rawApp } = buildApp()
    const aliceAgent = await registerAgent(rawApp, alice)
    await registerAgent(rawApp, bob)

    const response = await aliceAgent.put(path).send({ username: 'mallory', currentPassword: bob.password })

    expectError(response, 422, 'validation_error')
    expect((await aliceAgent.get(path)).body.username).toBe('alice')
  })

  it('the old user name\'s lock does not follow, and a locked account cannot rename itself out of the lock', async () => {
    const { rawApp } = buildApp()
    const agent = await signInAgent(rawApp)
    // An attacker locks the user name through sign-in.
    for (let index = 0; index < 5; index += 1) {
      await newAgent(rawApp).post('/api/session').send({ username: demoUsername, password: `wrong-${index}` })
    }

    // Even with the right password, the locked account cannot change its name to escape the lock.
    expectError(await agent.put(path).send({ username: 'escaped', currentPassword: demoPassword }), 429, 'rate_limited')
    expect((await agent.get(path)).body.username).toBe(demoUsername)
  })

  it('the 409 and the wrong-password 422 never echo the requested value', async () => {
    const { rawApp } = buildApp()
    const aliceAgent = await registerAgent(rawApp, alice)
    await registerAgent(rawApp, bob)

    const conflict = await aliceAgent.put(path).send({ email: 'bob@example.com', currentPassword: alice.password })
    const wrong = await aliceAgent.put(path).send({ email: 'free@example.com', currentPassword: 'nope-nope' })

    expect(JSON.stringify(conflict.body)).not.toContain('bob@example.com')
    expect(JSON.stringify(wrong.body)).not.toContain('free@example.com')
  })
})

describe('QA 034: test configuration hostile input', () => {
  it.each([
    ['an empty kind list', { framework: 'Jest', testTypeIdList: [] }],
    ['a repeated kind', { framework: 'Jest', testTypeIdList: ['unit', 'unit'] }],
    ['four kinds', { framework: 'Jest', testTypeIdList: ['unit', 'edge', 'error', 'unit'] }],
    ['an unknown kind', { framework: 'Jest', testTypeIdList: ['integration'] }],
    ['a lower-case framework', { framework: 'jest', testTypeIdList: ['unit'] }],
    ['an unknown framework', { framework: 'Jasmine', testTypeIdList: ['unit'] }],
    ['a missing framework', { testTypeIdList: ['unit'] }],
    ['a missing kind list', { framework: 'Jest' }],
    ['an extra field', { framework: 'Jest', testTypeIdList: ['unit'], code: 'process.exit()' }],
    ['a kind list that is a string', { framework: 'Jest', testTypeIdList: 'unit' }],
    ['an array body', [{ framework: 'Jest', testTypeIdList: ['unit'] }]]
  ])('refuses %s with 422 and stores nothing', async (_label, body) => {
    const { app, store } = buildApp()
    addReview(store, { id: 'r1' })
    const before = (await request(app).get('/api/review/r1')).body

    const response = await request(app).post('/api/review/r1/generated-test').send(body)

    expectError(response, 422, 'validation_error')
    const after = (await request(app).get('/api/review/r1')).body
    expect(after.testConfig).toEqual(before.testConfig)
    expect(after.generatedTest).toEqual(before.generatedTest)
  })

  it('Vitest stored, then Jest (equal to the default) sent explicitly: the stored config becomes Jest', async () => {
    const { app, store } = buildApp()
    addReview(store, { id: 'r1' })

    await request(app).post('/api/review/r1/generated-test').send({ framework: 'Vitest', testTypeIdList: ['edge'] })
    const back = await request(app).post('/api/review/r1/generated-test').send({ framework: 'Jest', testTypeIdList: ['unit', 'edge', 'error'] })

    expect(back.status).toBe(200)
    const read = (await request(app).get('/api/review/r1')).body
    expect(read.testConfig).toEqual({ framework: 'Jest', testTypeIdList: ['unit', 'edge', 'error'] })
    expect(read.generatedTest[0].code).toContain("from '@jest/globals'")
    expect(read.generatedTest[0].code).not.toContain("from 'vitest'")
  })

  it('Mocha output uses chai assertions only; error-only output has no unit or edge describe', async () => {
    const { app, store } = buildApp()
    addReview(store, { id: 'r1' })

    const response = await request(app).post('/api/review/r1/generated-test').send({ framework: 'Mocha', testTypeIdList: ['error'] })

    for (const file of response.body as { code: string }[]) {
      expect(file.code).toContain("from 'chai'")
      expect(file.code).not.toContain('.toBe(')
      expect(file.code).not.toContain('.toThrow(')
      expect(file.code).toContain('error cases')
      expect(file.code).not.toContain('unit tests')
      expect(file.code).not.toContain('edge cases')
    }
  })

  it('two concurrent regenerates with different configs leave a stored config that matches the stored code', async () => {
    const { app, store } = buildApp()
    addReview(store, { id: 'r1' })

    await Promise.all([
      request(app).post('/api/review/r1/generated-test').send({ framework: 'Vitest', testTypeIdList: ['unit'] }),
      request(app).post('/api/review/r1/generated-test').send({ framework: 'Mocha', testTypeIdList: ['edge'] })
    ])

    const read = (await request(app).get('/api/review/r1')).body
    const marker = read.testConfig.framework === 'Vitest' ? "from 'vitest'" : "from 'chai'"
    for (const file of read.generatedTest as { code: string }[]) expect(file.code).toContain(marker)
  })
})
