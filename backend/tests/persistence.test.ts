import { readFileSync } from 'node:fs'
import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'
import type { Analyzer } from '../src/analyzer/analyzer.js'
import { createStubAnalyzer } from '../src/analyzer/stub-analyzer.js'
import { loadConfig } from '../src/config.js'
import { DatabaseError, DatabaseStartupError, databaseError, errorCodeOf } from '../src/lib/db-error.js'
import { createReviewService } from '../src/service/review.service.js'
import { createStore } from '../src/store/create-store.js'
import { MemoryStore } from '../src/store/memory-store.js'
import { isTestDatabaseName } from '../src/store/pg-schema.js'
import { connectPgStore, PgStore, type PgPool } from '../src/store/pg-store.js'
import { addReview, buildApp, fixedNow } from './helper/app.js'
import { expectError } from './helper/contract.js'

// Plan 022 behavior that needs no database. The PostgreSQL suite is `npm run test:db`.

const required = { PORT: '4000', FRONTEND_URL: 'https://app.example.com' }

function captureLogger() {
  const line: string[] = []
  return { line, logger: { info: (text: string) => line.push(text), warn: (text: string) => line.push(text) } }
}

// A pool that answers `current_database()` with `name` and records every statement.
function fakePool(name: string) {
  const statementList: string[] = []
  const query = vi.fn(async (text: string) => {
    statementList.push(text)
    return { rows: [{ name }], rowCount: 1 }
  })
  const pool = { query, connect: vi.fn(async () => ({ query, release: () => undefined })), end: vi.fn(async () => undefined) }
  return { pool: pool as unknown as PgPool, statementList }
}

describe('DATABASE_URL config', () => {
  it('is optional: unset or blank means no database', () => {
    expect(loadConfig(required).databaseUrl).toBeUndefined()
    expect(loadConfig({ ...required, DATABASE_URL: '   ' }).databaseUrl).toBeUndefined()
  })

  it('is read as it is when set', () => {
    expect(loadConfig({ ...required, DATABASE_URL: 'postgres://localhost/ai_code_reviewer' }).databaseUrl)
      .toBe('postgres://localhost/ai_code_reviewer')
  })
})

describe('createStore without DATABASE_URL', () => {
  it('falls back to the in-memory store and warns exactly once that data will not survive a restart', async () => {
    const { line, logger } = captureLogger()

    const store = await createStore(undefined, logger)

    expect(store).toBeInstanceOf(MemoryStore)
    expect(line).toHaveLength(1)
    expect(JSON.parse(line[0] ?? '{}')).toMatchObject({ level: 'warn', operation: 'startup' })
    expect(line[0]).toMatch(/DATABASE_URL is not set/)
  })
})

describe('PostgreSQL startup failures never reveal the connection string', () => {
  const password = 'Pa55-word-never-shown'

  it('a refused connection names the variable and the code, not the URL or the password', async () => {
    const url = `postgres://reviewer:${password}@127.0.0.1:1/secret_name_test`

    const error = await connectPgStore(url).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(DatabaseStartupError)
    const message = (error as Error).message
    expect(message).toMatch(/^Could not connect to PostgreSQL with DATABASE_URL \(ECONNREFUSED\)/)
    for (const part of [password, 'reviewer', 'secret_name_test', url]) expect(message).not.toContain(part)
  }, 20_000)

  it('createStore rejects with the same safe error and logs nothing', async () => {
    const { line, logger } = captureLogger()

    await expect(createStore(`postgres://u:${password}@127.0.0.1:1/x_test`, logger)).rejects.toBeInstanceOf(DatabaseStartupError)
    expect(line).toEqual([])
  }, 20_000)

  it('query errors keep only the operation and the code', () => {
    const raw = Object.assign(new Error(`invalid input syntax: "'); DROP TABLE review; --" for ${password}`), { code: '22P02' })

    const error = databaseError('review.save', raw)

    expect(error).toBeInstanceOf(DatabaseError)
    expect(error.message).toBe('Database operation review.save failed (22P02).')
    expect(errorCodeOf(new AggregateError([Object.assign(new Error('x'), { code: 'ECONNREFUSED' })]))).toBe('ECONNREFUSED')
    expect(errorCodeOf({ code: 'not a code; with spaces' })).toBe('unknown')
  })
})

