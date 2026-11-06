import { readFile } from 'node:fs/promises'
import pg from 'pg'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../../src/app.js'
import { createFakeGithubSignInClient } from '../../src/lib/github-signin-fake.js'
import { connectPgStore, type PgStore } from '../../src/store/pg-store.js'
import { frontendUrl } from './fixture.js'
import { testDatabaseUrl } from './helper.js'

// Plan 040 against the real test database (`npm run test:db`): the identity table, the nullable
// password hash, the one-transaction sign-up, migration 006, and the routes over PgStore.

const url = testDatabaseUrl()
const demoOrg = 'default'
let store: PgStore

beforeEach(async () => {
  store = await connectPgStore(url, 'TEST_DATABASE_URL')
  await store.reset()
})

afterEach(async () => {
  await store.close()
})

const account = (username: string, passwordHash: string | null) => ({
  username, fullName: username, email: `${username}@example.com`, memberSince: 'October 22, 2026', passwordHash
})

async function addGithubAccount(orgId: string, username: string, providerUserId: string) {
  return store.createAccount({
    orgId, orgName: username, account: account(username, null), settings: await store.getSettings(demoOrg),
    identity: { provider: 'github', providerUserId, login: username }
  })
}

describe('PgStore identities', () => {
  it('creates the org, a password-less account and its identity in one step; the account reads githubLogin', async () => {
    expect(await addGithubAccount('org-gh', 'octocat', '583231')).toEqual({ ok: true })

    expect(await store.getAccount('org-gh')).toMatchObject({ username: 'octocat', passwordHash: null, githubLogin: 'octocat' })
    expect(await store.findIdentity('github', '583231')).toEqual({ provider: 'github', providerUserId: '583231', orgId: 'org-gh', login: 'octocat' })
    expect(await store.findIdentityByOrg('org-gh', 'github')).toMatchObject({ providerUserId: '583231' })
    expect((await store.findAccountByUsername('OCTOCAT'))?.account.githubLogin).toBe('octocat')
    expect(await store.findAccountByEmail('Octocat@Example.com')).toEqual({ orgId: 'org-gh' })
    expect(await store.getAccount(demoOrg)).toMatchObject({ passwordHash: expect.any(String), githubLogin: null })
  })

  it('a GitHub id that is already linked rolls the whole sign-up back', async () => {
    await addGithubAccount('org-a', 'alice', '1')

    expect(await addGithubAccount('org-b', 'bob', '1')).toEqual({ ok: false, reason: 'conflict' })

    expect(await store.getAccount('org-b')).toBeUndefined()
    expect(await store.findAccountByUsername('bob')).toBeUndefined()
  })

  it('links, refuses a second identity for the org and a GitHub id used elsewhere, refreshes the login and unlinks', async () => {
    await addGithubAccount('org-a', 'alice', '1')

    expect(await store.createIdentity({ provider: 'github', providerUserId: '2', orgId: demoOrg, login: 'john' })).toEqual({ ok: true })
    expect(await store.createIdentity({ provider: 'github', providerUserId: '3', orgId: demoOrg, login: 'john2' })).toEqual({ ok: false, reason: 'conflict' })
    expect(await store.createIdentity({ provider: 'github', providerUserId: '1', orgId: demoOrg, login: 'taken' })).toEqual({ ok: false, reason: 'conflict' })
    await store.setIdentityLogin('github', '2', 'john-renamed')
    expect((await store.getAccount(demoOrg))?.githubLogin).toBe('john-renamed')
    expect(await store.deleteIdentity(demoOrg, 'github')).toBe(true)
    expect(await store.deleteIdentity(demoOrg, 'github')).toBe(false)
    expect((await store.getAccount(demoOrg))?.githubLogin).toBeNull()
  })

  it('the identity key is the provider user id, not the login', async () => {
    await addGithubAccount('org-a', 'alice', '1')

    expect(await store.findIdentity('github', 'alice')).toBeUndefined()
    await store.setIdentityLogin('github', '1', 'alice-renamed')
    expect(await store.findIdentity('github', '1')).toMatchObject({ orgId: 'org-a', login: 'alice-renamed' })
  })

  it('deleting the account row is not needed to unlink; reset empties identities too', async () => {
    await addGithubAccount('org-a', 'alice', '1')

    await store.reset()

    expect(await store.findIdentity('github', '1')).toBeUndefined()
    expect(await store.getAccount('org-a')).toBeUndefined()
  })
})

