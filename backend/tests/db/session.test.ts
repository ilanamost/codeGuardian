import { readFile } from 'node:fs/promises'
import pg from 'pg'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../../src/app.js'
import { hashSessionId } from '../../src/lib/session.js'
import { applySchema } from '../../src/store/pg-schema.js'
import { connectPgStore, type PgStore } from '../../src/store/pg-store.js'
import { newAgent, registerAgent, registrationOf, sessionCookieOf, signInCookie, waitForAgentStatus } from '../helper/app.js'
import { fixedNow, frontendUrl, reviewRecord } from './fixture.js'
import { testDatabaseUrl } from './helper.js'
import { fakeGithubClient, fakeUser } from '../helper/github.js'

// Plan 028 on PostgreSQL (`npm run test:db`): registration and the unique indexes, sessions
// (only hashes stored, surviving a restart), photo bytes, per-account isolation, and the
// upgrade of a database built by migration 001 with data in the `default` org.

const url = testDatabaseUrl()
const openList: PgStore[] = []
const silent = { info: () => undefined, warn: () => undefined }
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from([0, 1, 2, 3, 255, 254])])

async function connect(): Promise<PgStore> {
  const store = await connectPgStore(url, 'TEST_DATABASE_URL')
  openList.push(store)
  return store
}

function appOf(store: PgStore) {
  return createApp({ frontendUrl, enableTestRoute: false }, { store, now: () => fixedNow, securityLogger: silent, githubClient: fakeGithubClient() })
}

async function sql<R extends pg.QueryResultRow>(text: string, values: unknown[] = []): Promise<R[]> {
  const client = new pg.Client({ connectionString: url })
  await client.connect()
  try {
    return (await client.query<R>(text, values)).rows
  } finally {
    await client.end()
  }
}

beforeEach(async () => {
  const store = await connect()
  await store.reset()
})

afterEach(async () => {
  await Promise.all(openList.splice(0).map((store) => store.close().catch(() => undefined)))
})

describe('registration on PostgreSQL', () => {
  it('creates the org, the account, the default settings and the GitHub row, and signs in', async () => {
    const store = await connect()
    const app = appOf(store)

    const agent = await registerAgent(app, registrationOf('alice'))

    expect((await agent.get('/api/account')).body).toMatchObject({ username: 'alice', email: 'alice@example.com', avatarUrl: null })
    const [row] = await sql<{ org_id: string, name: string, password_hash: string, connected: boolean, theme: string }>(
      `SELECT a.org_id, o.name, a.password_hash, g.connected, s.data->>'theme' AS theme
       FROM account a JOIN org o ON o.id = a.org_id JOIN github_connection g ON g.org_id = a.org_id JOIN setting s ON s.org_id = a.org_id
       WHERE a.username = 'alice'`)
    expect(row).toMatchObject({ name: 'alice', connected: false, theme: 'light' })
    expect(row?.password_hash).toMatch(/^scrypt\$[0-9a-f]+\$[0-9a-f]+$/)
    expect(row?.org_id).not.toBe('default')
  })

  it.each([
    ['the same user name in other case', { ...registrationOf('bob'), username: 'ALICE' }],
    ['the same email in other case', { ...registrationOf('bob'), email: 'Alice@Example.COM' }],
    ['the demo user name', { ...registrationOf('bob'), username: 'john.doe' }]
  ])('the unique indexes refuse %s with the generic 409, and nothing is left behind', async (_label, body) => {
    const store = await connect()
    const app = appOf(store)
    await registerAgent(app, registrationOf('alice'))
    const before = await sql<{ count: string }>('SELECT count(*)::text AS count FROM org')

    const response = await newAgent(app).post('/api/account').send(body)

    expect(response.status).toBe(409)
    expect(response.body.error).toEqual({ code: 'conflict', message: 'This user name or email cannot be used.' })
    expect(await sql('SELECT count(*)::text AS count FROM org')).toEqual(before)
  })

  it('two registrations of the same user name at once: one 201, one 409', async () => {
    const store = await connect()
    const app = appOf(store)

    const statusList = (await Promise.all([
      newAgent(app).post('/api/account').send(registrationOf('race')),
      newAgent(app).post('/api/account').send({ ...registrationOf('race'), email: 'other@example.com' })
    ])).map((response) => response.status).sort()

    expect(statusList).toEqual([201, 409])
  })
})

