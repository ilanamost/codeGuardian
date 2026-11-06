import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { AnalyzerError } from '../src/analyzer/analyzer-error.js'
import type { Analyzer, AnalyzerResult } from '../src/analyzer/analyzer.js'
import { createClaudeAnalyzer } from '../src/analyzer/claude-analyzer.js'
import { createRateLimiter } from '../src/lib/rate-limit.js'
import { createReviewService } from '../src/service/review.service.js'
import { addReview, buildApp, demoOrgId, fixedNow, registerAgent, registrationOf, waitForStatus } from './helper/app.js'
import { expectContract, expectError } from './helper/contract.js'
import { captureLog, createFakeClaude, replyOf, sdkError, validAnalysis, type FakeHandler } from './helper/fake-claude.js'

const newReview = { source_type: 'snippet', title: 'Debug helper', language: 'TypeScript', content: 'const value: any = 1\neval(value)\n' }

function claudeAnalyzer(handler: FakeHandler = () => replyOf(validAnalysis)) {
  const client = createFakeClaude(handler)
  return { client, analyzer: createClaudeAnalyzer({ client, model: 'claude-test-model', logger: captureLog() }) }
}

// An analyzer of kind `claude` that fails the way a real one would, without a client.
function failingAnalyzer(error: unknown): Analyzer {
  return {
    kind: 'claude',
    analyze: () => Promise.reject(error),
    regenerateTest: () => Promise.reject(error)
  }
}

const emptyResult: AnalyzerResult = { qualityScore: 100, findingCount: [], finding: [], suggestion: [], generatedTest: [] }

describe('GET /api/health analyzer (contract 0.14.0)', () => {
  it('says claude with the Claude analyzer and stub otherwise', async () => {
    const claude = buildApp({ analyzer: claudeAnalyzer().analyzer })
    const stub = buildApp()

    const claudeResponse = await request(claude.rawApp).get('/api/health')
    const stubResponse = await request(stub.rawApp).get('/api/health')

    expect(claudeResponse.body).toEqual({ status: 'ok', analyzer: 'claude', githubOAuth: false })
    expect(stubResponse.body).toEqual({ status: 'ok', analyzer: 'stub', githubOAuth: false })
    expectContract(claudeResponse, '/api/health', 'GET')
  })
})

