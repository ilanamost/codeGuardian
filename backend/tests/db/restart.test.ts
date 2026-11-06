import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Analyzer, AnalyzerResult } from '../../src/analyzer/analyzer.js'
import { createStubAnalyzer } from '../../src/analyzer/stub-analyzer.js'
import { createApp } from '../../src/app.js'
import { createReviewService } from '../../src/service/review.service.js'
import { createMemoryStore } from '../../src/store/memory-store.js'
import { connectPgStore, type PgStore } from '../../src/store/pg-store.js'
import type { Store } from '../../src/store/store.js'
import { analyzerResult, fixedNow, frontendUrl, msPerDay, reviewRecord } from './fixture.js'
import { testDatabaseUrl } from './helper.js'
import { signedInClient } from '../helper/app.js'
import { fakeGithubClient, fakeUser } from '../helper/github.js'

// The bug (AI-42): everything the user changes survives a restart. "Restart" here is what the
// server does: close the pool, connect a new store to the same database, build a new app.

const url = testDatabaseUrl()
// Plan 028: the demo account's org; every request is signed in as it.
const demoOrg = 'default'
const seededPassword = 'mock-password'
const openList: PgStore[] = []

async function connect(): Promise<PgStore> {
  const store = await connectPgStore(url, 'TEST_DATABASE_URL')
  openList.push(store)
  return store
}

function appOf(store: Store, analyzer: Analyzer = createStubAnalyzer(), now = () => fixedNow) {
  return signedInClient(createApp({ frontendUrl, enableTestRoute: false }, { store, analyzer, now, securityLogger: { info: () => undefined, warn: () => undefined }, githubClient: fakeGithubClient() }), store)
}

async function waitForStatus(app: ReturnType<typeof createApp>, id: string, status: string) {
  await vi.waitFor(async () => {
    expect((await request(app).get(`/api/review/${id}`)).body.status).toBe(status)
  }, { timeout: 10_000, interval: 25 })
}

beforeEach(async () => {
  const store = await connect()
  await store.reset()
})

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(openList.splice(0).map((store) => store.close().catch(() => undefined)))
})