describe('test reset guard (PgStore)', () => {
  it.each(['ai_code_reviewer', 'postgres', 'test', 'ai_code_reviewer_test_copy'])('refuses %j before changing anything', async (name) => {
    const { pool, statementList } = fakePool(name)

    await expect(new PgStore(pool).reset()).rejects.toMatchObject({ status: 409, code: 'conflict' })
    expect(statementList.join('\n')).not.toMatch(/TRUNCATE|DELETE|INSERT|ALTER/i)
  })

  it('answers the reset route with 409 conflict on a database that is not a _test one', async () => {
    const { pool } = fakePool('ai_code_reviewer')
    const { createApp } = await import('../src/app.js')
    const app = createApp({ frontendUrl: 'http://localhost:5173', enableTestRoute: true }, { store: new PgStore(pool) })

    expectError(await request(app).post('/api/test/reset').set('X-CSRF-Protection', '1'), 409, 'conflict')
  })

  it('accepts only names that end in _test', () => {
    expect(isTestDatabaseName('ai_code_reviewer_test')).toBe(true)
    expect(isTestDatabaseName('ai_code_reviewer')).toBe(false)
    expect(isTestDatabaseName('ai_code_reviewer_TEST')).toBe(false)
  })
})

describe('reviews unfinished at shutdown', () => {
  it('are analyzed again on start and reach completed; finished and deleted ones are left alone', async () => {
    const { store } = buildApp()
    addReview(store, { id: 'done', status: 'completed' })
    addReview(store, { id: 'left-pending', status: 'pending', findingCount: [], finding: [], suggestion: [], generatedTest: [] })
    addReview(store, { id: 'left-queued', status: 'queued', findingCount: [], finding: [], suggestion: [], generatedTest: [] })
    addReview(store, { id: 'gone', status: 'pending' }).deleted = true
    const analyze = vi.fn(createStubAnalyzer().analyze)
    const analyzer: Analyzer = { ...createStubAnalyzer(), analyze }

    const count = await createReviewService(store, analyzer, () => fixedNow).resumeUnfinished()
    await vi.waitFor(async () => {
      expect((await store.findReview('default', 'left-pending'))?.review.status).toBe('completed')
      expect((await store.findReview('default', 'left-queued'))?.review.status).toBe('completed')
    })

    expect(count).toBe(2)
    expect(analyze.mock.calls.map(([input]) => input.reviewId).sort()).toEqual(['left-pending', 'left-queued'])
    expect(store.state.reviewList.find((record) => record.id === 'gone')?.review.status).toBe('pending')
  })
})