describe('failureReason on every review response', () => {
  it('is null while pending and when completed, on create, get and run', async () => {
    const { app } = buildApp({ analyzer: claudeAnalyzer().analyzer })

    const created = await request(app).post('/api/review').send(newReview)
    expect(created.status).toBe(202)
    expect(created.body.failureReason).toBeNull()
    expectContract(created, '/api/review', 'POST')
    const done = await waitForStatus(app, created.body.id, 'completed')
    expect(done.body.failureReason).toBeNull()
    expectContract(done, '/api/review/{id}', 'GET')

    const run = await request(app).post(`/api/review/${created.body.id}/run`).send({ language: 'TypeScript', code: 'const a = 1\n' })
    expect(run.status).toBe(202)
    expect(run.body.failureReason).toBeNull()
    expectContract(run, '/api/review/{id}/run', 'POST')
  })

  it('the Claude analyzer result is stored with server ids and counts', async () => {
    const { app } = buildApp({ analyzer: claudeAnalyzer().analyzer })
    const created = await request(app).post('/api/review').send(newReview)

    const done = await waitForStatus(app, created.body.id, 'completed')

    expect(done.body.finding.map((item: { id: string }) => item.id)).toEqual(['f1', 'f2', 'f3'])
    expect(done.body.qualityScore).toBe(64)
    expect(done.body.generatedTest).toHaveLength(1)
  })

  const reasonCases: [string, unknown, string][] = [
    ['ai_timeout', new AnalyzerError('ai_timeout'), 'ai_timeout'],
    ['ai_invalid_output', new AnalyzerError('ai_invalid_output'), 'ai_invalid_output'],
    ['ai_refused', new AnalyzerError('ai_refused'), 'ai_refused'],
    ['ai_unavailable', new AnalyzerError('ai_unavailable'), 'ai_unavailable'],
    ['ai_rate_limited', new AnalyzerError('ai_rate_limited'), 'ai_rate_limited'],
    ['an error that is not an AnalyzerError', new TypeError('boom'), 'internal']
  ]
  for (const [name, error, reason] of reasonCases) {
    it(`a failed review reads ${reason} (${name}) and stores nothing`, async () => {
      const { app } = buildApp({ analyzer: failingAnalyzer(error) })
      const created = await request(app).post('/api/review').send(newReview)

      const failed = await waitForStatus(app, created.body.id, 'failed')

      expect(failed.body.failureReason).toBe(reason)
      expect(failed.body.finding).toEqual([])
      expect(failed.body.suggestion).toEqual([])
      expect(failed.body.generatedTest).toEqual([])
      expect(failed.body.findingCount).toEqual([])
      expectContract(failed, '/api/review/{id}', 'GET')
    })
  }

  it('a failed review with a fake analyzer run through the real client maps a refusal end to end', async () => {
    const { analyzer } = claudeAnalyzer(() => replyOf('', { stopReason: 'refusal' }))
    const { app } = buildApp({ analyzer })
    const created = await request(app).post('/api/review').send(newReview)

    const failed = await waitForStatus(app, created.body.id, 'failed')

    expect(failed.body.failureReason).toBe('ai_refused')
    expect(failed.body.finding).toEqual([])
  })

  it('a new run clears the reason', async () => {
    let fail = true
    const analyzer: Analyzer = {
      kind: 'claude',
      analyze: () => (fail ? Promise.reject(new AnalyzerError('ai_timeout')) : Promise.resolve(emptyResult)),
      regenerateTest: () => Promise.resolve([])
    }
    const { app } = buildApp({ analyzer })
    const created = await request(app).post('/api/review').send(newReview)
    const failed = await waitForStatus(app, created.body.id, 'failed')
    expect(failed.body.failureReason).toBe('ai_timeout')

    fail = false
    const run = await request(app).post(`/api/review/${created.body.id}/run`).send({ language: 'TypeScript', code: 'a\n' })
    expect(run.body.failureReason).toBeNull()
    const done = await waitForStatus(app, created.body.id, 'completed')

    expect(done.body.failureReason).toBeNull()
  })

  it('a failed review with no stored reason (from before 0.14.0) reads internal', async () => {
    const { app, store } = buildApp()
    addReview(store, { id: 'old', status: 'failed', finding: [], findingCount: [], suggestion: [], generatedTest: [] })

    const response = await request(app).get('/api/review/old')

    expect(response.body.failureReason).toBe('internal')
  })

  it('the stub analyzer never fails with a reason', async () => {
    const { app } = buildApp()
    const created = await request(app).post('/api/review').send(newReview)

    const done = await waitForStatus(app, created.body.id, 'completed')

    expect(done.body.failureReason).toBeNull()
  })
})

