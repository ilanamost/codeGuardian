import pg from 'pg'
import request from 'supertest'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Analyzer, AnalyzerInput, AnalyzerResult } from '../../src/analyzer/analyzer.js'
import { createStubAnalyzer } from '../../src/analyzer/stub-analyzer.js'
import { createApp } from '../../src/app.js'
import { createMemoryStore } from '../../src/store/memory-store.js'
import { applySchema } from '../../src/store/pg-schema.js'
import { connectPgStore, type PgStore } from '../../src/store/pg-store.js'
import type { Store } from '../../src/store/store.js'
import { analyzerResult, fixedNow, frontendUrl, msPerDay } from './fixture.js'
import { testDatabaseUrl } from './helper.js'
import { signedInClient } from '../helper/app.js'
import { fakeGithubClient, fakeUser } from '../helper/github.js'

// QA AI-43 (plan 022): adversarial checks on the PostgreSQL store, written by QA. They try to
// break persistence with input and timing the implementing agent's suite does not cover.

const url = testDatabaseUrl()
// Plan 028: the demo account's org; every request is signed in as it.
const demoOrg = 'default'
const openList: PgStore[] = []

async function connect(databaseUrl = url): Promise<PgStore> {
  const store = await connectPgStore(databaseUrl, 'TEST_DATABASE_URL')
  openList.push(store)
  return store
}

function appOf(store: Store, option: { analyzer?: Analyzer, now?: () => number, enableTestRoute?: boolean } = {}) {
  return signedInClient(createApp({ frontendUrl, enableTestRoute: option.enableTestRoute ?? false }, {
    store, analyzer: option.analyzer ?? createStubAnalyzer(), now: option.now ?? (() => fixedNow),
    securityLogger: { info: () => undefined, warn: () => undefined }, githubClient: fakeGithubClient()
  }), store)
}

async function waitForStatus(app: ReturnType<typeof createApp>, id: string, status: string) {
  await vi.waitFor(async () => {
    expect((await request(app).get(`/api/review/${id}`)).body.status).toBe(status)
  }, { timeout: 10_000, interval: 25 })
}

// An analyzer whose analyses finish only when the test releases them, in any order.
function gatedAnalyzer() {
  const pending: { input: AnalyzerInput, resolve: (result: AnalyzerResult) => void }[] = []
  const analyzer: Analyzer = {
    ...createStubAnalyzer(),
    analyze: (input) => new Promise((resolve) => { pending.push({ input, resolve }) })
  }
  return { analyzer, pending }
}

beforeEach(async () => {
  const store = await connect()
  await store.reset()
})

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(openList.splice(0).map((store) => store.close().catch(() => undefined)))
})

