import { request as httpRequest, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import request from 'supertest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Analyzer, AnalyzerResult } from '../src/analyzer/analyzer.js'
import { createStubAnalyzer } from '../src/analyzer/stub-analyzer.js'
import { addReview, buildApp as buildEmptyApp, frontendUrl, validSettings } from './helper/app.js'
import { expectContract, expectError } from './helper/contract.js'
import { fakeGithubClient, fakeUser } from './helper/github.js'

// QA adversarial pass for plan 018 (AI-32). Probes edges the implementing agent did not cover.
// Known defects are marked `it.fails` so the suite stays green and flips red once they are fixed.

const seededPassword = 'mock-password'
const validReview = { source_type: 'snippet', language: 'TypeScript', content: 'const a = 1' }
const validSupport = { issueType: 'other', email: 'a@b.co', reviewId: '', priority: 'low', description: 'Something is broken here' }

// An analyzer whose analysis only finishes when the test says so, so `pending` is observable.
function deferredAnalyzer() {
  let finish: (result: AnalyzerResult) => void = () => {}
  let fail: (error: Error) => void = () => {}
  const stub = createStubAnalyzer()
  const analyzer: Analyzer = {
    analyze: () => new Promise<AnalyzerResult>((resolve, reject) => { finish = resolve; fail = reject }),
    regenerateTest: (fileList) => stub.regenerateTest(fileList)
  }
  return {
    analyzer,
    finish: (result: AnalyzerResult) => finish(result),
    fail: (error: Error) => fail(error)
  }
}


// Supertest (superagent) resolves `..` and `%2e%2e` on the client before sending, so path
// probes go over a raw socket with the path exactly as written.
async function rawGet(app: ReturnType<typeof buildApp>['app'], path: string) {
  const server: Server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)) })
  try {
    const { port } = server.address() as AddressInfo
    return await new Promise<{ status: number, headers: Record<string, unknown>, text: string, body: Record<string, unknown> }>((resolve, reject) => {
      const req = httpRequest({ host: '127.0.0.1', port, path, method: 'GET' }, (res) => {
        let text = ''
        res.on('data', (chunk) => { text += chunk })
        res.on('end', () => {
          let body: Record<string, unknown> = {}
          try { body = JSON.parse(text) } catch { body = {} }
          resolve({ status: res.statusCode ?? 0, headers: res.headers, text, body })
        })
      })
      req.on('error', reject)
      req.end()
    })
  } finally {
    server.close()
  }
}

function expectRawError(response: Awaited<ReturnType<typeof rawGet>>, status: number, code: string) {
  expect(response.status).toBe(status)
  expect((response.body.error as { code: string }).code).toBe(code)
  expect(response.body.requestId).toBe(response.headers['x-request-id'])
}

const emptyResult: AnalyzerResult = { qualityScore: 100, findingCount: [], finding: [], suggestion: [], generatedTest: [] }
const flush = () => new Promise((resolve) => setTimeout(resolve, 20))