describe('sessions on PostgreSQL', () => {
  it('stores only the SHA-256 hash in session.id, and a session survives closing the pool and reconnecting', async () => {
    const first = await connect()
    const cookie = await signInCookie(appOf(first))
    const id = cookie.slice('cr_session='.length)

    const rowList = await sql<{ id: string }>('SELECT id FROM session')
    expect(rowList).toEqual([{ id: hashSessionId(id) }])
    expect(JSON.stringify(rowList)).not.toContain(id)
    await first.close()

    const second = await connect()
    const response = await request(appOf(second)).get('/api/session').set('cookie', cookie)

    expect(response.status).toBe(200)
    expect(response.body.account.username).toBe('john.doe')
  })

  it('sign-out deletes the row; a password change deletes the other sessions and rotates the current one', async () => {
    const store = await connect()
    const app = appOf(store)
    const other = await signInCookie(app)
    const agent = newAgent(app)
    await agent.post('/api/session').send({ username: 'john.doe', password: 'mock-password' })

    const change = await agent.put('/api/account/password').send({ currentPassword: 'mock-password', newPassword: 'brand-new-pass-42' })

    expect(change.status).toBe(204)
    expect(sessionCookieOf(change)).toBeDefined()
    expect((await request(app).get('/api/account').set('cookie', other)).status).toBe(401)
    expect(await sql('SELECT id FROM session')).toHaveLength(1)
    expect((await agent.delete('/api/session')).status).toBe(204)
    expect(await sql('SELECT id FROM session')).toEqual([])
  })

  it('expired sessions are deleted when read', async () => {
    const store = await connect()
    const cookie = await signInCookie(appOf(store))
    // The app runs on the fixed clock, so the expiry is set just before it.
    await sql('UPDATE session SET expires_at = $1', [new Date(fixedNow - 1000)])

    expect((await request(appOf(store)).get('/api/account').set('cookie', cookie)).status).toBe(401)
    expect(await sql('SELECT id FROM session')).toEqual([])
  })
})

describe('profile photo on PostgreSQL', () => {
  it('keeps the bytes exactly, serves them back, and removes them', async () => {
    const store = await connect()
    const app = appOf(store)
    const agent = newAgent(app)
    await agent.post('/api/session').send({ username: 'john.doe', password: 'mock-password' })

    const uploaded = await agent.put('/api/account/avatar').set('content-type', 'image/png').send(png)

    expect(uploaded.body.avatarUrl).toMatch(/^\/api\/account\/avatar\?v=[0-9a-f]{12}$/)
    const avatar = await store.getAvatar('default')
    expect(avatar?.contentType).toBe('image/png')
    expect(Buffer.compare(avatar?.data ?? Buffer.alloc(0), png)).toBe(0)
    const served = await agent.get('/api/account/avatar').buffer(true).parse((res, callback) => {
      const chunkList: Buffer[] = []
      res.on('data', (chunk: Buffer) => chunkList.push(chunk))
      res.on('end', () => callback(null, Buffer.concat(chunkList)))
    })
    expect(Buffer.compare(served.body as Buffer, png)).toBe(0)
    expect((await agent.delete('/api/account/avatar')).body.avatarUrl).toBeNull()
    expect(await sql('SELECT org_id FROM account_avatar')).toEqual([])
  })
})

describe('per-account isolation on PostgreSQL', () => {
  it("B never sees or changes A's review, settings, photo or GitHub state, and A's analysis uses A's preferences", async () => {
    const store = await connect()
    const app = appOf(store)
    const alice = await registerAgent(app, registrationOf('alice'))
    const bob = await registerAgent(app, registrationOf('bob'))
    const settings = (await alice.get('/api/settings')).body
    await alice.put('/api/settings').send({ ...settings, reviewFocus: 'security' })
    await alice.post('/api/github/connect').send({ username: fakeUser })
    await alice.put('/api/account/avatar').set('content-type', 'image/png').send(png)
    const created = await alice.post('/api/review').send({ source_type: 'snippet', language: 'TypeScript', content: 'eval(x)\nconst v: any = 1\n' })
    const id: string = created.body.id
    const done = (await waitForAgentStatus(alice, id, 'completed')).body

    for (const response of [
      await bob.get(`/api/review/${id}`),
      await bob.put(`/api/review/${id}`).send({ language: 'Go', code: 'x' }),
      await bob.post(`/api/review/${id}/run`).send({ language: 'Go', code: 'x' }),
      await bob.patch(`/api/review/${id}`).send({ name: 'x' }),
      await bob.post(`/api/review/${id}/generated-test`),
      await bob.delete(`/api/review/${id}`)
    ]) expect(response.status).toBe(404)

    expect((await bob.get('/api/review')).body).toEqual([])
    expect((await bob.get('/api/dashboard')).body.statList[0].value).toBe(0)
    expect((await bob.get('/api/settings')).body.reviewFocus).toBe('all')
    expect((await bob.get('/api/account/avatar')).status).toBe(404)
    expect(done.finding.map((finding: { category: string }) => finding.category)).toEqual(['security'])
    expect((await alice.get(`/api/review/${id}`)).status).toBe(200)
    const github = await sql<{ username: string, connected: boolean, login: string | null }>(
      'SELECT a.username, g.connected, g.login FROM github_connection g JOIN account a ON a.org_id = g.org_id ORDER BY a.username')
    expect(github).toEqual([
      { username: 'alice', connected: true, login: fakeUser },
      { username: 'bob', connected: false, login: null },
      { username: 'john.doe', connected: false, login: null }
    ])
    expect((await bob.get('/api/github/repo')).body.error.code).toBe('conflict')
  })
})