describe('schema files', () => {
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
  const tableListOf = (sql: string) => [...sql.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?(\w+)/g)].map((match) => match[1]).sort()

  it('schema.sql and migrations 001 to 006 create the same tables, all singular and org-scoped', () => {
    const schema = read('../db/schema.sql')
    const migration = read('../db/migration/001-init.sql') + read('../db/migration/002-session.sql') + read('../db/migration/003-github-login.sql') + read('../db/migration/004-test-config.sql') + read('../db/migration/005-failure-reason.sql') + read('../db/migration/006-github-identity.sql')

    expect(tableListOf(schema)).toEqual(tableListOf(migration).sort())
    expect(tableListOf(schema)).toEqual(['account', 'account_avatar', 'account_identity', 'finding', 'generated_test', 'github_connection', 'org', 'review', 'session', 'setting', 'suggestion', 'support_request'])
    // Plan 028: the session and photo tables hang off the account (one per org) and go with it.
    for (const block of schema.split('CREATE TABLE').slice(2)) {
      expect(block).toMatch(/org_id text (NOT NULL|PRIMARY KEY) REFERENCES (org\(id\)|account\(org_id\) ON DELETE CASCADE)/)
    }
  })

  it('schema.sql and migration 002 add the same user-name column and unique indexes (plan 028)', () => {
    const indexListOf = (sql: string) => [...sql.matchAll(/CREATE (?:UNIQUE )?INDEX (?:IF NOT EXISTS )?(\w+)/g)].map((match) => match[1]).sort()
    const schema = read('../db/schema.sql')
    const migration = read('../db/migration/001-init.sql') + read('../db/migration/002-session.sql') + read('../db/migration/003-github-login.sql') + read('../db/migration/004-test-config.sql') + read('../db/migration/005-failure-reason.sql') + read('../db/migration/006-github-identity.sql')

    expect(indexListOf(schema)).toEqual(indexListOf(migration))
    for (const sql of [schema, migration]) {
      expect(sql).toMatch(/CREATE UNIQUE INDEX (IF NOT EXISTS )?account_username_lower_idx ON account \(lower\(username\)\)/)
      expect(sql).toMatch(/CREATE UNIQUE INDEX (IF NOT EXISTS )?account_email_lower_idx ON account \(lower\(email\)\)/)
      expect(sql).toMatch(/UPDATE account SET username = 'john\.doe' WHERE org_id = 'default' AND username IS NULL/)
    }
    expect(schema).toMatch(/ALTER TABLE account ADD COLUMN IF NOT EXISTS username text/)
  })

  it('schema.sql and migration 003 add the same nullable GitHub login and display name columns (plan 030)', () => {
    const schema = read('../db/schema.sql')
    const migration = read('../db/migration/003-github-login.sql')

    for (const column of ['login', 'display_name']) {
      expect(schema).toMatch(new RegExp(`ALTER TABLE github_connection ADD COLUMN IF NOT EXISTS ${column} text;`))
      expect(migration).toMatch(new RegExp(`ALTER TABLE github_connection ADD COLUMN ${column} text;`))
    }
    // Additive and nullable: no NOT NULL, no backfill, no DROP outside the rollback comment.
    expect(schema).not.toMatch(/github_connection ALTER COLUMN/)
    const statementList = migration.split('\n').filter((line) => !line.startsWith('--')).join('\n')
    expect(statementList).not.toMatch(/\bDROP\b|NOT NULL|UPDATE/)
    expect(statementList).toMatch(/BEGIN;[\s\S]*COMMIT;/)
  })

  it('schema.sql and migration 004 add the same nullable review test_config column, idempotently (plan 034)', () => {
    const schema = read('../db/schema.sql')
    const migration = read('../db/migration/004-test-config.sql')
    const statementList = migration.split(/\r?\n/).filter((line) => !line.startsWith('--')).join('\n')

    for (const sql of [schema, statementList]) {
      expect(sql).toMatch(/ALTER TABLE review ADD COLUMN IF NOT EXISTS test_config jsonb NULL;/)
    }
    // Additive, nullable and safe to apply twice: no NOT NULL, no default, no backfill, no DROP
    // outside the rollback comment, and only IF NOT EXISTS.
    expect(statementList).not.toMatch(/\bDROP\b|NOT NULL|UPDATE|DEFAULT/)
    expect(statementList).not.toMatch(/ADD COLUMN (?!IF NOT EXISTS)/)
    expect(statementList).toMatch(/BEGIN;[\s\S]*COMMIT;/)
    expect(migration).toMatch(/--\s+ALTER TABLE review DROP COLUMN IF EXISTS test_config;/)
  })

  it('schema.sql is idempotent: only IF NOT EXISTS creates and a conflict-safe org seed', () => {
    const schema = read('../db/schema.sql')

    expect(schema).not.toMatch(/CREATE (TABLE|INDEX|UNIQUE INDEX|SEQUENCE) (?!IF NOT EXISTS)/)
    // Plan 028: an additive column only with ADD COLUMN IF NOT EXISTS.
    expect(schema).not.toMatch(/ADD COLUMN (?!IF NOT EXISTS)/)
    // Plan 040: `DROP NOT NULL` (a nullable password hash) is the one loosening allowed.
    expect(schema).not.toMatch(/\bDROP\b(?! NOT NULL)|\bTRUNCATE\b/i)
    expect(schema).toMatch(/INSERT INTO org \(id, name\) VALUES \('default', 'Default'\) ON CONFLICT \(id\) DO NOTHING/)
  })
})

