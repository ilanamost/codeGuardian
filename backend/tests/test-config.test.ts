import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { configuredTestCode, createStubAnalyzer } from '../src/analyzer/stub-analyzer.js'
import type { TestConfig } from '../src/model/dto.js'
import { addReview, buildApp, demoOrgId, newAgent, registerAgent, registrationOf, signInCookie, waitForStatus } from './helper/app.js'
import { expectContract, expectError } from './helper/contract.js'

// Plan 034, Workstream C (Open Question 4, answer A): the test configuration is stored with the
// review, sent with Regenerate, and the generator honors it.

const defaultConfig = { framework: 'Jest', testTypeIdList: ['unit', 'edge', 'error'] }
const input = { reviewId: 'abc', title: 'Payment API', language: 'TypeScript', content: 'const a = 1\n' }

// The stub's generated test before plan 034, unchanged for a review without a configuration.
const legacyCode = "// Stub generated test for payment-api.ts\ndescribe('payment-api', () => {\n  it('loads the module', () => {\n    expect(true).toBe(true)\n  })\n})\n"
const legacyAltCode = "// Stub generated test for payment-api.ts (regenerated)\ndescribe('payment-api (regenerated)', () => {\n  it('still loads the module', () => {\n    expect(true).toBe(true)\n  })\n})\n"

const allType = ['unit', 'edge', 'error'] as const

