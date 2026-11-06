import { createHash, scryptSync } from 'node:crypto'
import request, { type Response } from 'supertest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { hashPassword, SCRYPT_OPTION, verifyPassword } from '../src/lib/password.js'
import type { MemoryStore } from '../src/store/memory-store.js'
import { PASSWORD_HASH } from '../src/utils/constants.js'
import { buildApp, demoUsername, newAgent, registrationOf } from './helper/app.js'

// Plan 033 (Open Question 4, answer A): passwords are hashed with scrypt, never encrypted. This
// audit proves that no store row, API response, error body or log line holds a readable password
// or anything derived from it except the stored hash; that the hash parameters are pinned and
// every password gets its own random salt; that a wrong password and an unknown user get the
// same answer; and that the current-password check of a change uses the same hash.

const pinned = { cost: 16_384, blockSize: 8, parallelization: 1, saltBytes: 16, keyLength: 64 }

// Every form of a password a careless log or column could hold.
function derivedFormList(password: string): string[] {
  const data = Buffer.from(password, 'utf8')
  return [
    password,
    password.toLowerCase(),
    password.toUpperCase(),
    data.toString('hex'),
    data.toString('base64'),
    data.toString('base64url'),
    encodeURIComponent(password),
    JSON.stringify(password).slice(1, -1),
    createHash('sha256').update(password).digest('hex'),
    createHash('sha256').update(password).digest('base64'),
    createHash('md5').update(password).digest('hex'),
    createHash('sha1').update(password).digest('hex')
  ]
}

function expectNoPassword(text: string, passwordList: string[], where: string): void {
  for (const password of passwordList) {
    for (const form of derivedFormList(password)) expect(text.includes(form), `${where} holds a form of a password`).toBe(false)
  }
}

// Maps, sets and buffers as plain JSON, so the whole store can be searched.
function dumpStore(store: MemoryStore): string {
  return JSON.stringify({ orgMap: store.orgMap, sessionMap: store.sessionMap }, (_key, value: unknown) => {
    if (value instanceof Map) return Object.fromEntries(value)
    if (value instanceof Set) return [...value]
    if (Buffer.isBuffer(value)) return value.toString('base64')
    return value
  })
}