describe('analysis quota (20 per account per hour, Claude analyzer only)', () => {
  async function createMany(app: Parameters<typeof request>[0], count: number) {
    const idList: string[] = []
    for (let index = 0; index < count; index += 1) {
      const response = await request(app).post('/api/review').send(newReview)
      expect(response.status).toBe(202)
      idList.push(response.body.id as string)
    }
    return idList
  }

  it('the 21st create gets 429 rate_limited with details.resetAt and Retry-After, and creates nothing', async () => {
    const { app } = buildApp({ analyzer: claudeAnalyzer().analyzer })
    await createMany(app, 20)

    const response = await request(app).post('/api/review').send(newReview)

    expectError(response, 429, 'rate_limited')
    expectContract(response, '/api/review', 'POST')
    expect(response.body.error.details.resetAt).toBe(new Date(fixedNow + 3600 * 1000).toISOString())
    expect(response.headers['retry-after']).toBe('3600')
    expect((await request(app).get('/api/review')).body).toHaveLength(20)
  })

  it('run answers 429 and leaves the review as it was', async () => {
    const { app } = buildApp({ analyzer: claudeAnalyzer().analyzer })
    const [first] = await createMany(app, 20)
    await waitForStatus(app, first as string, 'completed')
    const before = await request(app).get(`/api/review/${first}`)

    const response = await request(app).post(`/api/review/${first}/run`).send({ language: 'Python', code: 'x = 1\n' })

    expectError(response, 429, 'rate_limited')
    expectContract(response, '/api/review/{id}/run', 'POST')
    const after = await request(app).get(`/api/review/${first}`)
    expect(after.body).toEqual(before.body)
    expect(after.body.savedAt).toBeNull()
  })

  it('regenerate counts against the quota and answers 429 over it, storing nothing', async () => {
    const { app } = buildApp({ analyzer: claudeAnalyzer((request_) => (request_.user.includes('previous_test') ? replyOf({ code: 'REGENERATED' }) : replyOf(validAnalysis))).analyzer })
    const [first] = await createMany(app, 19)
    await waitForStatus(app, first as string, 'completed')

    const twentieth = await request(app).post(`/api/review/${first}/generated-test`)
    expect(twentieth.status).toBe(200)
    expect(twentieth.body[0].code).toBe('REGENERATED')
    const over = await request(app).post(`/api/review/${first}/generated-test`)

    expectError(over, 429, 'rate_limited')
    expectContract(over, '/api/review/{id}/generated-test', 'POST')
    expect(over.body.error.details.resetAt).toBeDefined()
    expect((await request(app).get(`/api/review/${first}`)).body.generatedTest[0].code).toBe('REGENERATED')
  })

  it('is per account, not shared', async () => {
    const { app, rawApp } = buildApp({ analyzer: claudeAnalyzer().analyzer })
    await createMany(app, 20)
    const other = await registerAgent(rawApp, registrationOf('quota-other'))

    const response = await other.post('/api/review').send(newReview)

    expect(response.status).toBe(202)
  })

  it('accepts a new analysis once the hour has passed', async () => {
    let time = fixedNow
    const { app } = buildApp({ analyzer: claudeAnalyzer().analyzer, now: () => time })
    await createMany(app, 20)
    expect((await request(app).post('/api/review').send(newReview)).status).toBe(429)

    time += 3600 * 1000 + 1

    expect((await request(app).post('/api/review').send(newReview)).status).toBe(202)
  })

  it('a validation error or a 409 does not use up the quota', async () => {
    const { app } = buildApp({ analyzer: claudeAnalyzer().analyzer })
    await createMany(app, 19)
    await request(app).post('/api/review').send({ ...newReview, content: '' })
    await request(app).post('/api/review/does-not-exist/run').send({ language: 'TypeScript', code: 'a' })

    expect((await request(app).post('/api/review').send(newReview)).status).toBe(202)
  })

  it('the stub analyzer has no quota', async () => {
    const { app } = buildApp()

    await createMany(app, 25)
  })

  it('the test-only reset starts the quota again', async () => {
    const { app } = buildApp({ analyzer: claudeAnalyzer().analyzer }, true)
    await createMany(app, 20)
    expect((await request(app).post('/api/review').send(newReview)).status).toBe(429)

    expect((await request(app).post('/api/test/reset')).status).toBe(204)

    expect((await request(app).post('/api/review').send(newReview)).status).toBe(202)
  })
})