// Fixture setup only (plan 019 addendum): the store no longer seeds reviews, so every app these
// probes use gets the two completed reviews r1 and r2 they target, each with two generated tests.
function buildApp(option?: Parameters<typeof buildEmptyApp>[0]) {
  const built = buildEmptyApp(option)
  addReview(built.store, { id: 'r2' })
  addReview(built.store, { id: 'r1' })
  return built
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('QA: validation edges on names and content', () => {
  async function savedReview() {
    const { app } = buildApp()
    await request(app).put('/api/review/r1').send({ language: 'Go', code: 'x', name: 'start' })
    return app
  }

  it.each([
    [0, 422],
    [1, 200],
    [80, 200],
    [81, 422]
  ])('PATCH rename with a %i-character name returns %i', async (length, status) => {
    const app = await savedReview()

    const response = await request(app).patch('/api/review/r1').send({ name: 'n'.repeat(length) })

    expect(response.status).toBe(status)
    expectContract(response, '/api/review/{id}', 'PATCH')
  })

  it.each([
    [0, 422],
    [1, 200],
    [80, 200],
    [81, 422]
  ])('PUT save with a %i-character name returns %i', async (length, status) => {
    const { app } = buildApp()

    const response = await request(app).put('/api/review/r1').send({ language: 'Go', code: 'x', name: 'n'.repeat(length) })

    expect(response.status).toBe(status)
    expectContract(response, '/api/review/{id}', 'PUT')
  })

  it('rejects a whitespace-only name, language or content with 422', async () => {
    const app = await savedReview()

    expectError(await request(app).patch('/api/review/r1').send({ name: '   ' }), 422, 'validation_error')
    expectError(await request(app).put('/api/review/r1').send({ language: '  ', code: 'x' }), 422, 'validation_error')
    expectError(await request(app).post('/api/review').send({ ...validReview, content: ' \n\t ' }), 422, 'validation_error')
  })

  it('accepts content of exactly 100000 characters and rejects 100001 with 422', async () => {
    const { app } = buildApp()

    const atLimit = await request(app).post('/api/review').send({ ...validReview, content: 'a'.repeat(100_000) })
    const overLimit = await request(app).post('/api/review').send({ ...validReview, content: 'a'.repeat(100_001) })
    const saveAtLimit = await request(app).put('/api/review/r1').send({ language: 'Go', code: 'a'.repeat(100_000) })
    const saveOverLimit = await request(app).put('/api/review/r1').send({ language: 'Go', code: 'a'.repeat(100_001) })

    expect(atLimit.status).toBe(202)
    expectContract(atLimit, '/api/review', 'POST')
    expectError(overLimit, 422, 'validation_error')
    expect(saveAtLimit.status).toBe(200)
    expectError(saveOverLimit, 422, 'validation_error')
  })

  // DEFECT D2: the contract allows 100 000 characters, but the 200 kB byte limit rejects
  // 100 000 characters of non-ASCII code (3 bytes each in UTF-8) with 413.
  it('accepts 100000 characters of non-ASCII content (contract maxLength)', async () => {
    const { app } = buildApp()

    const response = await request(app).post('/api/review').send({ ...validReview, content: '中'.repeat(100_000) })

    expect(response.status).toBe(202)
  })

  it('rejects a title over 120 characters and defaults a blank title', async () => {
    const { app } = buildApp()

    expectError(await request(app).post('/api/review').send({ ...validReview, title: 't'.repeat(121) }), 422, 'validation_error')
    const blank = await request(app).post('/api/review').send({ ...validReview, title: '   ' })
    expect(blank.status).toBe(202)
    expect(blank.body.title).toBe('New review')
  })
})

describe('QA: hostile bodies', () => {
  const writeRouteList: [string, string, object][] = [
    ['post', '/api/review', validReview],
    ['put', '/api/review/r1', { language: 'Go', code: 'x' }],
    ['patch', '/api/review/r1', { name: 'n' }],
    ['put', '/api/settings', validSettings],
    ['post', '/api/support-request', validSupport],
    ['put', '/api/account/password', { currentPassword: seededPassword, newPassword: 'brand-new-pass' }]
  ]

  it.each(writeRouteList)('%s %s: 413 with requestId for a body over 200 kB', async (method, path, body) => {
    const { app } = buildApp()

    const response = await request(app)[method as 'post'](path).send({ ...body, pad: 'x'.repeat(210_000) })

    expectError(response, 413, 'payload_too_large')
    expect(response.text).not.toContain('xxxxxxxx')
  })

  it.each(writeRouteList)('%s %s: 400 with requestId for malformed JSON', async (method, path) => {
    const { app } = buildApp()

    const response = await request(app)[method as 'post'](path).set('content-type', 'application/json').send('{"a":')

    expectError(response, 400, 'bad_request')
    expect(response.text).not.toMatch(/SyntaxError|at JSON|node_modules|\.ts:/)
  })

  it.each(writeRouteList)('%s %s: 422 for an unknown field', async (method, path, body) => {
    const { app } = buildApp()

    expectError(await request(app)[method as 'post'](path).send({ ...body, isAdmin: true }), 422, 'validation_error')
  })

  it.each(writeRouteList)('%s %s: 422 for a JSON array, string-typed number or null fields', async (method, path, body) => {
    const { app } = buildApp()

    expectError(await request(app)[method as 'post'](path).send([body]), 422, 'validation_error')
    const nulled = Object.fromEntries(Object.keys(body).map((key) => [key, null]))
    expectError(await request(app)[method as 'post'](path).send(nulled), 422, 'validation_error')
  })

  it('400 for a top-level JSON primitive and for a bare null body', async () => {
    const { app } = buildApp()

    expectError(await request(app).post('/api/review').set('content-type', 'application/json').send('"snippet"'), 400, 'bad_request')
    expectError(await request(app).post('/api/review').set('content-type', 'application/json').send('null'), 400, 'bad_request')
  })

  it('a __proto__ key is rejected and does not pollute Object.prototype', async () => {
    const { app } = buildApp()

    const response = await request(app).post('/api/review').set('content-type', 'application/json')
      .send('{"source_type":"snippet","language":"Go","content":"x","__proto__":{"polluted":true}}')

    expectError(response, 422, 'validation_error')
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })

  it('wrong types inside settings: a string boolean and an unknown enum value get 422', async () => {
    const { app } = buildApp()

    expectError(await request(app).put('/api/settings').send({ ...validSettings, generatedTest: 'true' }), 422, 'validation_error')
    expectError(await request(app).put('/api/settings').send({ ...validSettings, theme: 'neon' }), 422, 'validation_error')
    expectError(await request(app).put('/api/settings').send({ ...validSettings, notification: { ...validSettings.notification, extra: true } }), 422, 'validation_error')
    expect((await request(app).get('/api/settings')).body.theme).toBe('light')
  })

  it('support: bad reviewId, short trimmed description and bad email get 422', async () => {
    const { app } = buildApp()

    expectError(await request(app).post('/api/support-request').send({ ...validSupport, reviewId: '../r1' }), 422, 'validation_error')
    expectError(await request(app).post('/api/support-request').send({ ...validSupport, description: '   short   ' }), 422, 'validation_error')
    expectError(await request(app).post('/api/support-request').send({ ...validSupport, email: 'a@b' }), 422, 'validation_error')
  })

  // DEFECT D3: body-parser 415 (unsupported content-encoding) is passed through with code
  // `bad_request`, a status the contract never declares.
  it('an unsupported content-encoding maps to a status the contract declares', async () => {
    const { app } = buildApp()

    const response = await request(app).post('/api/review').set('content-type', 'application/json').set('content-encoding', 'br').send('{}')

    expectContract(response, '/api/review', 'POST')
  })

})

describe('QA: hostile ids and queries', () => {
  it.each([
    ['%2e%2e', 422],
    ['..%2F..%2Faccount', 422],
    ['r1%00', 422],
    ['r1;drop', 422],
    ['a'.repeat(64), 404],
    ['a'.repeat(65), 422],
    ['a'.repeat(8000), 422]
  ])('GET /api/review/%s returns %i with the error shape', async (id, status) => {
    const { app } = buildApp()

    const response = await rawGet(app, `/api/review/${id}`)

    expectRawError(response, status, status === 404 ? 'not_found' : 'validation_error')
  })

  it('a ../ traversal never escapes the review router', async () => {
    const { app } = buildApp()

    const literal = await rawGet(app, '/api/review/../account')
    const encoded = await rawGet(app, '/api/review/%2e%2e/account')
    const slash = await rawGet(app, '/api/review/..%2Faccount')

    for (const response of [literal, encoded, slash]) {
      expect(response.body.fullName).toBeUndefined()
      expect(response.status).toBeGreaterThanOrEqual(400)
      expect(response.body.requestId).toBe(response.headers['x-request-id'])
    }
  })

  // DEFECT D1: a malformed percent-escape in a path parameter makes Express throw a URIError
  // (status 400), which the error handler does not recognise, so it answers 500 internal_error.
  it('a malformed percent-escape in an id gets 400 or 422, not 500', async () => {
    const { app } = buildApp()
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const response = await rawGet(app, '/api/review/%E0%A4%A')

    expect(response.status).toBeLessThan(500)
  })

  it('a malformed percent-escape still gets the error shape, a requestId and no stack', async () => {
    const { app } = buildApp()
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const response = await rawGet(app, '/api/github/repo/%zz/file')

    expect(response.body.requestId).toBe(response.headers['x-request-id'])
    expect(response.text).not.toMatch(/URIError|at decode|node_modules/)
  })

  it.each([
    ['query[$ne]=x', 422],
    ['query[]=a', 422],
    ['query=a&query=b', 422],
    ['query[toString]=x', 422]
  ])('repo search ?%s is rejected with %i', async (query, status) => {
    const { app } = buildApp()

    const response = await request(app).get(`/api/github/repo?${query}`)

    expectError(response, status, 'validation_error')
  })

  it.each(['.*', '%25', '%00', "' OR 1=1 --", '(a+)+$', '<script>'])('repo search treats %s as a literal substring', async (query) => {
    // Plan 030: the search filters the connected fake user's repositories on the server.
    const { app } = buildApp({ githubClient: fakeGithubClient() })
    await request(app).post('/api/github/connect').send({ username: fakeUser })

    const response = await request(app).get('/api/github/repo').query({ query })

    expect(response.status).toBe(200)
    expectContract(response, '/api/github/repo', 'GET')
    expect(response.body).toEqual({ items: [], truncated: false })
  })

  it('github file routes reject inherited keys and traversal ids', async () => {
    const { app } = buildApp({ githubClient: fakeGithubClient() })
    await request(app).post('/api/github/connect').send({ username: fakeUser })

    expectError(await request(app).get('/api/github/repo/constructor/file'), 404, 'not_found')
    // Plan 030: `toString` is not the base64url of a supported file path.
    expectError(await request(app).get('/api/github/repo/hasOwnProperty/file/toString'), 422, 'validation_error')
    expectRawError(await rawGet(app, '/api/github/repo/%2e%2e/file/x'), 422, 'validation_error')
  })
})

describe('QA: state consistency', () => {
  it('after delete, save, rename, regenerate and get all answer 404', async () => {
    const { app } = buildApp()
    await request(app).put('/api/review/r1').send({ language: 'Go', code: 'x', name: 'kept' })
    expect((await request(app).delete('/api/review/r1')).status).toBe(204)

    expectError(await request(app).put('/api/review/r1').send({ language: 'Go', code: 'y' }), 404, 'not_found')
    expectError(await request(app).patch('/api/review/r1').send({ name: 'z' }), 404, 'not_found')
    expectError(await request(app).post('/api/review/r1/generated-test'), 404, 'not_found')
    expectError(await request(app).get('/api/review/r1'), 404, 'not_found')
    expectError(await request(app).delete('/api/review/r1'), 404, 'not_found')
    expect((await request(app).get('/api/review')).body.map((row: { id: string }) => row.id)).not.toContain('r1')
  })

  it('rename of a never-saved review is 404 and leaves it unsaved', async () => {
    const { app } = buildApp()

    expectError(await request(app).patch('/api/review/r1').send({ name: 'x' }), 404, 'not_found')
    expect((await request(app).get('/api/review/r1')).body.savedAt).toBeNull()
  })

  it('a created review reads back as pending, cannot be regenerated, and then completes', async () => {
    const deferred = deferredAnalyzer()
    const { app } = buildApp({ analyzer: deferred.analyzer })

    const created = await request(app).post('/api/review').send(validReview)
    const pending = await request(app).get(`/api/review/${created.body.id}`)

    expect(pending.status).toBe(200)
    expect(pending.body.status).toBe('pending')
    expectContract(pending, '/api/review/{id}', 'GET')
    expect((await request(app).get('/api/review')).body[0]).toMatchObject({ id: created.body.id, status: 'pending' })
    expectError(await request(app).post(`/api/review/${created.body.id}/generated-test`), 409, 'conflict')

    deferred.finish(emptyResult)
    await flush()
    expect((await request(app).get(`/api/review/${created.body.id}`)).body.status).toBe('completed')
  })

  it('a review deleted while pending stays deleted when the analyzer finishes', async () => {
    const deferred = deferredAnalyzer()
    const { app, store } = buildApp({ analyzer: deferred.analyzer })

    const created = await request(app).post('/api/review').send(validReview)
    expect((await request(app).delete(`/api/review/${created.body.id}`)).status).toBe(204)
    deferred.finish(emptyResult)
    await flush()

    expectError(await request(app).get(`/api/review/${created.body.id}`), 404, 'not_found')
    expect(store.state.reviewList.find((record) => record.id === created.body.id)?.review.status).toBe('pending')
  })

  it('a save made while pending survives completion', async () => {
    const deferred = deferredAnalyzer()
    const { app } = buildApp({ analyzer: deferred.analyzer })

    const created = await request(app).post('/api/review').send(validReview)
    await request(app).put(`/api/review/${created.body.id}`).send({ language: 'Go', code: 'edited', name: 'mine' })
    deferred.finish(emptyResult)
    await flush()

    const response = await request(app).get(`/api/review/${created.body.id}`)
    expect(response.body).toMatchObject({ status: 'completed', title: 'mine', content: 'edited' })
  })

  it('rapid parallel creates all get distinct ids and all appear in the list', async () => {
    const { app } = buildApp()

    const responseList = await Promise.all(Array.from({ length: 25 }, () => request(app).post('/api/review').send(validReview)))
    const idList = responseList.map((response) => response.body.id)

    expect(new Set(idList).size).toBe(25)
    const listed = (await request(app).get('/api/review')).body.map((row: { id: string }) => row.id)
    for (const id of idList) expect(listed).toContain(id)
  })

  it('parallel double delete: exactly one 204 and one 404', async () => {
    const { app } = buildApp()

    const statusList = (await Promise.all([request(app).delete('/api/review/r2'), request(app).delete('/api/review/r2')])).map((response) => response.status).sort()

    expect(statusList).toEqual([204, 404])
  })

  it('regenerate twice returns the original files again', async () => {
    const { app } = buildApp()
    const before = (await request(app).get('/api/review/r1')).body.generatedTest

    await request(app).post('/api/review/r1/generated-test')
    const second = await request(app).post('/api/review/r1/generated-test')

    expect(second.body).toEqual(before)
  })
})

describe('QA: password security', () => {
  it('the old password fails after a change, and the new one works', async () => {
    const { app } = buildApp()

    expect((await request(app).put('/api/account/password').send({ currentPassword: seededPassword, newPassword: 'second-pass-1' })).status).toBe(204)

    const old = await request(app).put('/api/account/password').send({ currentPassword: seededPassword, newPassword: 'third-pass-1' })
    expectError(old, 422, 'validation_error')
    expect(old.body.error.details.issue[0].field).toBe('currentPassword')
    expect((await request(app).put('/api/account/password').send({ currentPassword: 'second-pass-1', newPassword: 'third-pass-1' })).status).toBe(204)
  })

  it('a reset store goes back to the seeded password', async () => {
    const { app, store } = buildApp()
    await request(app).put('/api/account/password').send({ currentPassword: seededPassword, newPassword: 'second-pass-1' })

    store.reset()

    expect((await request(app).put('/api/account/password').send({ currentPassword: seededPassword, newPassword: 'second-pass-1' })).status).toBe(204)
  })

  it('compares with crypto.timingSafeEqual over a fixed-length scrypt hash', async () => {
    const { verifyPassword, hashPassword } = await import('../src/lib/password.js')
    const crypto = await import('node:crypto')
    const stored = hashPassword('correct-horse')

    expect(verifyPassword('correct-horse', stored)).toBe(true)
    expect(verifyPassword('', stored)).toBe(false)
    expect(verifyPassword('x'.repeat(200), stored)).toBe(false)
    expect(verifyPassword('correct-horse', 'md5$abc$def')).toBe(false)
    expect(verifyPassword('correct-horse', 'garbage')).toBe(false)
    expect(typeof crypto.timingSafeEqual).toBe('function')
    const source = (await import('node:fs')).readFileSync(new URL('../src/lib/password.ts', import.meta.url), 'utf8')
    expect(source).toContain('timingSafeEqual(actual, expected)')
    expect(source).not.toMatch(/actual\s*===\s*expected|\.equals\(/)
  })

  it('wrong and right current passwords of every length take similar time (no early exit)', async () => {
    const { verifyPassword, hashPassword } = await import('../src/lib/password.js')
    const stored = hashPassword('correct-horse')
    const time = (value: string) => {
      const start = process.hrtime.bigint()
      for (let index = 0; index < 5; index += 1) verifyPassword(value, stored)
      return Number(process.hrtime.bigint() - start)
    }
    time('warm-up')

    const wrongShort = time('a')
    const right = time('correct-horse')

    // scrypt dominates both paths; an early exit would make the wrong one far faster.
    expect(wrongShort / right).toBeGreaterThan(0.5)
  })

  it('no response or log line ever contains the password, across 400, 413, 422, 204 and 500', async () => {
    const analyzer: Analyzer = { ...createStubAnalyzer(), regenerateTest: async () => { throw new Error('boom') } }
    const { app, store } = buildApp({ analyzer })
    const logLine: string[] = []
    for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, level).mockImplementation((...arg: unknown[]) => { logLine.push(arg.map(String).join(' ')) })
    }
    const secret = 'S3cret-Value-qa-77'
    const text: string[] = []
    const keep = (response: request.Response) => text.push(JSON.stringify(response.headers), response.text)

    keep(await request(app).put('/api/account/password').send({ currentPassword: seededPassword, newPassword: secret }))
    keep(await request(app).put('/api/account/password').send({ currentPassword: secret, newPassword: secret }))
    keep(await request(app).put('/api/account/password').send({ currentPassword: secret, newPassword: secret.repeat(20) }))
    keep(await request(app).put('/api/account/password').send({ currentPassword: secret, newPassword: secret, pad: 'x'.repeat(210_000) }))
    keep(await request(app).put('/api/account/password').set('content-type', 'application/json').send(`{"currentPassword":"${secret}",`))
    keep(await request(app).put('/api/account/password').send({ currentPassword: 42, newPassword: secret }))
    keep(await request(app).get('/api/account'))
    keep(await request(app).post('/api/review/r1/generated-test'))

    const everything = [...text, ...logLine].join('\n')
    expect(everything).not.toContain(secret)
    expect(everything).not.toContain(seededPassword)
    expect(everything).not.toContain(store.state.account.passwordHash?.split('$')[2])
  })
})

