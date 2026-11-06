import { readFile } from 'node:fs/promises'
import pg from 'pg'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../../src/app.js'
import { applySchema } from '../../src/store/pg-schema.js'
import { connectPgStore, PgStore } from '../../src/store/pg-store.js'
import { analyzerResult, findingCountOf, fixedNow, frontendUrl, reviewRecord } from './fixture.js'
import { testDatabaseUrl } from './helper.js'

// Every `PgStore` method against the real test database (plan 022, `npm run test:db`).

const url = testDatabaseUrl()
// Plan 028: the demo account's org.
const demoOrg = 'default'
const unfinished = ['pending', 'queued', 'in_progress']
let store: PgStore

beforeEach(async () => {
  store = await connectPgStore(url, 'TEST_DATABASE_URL')
  await store.reset()
})

afterEach(async () => {
  await store.close()
})

describe('PgStore reviews', () => {
  it('creates, finds and lists a review with its items in order; finding counts follow the findings', async () => {
    const record = reviewRecord('r1')

    await store.createReview(demoOrg, record)

    expect(await store.findReview(demoOrg, 'r1')).toEqual(record)
    expect(await store.listReviewSummary(demoOrg)).toEqual([
      { id: 'r1', title: 'Review r1', language: 'TypeScript', status: 'completed', createdAt: fixedNow, findingCount: findingCountOf(record.review.finding) }
    ])
  })

  it('lists newest first, ties in insertion order, and leaves deleted reviews out', async () => {
    await store.createReview(demoOrg, reviewRecord('old', { createdAt: fixedNow - 1000 }))
    await store.createReview(demoOrg, reviewRecord('same-1'))
    await store.createReview(demoOrg, reviewRecord('same-2'))
    await store.createReview(demoOrg, reviewRecord('gone'))
    expect(await store.deleteReview(demoOrg, 'gone')).toBe(true)

    expect((await store.listReviewSummary(demoOrg)).map((row) => row.id)).toEqual(['same-2', 'same-1', 'old'])
    expect(await store.findReview(demoOrg, 'gone')).toBeUndefined()
    expect(await store.deleteReview(demoOrg, 'gone')).toBe(false)
  })

  it('saves and renames the edit, and keeps it on the review', async () => {
    await store.createReview(demoOrg, reviewRecord('r1'))
    const saved = { name: 'mine', language: 'Go', code: 'package main', savedAt: new Date(fixedNow).toISOString() }

    expect(await store.saveReview(demoOrg, 'r1', saved)).toBe(true)
    expect(await store.saveReview(demoOrg, 'missing', saved)).toBe(false)

    expect((await store.findReview(demoOrg, 'r1'))?.saved).toEqual(saved)
    expect((await store.listReviewSummary(demoOrg))[0]?.title).toBe('mine')
    const { name: _name, ...unnamed } = saved
    await store.saveReview(demoOrg, 'r1', unnamed)
    expect((await store.findReview(demoOrg, 'r1'))?.saved).toEqual(unnamed)
  })

  it('restartReview starts a new run once, clears the old items, and refuses while unfinished', async () => {
    await store.createReview(demoOrg, reviewRecord('r1'))
    const restart = { saved: { language: 'Go', code: 'x', savedAt: new Date(fixedNow).toISOString() }, language: 'Go', content: 'x', analyzedAt: fixedNow + 5000 }

    expect(await store.restartReview(demoOrg, 'r1', restart, unfinished)).toEqual({ ok: true, run: 1 })
    expect(await store.restartReview(demoOrg, 'r1', restart, unfinished)).toEqual({ ok: false, reason: 'unfinished', status: 'pending' })
    expect(await store.restartReview(demoOrg, 'missing', restart, unfinished)).toEqual({ ok: false, reason: 'not_found' })

    const record = await store.findReview(demoOrg, 'r1')
    expect(record).toMatchObject({ run: 1, analyzedAt: fixedNow + 5000, saved: restart.saved })
    expect(record?.review).toMatchObject({ status: 'pending', language: 'Go', content: 'x', qualityScore: 0, findingCount: [], finding: [], suggestion: [], generatedTest: [] })
  })

  it('completeReview is run-guarded: a late result from an older run does not overwrite the newer run', async () => {
    await store.createReview(demoOrg, reviewRecord('r1', { status: 'pending' }))
    const restart = { saved: { language: 'Go', code: 'x', savedAt: new Date(fixedNow).toISOString() }, language: 'Go', content: 'x', analyzedAt: fixedNow }
    expect(await store.completeReview(demoOrg, 'r1', 0, analyzerResult({ qualityScore: 10 }))).toBe(true)
    expect(await store.restartReview(demoOrg, 'r1', restart, unfinished)).toEqual({ ok: true, run: 1 })

    expect(await store.completeReview(demoOrg, 'r1', 0, analyzerResult({ qualityScore: 11 }))).toBe(false)
    expect(await store.failReview(demoOrg, 'r1', 0, 'internal')).toBe(false)
    expect((await store.findReview(demoOrg, 'r1'))?.review).toMatchObject({ status: 'pending', qualityScore: 0, finding: [] })

    expect(await store.completeReview(demoOrg, 'r1', 1, analyzerResult({ qualityScore: 99 }))).toBe(true)
    expect((await store.findReview(demoOrg, 'r1'))?.review).toMatchObject({ status: 'completed', qualityScore: 99 })
  })

  it('a deleted review never takes a result or a failure', async () => {
    await store.createReview(demoOrg, reviewRecord('r1', { status: 'pending' }))
    await store.deleteReview(demoOrg, 'r1')

    expect(await store.completeReview(demoOrg, 'r1', 0, analyzerResult())).toBe(false)
    expect(await store.failReview(demoOrg, 'r1', 0, 'internal')).toBe(false)
    expect(await store.replaceGeneratedTest(demoOrg, 'r1', [])).toBe(false)
  })

  it('failReview marks the current run failed', async () => {
    await store.createReview(demoOrg, reviewRecord('r1', { status: 'pending' }))

    expect(await store.failReview(demoOrg, 'r1', 0, 'internal')).toBe(true)
    expect((await store.findReview(demoOrg, 'r1'))?.review.status).toBe('failed')
  })

  it('failReview stores the reason (plan 039), a new run clears it, and only a failed review has one', async () => {
    await store.createReview(demoOrg, reviewRecord('r1', { status: 'pending' }))
    expect((await store.findReview(demoOrg, 'r1'))?.failureReason).toBeUndefined()

    expect(await store.failReview(demoOrg, 'r1', 0, 'ai_timeout')).toBe(true)
    expect((await store.findReview(demoOrg, 'r1'))?.failureReason).toBe('ai_timeout')

    const restart = { saved: { language: 'Go', code: 'x', savedAt: new Date(fixedNow).toISOString() }, language: 'Go', content: 'x', analyzedAt: fixedNow }
    expect(await store.restartReview(demoOrg, 'r1', restart, unfinished)).toEqual({ ok: true, run: 1 })
    const restarted = await store.findReview(demoOrg, 'r1')
    expect(restarted?.review.status).toBe('pending')
    expect(restarted?.failureReason).toBeUndefined()
  })

  it('markReviewStatus moves only an unfinished review on the current run (plan 039)', async () => {
    await store.createReview(demoOrg, reviewRecord('r1', { status: 'pending' }))

    expect(await store.markReviewStatus(demoOrg, 'r1', 0, 'queued', unfinished)).toBe(true)
    expect((await store.findReview(demoOrg, 'r1'))?.review.status).toBe('queued')
    expect(await store.markReviewStatus(demoOrg, 'r1', 0, 'in_progress', unfinished)).toBe(true)
    expect((await store.findReview(demoOrg, 'r1'))?.review.status).toBe('in_progress')
    expect(await store.markReviewStatus(demoOrg, 'r1', 5, 'queued', unfinished)).toBe(false)
    expect(await store.markReviewStatus(demoOrg, 'missing', 0, 'queued', unfinished)).toBe(false)
    expect(await store.failReview(demoOrg, 'r1', 0, 'internal')).toBe(true)
    expect(await store.markReviewStatus(demoOrg, 'r1', 0, 'in_progress', unfinished)).toBe(false)
    await store.createReview(demoOrg, reviewRecord('r2', { status: 'pending' }))
    await store.deleteReview(demoOrg, 'r2')
    expect(await store.markReviewStatus(demoOrg, 'r2', 0, 'queued', unfinished)).toBe(false)
  })

  it('replaceGeneratedTest swaps the generated tests only', async () => {
    await store.createReview(demoOrg, reviewRecord('r1'))
    const fileList = [{ id: 't9', sourceFile: 'z.ts', testFile: 'z.test.ts', language: 'TypeScript', code: 'new', altCode: 'old' }]

    expect(await store.replaceGeneratedTest(demoOrg, 'r1', fileList)).toBe(true)

    const review = (await store.findReview(demoOrg, 'r1'))?.review
    expect(review?.generatedTest).toEqual(fileList)
    expect(review?.finding).toHaveLength(4)
  })

  it('listUnfinishedReview returns pending, queued and in-progress reviews with their run, not deleted ones', async () => {
    await store.createReview(demoOrg, reviewRecord('done'))
    await store.createReview(demoOrg, reviewRecord('p', { status: 'pending' }))
    await store.createReview(demoOrg, reviewRecord('q', { status: 'queued' }))
    await store.createReview(demoOrg, reviewRecord('gone', { status: 'pending' }))
    await store.deleteReview(demoOrg, 'gone')

    expect(await store.listUnfinishedReview(unfinished)).toEqual([{ orgId: demoOrg, id: 'p', run: 0 }, { orgId: demoOrg, id: 'q', run: 0 }])
  })

  it('stores SQL injection attempts as plain text and returns them unchanged', async () => {
    const attack = `'); DROP TABLE review; --`
    await store.createReview(demoOrg, reviewRecord('r1', { title: attack, content: `${attack}\n" OR 1=1; --` }))
    await store.saveReview(demoOrg, 'r1', { name: attack, language: attack, code: attack, savedAt: new Date(fixedNow).toISOString() })
    await store.saveSettings(demoOrg, { ...(await store.getSettings(demoOrg)), language: attack })
    await store.createSupportRequest(demoOrg, { issueType: 'other', email: 'a@b.co', reviewId: 'r1', priority: 'low', description: attack, createdAt: new Date(fixedNow).toISOString() })

    const record = await store.findReview(demoOrg, 'r1')
    expect(record?.review).toMatchObject({ title: attack, content: `${attack}\n" OR 1=1; --` })
    expect(record?.saved).toMatchObject({ name: attack, code: attack })
    expect((await store.getSettings(demoOrg)).language).toBe(attack)
    expect(await store.listReviewSummary(demoOrg)).toHaveLength(1)
  })
})