describe('regenerate with the Claude analyzer', () => {
  async function completedReview(handler: FakeHandler) {
    const { analyzer, client } = claudeAnalyzer(handler)
    const built = buildApp({ analyzer })
    const created = await request(built.app).post('/api/review').send(newReview)
    const done = await waitForStatus(built.app, created.body.id, 'completed')
    return { ...built, client, id: created.body.id as string, before: done.body.generatedTest as { code: string, altCode: string }[] }
  }

  it('stores the model test as code and the previous one as altCode', async () => {
    const { app, id, before } = await completedReview((req) => (req.user.includes('previous_test') ? replyOf({ code: 'NEW TEST' }) : replyOf(validAnalysis)))

    const response = await request(app).post(`/api/review/${id}/generated-test`).send({ framework: 'Vitest', testTypeIdList: ['unit'] })

    expect(response.status).toBe(200)
    expectContract(response, '/api/review/{id}/generated-test', 'POST')
    expect(response.body[0]).toMatchObject({ code: 'NEW TEST', altCode: before[0]?.code })
    const stored = await request(app).get(`/api/review/${id}`)
    expect(stored.body.generatedTest[0].code).toBe('NEW TEST')
    expect(stored.body.testConfig).toEqual({ framework: 'Vitest', testTypeIdList: ['unit'] })
  })

  const errorCases: [string, () => Error, number, string][] = [
    ['the provider failing', () => sdkError(500), 502, 'upstream_error'],
    ['a connection error', () => sdkError(401), 502, 'upstream_error'],
    ['a rate limit', () => sdkError(429), 429, 'rate_limited'],
    ['a bad request', () => sdkError(400), 502, 'upstream_error']
  ]
  for (const [name, make, status, code] of errorCases) {
    it(`${name} answers ${status} ${code} and stores nothing`, async () => {
      let regenerating = false
      const { app, id, before } = await completedReview(() => {
        if (regenerating) throw make()
        return replyOf(validAnalysis)
      })
      regenerating = true

      const response = await request(app).post(`/api/review/${id}/generated-test`).send({ framework: 'Mocha', testTypeIdList: ['edge'] })

      expectError(response, status, code)
      expectContract(response, '/api/review/{id}/generated-test', 'POST')
      expect(JSON.stringify(response.body)).not.toContain('provider body')
      const stored = await request(app).get(`/api/review/${id}`)
      expect(stored.body.generatedTest).toEqual(before)
      expect(stored.body.testConfig.framework).toBe('Jest')
    })
  }

  it('a refusal and an invalid answer are 502', async () => {
    let mode: 'ok' | 'refuse' | 'invalid' = 'ok'
    const { app, id } = await completedReview(() => {
      if (mode === 'refuse') return replyOf('', { stopReason: 'refusal' })
      if (mode === 'invalid') return replyOf({ wrong: true })
      return replyOf(validAnalysis)
    })

    mode = 'refuse'
    expectError(await request(app).post(`/api/review/${id}/generated-test`), 502, 'upstream_error')
    mode = 'invalid'
    expectError(await request(app).post(`/api/review/${id}/generated-test`), 502, 'upstream_error')
  })

  it('the regenerate deadline answers 504 upstream_timeout with details.limit totalTimeout', async () => {
    const analyzer: Analyzer = { kind: 'claude', analyze: () => Promise.resolve(emptyResult), regenerateTest: () => Promise.reject(new AnalyzerError('ai_timeout')) }
    const { app, store } = buildApp({ analyzer })
    addReview(store, { id: 'done-1' })

    const response = await request(app).post('/api/review/done-1/generated-test')

    expectError(response, 504, 'upstream_timeout')
    expectContract(response, '/api/review/{id}/generated-test', 'POST')
    expect(response.body.error.details).toEqual({ limit: 'totalTimeout', maxMs: 60_000 })
    expect((await request(app).get('/api/review/done-1')).body.generatedTest[0].code).toBe('first a')
  })

  it('an analyzer bug that is not an AnalyzerError stays a 500', async () => {
    const analyzer: Analyzer = { kind: 'claude', analyze: () => Promise.resolve(emptyResult), regenerateTest: () => Promise.reject(new TypeError('bug')) }
    const { app, store } = buildApp({ analyzer })
    addReview(store, { id: 'done-2' })

    expectError(await request(app).post('/api/review/done-2/generated-test'), 500, 'internal_error')
  })
})