describe('restart survival', () => {
  it('reviews, saved edits, renames, deletions, settings, password, GitHub and support requests all survive', async () => {
    const first = await connect()
    const app = appOf(first)
    const kept = await request(app).post('/api/review').send({ source_type: 'snippet', title: 'Keep me', language: 'TypeScript', content: 'const value: any = eval(input)\n' })
    const removed = await request(app).post('/api/review').send({ source_type: 'snippet', language: 'Go', content: 'package main\n' })
    await waitForStatus(app, kept.body.id, 'completed')
    await waitForStatus(app, removed.body.id, 'completed')
    expect((await request(app).put(`/api/review/${kept.body.id}`).send({ language: 'JavaScript', code: 'let saved = 1\n' })).status).toBe(200)
    expect((await request(app).patch(`/api/review/${kept.body.id}`).send({ name: 'Renamed' })).status).toBe(200)
    expect((await request(app).delete(`/api/review/${removed.body.id}`)).status).toBe(204)
    const settings = (await request(app).get('/api/settings')).body
    expect((await request(app).put('/api/settings').send({ ...settings, theme: 'dark', editorFontSize: 'large' })).status).toBe(204)
    expect((await request(app).put('/api/account/password').send({ currentPassword: seededPassword, newPassword: 'after-restart-1' })).status).toBe(204)
    expect((await request(app).post('/api/github/connect').send({ username: fakeUser })).status).toBe(200)
    const ticket = (await request(app).post('/api/support-request')
      .send({ issueType: 'other', email: 'john@company.com', reviewId: kept.body.id, priority: 'low', description: 'Sent before the restart.' })).body.ticket
    const before = {
      list: (await request(app).get('/api/review')).body,
      review: (await request(app).get(`/api/review/${kept.body.id}`)).body,
      dashboard: (await request(app).get('/api/dashboard')).body,
      settings: (await request(app).get('/api/settings')).body
    }
    await first.close()

    const second = await connect()
    const restarted = appOf(second)

    expect((await request(restarted).get('/api/review')).body).toEqual(before.list)
    expect((await request(restarted).get(`/api/review/${kept.body.id}`)).body).toEqual(before.review)
    expect(before.review).toMatchObject({ title: 'Renamed', language: 'JavaScript', content: 'let saved = 1\n', status: 'completed' })
    expect((await request(restarted).get(`/api/review/${removed.body.id}`)).status).toBe(404)
    expect((await request(restarted).get('/api/dashboard')).body).toEqual(before.dashboard)
    expect((await request(restarted).get('/api/settings')).body).toEqual(before.settings)
    expect((await request(restarted).put('/api/account/password').send({ currentPassword: seededPassword, newPassword: 'x-another-1' })).status).toBe(422)
    expect((await request(restarted).put('/api/account/password').send({ currentPassword: 'after-restart-1', newPassword: 'x-another-1' })).status).toBe(204)
    // Plan 030: the connected login survives the restart, and the wizard reads it.
    expect(await second.getGithubConnection(demoOrg)).toEqual({ login: fakeUser, name: 'Example User' })
    expect((await request(restarted).get('/api/github/repo')).body.items[0]).toEqual({ id: 'demo', name: 'demo', description: 'A small demo repository' })
    expect((await request(restarted).post('/api/support-request')
      .send({ issueType: 'other', email: 'john@company.com', reviewId: '', priority: 'low', description: 'Sent after the restart.' })).body.ticket)
      .toBe(`SUP-${Number(ticket.slice(4)) + 1}`)
  })

  it('a review completes after the 202 and its result is in the database', async () => {
    const store = await connect()
    const app = appOf(store)

    const created = await request(app).post('/api/review').send({ source_type: 'snippet', language: 'TypeScript', content: 'const value: any = 1\n' })
    expect(created.status).toBe(202)
    expect(created.body.status).toBe('pending')
    await waitForStatus(app, created.body.id, 'completed')

    const reader = await connect()
    const record = await reader.findReview(demoOrg, created.body.id)
    expect(record?.review.status).toBe('completed')
    expect(record?.review.finding.length).toBeGreaterThan(0)
  })

  it('a run started while an older analysis is late keeps the newer result', async () => {
    const store = await connect()
    let release: (result: AnalyzerResult) => void = () => undefined
    const late = new Promise<AnalyzerResult>((resolve) => { release = resolve })
    const stub = createStubAnalyzer()
    let call = 0
    const analyzer: Analyzer = { ...stub, analyze: (input) => (call++ === 0 ? late : stub.analyze(input)) }
    const app = appOf(store, analyzer)
    await store.createReview(demoOrg, reviewRecord('r1'))
    // Run 1's analysis is held. The review is marked failed meanwhile, so run 2 may start and
    // completes; then run 1's late result arrives and must be discarded.
    expect((await request(app).post('/api/review/r1/run').send({ language: 'Go', code: 'held' })).status).toBe(202)
    expect(await store.failReview(demoOrg, 'r1', 1, 'internal')).toBe(true)
    expect((await request(app).post('/api/review/r1/run').send({ language: 'Go', code: 'newer' })).status).toBe(202)
    await waitForStatus(app, 'r1', 'completed')
    const newer = (await request(app).get('/api/review/r1')).body

    release(analyzerResult({ qualityScore: 1 }))
    await new Promise((resolve) => setTimeout(resolve, 100))

    expect((await request(app).get('/api/review/r1')).body).toEqual(newer)
    expect(newer.analyzedContent).toBe('newer')
  })

  it('a failed review keeps its reason across a restart, and a new run clears it (plan 039)', async () => {
    const first = await connect()
    await first.createReview(demoOrg, reviewRecord('r1', { status: 'pending' }))
    expect(await first.failReview(demoOrg, 'r1', 0, 'ai_refused')).toBe(true)
    await first.close()

    const second = await connect()
    const app = appOf(second)
    const failed = await request(app).get('/api/review/r1')
    expect(failed.body).toMatchObject({ status: 'failed', failureReason: 'ai_refused', finding: [] })

    expect((await request(app).post('/api/review/r1/run').send({ language: 'Go', code: 'x' })).body.failureReason).toBeNull()
    await waitForStatus(app, 'r1', 'completed')
    expect((await request(app).get('/api/review/r1')).body.failureReason).toBeNull()
  })

  it('a review left pending is analyzed again after the restart and reaches completed', async () => {
    const first = await connect()
    await first.createReview(demoOrg, reviewRecord('left', { status: 'pending' }))
    await first.close()

    const second = await connect()
    const analyzer = createStubAnalyzer()
    expect(await createReviewService(second, analyzer, () => fixedNow).resumeUnfinished()).toBe(1)

    await waitForStatus(appOf(second, analyzer), 'left', 'completed')
  })
})