function responseText(response: Response): string {
  return `${response.status} ${JSON.stringify(response.headers)} ${response.text}`
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('password hash: scrypt with pinned parameters', () => {
  it('pins N, r, p, the salt and the key length in constants', () => {
    expect(PASSWORD_HASH).toMatchObject({ scheme: 'scrypt', ...pinned })
    expect(SCRYPT_OPTION).toMatchObject({ N: pinned.cost, r: pinned.blockSize, p: pinned.parallelization })
    expect(Object.isFrozen(SCRYPT_OPTION)).toBe(true)
  })

  it('stores scrypt$<16-byte salt hex>$<64-byte hash hex>, reproducible with the pinned parameters only', () => {
    const stored = hashPassword('Pinned-Password-1')
    const [scheme, salt, hash] = stored.split('$')
    expect(scheme).toBe('scrypt')
    expect(salt).toMatch(/^[0-9a-f]{32}$/)
    expect(hash).toMatch(/^[0-9a-f]{128}$/)
    const again = scryptSync('Pinned-Password-1', Buffer.from(salt as string, 'hex'), 64, { N: 16_384, r: 8, p: 1 }).toString('hex')
    expect(again).toBe(hash)
    const weaker = scryptSync('Pinned-Password-1', Buffer.from(salt as string, 'hex'), 64, { N: 1024, r: 8, p: 1 }).toString('hex')
    expect(weaker).not.toBe(hash)
  })

  it('gives every password a new random salt, so the same password never hashes the same', () => {
    const hashList = Array.from({ length: 5 }, () => hashPassword('Same-Password-1'))
    expect(new Set(hashList.map((item) => item.split('$')[1])).size).toBe(5)
    expect(new Set(hashList).size).toBe(5)
    for (const stored of hashList) expect(verifyPassword('Same-Password-1', stored)).toBe(true)
  })

  it('verifies only the right password, and refuses a malformed or foreign hash', () => {
    const stored = hashPassword('Right-Password-1')
    expect(verifyPassword('Right-Password-1', stored)).toBe(true)
    expect(verifyPassword('right-password-1', stored)).toBe(false)
    expect(verifyPassword('Right-Password-1 ', stored)).toBe(false)
    expect(verifyPassword('Right-Password-1', 'bcrypt$aa$bb')).toBe(false)
    expect(verifyPassword('Right-Password-1', 'scrypt$$')).toBe(false)
    expect(verifyPassword('Right-Password-1', stored.slice(0, -2))).toBe(false)
    expect(verifyPassword('Right-Password-1', 'Right-Password-1')).toBe(false)
  })

  it('two accounts registered with the same password get different salts', async () => {
    const { rawApp, store } = buildApp()
    const shared = 'Shared-Password-42'
    expect((await newAgent(rawApp).post('/api/account').send({ ...registrationOf('salt.one'), password: shared })).status).toBe(201)
    expect((await newAgent(rawApp).post('/api/account').send({ ...registrationOf('salt.two'), password: shared })).status).toBe(201)
    const hashList = [...store.orgMap.values()].map((org) => org.account.passwordHash ?? '').filter((item) => verifyPassword(shared, item))
    expect(hashList).toHaveLength(2)
    expect(hashList[0]?.split('$')[1]).not.toBe(hashList[1]?.split('$')[1])
  })
})

describe('no readable password anywhere', () => {
  it('in the store, the responses, the error bodies and the log lines of a full account life', async () => {
    const logLineList: string[] = []
    const capture = (...argList: unknown[]) => { logLineList.push(argList.map(String).join(' ')) }
    for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) vi.spyOn(console, method).mockImplementation(capture)
    const securityLogger = { info: (line: string) => logLineList.push(line), warn: (line: string) => logLineList.push(line) }
    const { rawApp, store } = buildApp({ securityLogger })

    const registration = registrationOf('audit.user')
    const firstPassword = registration.password
    const secondPassword = 'Second-Audit-Pass-9'
    const wrongPassword = 'Wrong-Audit-Guess-3'
    const weakPassword = 'short'
    const passwordList = [firstPassword, secondPassword, wrongPassword, 'Too-Long-Pass-1'.repeat(20)]
    const responseList: Response[] = []

    const agent = newAgent(rawApp)
    responseList.push(await agent.post('/api/account').send(registration))
    responseList.push(await agent.post('/api/account').send({ ...registration, username: 'audit.other' }))
    responseList.push(await agent.post('/api/account').send({ ...registrationOf('audit.weak'), password: weakPassword }))
    responseList.push(await agent.get('/api/account'))
    responseList.push(await agent.get('/api/session'))
    responseList.push(await agent.put('/api/account/password').send({ currentPassword: wrongPassword, newPassword: secondPassword }))
    responseList.push(await agent.put('/api/account/password').send({ currentPassword: firstPassword, newPassword: firstPassword }))
    responseList.push(await agent.put('/api/account/password').send({ currentPassword: firstPassword, newPassword: 'Too-Long-Pass-1'.repeat(20) }))
    responseList.push(await agent.put('/api/account/password').send({ currentPassword: firstPassword, newPassword: secondPassword }))
    responseList.push(await newAgent(rawApp).post('/api/session').send({ username: 'audit.user', password: wrongPassword }))
    responseList.push(await newAgent(rawApp).post('/api/session').send({ username: 'nobody.here', password: wrongPassword }))
    responseList.push(await newAgent(rawApp).post('/api/session').send({ username: 'audit.user', password: firstPassword }))
    responseList.push(await newAgent(rawApp).post('/api/session').send({ username: 'audit.user', password: secondPassword }))
    responseList.push(await newAgent(rawApp).post('/api/session').send({ username: 'audit.user', password: secondPassword, extra: 1 }))
    responseList.push(await newAgent(rawApp).post('/api/session').set('content-type', 'application/json').send(`{"username":"audit.user","password":"${secondPassword}"`))

    expect(responseList.map((response) => response.status)).toEqual([201, 409, 422, 200, 200, 422, 422, 422, 204, 401, 401, 401, 200, 422, 400])

    const record = [...store.orgMap.values()].find((org) => org.account.username === 'audit.user')?.account
    expect(record?.passwordHash).toMatch(/^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/)
    expect(verifyPassword(secondPassword, record?.passwordHash ?? '')).toBe(true)

    expectNoPassword(dumpStore(store).replace(record?.passwordHash ?? '', ''), passwordList, 'the store')
    for (const response of responseList) {
      expectNoPassword(responseText(response), passwordList, `the ${response.status} response`)
      expect(response.text).not.toContain(record?.passwordHash?.split('$')[2])
      expect(response.text).not.toContain('scrypt$')
    }
    const logText = logLineList.join('\n')
    expect(logLineList.length).toBeGreaterThan(0)
    expectNoPassword(logText, passwordList, 'the log')
    expect(logText).not.toContain('scrypt$')
  })
})

describe('sign-in answers', () => {
  it('a wrong password and an unknown user name get the same status and body', async () => {
    const { rawApp } = buildApp()
    const wrong = await request(rawApp).post('/api/session').set('X-CSRF-Protection', '1').send({ username: demoUsername, password: 'Not-The-Password-1' })
    const unknown = await request(rawApp).post('/api/session').set('X-CSRF-Protection', '1').send({ username: 'no.such.user', password: 'Not-The-Password-1' })
    expect(wrong.status).toBe(401)
    expect(unknown.status).toBe(401)
    const strip = (response: Response) => ({ ...response.body, requestId: undefined })
    expect(strip(wrong)).toEqual(strip(unknown))
    expect(wrong.headers['set-cookie']).toBeUndefined()
    expect(unknown.headers['set-cookie']).toBeUndefined()
  })
})

describe('the current-password check of a change uses the same scrypt hash', () => {
  it('accepts the password whose pinned scrypt hash is stored, and refuses one hashed with other parameters', async () => {
    const { app, store } = buildApp()
    const known = 'Known-Current-Pass-5'
    store.state.account.passwordHash = hashPassword(known)
    const ok = await request(app).put('/api/account/password').send({ currentPassword: known, newPassword: 'Next-Current-Pass-6' })
    expect(ok.status).toBe(204)
    expect(verifyPassword('Next-Current-Pass-6', store.state.account.passwordHash)).toBe(true)
    expect(verifyPassword(known, store.state.account.passwordHash)).toBe(false)

    // The same password and salt under weaker scrypt parameters is not accepted.
    const salt = Buffer.alloc(16, 3)
    const weak = scryptSync('Weak-Params-Pass-7', salt, 64, { N: 1024, r: 8, p: 1 }).toString('hex')
    store.state.account.passwordHash = ['scrypt', salt.toString('hex'), weak].join('$')
    const refused = await request(app).put('/api/account/password').send({ currentPassword: 'Weak-Params-Pass-7', newPassword: 'Another-Pass-8' })
    expect(refused.status).toBe(422)
    expect(refused.body.error.details.issue[0].field).toBe('currentPassword')
  })
})