describe('concurrency: at most 3 provider calls, the rest queued', () => {
  it('shows queued while waiting for a slot, then in_progress, then completed', async () => {
    const gate: (() => void)[] = []
    let running = 0
    let peak = 0
    const analyzer: Analyzer = {
      kind: 'claude',
      analyze: async () => {
        running += 1
        peak = Math.max(peak, running)
        await new Promise<void>((resolve) => gate.push(resolve))
        running -= 1
        return emptyResult
      },
      regenerateTest: () => Promise.resolve([])
    }
    const { app } = buildApp({ analyzer })
    const idList: string[] = []
    for (let index = 0; index < 5; index += 1) idList.push((await request(app).post('/api/review').send(newReview)).body.id as string)

    await waitForStatus(app, idList[2] as string, 'in_progress')
    await waitForStatus(app, idList[3] as string, 'queued')
    await waitForStatus(app, idList[4] as string, 'queued')
    expect(peak).toBe(3)
    expect((await request(app).get('/api/review')).body.map((row: { status: string }) => row.status).sort()).toEqual(['in_progress', 'in_progress', 'in_progress', 'queued', 'queued'])

    gate.shift()?.()
    await waitForStatus(app, idList[0] as string, 'completed')
    await waitForStatus(app, idList[3] as string, 'in_progress')
    expect((await request(app).get(`/api/review/${idList[4]}`)).body.status).toBe('queued')

    while (gate.length > 0 || running > 0) {
      gate.shift()?.()
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    for (const id of idList) await waitForStatus(app, id, 'completed')
    expect(peak).toBe(3)
  })

  it('a review deleted while it waits is never sent to the provider', async () => {
    const gate: (() => void)[] = []
    let callCount = 0
    const analyzer: Analyzer = {
      kind: 'claude',
      analyze: async () => {
        callCount += 1
        await new Promise<void>((resolve) => gate.push(resolve))
        return emptyResult
      },
      regenerateTest: () => Promise.resolve([])
    }
    const { app } = buildApp({ analyzer })
    const idList: string[] = []
    for (let index = 0; index < 4; index += 1) idList.push((await request(app).post('/api/review').send(newReview)).body.id as string)
    await waitForStatus(app, idList[3] as string, 'queued')

    expect((await request(app).delete(`/api/review/${idList[3]}`)).status).toBe(204)
    while (gate.length < 3) await new Promise((resolve) => setTimeout(resolve, 5))
    for (const release of gate.splice(0)) release()
    await waitForStatus(app, idList[0] as string, 'completed')
    await new Promise((resolve) => setTimeout(resolve, 30))

    expect(callCount).toBe(3)
  })

  it('a failure releases the slot', async () => {
    const analyzer = failingAnalyzer(new AnalyzerError('ai_unavailable'))
    const { app } = buildApp({ analyzer })
    const idList: string[] = []
    for (let index = 0; index < 8; index += 1) idList.push((await request(app).post('/api/review').send(newReview)).body.id as string)

    for (const id of idList) await waitForStatus(app, id, 'failed')
  })
})

describe('reviews resumed on start (plan 022, Open Question 7)', () => {
  function pendingStore(count: number) {
    const { store } = buildApp()
    for (let index = 0; index < count; index += 1) addReview(store, { id: `p${index}`, status: 'pending', finding: [], findingCount: [], suggestion: [], generatedTest: [] })
    return store
  }

  it('fails with ai_quota_exceeded when the org has spent its analyses, without a provider call', async () => {
    const store = pendingStore(2)
    const { analyzer, client } = claudeAnalyzer()
    const quota = createRateLimiter({ limit: 20, windowMs: 3600_000, now: () => fixedNow })
    for (let index = 0; index < 20; index += 1) quota.hit(demoOrgId)
    const service = createReviewService(store, analyzer, () => fixedNow, { quota })

    expect(await service.resumeUnfinished()).toBe(2)
    await new Promise((resolve) => setTimeout(resolve, 50))

    for (const id of ['p0', 'p1']) {
      const record = await store.findReview(demoOrgId, id)
      expect(record?.review.status).toBe('failed')
      expect(record?.failureReason).toBe('ai_quota_exceeded')
    }
    expect(client.requestList).toHaveLength(0)
  })

  it('analyzes within the quota and charges it', async () => {
    const store = pendingStore(2)
    const { analyzer, client } = claudeAnalyzer()
    const quota = createRateLimiter({ limit: 1, windowMs: 3600_000, now: () => fixedNow })
    const service = createReviewService(store, analyzer, () => fixedNow, { quota })

    await service.resumeUnfinished()
    await new Promise((resolve) => setTimeout(resolve, 80))

    const statusList = await Promise.all(['p0', 'p1'].map(async (id) => (await store.findReview(demoOrgId, id))?.review.status))
    expect(statusList.filter((status) => status === 'completed')).toHaveLength(1)
    expect(statusList.filter((status) => status === 'failed')).toHaveLength(1)
    expect(client.requestList).toHaveLength(1)
  })
})
