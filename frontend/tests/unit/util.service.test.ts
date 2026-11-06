import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clamp,
  createId,
  createTicketNumber,
  delay,
  formatTimeAgo,
  groupBy,
  isNonEmptyString,
  matchesQuery,
  toggleItem,
  truncate
} from '../../src/services/util.service'

afterEach(() => {
  vi.useRealTimers()
})

describe('util.service', () => {
  it('delay resolves after the time passes', async () => {
    vi.useFakeTimers()
    const done = vi.fn()
    delay(100).then(done)

    await vi.advanceTimersByTimeAsync(99)
    expect(done).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(done).toHaveBeenCalled()
  })

  it('delay rejects when aborted', async () => {
    const controller = new AbortController()
    const pending = delay(10_000, controller.signal)
    controller.abort(new Error('stop'))

    await expect(pending).rejects.toThrow('stop')
    const aborted = new AbortController()
    aborted.abort(new Error('early'))
    await expect(delay(1, aborted.signal)).rejects.toThrow('early')
  })

  it('clamps numbers into a range', () => {
    expect(clamp(5, 0, 3)).toBe(3)
    expect(clamp(-1, 0, 3)).toBe(0)
    expect(clamp(2, 0, 3)).toBe(2)
  })

  it('detects non-empty strings', () => {
    expect(isNonEmptyString(' a ')).toBe(true)
    expect(isNonEmptyString('   ')).toBe(false)
    expect(isNonEmptyString(3)).toBe(false)
  })

  it('truncates long text with a suffix', () => {
    expect(truncate('abcdefgh', 5)).toBe('ab...')
    expect(truncate('abc', 5)).toBe('abc')
    expect(truncate('abcdef', 2)).toBe('ab')
    expect(truncate('abc', 0)).toBe('')
  })

  it('formats time ago', () => {
    const now = new Date('2026-10-20T12:00:00Z')

    expect(formatTimeAgo('2026-10-20T10:00:00Z', now)).toBe('2 hours ago')
    expect(formatTimeAgo('2026-10-19T12:00:00Z', now)).toBe('1 day ago')
    expect(formatTimeAgo('2026-10-20T11:59:30Z', now)).toBe('just now')
    expect(formatTimeAgo('2026-10-21T12:00:00Z', now)).toBe('just now')
  })

  it('creates ids and ticket numbers from the random source', () => {
    expect(createId('review', () => 0)).toBe('review-0000000')
    expect(createId('', () => 0.5)).toMatch(/^[0-9a-z]{7}$/)
    expect(createTicketNumber(() => 0)).toBe('SUP-1000')
    expect(createTicketNumber()).toMatch(/^SUP-\d{4}$/)
  })

  it('groups items by key', () => {
    expect(groupBy(['ab', 'ac', 'b'], (item) => item[0])).toEqual({ a: ['ab', 'ac'], b: ['b'] })
    expect(groupBy([], () => 'x')).toEqual({})
  })

  it('matches queries case-insensitively and toggles list items', () => {
    expect(matchesQuery('Backend-API', '  api ')).toBe(true)
    expect(matchesQuery('frontend', 'zzz')).toBe(false)
    expect(toggleItem(['a', 'b'], 'a')).toEqual(['b'])
    expect(toggleItem(['a'], 'b')).toEqual(['a', 'b'])
  })
})