describe('dashboard SQL aggregates', () => {
  it('give the same Dashboard as the in-memory store for the same reviews', async () => {
    const pgStore = await connect()
    const memoryStore = createMemoryStore()
    const day = (offset: number) => fixedNow - offset * msPerDay
    const recordList = [
      reviewRecord('today', { createdAt: day(0) }),
      reviewRecord('yesterday', { createdAt: day(1), result: analyzerResult({ qualityScore: 41 }) }),
      reviewRecord('week', { createdAt: day(6), status: 'failed' }),
      reviewRecord('fortnight', { createdAt: day(13), result: analyzerResult({ qualityScore: 90, finding: [] }) }),
      reviewRecord('month', { createdAt: day(29), status: 'pending' }),
      reviewRecord('previous', { createdAt: day(45), result: analyzerResult({ qualityScore: 60 }) }),
      reviewRecord('ancient', { createdAt: day(200) }),
      reviewRecord('deleted', { createdAt: day(2) })
    ]
    for (const record of [...recordList].reverse()) {
      await pgStore.createReview(demoOrg, record)
      await memoryStore.createReview(demoOrg, record)
    }
    await pgStore.deleteReview(demoOrg, 'deleted')
    await memoryStore.deleteReview(demoOrg, 'deleted')

    const fromPg = (await request(appOf(pgStore)).get('/api/dashboard')).body
    const fromMemory = (await request(appOf(memoryStore)).get('/api/dashboard')).body

    expect(fromPg).toEqual(fromMemory)
    expect(fromPg.statList[0].value).toBe(7)
  })
})

describe('logging', () => {
  it('no log line contains submitted code, the password hash or the connection string', async () => {
    const lineList: string[] = []
    for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, level).mockImplementation((...arg: unknown[]) => { lineList.push(arg.map(String).join(' ')) })
    }
    const code = 'const secretMarker_9f2 = "do-not-log"'
    const failing: Analyzer = { ...createStubAnalyzer(), analyze: async () => { throw new Error('analysis failed') } }
    const store = await connect()
    const app = appOf(store, failing)

    const created = await request(app).post('/api/review').send({ source_type: 'snippet', language: 'TypeScript', content: code })
    await waitForStatus(app, created.body.id, 'failed')
    await request(app).put('/api/account/password').send({ currentPassword: 'wrong-one-1', newPassword: 'whatever-1' })
    const hash = (await store.getAccount(demoOrg))?.passwordHash ?? 'missing'
    await store.close()
    // A query on a closed pool fails inside a request: it is logged, safely.
    expect((await request(app).get(`/api/review/${created.body.id}`)).status).toBe(500)

    const everything = lineList.join('\n')
    expect(lineList.length).toBeGreaterThan(0)
    expect(everything).not.toContain('secretMarker_9f2')
    expect(everything).not.toContain(hash.split('$')[2])
    expect(everything).not.toContain(url)
    const password = new URL(url).password
    if (password) expect(everything).not.toContain(password)
  })
})
