import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { createSessionId, hashSessionId } from '../src/lib/session.js'
import { buildApp, demoOrgId, fixedNow, newAgent, registrationOf, sessionCookieOf } from './helper/app.js'
import { contract, expectContract, expectError } from './helper/contract.js'

// Plan 028, Scope 4: every protected route answers 401 `unauthorized` in the standard error
// shape without a valid session. The routes come from the contract, so a new route is covered
// as soon as it is declared. (`auth-boundary` in the plan; renamed for the guardrail hook.)

type Operation = { security?: unknown[] }

const sample: Record<string, string> = { id: 'r1', repoId: 'repo-1', fileId: 'file-1' }

const protectedList = Object.entries(contract.paths as Record<string, Record<string, Operation>>).flatMap(([path, item]) =>
  Object.entries(item)
    .filter(([method, operation]) => method !== 'parameters' && !(Array.isArray(operation.security) && operation.security.length === 0))
    .map(([method]) => ({ method, path, url: path.replace(/\{(\w+)\}/g, (_all, name: string) => sample[name] ?? 'x') })))

function send(app: Parameters<typeof request>[0], method: string, url: string, cookie: string | undefined) {
  const pending = (request(app) as unknown as Record<string, (url: string) => request.Test>)[method]?.(url)
  if (!pending) throw new Error(`No method ${method}`)
  pending.set('X-CSRF-Protection', '1')
  if (cookie !== undefined) pending.set('cookie', cookie)
  return pending
}

// A session planted with the given expiry, for the expired cases.
function plant(store: ReturnType<typeof buildApp>['store'], expiresAt: number, absoluteExpiresAt: number): string {
  const id = createSessionId()
  store.sessionMap.set(hashSessionId(id), { idHash: hashSessionId(id), orgId: demoOrgId, createdAt: fixedNow - 1000, lastSeenAt: fixedNow - 1000, expiresAt, absoluteExpiresAt })
  return `cr_session=${id}`
}

describe('every protected route needs a session', () => {
  it('the contract has protected routes on every resource', () => {
    expect(protectedList.length).toBeGreaterThan(20)
    expect(protectedList.map((item) => `${item.method.toUpperCase()} ${item.path}`)).toContain('DELETE /api/session')
  })

  it.each(protectedList.map((item) => [`${item.method.toUpperCase()} ${item.path}`, item] as const))('%s answers 401 for no cookie, unknown, tampered, idle-expired and absolute-expired ids', async (_label, item) => {
    const { rawApp, store } = buildApp()
    const signIn = await newAgent(rawApp).post('/api/session').send({ username: 'john.doe', password: 'mock-password' })
    const valid = (sessionCookieOf(signIn) ?? '').split(';')[0] ?? ''
    const tampered = `${valid.slice(0, -1)}${valid.endsWith('A') ? 'B' : 'A'}`
    const caseList = [
      undefined,
      `cr_session=${createSessionId()}`,
      tampered,
      'cr_session=not a session id',
      plant(store, fixedNow, fixedNow + 1000),
      plant(store, fixedNow + 1000, fixedNow)
    ]

    for (const cookie of caseList) {
      const response = await send(rawApp, item.method, item.url, cookie)
      expectError(response, 401, 'unauthorized')
      expectContract(response, item.path, item.method.toUpperCase())
      expect(response.body.error.message).toBe('Sign in to continue.')
    }
    // The valid session still works and was never touched by the refusals.
    expect((await request(rawApp).get('/api/account').set('cookie', valid)).status).toBe(200)
  })

  it('an unknown path is 401 without a session, before the 404', async () => {
    const { rawApp } = buildApp()

    expectError(await request(rawApp).get('/api/nothing-here'), 401, 'unauthorized')
    expectError(await request(rawApp).get('/API/HEALTH/extra'), 401, 'unauthorized')
  })
})

describe('the public routes work without a session', () => {
  it('GET /api/health, POST /api/account and POST /api/session', async () => {
    const { rawApp } = buildApp()

    expect((await request(rawApp).get('/api/health')).status).toBe(200)
    expect((await request(rawApp).post('/api/account').set('X-CSRF-Protection', '1').send(registrationOf('carol'))).status).toBe(201)
    expect((await request(rawApp).post('/api/session').set('X-CSRF-Protection', '1').send({ username: 'carol', password: registrationOf('carol').password })).status).toBe(200)
  })

  it('the test reset is public only when the test route is on', async () => {
    const off = buildApp().rawApp
    const on = buildApp({}, true).rawApp

    expectError(await request(off).post('/api/test/reset').set('X-CSRF-Protection', '1'), 401, 'unauthorized')
    expect((await request(on).post('/api/test/reset').set('X-CSRF-Protection', '1')).status).toBe(204)
  })
})