describe('PgStore settings, account, GitHub and support', () => {
  it('starts from the seeded defaults and keeps every change', async () => {
    const settings = await store.getSettings(demoOrg)
    expect(settings.theme).toBe('light')
    expect(await store.getGithubConnection(demoOrg)).toBeUndefined()
    const account = await store.getAccount(demoOrg)
    expect(account).toMatchObject({ username: 'john.doe', email: 'john@company.com', avatarDigest: null })

    await store.saveSettings(demoOrg, { ...settings, theme: 'dark' })
    await store.setGithubConnection(demoOrg, { login: 'example-user', name: null })
    await store.setPasswordHash(demoOrg, 'scrypt$00$11')

    expect((await store.getSettings(demoOrg)).theme).toBe('dark')
    expect(await store.getGithubConnection(demoOrg)).toEqual({ login: 'example-user', name: null })
    expect((await store.getAccount(demoOrg))?.passwordHash).toBe('scrypt$00$11')
  })

  it('keeps the GitHub login and name, clears them on disconnect, and reads a row without a login as not connected (plan 030)', async () => {
    await store.setGithubConnection(demoOrg, { login: 'example-user', name: 'Example User' })
    expect(await store.getGithubConnection(demoOrg)).toEqual({ login: 'example-user', name: 'Example User' })
    expect(await store.getGithubConnection('another-org')).toBeUndefined()

    await store.setGithubConnection(demoOrg, null)
    expect(await store.getGithubConnection(demoOrg)).toBeUndefined()

    // The mock flag of plans 022 and 028: connected, but no login.
    const client = new pg.Client({ connectionString: url })
    await client.connect()
    try {
      await client.query("UPDATE github_connection SET connected = true, login = NULL WHERE org_id = 'default'")
    } finally {
      await client.end()
    }
    expect(await store.getGithubConnection(demoOrg)).toBeUndefined()
  })

  it('numbers support tickets from SUP-1001, and reset starts them again', async () => {
    const input = { issueType: 'other', email: 'a@b.co', reviewId: '', priority: 'low', description: 'x', createdAt: new Date(fixedNow).toISOString() }

    expect(await store.createSupportRequest(demoOrg, input)).toBe('SUP-1001')
    expect(await store.createSupportRequest(demoOrg, input)).toBe('SUP-1002')
    await store.reset()
    expect(await store.createSupportRequest(demoOrg, input)).toBe('SUP-1001')
  })

  it('parallel support requests never share a ticket', async () => {
    const input = { issueType: 'other', email: 'a@b.co', reviewId: '', priority: 'low', description: 'x', createdAt: new Date(fixedNow).toISOString() }

    const ticketList = await Promise.all(Array.from({ length: 10 }, () => store.createSupportRequest(demoOrg, input)))

    expect(new Set(ticketList).size).toBe(10)
  })
})