describe('stub analyzer: test configuration', () => {
  it('without a configuration gives exactly the original generated test (old reviews read the same)', async () => {
    const result = await createStubAnalyzer().analyze(input)

    expect(result.generatedTest).toEqual([{
      id: 'abc-t1', sourceFile: 'payment-api.ts', testFile: 'payment-api.test.ts', language: 'TypeScript', code: legacyCode, altCode: legacyAltCode
    }])
  })

  it.each([
    ['Jest', "from '@jest/globals'", '.toBe(', '.toThrow()'],
    ['Vitest', "from 'vitest'", '.toBe(', '.toThrow()'],
    ['Mocha', "from 'chai'", '.to.equal(', '.to.throw()']
  ] as const)('writes %s syntax', async (framework, importText, equal, throwing) => {
    const result = await createStubAnalyzer().analyze({ ...input, testConfig: { framework, testTypeIdList: [...allType] } })
    const code = result.generatedTest[0]?.code ?? ''

    expect(code).toContain(`// Stub ${framework} tests for payment-api.ts`)
    expect(code).toContain(importText)
    expect(code).toContain(equal)
    expect(code).toContain(throwing)
    for (const other of ['@jest/globals', "'vitest'", "'chai'"].filter((item) => !importText.includes(item))) expect(code).not.toContain(other)
    if (framework === 'Mocha') {
      expect(code).toContain("import { describe, it } from 'mocha'")
      expect(code).not.toMatch(/\.toBe\(|\.toThrow\(/)
    } else {
      expect(code).not.toMatch(/\.to\.equal\(|\.to\.throw\(/)
    }
  })

  it.each([
    [['unit'], ['unit tests'], ['edge cases', 'error cases']],
    [['edge'], ['edge cases'], ['unit tests', 'error cases']],
    [['error'], ['error cases'], ['unit tests', 'edge cases']],
    [['unit', 'error'], ['unit tests', 'error cases'], ['edge cases']],
    [['unit', 'edge', 'error'], ['unit tests', 'edge cases', 'error cases'], []]
  ] as const)('with %j generates only those kinds of tests', async (typeList, presentList, absentList) => {
    const code = configuredTestCode('a.ts', { framework: 'Vitest', testTypeIdList: [...typeList] }, false)

    for (const title of presentList) expect(code).toContain(`describe('${title}'`)
    for (const title of absentList) expect(code).not.toContain(title)
    expect(code.match(/\bit\(/g)).toHaveLength(typeList.length)
  })

  it('regenerates with a configuration: the first variant, then the second, then back', async () => {
    const analyzer = createStubAnalyzer()
    const config: TestConfig = { framework: 'Mocha', testTypeIdList: ['edge'] }
    const file = { id: 't', sourceFile: 'a.ts', testFile: 'a.test.ts', language: 'TypeScript', code: 'old', altCode: 'older' }

    const once = await analyzer.regenerateTest([file], config)
    const twice = await analyzer.regenerateTest(once, config)
    const thrice = await analyzer.regenerateTest(twice, config)

    expect(once[0]).toMatchObject({ id: 't', sourceFile: 'a.ts', testFile: 'a.test.ts', code: configuredTestCode('a.ts', config, false) })
    expect(twice[0]?.code).toBe(configuredTestCode('a.ts', config, true))
    expect(twice[0]?.code).toContain('(regenerated)')
    expect(thrice[0]?.code).toBe(once[0]?.code)
  })

  it('keeps a hostile source file name inside one string literal', () => {
    const code = configuredTestCode("x'); process.exit(1); ('\n.ts", { framework: 'Jest', testTypeIdList: ['unit'] }, false)

    expect(code).toContain("describe('x\\'); process.exit(1); (\\' ', () => {")
    expect(code.split('\n')[0]).toBe("// Stub Jest tests for x'); process.exit(1); (' .ts")
  })
})

describe('the review carries its test configuration', () => {
  it('reads as the default for a review without one (every review before migration 004)', async () => {
    const { app, store } = buildApp()
    addReview(store, { id: 'old' })

    const response = await request(app).get('/api/review/old')

    expectContract(response, '/api/review/{id}', 'GET')
    expect(response.body.testConfig).toEqual(defaultConfig)
    // The stored generated tests are not changed by reading.
    expect(response.body.generatedTest.map((file: { code: string }) => file.code)).toEqual(['first a', 'first b'])
  })

  it('is returned by create (the default) and the first tests are the original ones', async () => {
    const { app } = buildApp()

    const created = await request(app).post('/api/review').send({ source_type: 'snippet', title: 'Payment API', language: 'TypeScript', content: 'const a = 1\n' })

    expectContract(created, '/api/review', 'POST')
    expect(created.body.testConfig).toEqual(defaultConfig)
    const done = await waitForStatus(app, created.body.id, 'completed')
    expect(done.body.generatedTest[0].code).toBe(legacyCode)
  })
})

describe('POST /api/review/{id}/generated-test with a test configuration', () => {
  it('stores the configuration, returns files in that framework with only the chosen kinds, and GET returns both', async () => {
    const { app, store } = buildApp()
    addReview(store, { id: 'r1' })
    const config = { framework: 'Vitest', testTypeIdList: ['edge'] }

    const response = await request(app).post('/api/review/r1/generated-test').send(config)

    expectContract(response, '/api/review/{id}/generated-test', 'POST')
    expect(response.status).toBe(200)
    expect(response.body.map((file: { id: string }) => file.id)).toEqual(['r1-t1', 'r1-t2'])
    for (const file of response.body as { code: string, sourceFile: string }[]) {
      expect(file.code).toBe(configuredTestCode(file.sourceFile, config as TestConfig, false))
      expect(file.code).toContain("from 'vitest'")
      expect(file.code).toContain('edge cases')
      expect(file.code).not.toContain('unit tests')
      expect(file.code).not.toContain('error cases')
    }
    const read = await request(app).get('/api/review/r1')
    expect(read.body.testConfig).toEqual(config)
    expect(read.body.generatedTest).toEqual(response.body)
  })

  it.each([
    ['Jest', "from '@jest/globals'"],
    ['Vitest', "from 'vitest'"],
    ['Mocha', "from 'chai'"]
  ])('generates %s syntax', async (framework, importText) => {
    const { app, store } = buildApp()
    addReview(store, { id: 'r1' })

    const response = await request(app).post('/api/review/r1/generated-test').send({ framework, testTypeIdList: ['unit', 'edge', 'error'] })

    expect(response.status).toBe(200)
    expect(response.body[0].code).toContain(importText)
  })

  it('stores the kinds in the unit, edge, error order whatever order is sent', async () => {
    const { app, store } = buildApp()
    addReview(store, { id: 'r1' })

    await request(app).post('/api/review/r1/generated-test').send({ framework: 'Jest', testTypeIdList: ['error', 'unit'] })

    expect((await request(app).get('/api/review/r1')).body.testConfig).toEqual({ framework: 'Jest', testTypeIdList: ['unit', 'error'] })
  })

  it('without a body uses the stored configuration (the next variant), and keeps it', async () => {
    const { app, store } = buildApp()
    addReview(store, { id: 'r1' })
    const config = { framework: 'Mocha', testTypeIdList: ['unit', 'error'] } as TestConfig
    await request(app).post('/api/review/r1/generated-test').send(config)

    const again = await request(app).post('/api/review/r1/generated-test')

    expect(again.status).toBe(200)
    expect(again.body[0].code).toBe(configuredTestCode('a.ts', config, true))
    expect((await request(app).get('/api/review/r1')).body.testConfig).toEqual(config)
  })

  it('without a body on a review that has no configuration regenerates exactly as before', async () => {
    const { app, store } = buildApp()
    addReview(store, { id: 'r1' })

    const response = await request(app).post('/api/review/r1/generated-test').send({})

    expect(response.body.map((file: { code: string }) => file.code)).toEqual(['second a', 'second b'])
    expect(store.state.reviewList[0]?.testConfig ?? null).toBeNull()
  })

  it('a later run generates its first tests with the stored configuration', async () => {
    const { app, store } = buildApp()
    addReview(store, { id: 'r1', title: 'Payment API' })
    await request(app).post('/api/review/r1/generated-test').send({ framework: 'Vitest', testTypeIdList: ['error'] })

    const run = await request(app).post('/api/review/r1/run').send({ language: 'TypeScript', code: 'const b = 2\n' })

    expectContract(run, '/api/review/{id}/run', 'POST')
    expect(run.body.testConfig).toEqual({ framework: 'Vitest', testTypeIdList: ['error'] })
    const done = await waitForStatus(app, 'r1', 'completed')
    expect(done.body.generatedTest[0].code).toBe(configuredTestCode('payment-api.ts', { framework: 'Vitest', testTypeIdList: ['error'] }, false))
    expect(done.body.testConfig).toEqual({ framework: 'Vitest', testTypeIdList: ['error'] })
  })

  it.each([
    ['an empty testTypeIdList', { framework: 'Jest', testTypeIdList: [] }, 'testTypeIdList'],
    ['an unknown test type', { framework: 'Jest', testTypeIdList: ['unit', 'smoke'] }, 'testTypeIdList.1'],
    ['a repeated test type', { framework: 'Jest', testTypeIdList: ['unit', 'unit'] }, 'testTypeIdList'],
    ['too many test types', { framework: 'Jest', testTypeIdList: ['unit', 'edge', 'error', 'unit'] }, 'testTypeIdList'],
    ['a lower-case framework', { framework: 'jest', testTypeIdList: ['unit'] }, 'framework'],
    ['an unknown framework', { framework: 'Jasmine', testTypeIdList: ['unit'] }, 'framework'],
    ['a missing framework', { testTypeIdList: ['unit'] }, 'framework'],
    ['a missing testTypeIdList', { framework: 'Jest' }, 'testTypeIdList'],
    ['a testTypeIdList that is not a list', { framework: 'Jest', testTypeIdList: 'unit' }, 'testTypeIdList'],
    ['an unknown field', { framework: 'Jest', testTypeIdList: ['unit'], extra: true }, 'test configuration'],
    ['a list body', [{ framework: 'Jest', testTypeIdList: ['unit'] }], 'test configuration']
  ])('refuses %s with 422, and nothing is stored', async (_label, body, field) => {
    const { app, store } = buildApp()
    addReview(store, { id: 'r1' })
    const before = JSON.stringify(store.state.reviewList)

    const response = await request(app).post('/api/review/r1/generated-test').send(body)

    expectError(response, 422, 'validation_error')
    expectContract(response, '/api/review/{id}/generated-test', 'POST')
    expect(response.body.error.details.issue[0].field).toBe(field)
    expect(JSON.stringify(store.state.reviewList)).toBe(before)
  })

  it('answers 409 for a review that is not completed, and stores nothing', async () => {
    const { app, store } = buildApp()
    addReview(store, { id: 'r1', status: 'failed' })

    const response = await request(app).post('/api/review/r1/generated-test').send(defaultConfig)

    expectError(response, 409, 'conflict')
    expect(store.state.reviewList[0]?.testConfig ?? null).toBeNull()
  })

  it('answers 404 for an unknown id and for a review of another account, which keeps its configuration', async () => {
    const { app, rawApp, store } = buildApp()
    addReview(store, { id: 'r1' })
    const aliceAgent = await registerAgent(rawApp, registrationOf('alice'))

    expectError(await request(app).post('/api/review/missing/generated-test').send(defaultConfig), 404, 'not_found')
    const foreign = await aliceAgent.post('/api/review/r1/generated-test').send({ framework: 'Mocha', testTypeIdList: ['unit'] })

    expectError(foreign, 404, 'not_found')
    expect(store.orgMap.get(demoOrgId)?.reviewList[0]?.testConfig ?? null).toBeNull()
  })

  it('answers 401 without a session and 403 without the CSRF header', async () => {
    const { rawApp, store } = buildApp()
    addReview(store, { id: 'r1' })
    const cookie = await signInCookie(rawApp)

    expectError(await newAgent(rawApp).post('/api/review/r1/generated-test').send(defaultConfig), 401, 'unauthorized')
    expectError(await request(rawApp).post('/api/review/r1/generated-test').set('cookie', cookie).send(defaultConfig), 403, 'forbidden')
    expect(store.state.reviewList[0]?.testConfig ?? null).toBeNull()
  })
})

describe('MemoryStore: the test configuration', () => {
  it('replaceGeneratedTest stores a given configuration with the files, and keeps it when none is given', async () => {
    const { store } = buildApp()
    addReview(store, { id: 'r1' })
    const config: TestConfig = { framework: 'Vitest', testTypeIdList: ['unit'] }

    expect(await store.replaceGeneratedTest(demoOrgId, 'r1', [], config)).toBe(true)
    expect((await store.findReview(demoOrgId, 'r1'))?.testConfig).toEqual(config)
    expect(await store.replaceGeneratedTest(demoOrgId, 'r1', [])).toBe(true)
    expect((await store.findReview(demoOrgId, 'r1'))?.testConfig).toEqual(config)
    // A copy: changing the caller's object changes nothing stored.
    config.testTypeIdList.push('edge')
    expect((await store.findReview(demoOrgId, 'r1'))?.testConfig?.testTypeIdList).toEqual(['unit'])
  })
})