describe('QA AI-43: content round trip on PostgreSQL matches the memory store', () => {
  const tricky: [string, string][] = [
    ['SQL injection', "'); DROP TABLE review; --\n' OR '1'='1\n$$; TRUNCATE account; --\n\\'; DELETE FROM org; --"],
    ['unicode and emoji', 'const שלום = "日本語 🚀 🧪 é ñ ü"\n// 𝔘𝔫𝔦𝔠𝔬𝔡𝔢 ‍‏\n']
  ]

  // QA round 1 fixes: text PostgreSQL cannot keep unchanged is refused with the same 422 on both
  // stores, and nothing is written.
  const refused: [string, string, string][] = [
    ['D1 fixed: a NUL character', 'const a = "before\u0000after"\n', 'must not contain a NUL character (U+0000)'],
    ['D2 fixed: a lone surrogate', 'const a = "\uD800"\n', 'must be well-formed Unicode text (no unpaired surrogate)']
  ]

  for (const [label, content, message] of refused) {
    it(`${label} is refused with 422 on both stores, in create, save, run, rename and support`, async () => {
      const pgStore = await connect()
      const memoryStore = createMemoryStore()
      for (const store of [pgStore, memoryStore]) {
        const app = appOf(store)
        const created = await request(app).post('/api/review').send({ source_type: 'snippet', language: 'TypeScript', content: 'let ok = 1\n' })
        await waitForStatus(app, created.body.id, 'completed')
        await request(app).put(`/api/review/${created.body.id}`).send({ language: 'TypeScript', code: 'kept', name: 'kept' })
        const responseList = [
          await request(app).post('/api/review').send({ source_type: 'snippet', language: 'TypeScript', content }),
          await request(app).post('/api/review').send({ source_type: 'snippet', language: 'TypeScript', content: 'x', title: content }),
          await request(app).put(`/api/review/${created.body.id}`).send({ language: 'TypeScript', code: content }),
          await request(app).post(`/api/review/${created.body.id}/run`).send({ language: 'TypeScript', code: content }),
          await request(app).patch(`/api/review/${created.body.id}`).send({ name: content }),
          await request(app).post('/api/support-request').send({ issueType: 'other', email: 'a@b.co', reviewId: '', priority: 'low', description: `${content} long enough` })
        ]
        for (const response of responseList) {
          expect(response.status).toBe(422)
          expect(response.body.error.code).toBe('validation_error')
          expect(response.body.error.details.issue.map((issue: { message: string }) => issue.message)).toContain(message)
        }
        expect((await request(app).get('/api/review')).body).toHaveLength(1)
        expect((await request(app).get(`/api/review/${created.body.id}`)).body).toMatchObject({ title: 'kept', content: 'kept', status: 'completed' })
      }
    })
  }

  for (const [label, content] of tricky) {
    it(`${label}: created on both stores, returned unchanged by both`, async () => {
      const pgApp = appOf(await connect())
      const memoryApp = appOf(createMemoryStore())
      const body = { source_type: 'snippet', title: label, language: 'TypeScript', content }

      const fromMemory = await request(memoryApp).post('/api/review').send(body)
      const fromPg = await request(pgApp).post('/api/review').send(body)

      expect(fromMemory.status).toBe(202)
      expect(fromPg.status).toBe(fromMemory.status)
      await waitForStatus(pgApp, fromPg.body.id, 'completed')
      expect((await request(pgApp).get(`/api/review/${fromPg.body.id}`)).body.content).toBe(content)
    })
  }

  it('100 000-character content and a saved edit of the same size survive a new pool', async () => {
    const big = ('x'.repeat(99) + '\n').repeat(1000)
    expect(big.length).toBe(100_000)
    const first = await connect()
    const app = appOf(first)
    const created = await request(app).post('/api/review').send({ source_type: 'snippet', language: 'TypeScript', content: big })
    expect(created.status).toBe(202)
    await waitForStatus(app, created.body.id, 'completed')
    const edit = '🚀'.repeat(100_000)
    expect((await request(app).put(`/api/review/${created.body.id}`).send({ language: 'TypeScript', code: edit })).status).toBe(200)
    await first.close()

    const restarted = appOf(await connect())
    const review = (await request(restarted).get(`/api/review/${created.body.id}`)).body
    expect(review.analyzedContent).toBe(big)
    expect(review.content).toBe(edit)
  })
})