describe('PgStore reset', () => {
  it('empties the user data and seeds the defaults again on a _test database', async () => {
    await store.createReview(demoOrg, reviewRecord('r1'))
    await store.saveSettings(demoOrg, { ...(await store.getSettings(demoOrg)), theme: 'dark' })
    await store.setGithubConnection(demoOrg, { login: 'example-user', name: 'Example User' })

    await store.reset()

    expect(await store.listReviewSummary(demoOrg)).toEqual([])
    expect((await store.getSettings(demoOrg)).theme).toBe('light')
    expect(await store.getGithubConnection(demoOrg)).toBeUndefined()
  })

  it('the reset route refuses a database whose name does not end in _test, and changes nothing', async () => {
    // The server's maintenance database `postgres` always exists; only `current_database()` is read.
    const otherUrl = new URL(url)
    otherUrl.pathname = '/postgres'
    const pool = new pg.Pool({ connectionString: otherUrl.toString() })
    const app = createApp({ frontendUrl, enableTestRoute: true }, { store: new PgStore(pool) })
    await store.createReview(demoOrg, reviewRecord('kept'))

    const response = await request(app).post('/api/test/reset').set('X-CSRF-Protection', '1')
    await pool.end()

    expect(response.status).toBe(409)
    expect(response.body.error.code).toBe('conflict')
    expect(await store.findReview(demoOrg, 'kept')).toBeDefined()
  })
})