describe('migration 006 (plan 040)', () => {
  it('applies twice on a database built by migrations 001 to 005, keeps every account and relaxes the password hash', async () => {
    const client = new pg.Client({ connectionString: url })
    await client.connect()
    const scratch = `migration_006_${Date.now()}`
    try {
      await client.query(`CREATE SCHEMA ${scratch}`)
      await client.query(`SET search_path TO ${scratch}`)
      for (const name of ['001-init.sql', '002-session.sql', '003-github-login.sql', '004-test-config.sql', '005-failure-reason.sql']) {
        await client.query(await readFile(new URL(`../../db/migration/${name}`, import.meta.url), 'utf8'))
      }
      await client.query(`INSERT INTO account (org_id, full_name, email, member_since, password_hash, username)
        VALUES ('default', 'John', 'john@example.com', 'March 12, 2025', 'scrypt$00$11', 'john.doe')`)
      const migration = await readFile(new URL('../../db/migration/006-github-identity.sql', import.meta.url), 'utf8')

      await client.query(migration)
      await client.query(migration)

      const accounts = await client.query('SELECT username, password_hash FROM account')
      expect(accounts.rows).toEqual([{ username: 'john.doe', password_hash: 'scrypt$00$11' }])
      const column = await client.query(
        `SELECT is_nullable FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'account' AND column_name = 'password_hash'`)
      expect(column.rows).toEqual([{ is_nullable: 'YES' }])
      const table = await client.query(
        `SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'account_identity' ORDER BY column_name`)
      expect(table.rows.map((row: { column_name: string }) => row.column_name)).toEqual(['created_at', 'login', 'org_id', 'provider', 'provider_user_id'])
    } finally {
      await client.query(`DROP SCHEMA IF EXISTS ${scratch} CASCADE`)
      await client.end()
    }
  })
})

describe('GitHub sign-in routes over PostgreSQL', () => {
  const silent = { info: () => undefined, warn: () => undefined }
  const oauth = { clientId: 'cid', clientSecret: 'canary-client-secret-7f3a', redirectUrl: 'http://localhost:3001/api/auth/github/callback' }

  it('signs a new GitHub user up (no password), signs the same user in again, and refuses the password sign-in', async () => {
    const client = createFakeGithubSignInClient({ code: { id: '583231', login: 'octocat', name: 'The Octocat', email: 'octocat@example.com', emailVerified: true } })
    const app = createApp({ frontendUrl, enableTestRoute: false, githubOAuth: oauth }, { store, securityLogger: silent, githubSignInClient: client })
    const browser = request.agent(app).set('X-CSRF-Protection', '1')
    const start = await browser.get('/api/auth/github')
    const state = new URL(start.headers.location as string).searchParams.get('state') ?? ''

    const done = await browser.get('/api/auth/github/callback').query({ code: 'code', state })

    expect(done.status).toBe(302)
    expect(new URL(done.headers.location as string).pathname).toBe('/')
    expect((await browser.get('/api/session')).body.account).toMatchObject({ username: 'octocat', signInMethod: 'github', githubLogin: 'octocat' })
    const again = request.agent(app).set('X-CSRF-Protection', '1')
    const second = new URL((await again.get('/api/auth/github')).headers.location as string).searchParams.get('state') ?? ''
    expect((await again.get('/api/auth/github/callback').query({ code: 'code', state: second })).status).toBe(302)
    expect((await again.get('/api/session')).body.account.username).toBe('octocat')
    expect((await request.agent(app).set('X-CSRF-Protection', '1').post('/api/session').send({ username: 'octocat', password: 'anything-123' })).status).toBe(401)
    const reader = new pg.Client({ connectionString: url })
    await reader.connect()
    let dump = ''
    try {
      dump = JSON.stringify([(await reader.query('SELECT * FROM account_identity')).rows, (await reader.query('SELECT * FROM account')).rows, (await reader.query('SELECT * FROM session')).rows])
    } finally {
      await reader.end()
    }
    expect(dump).not.toContain(oauth.clientSecret)
    expect(dump).not.toContain('fake-token')
  })
})