describe('upgrading a database built by migration 001', () => {
  it('schema.sql adds the columns, indexes and tables, and keeps the default data with the demo user name', async () => {
    const client = new pg.Client({ connectionString: url })
    await client.connect()
    const scratch = `upgrade_check_${Date.now()}`
    try {
      await client.query(`CREATE SCHEMA ${scratch}`)
      await client.query(`SET search_path TO ${scratch}`)
      await client.query(await readFile(new URL('../../db/migration/001-init.sql', import.meta.url), 'utf8'))
      await client.query(`INSERT INTO account (org_id, full_name, email, avatar_url, member_since, password_hash)
        VALUES ('default', 'John Doe', 'john@company.com', NULL, 'March 12, 2025', 'scrypt$00$11')`)
      const record = reviewRecord('kept-review')
      await client.query(`INSERT INTO review (id, org_id, title, status, language, content, created_at, analyzed_at)
        VALUES ($1, 'default', $2, 'completed', 'TypeScript', $3, now(), now())`, [record.id, record.review.title, record.review.content])
      await client.query("INSERT INTO setting (org_id, data) VALUES ('default', '{\"theme\":\"dark\"}'::jsonb)")
      // Plan 030: the mock flag of before, without a login.
      await client.query("INSERT INTO github_connection (org_id, connected) VALUES ('default', true)")

      await applySchema(client)
      await applySchema(client)

      const account = (await client.query('SELECT username, email, password_hash FROM account')).rows
      expect(account).toEqual([{ username: 'john.doe', email: 'john@company.com', password_hash: 'scrypt$00$11' }])
      expect((await client.query('SELECT id FROM review')).rows).toEqual([{ id: 'kept-review' }])
      expect((await client.query("SELECT data->>'theme' AS theme FROM setting")).rows).toEqual([{ theme: 'dark' }])
      const tableList = (await client.query('SELECT table_name FROM information_schema.tables WHERE table_schema = $1 ORDER BY table_name', [scratch])).rows
        .map((row: { table_name: string }) => row.table_name)
      expect(tableList).toEqual(expect.arrayContaining(['session', 'account_avatar']))
      const indexList = (await client.query('SELECT indexname FROM pg_indexes WHERE schemaname = $1', [scratch])).rows.map((row: { indexname: string }) => row.indexname)
      expect(indexList).toEqual(expect.arrayContaining(['account_username_lower_idx', 'account_email_lower_idx', 'session_org_id_idx', 'support_request_org_id_idx']))
      const nullable = (await client.query(`SELECT is_nullable FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'account' AND column_name = 'username'`, [scratch])).rows
      expect(nullable).toEqual([{ is_nullable: 'NO' }])
      // Plan 030: the GitHub row is kept, its new columns are nullable and empty, so it reads as not connected.
      const github = (await client.query('SELECT connected, login, display_name FROM github_connection')).rows
      expect(github).toEqual([{ connected: true, login: null, display_name: null }])
      const githubColumn = (await client.query(`SELECT column_name, is_nullable FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = 'github_connection' AND column_name IN ('login', 'display_name') ORDER BY column_name`, [scratch])).rows
      expect(githubColumn).toEqual([{ column_name: 'display_name', is_nullable: 'YES' }, { column_name: 'login', is_nullable: 'YES' }])
    } finally {
      await client.query(`DROP SCHEMA IF EXISTS ${scratch} CASCADE`)
      await client.end()
    }
  })
})