describe('PgStore test configuration (plan 034)', () => {
  const config = { framework: 'Mocha', testTypeIdList: ['unit', 'error'] } as const

  it('creates a review with or without one, and reads null for none', async () => {
    await store.createReview(demoOrg, reviewRecord('with', { testConfig: { framework: config.framework, testTypeIdList: [...config.testTypeIdList] } }))
    await store.createReview(demoOrg, reviewRecord('without'))

    expect((await store.findReview(demoOrg, 'with'))?.testConfig).toEqual(config)
    expect((await store.findReview(demoOrg, 'without'))?.testConfig).toBeNull()
  })

  it('replaceGeneratedTest stores a given configuration with the files, and keeps it when none is given', async () => {
    await store.createReview(demoOrg, reviewRecord('r1'))
    const fileList = [{ id: 'x', sourceFile: 'x.ts', testFile: 'x.test.ts', language: 'TypeScript', code: 'new', altCode: 'old' }]

    expect(await store.replaceGeneratedTest(demoOrg, 'r1', fileList, { framework: config.framework, testTypeIdList: [...config.testTypeIdList] })).toBe(true)
    expect(await store.findReview(demoOrg, 'r1')).toMatchObject({ testConfig: config, review: { generatedTest: fileList } })
    expect(await store.replaceGeneratedTest(demoOrg, 'r1', [])).toBe(true)
    expect((await store.findReview(demoOrg, 'r1'))?.testConfig).toEqual(config)
    expect(await store.replaceGeneratedTest('other-org', 'r1', [], { framework: 'Jest', testTypeIdList: ['unit'] })).toBe(false)
    expect((await store.findReview(demoOrg, 'r1'))?.testConfig).toEqual(config)
  })

  it('keeps the configuration through a run', async () => {
    await store.createReview(demoOrg, reviewRecord('r1', { testConfig: { framework: 'Vitest', testTypeIdList: ['edge'] } }))
    const saved = { language: 'Go', code: 'package main', savedAt: new Date(fixedNow).toISOString() }

    expect((await store.restartReview(demoOrg, 'r1', { saved, language: 'Go', content: 'package main', analyzedAt: fixedNow }, unfinished)).ok).toBe(true)

    expect((await store.findReview(demoOrg, 'r1'))?.testConfig).toEqual({ framework: 'Vitest', testTypeIdList: ['edge'] })
  })

  it('reads a stored value that is not a valid configuration as none', async () => {
    await store.createReview(demoOrg, reviewRecord('r1'))
    const client = new pg.Client({ connectionString: url })
    await client.connect()
    await client.query(`UPDATE review SET test_config = '{"framework":"Jasmine","testTypeIdList":[]}'::jsonb WHERE id = 'r1'`)
    await client.end()

    expect((await store.findReview(demoOrg, 'r1'))?.testConfig).toBeNull()
  })
})

