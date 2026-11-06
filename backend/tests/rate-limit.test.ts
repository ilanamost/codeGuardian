import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRateLimiter } from '../src/lib/rate-limit.js'
import { buildApp, demoPassword, demoUsername, fixedNow, newAgent, signInAgent } from './helper/app.js'
import { expectContract, expectError } from './helper/contract.js'

// Plan 028, Scope 8: 5 failures per user name and 20 attempts per client IP in 15 minutes; a
// wrong current password counts as a failure of the account's user name.

const window = 15 * 60 * 1000

function clockApp() {
  const clock = { now: fixedNow }
  const built = buildApp({ now: () => clock.now }, true)
  return { ...built, clock }
}

function signIn(app: Parameters<typeof request>[0], username: string, password: string) {
  return newAgent(app).post('/api/session').send({ username, password })
}

describe('sign-in rate limit', () => {
  it('the 6th failed sign-in for one user name gets 429 with Retry-After, even with the correct password', async () => {
    const { rawApp } = clockApp()
    for (let index = 0; index < 5; index += 1) expectError(await signIn(rawApp, demoUsername, `wrong-${index}-pass`), 401, 'unauthorized')

    const limited = await signIn(rawApp, 'JOHN.DOE', demoPassword)

    expectError(limited, 429, 'rate_limited')
    expectContract(limited, '/api/session', 'POST')
    expect(limited.headers['retry-after']).toBe('900')
    expect(limited.body.error.details).toEqual({ retryAfterSecond: 900 })
    expect(limited.headers['set-cookie']).toBeUndefined()
  })

  it('an unknown user name behaves the same, with the same body', async () => {
    const known = clockApp()
    const unknown = clockApp()
    for (let index = 0; index < 5; index += 1) {
      await signIn(known.rawApp, demoUsername, 'wrong-pass-1')
      await signIn(unknown.rawApp, 'nobody', 'wrong-pass-1')
    }

    const first = await signIn(known.rawApp, demoUsername, 'wrong-pass-1')
    const second = await signIn(unknown.rawApp, 'nobody', 'wrong-pass-1')

    expectError(first, 429, 'rate_limited')
    expectError(second, 429, 'rate_limited')
    expect(first.body.error).toEqual(second.body.error)
    expect(first.headers['retry-after']).toBe(second.headers['retry-after'])
  })

  it('the failure limit of one user name does not lock another', async () => {
    const { rawApp } = clockApp()
    for (let index = 0; index < 5; index += 1) await signIn(rawApp, 'someone.else', 'wrong-pass-1')

    expect((await signIn(rawApp, demoUsername, demoPassword)).status).toBe(200)
  })

  it('the 21st attempt from one IP gets 429, successful ones included', async () => {
    const { rawApp } = clockApp()
    for (let index = 0; index < 20; index += 1) {
      const response = await signIn(rawApp, index % 2 === 0 ? demoUsername : `user${index}`, index % 2 === 0 ? demoPassword : 'wrong-pass-1')
      expect(response.status).not.toBe(429)
    }

    expectError(await signIn(rawApp, demoUsername, demoPassword), 429, 'rate_limited')
  })

  it('after the window (fixed clock), sign-in works again', async () => {
    const { rawApp, clock } = clockApp()
    for (let index = 0; index < 5; index += 1) await signIn(rawApp, demoUsername, 'wrong-pass-1')
    clock.now += window - 1000
    expect((await signIn(rawApp, demoUsername, demoPassword)).headers['retry-after']).toBe('1')

    clock.now += 1000

    expect((await signIn(rawApp, demoUsername, demoPassword)).status).toBe(200)
  })

  it('a wrong current password counts too, and the password change is then limited as well', async () => {
    const { rawApp } = clockApp()
    const agent = await signInAgent(rawApp)
    for (let index = 0; index < 5; index += 1) {
      expectError(await agent.put('/api/account/password').send({ currentPassword: `wrong-${index}-pass`, newPassword: 'brand-new-pass-42' }), 422, 'validation_error')
    }

    const change = await agent.put('/api/account/password').send({ currentPassword: demoPassword, newPassword: 'brand-new-pass-42' })

    expectError(change, 429, 'rate_limited')
    expectContract(change, '/api/account/password', 'PUT')
    expectError(await signIn(rawApp, demoUsername, demoPassword), 429, 'rate_limited')
  })

  it('the test reset clears the counters', async () => {
    const { rawApp } = clockApp()
    for (let index = 0; index < 5; index += 1) await signIn(rawApp, demoUsername, 'wrong-pass-1')

    expect((await request(rawApp).post('/api/test/reset').set('X-CSRF-Protection', '1')).status).toBe(204)

    expect((await signIn(rawApp, demoUsername, demoPassword)).status).toBe(200)
  })
})

describe('createRateLimiter', () => {
  it('slides: each hit leaves the window on its own', () => {
    const clock = { now: 0 }
    const limiter = createRateLimiter({ limit: 2, windowMs: 1000, now: () => clock.now })
    limiter.hit('a')
    clock.now = 400
    limiter.hit('a')

    expect(limiter.retryAfter('a')).toBe(1)
    clock.now = 1000
    expect(limiter.retryAfter('a')).toBeUndefined()
    limiter.hit('a')
    expect(limiter.retryAfter('a')).toBe(1)
    expect(limiter.retryAfter('b')).toBeUndefined()
  })
})

describe('sign-in logs', () => {
  const logLine: string[] = []

  beforeEach(() => {
    logLine.length = 0
    for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, level).mockImplementation((...arg: unknown[]) => { logLine.push(arg.map(String).join(' ')) })
    }
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('a failed sign-in logs one structured entry with requestId and a reason, and nothing secret', async () => {
    const { rawApp, store } = buildApp({ securityLogger: console })

    const failed = await signIn(rawApp, demoUsername, 'wrong-pass-1')

    expect(logLine).toHaveLength(1)
    const entry = JSON.parse(logLine[0] ?? '{}')
    expect(entry).toEqual({ level: 'warn', operation: 'session.signIn', requestId: failed.headers['x-request-id'], reason: 'wrong_password', userHash: expect.stringMatching(/^[0-9a-f]{12}$/) })

    const ok = await signIn(rawApp, demoUsername, demoPassword)
    const cookie = String(ok.headers['set-cookie']).split(';')[0]?.split('=')[1] ?? ''
    await request(rawApp).get('/api/review').set('cookie', 'cr_session=planted-and-wrong')
    await newAgent(rawApp).post('/api/review').set('origin', 'http://evil.example').send({})
    const everything = logLine.join('\n')
    expect(everything).toContain('"reason":"success"')
    expect(everything).toContain('"reason":"malformed_session_id"')
    expect(everything).toContain('"reason":"foreign_origin"')
    for (const secret of [demoPassword, 'wrong-pass-1', demoUsername, cookie, [...store.sessionMap.keys()][0] ?? 'none', store.state.account.passwordHash, 'planted-and-wrong']) {
      expect(everything).not.toContain(secret)
    }
  })
})