describe('QA: errors and CORS', () => {
  it('every error carries requestId equal to x-request-id, and ids are unique', async () => {
    const { app } = buildApp()

    const responseList = [
      await request(app).post('/api/review').set('content-type', 'application/json').send('{'),
      await request(app).post('/api/review').send({ ...validReview, content: 'x'.repeat(210_000) }),
      await request(app).post('/api/review').send({}),
      await request(app).get('/api/review/nope'),
      await request(app).post('/api/review/zz999/generated-test').send(),
      await request(app).get('/api/does-not-exist')
    ]

    for (const response of responseList) {
      expect(response.body.requestId).toMatch(/^[0-9a-f-]{36}$/)
      expect(response.body.requestId).toBe(response.headers['x-request-id'])
      expect(response.text).not.toMatch(/\bat \w+ \(|node_modules|stack/i)
    }
    expect(new Set(responseList.map((response) => response.body.requestId)).size).toBe(responseList.length)
  })

  it('a client-supplied x-request-id is not trusted or echoed', async () => {
    const { app } = buildApp()

    const response = await request(app).get('/api/review/nope').set('x-request-id', 'attacker<script>')

    expect(response.body.requestId).not.toBe('attacker<script>')
  })

  it('500 path: generic message, no internals, cause only in the log', async () => {
    const analyzer: Analyzer = { ...createStubAnalyzer(), regenerateTest: async () => { throw new TypeError('secret internal path C:/x/y.ts:12') } }
    const { app } = buildApp({ analyzer })
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    const response = await request(app).post('/api/review/r1/generated-test')

    expectError(response, 500, 'internal_error')
    expect(response.body.error.details).toBeUndefined()
    expect(response.text).not.toContain('secret internal path')
    expect(response.text).not.toContain('TypeError')
    expect(String(error.mock.calls[0]?.[0])).toContain(response.body.requestId)
  })

  it('CORS: the configured origin only, also on preflight and on errors', async () => {
    const { app } = buildApp()

    const evilPreflight = await request(app).options('/api/review').set('origin', 'http://evil.example').set('access-control-request-method', 'DELETE')
    const goodPreflight = await request(app).options('/api/review').set('origin', frontendUrl).set('access-control-request-method', 'DELETE')
    const evilError = await request(app).get('/api/review/nope').set('origin', 'http://evil.example')
    const nullOrigin = await request(app).get('/api/health').set('origin', 'null')

    // Plan 028: credentials only for FRONTEND_URL; any other origin (also `null`) gets no CORS
    // header at all, so it is never reflected and never given credentials.
    for (const response of [evilPreflight, evilError, nullOrigin]) {
      expect(response.headers['access-control-allow-origin']).toBeUndefined()
      expect(response.headers['access-control-allow-credentials']).toBeUndefined()
    }
    expect(goodPreflight.status).toBe(204)
    expect(goodPreflight.headers['access-control-allow-origin']).toBe(frontendUrl)
    expect(goodPreflight.headers['access-control-allow-credentials']).toBe('true')
    expect(goodPreflight.headers['access-control-allow-headers']).toBe('Content-Type,X-CSRF-Protection,Authorization,X-Session-Mode')
    expect(goodPreflight.headers['access-control-allow-methods']).toContain('DELETE')
  })

  it('CORS follows the frontendUrl passed to createApp', async () => {
    const { createApp } = await import('../src/app.js')
    const app = createApp({ frontendUrl: 'https://app.example.com', enableTestRoute: false })

    const other = await request(app).get('/api/health').set('origin', 'http://localhost:5173')
    const configured = await request(app).get('/api/health').set('origin', 'https://app.example.com')

    expect(other.headers['access-control-allow-origin']).toBeUndefined()
    expect(configured.headers['access-control-allow-origin']).toBe('https://app.example.com')
  })

  it('an unknown method on a known path is 404 with the error shape', async () => {
    const { app } = buildApp()

    expectError(await request(app).put('/api/dashboard'), 404, 'not_found')
    expectError(await request(app).post('/api/account/avatar'), 404, 'not_found')
    expectError(await request(app).get('/api/account/password'), 404, 'not_found')
  })
})

describe('QA: contract drift on error statuses', () => {
  // DEFECT D4: these error statuses are produced but not declared for the operation in the
  // contract (no matching code and no `default`).
  it('DELETE /api/review/{id} declares the 422 it returns for a malformed id', async () => {
    const { app } = buildApp()
    expectContract(await request(app).delete('/api/review/bad.id'), '/api/review/{id}', 'DELETE')
  })

  it('POST /api/review/{id}/generated-test declares the 422 it returns for a malformed id', async () => {
    const { app } = buildApp()
    expectContract(await request(app).post('/api/review/bad.id/generated-test'), '/api/review/{id}/generated-test', 'POST')
  })

  it('PUT /api/settings declares the 400 it returns for malformed JSON', async () => {
    const { app } = buildApp()
    expectContract(await request(app).put('/api/settings').set('content-type', 'application/json').send('{'), '/api/settings', 'PUT')
  })

  it('PUT /api/settings declares the 413 it returns for an oversized body', async () => {
    const { app } = buildApp()
    expectContract(await request(app).put('/api/settings').send({ pad: 'x'.repeat(210_000) }), '/api/settings', 'PUT')
  })
})