describe('plan 034 routes on PostgreSQL', () => {
  const silent = { info: () => undefined, warn: () => undefined }

  it('PUT /api/account switches the sign-in name and keeps the session; Regenerate stores the configuration', async () => {
    const app = createApp({ frontendUrl, enableTestRoute: false }, { store, securityLogger: silent })
    await store.createReview(demoOrg, reviewRecord('r1'))
    const agent = request.agent(app).set('X-CSRF-Protection', '1')
    expect((await agent.post('/api/session').send({ username: 'john.doe', password: 'mock-password' })).status).toBe(200)

    const updated = await agent.put('/api/account').send({ username: 'jane.doe', email: 'Jane@Example.com', currentPassword: 'mock-password' })
    const regenerated = await agent.post('/api/review/r1/generated-test').send({ framework: 'Vitest', testTypeIdList: ['edge'] })

    expect(updated.status).toBe(200)
    expect(updated.body).toMatchObject({ username: 'jane.doe', email: 'jane@example.com' })
    expect((await agent.get('/api/session')).body.account.username).toBe('jane.doe')
    expect(regenerated.status).toBe(200)
    expect(regenerated.body[0].code).toContain("from 'vitest'")
    expect((await agent.get('/api/review/r1')).body.testConfig).toEqual({ framework: 'Vitest', testTypeIdList: ['edge'] })
    const fresh = request.agent(app).set('X-CSRF-Protection', '1')
    expect((await fresh.post('/api/session').send({ username: 'john.doe', password: 'mock-password' })).status).toBe(401)
    expect((await fresh.post('/api/session').send({ username: 'jane.doe', password: 'mock-password' })).status).toBe(200)
  })
})

describe('PgStore account update (plan 034)', () => {
  const account = (username: string) => ({
    username, fullName: username, email: `${username}@example.com`, memberSince: 'October 22, 2026', passwordHash: 'scrypt$00$00'
  })

  async function addAccount(orgId: string, username: string) {
    expect(await store.createAccount({ orgId, orgName: username, account: account(username), settings: await store.getSettings(demoOrg) })).toEqual({ ok: true })
  }

  it('changes the user name and the lower-cased email, and leaves the other accounts alone', async () => {
    await addAccount('org-a', 'alice')
    await addAccount('org-b', 'bob')

    expect(await store.updateAccount('org-a', { username: 'alice2', email: 'Alice2@Example.com' })).toEqual({ ok: true })

    expect(await store.getAccount('org-a')).toMatchObject({ username: 'alice2', email: 'alice2@example.com', fullName: 'alice' })
    expect(await store.getAccount('org-b')).toMatchObject({ username: 'bob', email: 'bob@example.com' })
    expect((await store.findAccountByUsername('ALICE2'))?.orgId).toBe('org-a')
    expect(await store.findAccountByUsername('alice')).toBeUndefined()
  })

  it('changes only the field given', async () => {
    await addAccount('org-a', 'alice')

    await store.updateAccount('org-a', { email: 'new@example.com' })

    expect(await store.getAccount('org-a')).toMatchObject({ username: 'alice', email: 'new@example.com' })
  })

  it('refuses a user name or email of another account in any case as a conflict, changing nothing', async () => {
    await addAccount('org-a', 'alice')
    await addAccount('org-b', 'bob')

    expect(await store.updateAccount('org-a', { username: 'BOB' })).toEqual({ ok: false, reason: 'conflict' })
    expect(await store.updateAccount('org-a', { username: 'free', email: 'BOB@example.com' })).toEqual({ ok: false, reason: 'conflict' })
    expect(await store.updateAccount('org-a', { username: 'John.Doe' })).toEqual({ ok: false, reason: 'conflict' })

    expect(await store.getAccount('org-a')).toMatchObject({ username: 'alice', email: 'alice@example.com' })
  })

  it('lets an account keep its own values or change their letter case, and answers not_found for no account', async () => {
    await addAccount('org-a', 'alice')

    expect(await store.updateAccount('org-a', { username: 'Alice', email: 'ALICE@example.com' })).toEqual({ ok: true })
    expect(await store.getAccount('org-a')).toMatchObject({ username: 'Alice', email: 'alice@example.com' })
    expect(await store.updateAccount('missing-org', { username: 'zed' })).toEqual({ ok: false, reason: 'not_found' })
  })
})