describe('QA AI-43: stale-run guard across two pools (two backend processes)', () => {
  it('a late result from the old process does not overwrite the run the new process started', async () => {
    const gate = gatedAnalyzer()
    const oldStore = await connect()
    const oldApp = appOf(oldStore, { analyzer: gate.analyzer })
    const created = await request(oldApp).post('/api/review').send({ source_type: 'snippet', language: 'TypeScript', content: 'const old: any = eval(x)\n' })
    await vi.waitFor(() => expect(gate.pending).toHaveLength(1))

    // The "new process" sees a pending review, re-analyzes it on start (same run), and the user
    // then runs it again with new code once it completes.
    const newStore = await connect()
    const newApp = appOf(newStore)
    await waitForStatus(newApp, created.body.id, 'pending')
    const record = await newStore.findReview(demoOrg, created.body.id)
    expect(await newStore.completeReview(demoOrg, created.body.id, record!.run, analyzerResult({ qualityScore: 11 }))).toBe(true)
    const run = await request(newApp).post(`/api/review/${created.body.id}/run`).send({ language: 'Go', code: 'package main\n' })
    expect(run.status).toBe(202)
    await waitForStatus(newApp, created.body.id, 'completed')
    const newer = (await request(newApp).get(`/api/review/${created.body.id}`)).body

    // The old process's analysis finally finishes, with a very different result.
    gate.pending[0]!.resolve(analyzerResult({ qualityScore: 99, finding: [] }))
    await new Promise((resolve) => setTimeout(resolve, 300))

    const final = (await request(newApp).get(`/api/review/${created.body.id}`)).body
    expect(final.qualityScore).toBe(newer.qualityScore)
    expect(final.finding).toEqual(newer.finding)
    expect(final.analyzedContent).toBe('package main\n')
  })

  it('five parallel run requests on one review start exactly one run', async () => {
    const gate = gatedAnalyzer()
    const store = await connect()
    const app = appOf(store, { analyzer: gate.analyzer })
    const created = await request(app).post('/api/review').send({ source_type: 'snippet', language: 'TypeScript', content: 'let a = 1\n' })
    await vi.waitFor(() => expect(gate.pending).toHaveLength(1))
    gate.pending[0]!.resolve(analyzerResult())
    await waitForStatus(app, created.body.id, 'completed')

    const statusList = (await Promise.all(Array.from({ length: 5 }, (_, index) =>
      request(app).post(`/api/review/${created.body.id}/run`).send({ language: 'TypeScript', code: `let b = ${index}\n` })
    ))).map((response) => response.status).sort()

    expect(statusList).toEqual([202, 409, 409, 409, 409])
    await vi.waitFor(() => expect(gate.pending).toHaveLength(2))
  })
})

