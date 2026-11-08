import { describe, expect, it } from 'vitest'
import { createSessionCodeStore, hashSessionCode } from '../src/lib/session-code.js'

// Plan 048: the one-time code (authCode) that is swapped for a session id. Memory only, the
// SHA-256 hash of the code is the key, single use, 60 seconds.

const ttlMs = 60_000

function setup(maxCount = 100) {
  const clock = { value: 1_000_000 }
  const store = createSessionCodeStore({ now: () => clock.value, ttlMs, maxCount })
  return { clock, store }
}

describe('issue', () => {
  it('returns 43 URL-safe characters and a different code each time', () => {
    const { store } = setup()

    const first = store.issue('session-a')
    const second = store.issue('session-a')

    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(second).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(first).not.toBe(second)
  })

  it('keeps only the hash of the code, never the code', () => {
    const { store } = setup()

    const code = store.issue('session-a')

    expect(store.holds(hashSessionCode(code))).toBe(true)
    expect(store.holds(code)).toBe(false)
    expect(store.size()).toBe(1)
  })
})

describe('consume', () => {
  it('returns the session id once, then nothing', () => {
    const { store } = setup()
    const code = store.issue('session-a')

    expect(store.consume(code)).toBe('session-a')
    expect(store.consume(code)).toBeUndefined()
    expect(store.size()).toBe(0)
  })

  it('accepts a code just under 60 seconds old and refuses it at 60 seconds', () => {
    const { store, clock } = setup()
    const fresh = store.issue('fresh')
    const stale = store.issue('stale')

    clock.value += ttlMs - 1
    expect(store.consume(fresh)).toBe('fresh')
    clock.value += 1
    expect(store.consume(stale)).toBeUndefined()
    expect(store.size()).toBe(0)
  })

  it('returns undefined for an unknown, malformed, wrong-length or non-string code', () => {
    const { store } = setup()
    store.issue('session-a')

    for (const value of ['', 'short', 'x'.repeat(42), 'x'.repeat(44), `${'a'.repeat(42)}=`, ` ${'a'.repeat(42)}`, 'a'.repeat(43), undefined, null, 42, {}, [], ['a'.repeat(43)]]) {
      expect(store.consume(value)).toBeUndefined()
    }
    expect(store.size()).toBe(1)
  })

  it('a bad guess does not remove a good code', () => {
    const { store } = setup()
    const code = store.issue('session-a')

    expect(store.consume('b'.repeat(43))).toBeUndefined()
    expect(store.consume(code)).toBe('session-a')
  })
})

describe('size cap', () => {
  it('drops expired codes first when full', () => {
    const { store, clock } = setup(2)
    const old = store.issue('old')
    clock.value += 30_000
    const middle = store.issue('middle')
    clock.value += 30_000

    const newest = store.issue('newest')

    expect(store.size()).toBe(2)
    expect(store.consume(old)).toBeUndefined()
    expect(store.consume(middle)).toBe('middle')
    expect(store.consume(newest)).toBe('newest')
  })

  it('drops the oldest code when full and nothing has expired', () => {
    const { store } = setup(2)
    const first = store.issue('first')
    const second = store.issue('second')

    const third = store.issue('third')

    expect(store.size()).toBe(2)
    expect(store.consume(first)).toBeUndefined()
    expect(store.consume(second)).toBe('second')
    expect(store.consume(third)).toBe('third')
  })

  it('never holds more than maxCount codes', () => {
    const { store } = setup(5)

    for (let index = 0; index < 50; index += 1) store.issue(`session-${index}`)

    expect(store.size()).toBe(5)
  })
})

describe('reset', () => {
  it('forgets every code', () => {
    const { store } = setup()
    const code = store.issue('session-a')

    store.reset()

    expect(store.size()).toBe(0)
    expect(store.consume(code)).toBeUndefined()
  })
})