describe('schema', () => {
  it('db:setup is idempotent: applying schema.sql again keeps the data', async () => {
    await store.createReview(demoOrg, reviewRecord('r1'))
    const client = new pg.Client({ connectionString: url })
    await client.connect()

    await applySchema(client)
    await applySchema(client)
    await client.end()

    expect(await store.findReview(demoOrg, 'r1')).toBeDefined()
  })

  it('migration 004 applies twice on a populated database, keeps every row, and old reviews read as no configuration (plan 034)', async () => {
    await store.createReview(demoOrg, reviewRecord('old-1'))
    await store.createReview(demoOrg, reviewRecord('old-2', { status: 'pending' }))
    const before = await store.findReview(demoOrg, 'old-1')
    const migration = await readFile(new URL('../../db/migration/004-test-config.sql', import.meta.url), 'utf8')
    const client = new pg.Client({ connectionString: url })
    await client.connect()
    try {
      // The column exists already (schema.sql); a first and a second run both change nothing.
      await client.query(migration)
      await client.query(migration)
      const column = await client.query(
        `SELECT data_type, is_nullable, column_default FROM information_schema.columns
         WHERE table_schema = current_schema() AND table_name = 'review' AND column_name = 'test_config'`)
      expect(column.rows).toEqual([{ data_type: 'jsonb', is_nullable: 'YES', column_default: null }])
    } finally {
      await client.end()
    }

    expect(await store.findReview(demoOrg, 'old-1')).toEqual(before)
    expect((await store.findReview(demoOrg, 'old-1'))?.testConfig).toBeNull()
    expect((await store.listReviewSummary(demoOrg)).map((row) => row.id)).toEqual(['old-2', 'old-1'])
  })

  it('migration 004 adds the column to a database built by migrations 001 to 003 that holds reviews, and is idempotent', async () => {
    const client = new pg.Client({ connectionString: url })
    await client.connect()
    const scratch = `migration_004_${Date.now()}`
    try {
      await client.query(`CREATE SCHEMA ${scratch}`)
      await client.query(`SET search_path TO ${scratch}`)
      for (const name of ['001-init.sql', '002-session.sql', '003-github-login.sql']) {
        await client.query(await readFile(new URL(`../../db/migration/${name}`, import.meta.url), 'utf8'))
      }
      await client.query(`INSERT INTO review (id, org_id, title, status, language, content, created_at, analyzed_at)
        VALUES ('r1', 'default', 'Old', 'completed', 'TypeScript', 'const a = 1', now(), now())`)
      const migration = await readFile(new URL('../../db/migration/004-test-config.sql', import.meta.url), 'utf8')

      await client.query(migration)
      await client.query(migration)

      const { rows } = await client.query<{ id: string, title: string, test_config: unknown }>('SELECT id, title, test_config FROM review')
      expect(rows).toEqual([{ id: 'r1', title: 'Old', test_config: null }])
    } finally {
      await client.query(`DROP SCHEMA IF EXISTS ${scratch} CASCADE`)
      await client.end()
    }
  })

  it('migration 005 applies twice on a populated database, keeps every row, and a failed review from before reads with no reason (plan 039)', async () => {
    await store.createReview(demoOrg, reviewRecord('old-1'))
    await store.createReview(demoOrg, reviewRecord('old-2', { status: 'pending' }))
    const before = await store.findReview(demoOrg, 'old-1')
    const migration = await readFile(new URL('../../db/migration/005-failure-reason.sql', import.meta.url), 'utf8')
    const client = new pg.Client({ connectionString: url })
    await client.connect()
    try {
      await client.query(migration)
      await client.query(migration)
      const column = await client.query(
        `SELECT data_type, is_nullable, column_default FROM information_schema.columns
         WHERE table_schema = current_schema() AND table_name = 'review' AND column_name = 'failure_reason'`)
      expect(column.rows).toEqual([{ data_type: 'text', is_nullable: 'YES', column_default: null }])
    } finally {
      await client.end()
    }

    expect(await store.findReview(demoOrg, 'old-1')).toEqual(before)
    expect((await store.listReviewSummary(demoOrg)).map((row) => row.id)).toEqual(['old-2', 'old-1'])
  })

  it('migration 005 adds the column to a database built by migrations 001 to 004 that holds reviews, and is idempotent', async () => {
    const client = new pg.Client({ connectionString: url })
    await client.connect()
    const scratch = `migration_005_${Date.now()}`
    try {
      await client.query(`CREATE SCHEMA ${scratch}`)
      await client.query(`SET search_path TO ${scratch}`)
      for (const name of ['001-init.sql', '002-session.sql', '003-github-login.sql', '004-test-config.sql']) {
        await client.query(await readFile(new URL(`../../db/migration/${name}`, import.meta.url), 'utf8'))
      }
      await client.query(`INSERT INTO review (id, org_id, title, status, language, content, created_at, analyzed_at)
        VALUES ('r1', 'default', 'Old', 'failed', 'TypeScript', 'const a = 1', now(), now())`)
      const migration = await readFile(new URL('../../db/migration/005-failure-reason.sql', import.meta.url), 'utf8')

      await client.query(migration)
      await client.query(migration)

      const { rows } = await client.query<{ id: string, status: string, failure_reason: unknown }>('SELECT id, status, failure_reason FROM review')
      expect(rows).toEqual([{ id: 'r1', status: 'failed', failure_reason: null }])
    } finally {
      await client.query(`DROP SCHEMA IF EXISTS ${scratch} CASCADE`)
      await client.end()
    }
  })

  it('migrations 001 to 006 on an empty schema give the same columns and indexes as schema.sql', async () => {
    const client = new pg.Client({ connectionString: url })
    await client.connect()
    const scratch = `migration_check_${Date.now()}`
    const columnsOf = async (schema: string) => (await client.query(
      `SELECT table_name, column_name, data_type, is_nullable, column_default FROM information_schema.columns
       WHERE table_schema = $1 ORDER BY table_name, column_name`, [schema])).rows
    try {
      const main = (await client.query<{ name: string }>('SELECT current_schema() AS name')).rows[0]?.name ?? 'public'
      await client.query(`CREATE SCHEMA ${scratch}`)
      await client.query(`SET search_path TO ${scratch}`)
      await client.query(await readFile(new URL('../../db/migration/001-init.sql', import.meta.url), 'utf8'))
      await client.query(await readFile(new URL('../../db/migration/002-session.sql', import.meta.url), 'utf8'))
      await client.query(await readFile(new URL('../../db/migration/003-github-login.sql', import.meta.url), 'utf8'))
      await client.query(await readFile(new URL('../../db/migration/004-test-config.sql', import.meta.url), 'utf8'))
      await client.query(await readFile(new URL('../../db/migration/005-failure-reason.sql', import.meta.url), 'utf8'))
      await client.query(await readFile(new URL('../../db/migration/006-github-identity.sql', import.meta.url), 'utf8'))
      const indexOf = async (schema: string) => (await client.query(
        'SELECT tablename, indexname FROM pg_indexes WHERE schemaname = $1 ORDER BY tablename, indexname', [schema])).rows

      expect(await columnsOf(scratch)).toEqual(await columnsOf(main))
      expect(await indexOf(scratch)).toEqual(await indexOf(main))
    } finally {
      await client.query(`DROP SCHEMA IF EXISTS ${scratch} CASCADE`)
      await client.end()
    }
  })
})