describe('QA AI-43: reset guard on databases whose name does not end in _test', () => {
  const admin = new URL(url)
  const nameList = ['qa_ai43_real', 'qa_ai43_test_copy', 'qa_ai43_TEST']

  afterAll(async () => {
    const client = new pg.Client({ connectionString: `${admin.protocol}//${admin.username}${admin.password ? ':' + admin.password : ''}@${admin.host}/postgres` })
    await client.connect()
    for (const name of nameList) await client.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`)
    await client.end()
  })

  for (const name of nameList) {
    it(`POST /api/test/reset on "${name}" answers 409 and keeps every row`, async () => {
      const client = new pg.Client({ connectionString: `${admin.protocol}//${admin.username}${admin.password ? ':' + admin.password : ''}@${admin.host}/postgres` })
      await client.connect()
      await client.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`)
      await client.query(`CREATE DATABASE "${name}"`)
      await client.end()
      const target = new URL(url)
      target.pathname = `/${name}`
      const setup = new pg.Client({ connectionString: target.toString() })
      await setup.connect()
      await applySchema(setup)
      await setup.end()

      const store = await connect(target.toString())
      const app = appOf(store, { enableTestRoute: true })
      const created = await request(app).post('/api/review').send({ source_type: 'snippet', language: 'TypeScript', content: 'let keep = 1\n' })
      await waitForStatus(app, created.body.id, 'completed')
      await request(app).post('/api/github/connect').send({ username: fakeUser })

      const reset = await request(app).post('/api/test/reset')

      expect(reset.status).toBe(409)
      expect(reset.body.error?.code ?? reset.body.code).toBe('conflict')
      expect((await request(app).get('/api/review')).body).toHaveLength(1)
      expect((await store.getGithubConnection(demoOrg))?.login).toBe(fakeUser)
    })
  }
})

describe('QA AI-43: Dashboard and History parity, MemoryStore vs PgStore, through the API', () => {
  it('the same sequence of user actions over 60 days gives the same Dashboard and History', async () => {
    const pgStore = await connect()
    const memoryStore = createMemoryStore()
    let clock = fixedNow - 59 * msPerDay
    const now = () => clock
    const failOnBoom: Analyzer = {
      ...createStubAnalyzer(),
      analyze: async (input) => {
        if (input.content.includes('BOOM')) throw new Error('boom')
        return createStubAnalyzer().analyze(input)
      }
    }
    const pgApp = appOf(pgStore, { analyzer: failOnBoom, now })
    const memoryApp = appOf(memoryStore, { analyzer: failOnBoom, now })
    const contentList = [
      'const a: any = eval(x)\nconsole.log(a) // TODO\n',
      'password = "hunter2"\n',
      'BOOM\n',
      'let fine = 1\n',
      'x'.repeat(200) + '\n',
      'const b = eval(y) as any\n'
    ]
    const idPair: [string, string][] = []
    for (let index = 0; index < 18; index++) {
      clock = fixedNow - (59 - index * 3) * msPerDay + index * 1000
      const body = { source_type: 'snippet', title: `R${index}`, language: 'TypeScript', content: contentList[index % contentList.length] }
      const fromPg = await request(pgApp).post('/api/review').send(body)
      const fromMemory = await request(memoryApp).post('/api/review').send(body)
      idPair.push([fromPg.body.id, fromMemory.body.id])
      await waitForStatus(pgApp, fromPg.body.id, index % contentList.length === 2 ? 'failed' : 'completed')
      await waitForStatus(memoryApp, fromMemory.body.id, index % contentList.length === 2 ? 'failed' : 'completed')
    }
    clock = fixedNow
    for (const index of [1, 7, 14]) {
      const [pgId, memoryId] = idPair[index]!
      await request(pgApp).delete(`/api/review/${pgId}`)
      await request(memoryApp).delete(`/api/review/${memoryId}`)
    }
    // Run again: one to a failure, one to a clean result, and one save-only edit.
    for (const [index, code] of [[3, 'BOOM\n'], [4, 'let clean = 1\n']] as const) {
      const [pgId, memoryId] = idPair[index]!
      await request(pgApp).post(`/api/review/${pgId}/run`).send({ language: 'Go', code })
      await request(memoryApp).post(`/api/review/${memoryId}/run`).send({ language: 'Go', code })
      await waitForStatus(pgApp, pgId, code === 'BOOM\n' ? 'failed' : 'completed')
      await waitForStatus(memoryApp, memoryId, code === 'BOOM\n' ? 'failed' : 'completed')
    }
    await request(pgApp).put(`/api/review/${idPair[5]![0]}`).send({ language: 'Go', code: 'eval(z)\n', name: 'Edited' })
    await request(memoryApp).put(`/api/review/${idPair[5]![1]}`).send({ language: 'Go', code: 'eval(z)\n', name: 'Edited' })

    const pgDashboard = (await request(pgApp).get('/api/dashboard')).body
    const memoryDashboard = (await request(memoryApp).get('/api/dashboard')).body
    expect(pgDashboard).toEqual(memoryDashboard)

    const strip = (list: { id: string }[]) => list.map(({ id, ...rest }) => rest)
    const pgList = (await request(pgApp).get('/api/review')).body
    const memoryList = (await request(memoryApp).get('/api/review')).body
    expect(strip(pgList)).toEqual(strip(memoryList))
    expect(pgList.map((row: { title: string }) => row.title).slice(0, 3)).toEqual(['R17', 'R16', 'R15'])
  })

  it('History keeps newest first for reviews created in the same millisecond', async () => {
    const pgApp = appOf(await connect())
    const memoryApp = appOf(createMemoryStore())
    for (let index = 0; index < 6; index++) {
      const body = { source_type: 'snippet', title: `Same ms ${index}`, language: 'TypeScript', content: 'let a = 1\n' }
      await request(pgApp).post('/api/review').send(body)
      await request(memoryApp).post('/api/review').send(body)
    }
    const titleOf = async (app: ReturnType<typeof createApp>) => (await request(app).get('/api/review')).body.map((row: { title: string }) => row.title)
    expect(await titleOf(pgApp)).toEqual(await titleOf(memoryApp))
    expect(await titleOf(pgApp)).toEqual(['Same ms 5', 'Same ms 4', 'Same ms 3', 'Same ms 2', 'Same ms 1', 'Same ms 0'])
  })
})