describe('QA AI-43 D1 and D2: text a PostgreSQL store cannot keep unchanged is refused (memory store)', () => {
  const badList: [string, string, string][] = [
    ['NUL character', 'before\u0000after', 'must not contain a NUL character (U+0000)'],
    ['lone surrogate', 'before\uD800after', 'must be well-formed Unicode text (no unpaired surrogate)'],
    ['reversed surrogate pair', 'x\uDC00\uD800x', 'must be well-formed Unicode text (no unpaired surrogate)']
  ]
  const validSupport = { issueType: 'other', email: 'john@company.com', reviewId: 'r1', priority: 'low', description: 'Something went wrong here.' }

  for (const [label, bad, message] of badList) {
    it(`${label}: every free-text field answers 422 with the field and changes nothing`, async () => {
      const { app, store } = buildApp()
      addReview(store, { id: 'r1' })
      await request(app).put('/api/review/r1').send({ language: 'Go', code: 'saved', name: 'kept' })
      const settings = (await request(app).get('/api/settings')).body
      const requestList: [request.Test, string][] = [
        [request(app).post('/api/review').send({ source_type: 'snippet', language: 'Go', content: bad }), 'content'],
        [request(app).post('/api/review').send({ source_type: 'snippet', language: 'Go', content: 'x', title: bad }), 'title'],
        [request(app).post('/api/review').send({ source_type: 'snippet', language: bad, content: 'x' }), 'language'],
        [request(app).put('/api/review/r1').send({ language: 'Go', code: bad }), 'code'],
        [request(app).put('/api/review/r1').send({ language: 'Go', code: 'x', name: bad }), 'name'],
        [request(app).post('/api/review/r1/run').send({ language: 'Go', code: bad }), 'code'],
        [request(app).patch('/api/review/r1').send({ name: bad }), 'name'],
        [request(app).post('/api/support-request').send({ ...validSupport, description: bad }), 'description'],
        [request(app).post('/api/support-request').send({ ...validSupport, email: `a${bad}@b.co` }), 'email'],
        [request(app).put('/api/settings').send({ ...settings, language: bad }), 'language'],
        [request(app).put('/api/account/password').send({ currentPassword: 'mock-password', newPassword: `long-${bad}-pass` }), 'newPassword'],
        // A URL cannot carry an unpaired surrogate (it is decoded as U+FFFD), so only NUL applies here.
        ...(bad.includes('\u0000') ? [[request(app).get('/api/github/repo').query({ query: bad }), 'query'] as [request.Test, string]] : [])
      ]

      for (const [pending, field] of requestList) {
        const response = await pending
        expectError(response, 422, 'validation_error')
        expect(response.body.error.details.issue).toContainEqual({ field, message })
        expect(response.text).not.toContain(bad)
      }
      expect(store.state.reviewList).toHaveLength(1)
      expect(store.state.reviewList[0]?.saved).toMatchObject({ name: 'kept', code: 'saved' })
      expect(store.state.reviewList[0]?.run).toBe(0)
      expect(store.state.supportRequestList).toEqual([])
      expect(store.state.settings).toEqual(settings)
    })
  }

  it('well-formed text with emoji, other scripts and paired surrogates is still accepted', async () => {
    const { app } = buildApp()
    const content = 'const שלום = "日本語 🚀 𝔘𝔫𝔦"\n\t// tab and newline are fine\r\n'

    const response = await request(app).post('/api/review').send({ source_type: 'snippet', title: '🚀 launch', language: 'TypeScript', content })

    expect(response.status).toBe(202)
    expect(response.body.content).toBe(content)
  })
})
