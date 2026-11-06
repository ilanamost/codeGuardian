import { performance } from 'node:perf_hooks'
import { describe, expect, it, vi } from 'vitest'

// QA plan 028, D5: the dummy scrypt hash for unknown user names is built when the session
// service is created, so the first unknown-user sign-in after start is not slower than the next
// ones (no user enumeration by timing). This file gets its own module instance, so the hash
// starts unbuilt here, as after a backend start.

const hashSpy = vi.hoisted(() => ({ count: 0 }))

vi.mock('../src/lib/password.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/lib/password.js')>()
  return {
    ...original,
    hashPassword: (password: string) => {
      hashSpy.count += 1
      return original.hashPassword(password)
    }
  }
})

const { createLoginLimiter } = await import('../src/lib/rate-limit.js')
const { createSessionService } = await import('../src/service/session.service.js')
const { createMemoryStore } = await import('../src/store/memory-store.js')

const silentLog = () => undefined
const context = { requestId: 'timing', ip: '127.0.0.1' }

function serviceOf() {
  const now = () => Date.parse('2026-10-22T10:00:00.000Z')
  return createSessionService(createMemoryStore(), createLoginLimiter(now), now, silentLog)
}

async function timeUnknownSignIn(service: ReturnType<typeof serviceOf>, username: string): Promise<number> {
  const start = performance.now()
  await expect(service.signIn({ username, password: 'not-the-password-1' }, undefined, context)).rejects.toMatchObject({ status: 401 })
  return performance.now() - start
}

describe('unknown-user sign-in timing', () => {
  it('builds the dummy hash when the service is created, never during a sign-in', async () => {
    const service = serviceOf()
    const afterCreate = hashSpy.count

    await timeUnknownSignIn(service, 'nobody.one')
    await timeUnknownSignIn(service, 'nobody.two')

    expect(afterCreate).toBeGreaterThanOrEqual(1)
    expect(hashSpy.count).toBe(afterCreate)
  })

  it('the first and the second unknown-user sign-ins take comparable time', async () => {
    const service = serviceOf()

    const first = await timeUnknownSignIn(service, 'stranger.one')
    const second = await timeUnknownSignIn(service, 'stranger.two')

    // Building a hash during the first sign-in would make it about twice the second. The bound
    // is generous so scheduling noise never fails it.
    expect(first).toBeLessThan(second * 1.6 + 25)
  })
})
